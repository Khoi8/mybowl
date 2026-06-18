/**
 * Read-model adapters: persisted sessions/games → the relational ("head-to-
 * head") input views from S3 (`H2HSessionView`, `SelfSessionView`).
 *
 * How we enumerate "a player's sessions": we join THROUGH `games`, not through
 * `session_players`. Games are where actual play is recorded — a participant
 * who was added to a session but never bowled has no games and so contributes
 * nothing to either the competitive or contextual stats. A game also carries
 * both `playerId` and `sessionId`, so a single `listGamesByPlayer` scan yields a
 * player's session ids directly.
 *
 * Solo games (`sessionId = null`) are deliberately NOT a shared session: a null
 * session is its own degenerate one-game series, so it never appears in
 * head-to-head (correct — you weren't bowling against anyone). Such games are
 * skipped when collecting a player's session ids.
 *
 * Determinism: shared sessions are ordered by session id, and games within each
 * are ordered by game id (UUIDv7, time-sortable) via `loadSeriesForPlayer`, so
 * pairing-by-order in the domain is chronological and stable.
 */

import { listGamesByPlayer } from '../repositories';
import type { Db } from '../types';
import type { H2HSessionView, SelfSessionView } from '../../domain/headtohead';
import { loadSeriesForPlayer } from './seriesForPlayer';

/** The distinct, live session ids in which a player has at least one game. */
function sessionIdsForPlayer(db: Db, playerId: string): Set<string> {
  const ids = new Set<string>();
  for (const game of listGamesByPlayer(db, playerId)) {
    // Skip solo games (null session) — they are not shared outings.
    if (game.sessionId !== null) ids.add(game.sessionId);
  }
  return ids;
}

/**
 * Competitive view: every session where BOTH the self player and the opponent
 * bowled at least one game, each carrying the two players' ordered game lists.
 * Sessions are ordered by id for determinism.
 */
export function loadH2HSessions(
  db: Db,
  selfPlayerId: string,
  opponentPlayerId: string,
): H2HSessionView[] {
  const selfSessions = sessionIdsForPlayer(db, selfPlayerId);
  const opponentSessions = sessionIdsForPlayer(db, opponentPlayerId);

  const shared = [...selfSessions].filter((id) => opponentSessions.has(id)).sort();

  return shared.map((sessionId) => ({
    sessionId,
    selfGames: loadSeriesForPlayer(db, sessionId, selfPlayerId),
    opponentGames: loadSeriesForPlayer(db, sessionId, opponentPlayerId),
  }));
}

/**
 * Contextual ("with / without") view: ALL of the self player's sessions, each
 * flagged by whether the opponent also bowled in it, with the self player's
 * ordered game list. Solo (null-session) games are excluded — the with/without
 * comparison is over shared-context outings, and a session is required to ask
 * "was the opponent present". Sessions are ordered by id for determinism.
 */
export function loadWithWithout(
  db: Db,
  selfPlayerId: string,
  opponentPlayerId: string,
): SelfSessionView[] {
  const opponentSessions = sessionIdsForPlayer(db, opponentPlayerId);
  const selfSessions = [...sessionIdsForPlayer(db, selfPlayerId)].sort();

  return selfSessions.map((sessionId) => ({
    sessionId,
    opponentPresent: opponentSessions.has(sessionId),
    selfGames: loadSeriesForPlayer(db, sessionId, selfPlayerId),
  }));
}
