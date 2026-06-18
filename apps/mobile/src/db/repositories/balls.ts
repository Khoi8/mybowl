/**
 * Ball repository — offline-first CRUD over the `balls` table (the arsenal).
 *
 * A Ball is a piece of equipment owned by an account (`ownerUserId`). Every
 * write stamps sync metadata: inserts default `updatedAt`/`syncStatus` via the
 * schema; updates and tombstone deletes bump `updatedAt = Date.now()` and reset
 * `syncStatus = 'pending'` so the sync outbox (S17) re-pushes them.
 *
 * Deletes are TOMBSTONES (`deletedAt` set), never physical — that is what lets
 * the change propagate through last-write-wins sync. `getBallById`, `listBalls`
 * and `listActiveBalls` all treat tombstoned rows as gone.
 *
 * RETIRED vs DELETED are distinct: a retired ball is still a live row (history,
 * stats, and old games keep referencing it) but is hidden from NEW per-throw
 * tagging. `listActiveBalls` excludes both tombstones and retired balls;
 * `listBalls` excludes only tombstones (retired balls stay, for history/edit).
 */

import { and, eq, isNull } from 'drizzle-orm';

import { enqueueWithWrite } from '../../sync/outbox';
import { balls, type Ball, type NewBall } from '../schema';
import type { Db } from '../types';

/** Domain fields a caller supplies when creating a ball. */
export type CreateBallInput = {
  ownerUserId: string;
  name: string;
  brand?: string | null;
  coverstock?: string | null;
  layout?: string | null;
  surface?: string | null;
  weight?: number | null;
  retired?: boolean;
};

/** Mutable domain fields on a ball. Sync columns are managed by the repo. */
export type BallPatch = Partial<{
  name: string;
  brand: string | null;
  coverstock: string | null;
  layout: string | null;
  surface: string | null;
  weight: number | null;
  retired: boolean;
}>;

/**
 * Insert a ball, returning the created row (id + sync defaults populated).
 * The insert and its 'upsert' sync op are enqueued atomically (S17).
 */
export function createBall(db: Db, input: CreateBallInput): Ball {
  const values: NewBall = { ownerUserId: input.ownerUserId, name: input.name };
  if (input.brand !== undefined) values.brand = input.brand;
  if (input.coverstock !== undefined) values.coverstock = input.coverstock;
  if (input.layout !== undefined) values.layout = input.layout;
  if (input.surface !== undefined) values.surface = input.surface;
  if (input.weight !== undefined) values.weight = input.weight;
  if (input.retired !== undefined) values.retired = input.retired;

  return enqueueWithWrite(
    db,
    (tx) => {
      const [row] = tx.insert(balls).values(values).returning().all();
      if (row === undefined) throw new Error('createBall: insert returned no row');
      return row;
    },
    (row) => ({
      entityTable: 'balls',
      entityId: row.id,
      op: 'upsert',
      payload: row,
      entityUpdatedAt: row.updatedAt,
    }),
  );
}

/** Apply a patch and re-stamp sync metadata. Returns the updated row. */
export function updateBall(db: Db, id: string, patch: BallPatch): Ball {
  return enqueueWithWrite(
    db,
    (tx) => {
      const [row] = tx
        .update(balls)
        .set({ ...patch, updatedAt: Date.now(), syncStatus: 'pending' })
        .where(eq(balls.id, id))
        .returning()
        .all();
      if (row === undefined) throw new Error(`updateBall: no ball with id ${id}`);
      return row;
    },
    (row) => ({
      entityTable: 'balls',
      entityId: row.id,
      op: 'upsert',
      payload: row,
      entityUpdatedAt: row.updatedAt,
    }),
  );
}

/** Tombstone a ball (soft delete). Never physically removes the row. */
export function softDeleteBall(db: Db, id: string): void {
  enqueueWithWrite(
    db,
    (tx) => {
      const updatedAt = Date.now();
      tx.update(balls)
        .set({ deletedAt: updatedAt, updatedAt, syncStatus: 'pending' })
        .where(eq(balls.id, id))
        .run();
      return updatedAt;
    },
    (updatedAt) => ({
      entityTable: 'balls',
      entityId: id,
      op: 'delete',
      payload: { id },
      entityUpdatedAt: updatedAt,
    }),
  );
}

/** Fetch a live ball by id; tombstoned rows are treated as gone (undefined). */
export function getBallById(db: Db, id: string): Ball | undefined {
  const [row] = db
    .select()
    .from(balls)
    .where(and(eq(balls.id, id), isNull(balls.deletedAt)))
    .all();
  return row;
}

/** List all live (non-tombstoned) balls for an account, retired included. */
export function listBalls(db: Db, ownerUserId: string): Ball[] {
  return db
    .select()
    .from(balls)
    .where(and(eq(balls.ownerUserId, ownerUserId), isNull(balls.deletedAt)))
    .all();
}

/**
 * List balls eligible for NEW per-throw tagging: live (non-tombstoned) AND not
 * retired. Retired balls stay in `listBalls`/history but drop out here.
 */
export function listActiveBalls(db: Db, ownerUserId: string): Ball[] {
  return db
    .select()
    .from(balls)
    .where(
      and(
        eq(balls.ownerUserId, ownerUserId),
        isNull(balls.deletedAt),
        eq(balls.retired, false),
      ),
    )
    .all();
}
