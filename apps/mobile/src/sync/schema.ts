/**
 * Drizzle SQLite schema for the local sync OUTBOX (`sync_ops`).
 *
 * This table is the device half of the offline-first sync (CLAUDE.md §5): every
 * local mutation enqueues an op here, in the SAME transaction that writes the
 * entity row, so a write and its op land together or not at all. S18 drains
 * these ops to the backend.
 *
 * Lives under `sync/` (vertical-slice separation from `db/`), but participates
 * in drizzle-kit migration generation: `drizzle.config.ts` lists BOTH this file
 * and `db/schema.ts` so a single forward-only migration covers everything.
 *
 * KEY DISTINCTION — the outbox is a LOCAL-ONLY queue. It is NOT itself synced,
 * so unlike the entity tables it does NOT carry `updatedAt`/`deletedAt`/
 * `syncStatus`. Its only sync-shaped concession is a client-generated UUIDv7 PK,
 * used purely for time-ordered draining (UUIDv7 sorts lexically by creation
 * time). The op's own lifecycle is tracked by `status`/`attempts`/`lastError`,
 * not by the entity sync columns.
 *
 * Like `db/schema.ts`, this module imports NOTHING from `expo-sqlite` — only the
 * pure drizzle table builders and the local UUIDv7 generator — so it stays
 * Node-testable (better-sqlite3) and reusable from the Expo runtime alike.
 */

import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { uuidv7 } from '../db/id';

/**
 * The local outbox of pending sync operations.
 *
 * - `id`             — UUIDv7 PK, client-generated; time-sortable so pending ops
 *                      drain in creation order.
 * - `entityTable`    — the source table name (e.g. 'players', 'games').
 * - `entityId`       — the affected row's id.
 * - `op`             — 'upsert' (create/update) or 'delete' (tombstone).
 * - `payload`        — JSON snapshot of the row for 'upsert' ops; for 'delete'
 *                      ops a minimal `{ id }` marker. Nullable for forward
 *                      flexibility.
 * - `entityUpdatedAt`— the entity row's `updatedAt` at enqueue time; lets the
 *                      drain/reconciler reason about staleness without re-reading.
 * - `createdAt`      — ms epoch the op was enqueued; defaults to now.
 * - `status`         — local op lifecycle: pending → inflight → done | failed.
 * - `attempts`       — number of drain attempts; incremented on failure.
 * - `lastError`      — last failure message, for diagnostics; null until a failure.
 */
export const syncOps = sqliteTable('sync_ops', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => uuidv7()),
  entityTable: text('entity_table').notNull(),
  entityId: text('entity_id').notNull(),
  op: text('op', { enum: ['upsert', 'delete'] }).notNull(),
  payload: text('payload', { mode: 'json' }).$type<unknown>(),
  entityUpdatedAt: integer('entity_updated_at').notNull(),
  createdAt: integer('created_at')
    .notNull()
    .$defaultFn(() => Date.now()),
  status: text('status', { enum: ['pending', 'inflight', 'done', 'failed'] })
    .notNull()
    .default('pending'),
  attempts: integer('attempts').notNull().default(0),
  lastError: text('last_error'),
});

/** All sync-local tables, for drizzle-kit generation and `drizzle(sqlite, { schema })`. */
export const syncSchema = {
  syncOps,
} as const;

export type SyncOp = typeof syncOps.$inferSelect;
export type NewSyncOp = typeof syncOps.$inferInsert;
