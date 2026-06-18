/**
 * Sync outbox — the device-side write path's enqueue primitive (CLAUDE.md §5).
 *
 * The contract: every local mutation must (1) write/tombstone the entity row AND
 * (2) enqueue a `sync_ops` row describing that change, ATOMICALLY. {@link
 * enqueueWithWrite} is the primitive that guarantees this — it runs the entity
 * write and the op insert inside a single `db.transaction(...)`, so either both
 * land or neither does. Repos route their mutations through it (see
 * `db/repositories/*`).
 *
 * Draining these ops to the backend is S18; the `markOp*` transitions here are
 * the lifecycle hooks that drain consumes.
 *
 * Driver-agnostic: imports only drizzle query helpers, the local UUIDv7
 * generator, and the sync schema — no `expo-sqlite`, so it stays Node-testable.
 */

import { asc, eq } from 'drizzle-orm';

import type { Db } from '../db/types';
import { syncOps, type NewSyncOp, type SyncOp } from './schema';

/**
 * The caller-supplied description of a single sync op. The repo computes this
 * from the row it just wrote: `entityUpdatedAt` is the row's `updatedAt`, and
 * `payload` is the full row snapshot for an 'upsert' or a minimal `{ id }`
 * marker for a 'delete'.
 */
export interface SyncOpInput {
  entityTable: string;
  entityId: string;
  op: 'upsert' | 'delete';
  payload: unknown;
  entityUpdatedAt: number;
}

/** Build the insert values for a pending op from a {@link SyncOpInput}. */
function opInsertValues(input: SyncOpInput): NewSyncOp {
  return {
    entityTable: input.entityTable,
    entityId: input.entityId,
    op: input.op,
    payload: input.payload,
    entityUpdatedAt: input.entityUpdatedAt,
    // id, createdAt, status, attempts all default via the schema.
  };
}

/**
 * Insert a single pending sync op (id + createdAt + status default via schema).
 *
 * This is the bare enqueue. Mutations should prefer {@link enqueueWithWrite} so
 * the op is transactionally bound to its entity write; use this only when the
 * op is being enqueued from WITHIN an existing transaction (e.g. one op per
 * frame inside `createGameWithFrames`).
 */
export function enqueueOp(db: Db, input: SyncOpInput): void {
  db.insert(syncOps).values(opInsertValues(input)).run();
}

/**
 * Run an entity `write` and enqueue its sync op in ONE transaction.
 *
 * `write(tx)` performs the entity mutation and returns its result (e.g. the
 * inserted/updated row). `op(result)` derives the {@link SyncOpInput} from that
 * result. Both the write and the op insert execute on the same `tx`, so:
 *   - if `op(...)` or the op insert throws, the entity write rolls back;
 *   - if `write(...)` throws, no op is enqueued (and nothing is written).
 *
 * Returns the value `write` produced. This is the key offline-first invariant:
 * no entity mutation ever lands without its corresponding queued op.
 */
export function enqueueWithWrite<T>(
  db: Db,
  write: (tx: Db) => T,
  op: (result: T) => SyncOpInput,
): T {
  return db.transaction((tx) => {
    const result = write(tx);
    enqueueOp(tx, op(result));
    return result;
  });
}

/** Pending ops in UUIDv7 (creation-time) order — the order they should drain. */
export function listPendingOps(db: Db): SyncOp[] {
  return db
    .select()
    .from(syncOps)
    .where(eq(syncOps.status, 'pending'))
    .orderBy(asc(syncOps.id))
    .all();
}

/** Mark an op as in-flight (a drain attempt has started). */
export function markOpInflight(db: Db, opId: string): void {
  db.update(syncOps).set({ status: 'inflight' }).where(eq(syncOps.id, opId)).run();
}

/** Mark an op as successfully drained. */
export function markOpDone(db: Db, opId: string): void {
  db.update(syncOps).set({ status: 'done' }).where(eq(syncOps.id, opId)).run();
}

/**
 * Mark an op as failed: flip status, increment `attempts`, and record the error.
 *
 * `attempts` is incremented relative to its current value (read-modify-write in
 * a transaction so concurrent-ish callers don't lose a count).
 */
export function markOpFailed(db: Db, opId: string, error?: string): void {
  db.transaction((tx) => {
    const [current] = tx
      .select({ attempts: syncOps.attempts })
      .from(syncOps)
      .where(eq(syncOps.id, opId))
      .all();
    if (current === undefined) throw new Error(`markOpFailed: no op with id ${opId}`);
    tx.update(syncOps)
      .set({
        status: 'failed',
        attempts: current.attempts + 1,
        lastError: error ?? null,
      })
      .where(eq(syncOps.id, opId))
      .run();
  });
}
