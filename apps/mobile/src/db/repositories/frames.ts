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

/** Insert a frame, returning the created row. */
export function createFrame(db: Db, input: CreateFrameInput): Frame {
  const [row] = db.insert(frames).values(frameInsertValues(input)).returning().all();
  if (row === undefined) throw new Error('createFrame: insert returned no row');
  return row;
}

/** Apply a patch and re-stamp sync metadata. Returns the updated row. */
export function updateFrame(db: Db, id: string, patch: FramePatch): Frame {
  const [row] = db
    .update(frames)
    .set({ ...patch, updatedAt: Date.now(), syncStatus: 'pending' })
    .where(eq(frames.id, id))
    .returning()
    .all();
  if (row === undefined) throw new Error(`updateFrame: no frame with id ${id}`);
  return row;
}

/** Tombstone a frame (soft delete). */
export function softDeleteFrame(db: Db, id: string): void {
  db.update(frames)
    .set({ deletedAt: Date.now(), syncStatus: 'pending' })
    .where(eq(frames.id, id))
    .run();
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
