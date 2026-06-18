/**
 * Frame repository — offline-first CRUD over the `frames` table.
 *
 * A frame's `throws` / `ballIdPerThrow` / `pinState` are JSON arrays (see S5).
 * `listFramesByGame` returns frames ORDERED by `frameNo` so callers can feed
 * them straight into the pure scoring/stats domain without re-sorting.
 *
 * Sync stamping and tombstone semantics mirror the other repos.
 */

import { and, asc, eq, isNull } from 'drizzle-orm';

import { enqueueWithWrite } from '../../sync/outbox';
import { frames, type Frame, type NewFrame } from '../schema';
import type { Db } from '../types';

export type CreateFrameInput = {
  gameId: string;
  frameNo: number;
  throws: number[];
  ballIdPerThrow: (string | null)[];
  pinState: number[];
};

export type FramePatch = Partial<{
  frameNo: number;
  throws: number[];
  ballIdPerThrow: (string | null)[];
  pinState: number[];
}>;

/** Build the insert values for a frame (shared with the transactional game create). */
export function frameInsertValues(input: CreateFrameInput): NewFrame {
  return {
    gameId: input.gameId,
    frameNo: input.frameNo,
    throws: input.throws,
    ballIdPerThrow: input.ballIdPerThrow,
    pinState: input.pinState,
  };
}

/** Build the 'upsert' op for a frame row. */
function frameUpsertOp(row: Frame): {
  entityTable: string;
  entityId: string;
  op: 'upsert';
  payload: unknown;
  entityUpdatedAt: number;
} {
  return {
    entityTable: 'frames',
    entityId: row.id,
    op: 'upsert',
    payload: row,
    entityUpdatedAt: row.updatedAt,
  };
}

/** Insert a frame, returning the created row. Write + 'upsert' op are atomic. */
export function createFrame(db: Db, input: CreateFrameInput): Frame {
  return enqueueWithWrite(
    db,
    (tx) => {
      const [row] = tx.insert(frames).values(frameInsertValues(input)).returning().all();
      if (row === undefined) throw new Error('createFrame: insert returned no row');
      return row;
    },
    frameUpsertOp,
  );
}

/** Apply a patch and re-stamp sync metadata. Returns the updated row. */
export function updateFrame(db: Db, id: string, patch: FramePatch): Frame {
  return enqueueWithWrite(
    db,
    (tx) => {
      const [row] = tx
        .update(frames)
        .set({ ...patch, updatedAt: Date.now(), syncStatus: 'pending' })
        .where(eq(frames.id, id))
        .returning()
        .all();
      if (row === undefined) throw new Error(`updateFrame: no frame with id ${id}`);
      return row;
    },
    frameUpsertOp,
  );
}

/** Tombstone a frame (soft delete). */
export function softDeleteFrame(db: Db, id: string): void {
  enqueueWithWrite(
    db,
    (tx) => {
      const updatedAt = Date.now();
      tx.update(frames)
        .set({ deletedAt: updatedAt, updatedAt, syncStatus: 'pending' })
        .where(eq(frames.id, id))
        .run();
      return updatedAt;
    },
    (updatedAt) => ({
      entityTable: 'frames',
      entityId: id,
      op: 'delete',
      payload: { id },
      entityUpdatedAt: updatedAt,
    }),
  );
}

/** Fetch a live frame by id; tombstoned rows are treated as gone. */
export function getFrameById(db: Db, id: string): Frame | undefined {
  const [row] = db
    .select()
    .from(frames)
    .where(and(eq(frames.id, id), isNull(frames.deletedAt)))
    .all();
  return row;
}

/** List a game's live frames, ordered 1..10 by `frameNo`. */
export function listFramesByGame(db: Db, gameId: string): Frame[] {
  return db
    .select()
    .from(frames)
    .where(and(eq(frames.gameId, gameId), isNull(frames.deletedAt)))
    .orderBy(asc(frames.frameNo))
    .all();
}
