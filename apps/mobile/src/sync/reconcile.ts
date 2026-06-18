/**
 * Last-write-wins (LWW) reconciliation — the pure decision primitive plus a
 * generic apply that writes "take-remote" rows into the local SQLite DB.
 *
 * Sync model (CLAUDE.md §5): MVP conflict resolution is last-write-wins per
 * record, keyed on `updatedAt` (ms epoch, stamped on every local write and
 * carried on every synced row). A pulled remote row is authoritative when it
 * wins, so applying it marks the local row `syncStatus = 'synced'` (NOT
 * pending) — it is now in agreement with the server, nothing to re-push.
 *
 * TIE RULE (deterministic, documented): when `updatedAt` is exactly equal,
 *   1. a TOMBSTONE wins over a live row (deletes are sticky — once a row is
 *      deleted on either side at the same instant, the delete stands, which is
 *      the safer default for an offline tracker: a re-created "ghost" row is
 *      worse than a missing one the user can re-add);
 *   2. if both or neither side is a tombstone, the row with the higher `id`
 *      wins. IDs are UUIDv7 (time-sortable, globally unique), so this is a
 *      stable, content-independent tiebreak that both client and server compute
 *      identically — guaranteeing convergence without coordination.
 * If `local` is undefined (the row is not present locally at all) we always
 * take the remote.
 *
 * This module is driver-agnostic: it imports only drizzle query helpers and the
 * shared schema types — no `expo-sqlite` — so it is Node-testable.
 */

import { eq } from 'drizzle-orm';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';

import type { Db } from '../db/types';

/**
 * The minimal view of a row that LWW needs. Real entity rows carry many more
 * columns; reconcile ignores all of them — only id + the two sync timestamps
 * decide the winner.
 */
export interface SyncableRow {
  id: string;
  updatedAt: number;
  deletedAt: number | null;
}

/** Whether a row is a tombstone (soft-deleted). */
function isTombstone(r: SyncableRow): boolean {
  return r.deletedAt !== null;
}

/**
 * Decide, by last-write-wins, whether to keep the local row or take the remote.
 *
 * See the module doc comment for the full tie rule. Summary:
 *   - newer `updatedAt` wins;
 *   - on a tie, a tombstone beats a live row;
 *   - on a tie with equal tombstone-ness, the higher UUIDv7 `id` wins;
 *   - undefined local ⇒ always take-remote.
 */
export function reconcile(
  local: SyncableRow | undefined,
  remote: SyncableRow,
): 'take-remote' | 'keep-local' {
  if (local === undefined) return 'take-remote';

  if (remote.updatedAt > local.updatedAt) return 'take-remote';
  if (local.updatedAt > remote.updatedAt) return 'keep-local';

  // Equal updatedAt — apply the documented tie rule.
  const remoteTomb = isTombstone(remote);
  const localTomb = isTombstone(local);
  if (remoteTomb !== localTomb) {
    return remoteTomb ? 'take-remote' : 'keep-local';
  }

  // Both or neither are tombstones: deterministic UUIDv7 id ordering.
  return remote.id > local.id ? 'take-remote' : 'keep-local';
}

/**
 * Any of bowli's syncable entity tables. They all share the four sync columns
 * (`id`, `updatedAt`, `deletedAt`, `syncStatus`) declared by `syncColumns()` in
 * `db/schema.ts`, which is all `applyRemoteRows` touches generically. Typing the
 * param as `SQLiteTable` (rather than a specific table) keeps the function
 * reusable across entities without `any`; the per-row shape is `RemoteRow`.
 */
export type EntityTable = SQLiteTable;

/**
 * A pulled remote row: at minimum the sync fields, plus whatever entity columns
 * the table carries (passed straight through to the upsert). We deliberately
 * accept extra keys via an index signature of `unknown` so callers can hand us
 * the full wire row without a per-table generic, while still forbidding `any`.
 */
export type RemoteRow = SyncableRow & { [column: string]: unknown };

/**
 * Apply a batch of pulled remote rows to `table` under LWW.
 *
 * For each remote row: read the local row by id, {@link reconcile}, and
 *   - 'take-remote' → upsert the full remote row (insert-or-replace on id),
 *     forcing `syncStatus = 'synced'` (a pulled, winning row is authoritative
 *     and in agreement with the server — not pending). Tombstones flow through
 *     naturally: the remote's `deletedAt` is part of the row.
 *   - 'keep-local' → skip; the local row stays exactly as-is (a newer local edit
 *     is never clobbered, and its pending status is preserved for re-push).
 *
 * Returns how many rows were applied vs skipped.
 */
export function applyRemoteRows(
  db: Db,
  table: EntityTable,
  rows: readonly RemoteRow[],
): { applied: number; skipped: number } {
  // Drizzle exposes table columns on the table object keyed by property name.
  // We only need `id` for the local lookup; the rest is carried in the row.
  const idColumn = (table as unknown as { id: SQLiteTable['_']['columns']['id'] }).id;

  let applied = 0;
  let skipped = 0;

  for (const remote of rows) {
    const [localRow] = db
      .select()
      .from(table)
      .where(eq(idColumn, remote.id))
      .all() as SyncableRow[];

    if (reconcile(localRow, remote) === 'keep-local') {
      skipped += 1;
      continue;
    }

    // A winning remote row is authoritative: store it verbatim but pin
    // syncStatus to 'synced'.
    const values = { ...remote, syncStatus: 'synced' };
    db.insert(table)
      .values(values)
      .onConflictDoUpdate({ target: idColumn, set: values })
      .run();
    applied += 1;
  }

  return { applied, skipped };
}
