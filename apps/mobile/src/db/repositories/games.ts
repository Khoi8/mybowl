/**
 * Game repository — offline-first CRUD over the `games` table, plus the
 * transactional `createGameWithFrames`.
 *
 * Identity crux (CLAUDE.md §6): a game points at a Player (`playerId`), and
 * `ownerUserId` is merely the recording account — the two are distinct. A solo
 * game has `sessionId = null`; a group game references its session.
 *
 * Sync stamping and tombstone semantics mirror the other repos.
 */

import { and, eq, isNull } from 'drizzle-orm';

import { enqueueOp, enqueueWithWrite } from '../../sync/outbox';
import {
  frames,
  games,
  type Frame,
  type Game,
  type NewFrame,
  type NewGame,
} from '../schema';
import type { Db } from '../types';

export type CreateGameInput = {
  ownerUserId: string;
  playerId: string;
  date: string;
  sessionId?: string | null;
  leagueId?: string | null;
  locationId?: string | null;
  lane?: string | null;
  oilPatternId?: string | null;
  notes?: string | null;
};

export type GamePatch = Partial<{
  date: string;
  sessionId: string | null;
  leagueId: string | null;
  locationId: string | null;
  lane: string | null;
  oilPatternId: string | null;
  notes: string | null;
}>;

/**
 * Per-frame input for {@link createGameWithFrames}. `gameId` is supplied by the
 * transaction (derived from the freshly-inserted game), so it is NOT part of
 * this shape. An optional explicit `id` is accepted for callers that
 * pre-generate ids; reusing one within a batch is a PK violation and rolls the
 * whole game back.
 */
export type GameFrameInput = {
  id?: string;
  frameNo: number;
  throws: number[];
  ballIdPerThrow: (string | null)[];
  pinState: number[];
};

function gameInsertValues(input: CreateGameInput): NewGame {
  const values: NewGame = {
    ownerUserId: input.ownerUserId,
    playerId: input.playerId,
    date: input.date,
  };
  if (input.sessionId !== undefined) values.sessionId = input.sessionId;
  if (input.leagueId !== undefined) values.leagueId = input.leagueId;
  if (input.locationId !== undefined) values.locationId = input.locationId;
  if (input.lane !== undefined) values.lane = input.lane;
  if (input.oilPatternId !== undefined) values.oilPatternId = input.oilPatternId;
  if (input.notes !== undefined) values.notes = input.notes;
  return values;
}

/** Build the 'upsert' op for a game row. */
function gameUpsertOp(row: Game): {
  entityTable: string;
  entityId: string;
  op: 'upsert';
  payload: unknown;
  entityUpdatedAt: number;
} {
  return {
    entityTable: 'games',
    entityId: row.id,
    op: 'upsert',
    payload: row,
    entityUpdatedAt: row.updatedAt,
  };
}

/** Insert a game, returning the created row. Write + 'upsert' op are atomic. */
export function createGame(db: Db, input: CreateGameInput): Game {
  return enqueueWithWrite(
    db,
    (tx) => {
      const [row] = tx.insert(games).values(gameInsertValues(input)).returning().all();
      if (row === undefined) throw new Error('createGame: insert returned no row');
      return row;
    },
    gameUpsertOp,
  );
}

/** Apply a patch and re-stamp sync metadata. Returns the updated row. */
export function updateGame(db: Db, id: string, patch: GamePatch): Game {
  return enqueueWithWrite(
    db,
    (tx) => {
      const [row] = tx
        .update(games)
        .set({ ...patch, updatedAt: Date.now(), syncStatus: 'pending' })
        .where(eq(games.id, id))
        .returning()
        .all();
      if (row === undefined) throw new Error(`updateGame: no game with id ${id}`);
      return row;
    },
    gameUpsertOp,
  );
}

/** Tombstone a game (soft delete). */
export function softDeleteGame(db: Db, id: string): void {
  enqueueWithWrite(
    db,
    (tx) => {
      const updatedAt = Date.now();
      tx.update(games)
        .set({ deletedAt: updatedAt, updatedAt, syncStatus: 'pending' })
        .where(eq(games.id, id))
        .run();
      return updatedAt;
    },
    (updatedAt) => ({
      entityTable: 'games',
      entityId: id,
      op: 'delete',
      payload: { id },
      entityUpdatedAt: updatedAt,
    }),
  );
}

/** Fetch a live game by id; tombstoned rows are treated as gone. */
export function getGameById(db: Db, id: string): Game | undefined {
  const [row] = db
    .select()
    .from(games)
    .where(and(eq(games.id, id), isNull(games.deletedAt)))
    .all();
  return row;
}

/** List a session's live games. */
export function listGamesBySession(db: Db, sessionId: string): Game[] {
  return db
    .select()
    .from(games)
    .where(and(eq(games.sessionId, sessionId), isNull(games.deletedAt)))
    .all();
}

/** List a player's live games. */
export function listGamesByPlayer(db: Db, playerId: string): Game[] {
  return db
    .select()
    .from(games)
    .where(and(eq(games.playerId, playerId), isNull(games.deletedAt)))
    .all();
}

/**
 * Atomically create a game and all of its frames. If ANY frame insert fails
 * (FK/PK/constraint), the whole transaction rolls back — no partial game is left
 * behind. Returns the created game and its frames.
 */
export function createGameWithFrames(
  db: Db,
  gameInput: CreateGameInput,
  frameInputs: GameFrameInput[],
): { game: Game; frames: Frame[] } {
  return db.transaction((tx) => {
    const [game] = tx.insert(games).values(gameInsertValues(gameInput)).returning().all();
    if (game === undefined)
      throw new Error('createGameWithFrames: game insert returned no row');

    // One 'upsert' op per entity, all WITHIN this same transaction so the whole
    // game + its frames + their ops land together or roll back together (S17).
    enqueueOp(tx, gameUpsertOp(game));

    const insertedFrames: Frame[] = [];
    for (const fi of frameInputs) {
      const values: NewFrame = {
        gameId: game.id,
        frameNo: fi.frameNo,
        throws: fi.throws,
        ballIdPerThrow: fi.ballIdPerThrow,
        pinState: fi.pinState,
      };
      if (fi.id !== undefined) values.id = fi.id;

      const [frame] = tx.insert(frames).values(values).returning().all();
      if (frame === undefined) {
        throw new Error('createGameWithFrames: frame insert returned no row');
      }
      enqueueOp(tx, {
        entityTable: 'frames',
        entityId: frame.id,
        op: 'upsert',
        payload: frame,
        entityUpdatedAt: frame.updatedAt,
      });
      insertedFrames.push(frame);
    }

    return { game, frames: insertedFrames };
  });
}
