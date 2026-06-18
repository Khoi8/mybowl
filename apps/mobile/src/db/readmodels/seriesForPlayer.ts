/**
 * Read-model adapters: a player's games (within a session, or across all
 * sessions) → the `number[][][]` series shape the domain consumes
 * (`computeSeriesStats`, and the per-player game lists inside `H2HSessionView`).
 *
 * Game ordering: rows are sorted by their UUIDv7 `id`. UUIDv7 is time-sortable
 * (S4), so lexical id order == insertion/chronological order == "game 1, game
 * 2, …". This gives a stable, chronological order so pairing-by-order in
 * head-to-head is meaningful, without depending on row scan order from SQLite.
 */

import { listGamesByPlayer, listGamesBySession } from '../repositories';
import type { Game } from '../schema';
import type { Db } from '../types';
import { loadGameFrames } from './gameFrames';

/** Stable chronological game order: UUIDv7 ids sort lexically by time. */
function byId(a: Game, b: Game): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * A player's games WITHIN one session, each as its frames (`number[][]`), in
 * chronological order. This is the player's "series" for that outing — the unit
 * head-to-head pairs by order. Intersects the session's live games with the
 * player (a solo game with `sessionId = null` never matches a real `sessionId`,
 * so it cannot leak in here).
 */
export function loadSeriesForPlayer(
  db: Db,
  sessionId: string,
  playerId: string,
): number[][][] {
  return listGamesBySession(db, sessionId)
    .filter((game) => game.playerId === playerId)
    .sort(byId)
    .map((game) => loadGameFrames(db, game.id));
}

/**
 * ALL of a player's live games across every session (and solo games with a null
 * session), each as its frames, in chronological order. Useful for whole-career
 * solo stats (`computeSeriesStats`) that span outings.
 */
export function loadAllGamesForPlayer(db: Db, playerId: string): number[][][] {
  return listGamesByPlayer(db, playerId)
    .sort(byId)
    .map((game) => loadGameFrames(db, game.id));
}
