/**
 * Sessions store — the per-outing surface that ties context, participants, and
 * their games together.
 *
 * RN-FREE by design: this module imports only `zustand/vanilla` and the
 * (Node-testable) session/game repositories. It must NOT import
 * `react-native`/`expo`/`nativewind`/`react` — that would break the headless
 * Vitest run. The React binding lives in `useSession.ts`, and the `.tsx`
 * screens consume that hook.
 *
 * THE CRUX (CLAUDE.md §5/§6/§11): a solo game is the DEGENERATE one-participant
 * case of a group session — NOT a separate code path. `startSolo` is a thin
 * convenience that goes through the SAME `createSession` + `addParticipant`
 * functions a group outing uses; the ONLY material difference is `isGroup`
 * (false for solo, true for a multi-participant outing) and the participant
 * count. There is no solo-only table or flow.
 *
 * "Session holds context once; games inherit it": `gameMetaFor` builds the
 * `GameMeta` the scoring store's `commit` consumes by reading the session's
 * locationId/lane/oilPatternId (plus its id + ownerUserId) and stamping them
 * onto a game for a given participant. That is where context inheritance is
 * realized — callers never re-type the context per game.
 *
 * No persistence/identity logic is re-implemented here — create/add/list all
 * delegate to `db/repositories/{sessions,games}`. Player rows are NOT created
 * here (that is S11's reuse-first contacts flow); `addParticipant` only links
 * an EXISTING player id into the session.
 */

import { createStore, type StoreApi } from 'zustand/vanilla';

import type { Db } from '../../db/types';
import type { Game, Session } from '../../db/schema';
import type { GameMeta } from '../scoring/store';
import {
  addSessionPlayer,
  createSession,
  listSessionPlayers,
  type CreateSessionInput,
  type SessionPlayerRow,
} from '../../db/repositories/sessions';
import { listGamesBySession } from '../../db/repositories/games';

/** Context a caller supplies once for a whole outing (solo or group). */
export type SessionContext = {
  ownerUserId: string;
  date: string;
  locationId?: string | null;
  lane?: string | null;
  oilPatternId?: string | null;
  notes?: string | null;
};

/** A participant paired with the set of games they bowled in the session. */
export interface ParticipantGames {
  readonly participant: SessionPlayerRow;
  readonly games: readonly Game[];
}

export interface SessionsState {
  /**
   * Create an outing. `isGroup` is pure metadata — the recording flow is
   * identical whether it is true or false. Solo callers use {@link startSolo},
   * which delegates here with `isGroup: false`.
   */
  createSession: (db: Db, input: CreateSessionInput) => Session;

  /**
   * Link an EXISTING player (from S11's contacts) into the session as a
   * participant. Does NOT create players. `turnOrder` is optional.
   */
  addParticipant: (
    db: Db,
    sessionId: string,
    playerId: string,
    turnOrder?: number | null,
  ) => SessionPlayerRow;

  /** A session's live participants. */
  listParticipants: (db: Db, sessionId: string) => SessionPlayerRow[];

  /**
   * Convenience for solo play: the degenerate one-participant session. Creates
   * a session with `isGroup: false` and adds the self player as the sole
   * participant — going through the SAME `createSession`/`addParticipant`
   * functions a group outing uses (no separate solo path). Returns both the
   * session and the lone participant row.
   */
  startSolo: (
    db: Db,
    input: SessionContext & { selfPlayerId: string },
  ) => { session: Session; participant: SessionPlayerRow };

  /**
   * Build the {@link GameMeta} the scoring store's `commit` consumes for one
   * participant, INHERITING the session's context (locationId/lane/
   * oilPatternId, sessionId, ownerUserId). This is how "session holds context
   * once; games inherit it" is realized — the per-game date defaults to the
   * session date but can be overridden.
   */
  gameMetaFor: (session: Session, playerId: string, date?: string) => GameMeta;

  /**
   * Group a session's games by participant: each participant's set of games is
   * their series for that outing. Participants with no games yet appear with an
   * empty `games` array (preserving participant order).
   */
  listSessionGamesByPlayer: (db: Db, sessionId: string) => ParticipantGames[];
}

export function createSessionsStore(): StoreApi<SessionsState> {
  return createStore<SessionsState>(() => ({
    createSession: (db: Db, input: CreateSessionInput): Session =>
      createSession(db, input),

    addParticipant: (
      db: Db,
      sessionId: string,
      playerId: string,
      turnOrder?: number | null,
    ): SessionPlayerRow => {
      const input: { sessionId: string; playerId: string; turnOrder?: number | null } = {
        sessionId,
        playerId,
      };
      if (turnOrder !== undefined) input.turnOrder = turnOrder;
      return addSessionPlayer(db, input);
    },

    listParticipants: (db: Db, sessionId: string): SessionPlayerRow[] =>
      listSessionPlayers(db, sessionId),

    startSolo: (
      db: Db,
      input: SessionContext & { selfPlayerId: string },
    ): { session: Session; participant: SessionPlayerRow } => {
      const { selfPlayerId, ...context } = input;
      // SAME code path as a group outing — isGroup:false is the only difference.
      const session = createSession(db, { ...context, isGroup: false });
      const participant = addSessionPlayer(db, {
        sessionId: session.id,
        playerId: selfPlayerId,
      });
      return { session, participant };
    },

    gameMetaFor: (session: Session, playerId: string, date?: string): GameMeta => ({
      ownerUserId: session.ownerUserId,
      playerId,
      date: date ?? session.date,
      sessionId: session.id,
      // Context inherited from the session — recorded once, stamped onto games.
      locationId: session.locationId,
      lane: session.lane,
      oilPatternId: session.oilPatternId,
    }),

    listSessionGamesByPlayer: (db: Db, sessionId: string): ParticipantGames[] => {
      const participants = listSessionPlayers(db, sessionId);
      const games = listGamesBySession(db, sessionId);
      return participants.map((participant) => ({
        participant,
        games: games.filter((g) => g.playerId === participant.playerId),
      }));
    },
  }));
}
