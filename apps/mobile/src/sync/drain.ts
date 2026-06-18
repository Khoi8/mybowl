/**
 * Drain — push the local outbox to a transport when connectivity returns
 * (CLAUDE.md §5: outbox/queue pattern, network never blocks the user; ops are
 * drained out-of-band once online).
 *
 * The transport is DEPENDENCY-INJECTED (see {@link SyncTransport}) so this logic
 * is fully unit-testable headless: tests pass a mock transport + an in-memory
 * SQLite handle. The only Expo-coupled piece of S18 is `connectivity.ts` (the
 * NetInfo wrapper), which decides *when* to call `drain`, not *how* it works.
 *
 * RETRY POSTURE: drain pushes every retryable op (status `pending` OR `failed`)
 * in one batch. On transport success each op is marked `done`; on transport
 * error each op is marked `failed` (which increments `attempts` and records
 * `lastError`) and LEFT in the queue. A failed op is therefore retried by the
 * next drain — drains are idempotent and retry-safe: `done` ops are never
 * re-pushed, and a second drain after a failure re-attempts only the still-
 * unfinished ops. We push the whole batch in a single `transport.push(...)` so
 * either the batch lands server-side or it doesn't; partial-batch accounting is
 * a backend (S19) concern, not the client's.
 *
 * SCOPE — PUSH vs PULL: S18 implements PUSH fully here. The reconcile/apply
 * primitive that PULL needs (`applyRemoteRows`) lives in `reconcile.ts` and is
 * unit-tested there directly. `drainPull` below is a thin, optional convenience
 * that wires a transport `pull` to `applyRemoteRows`; the heavy LWW behavior it
 * relies on is proven in `reconcile.test.ts`. End-to-end multi-device pull is a
 * backend slice (S19) and a parked live-session concern (CLAUDE.md §1).
 *
 * Driver-agnostic: imports only the outbox helpers, the reconcile primitive,
 * and drizzle query helpers — no `expo-sqlite` — so it stays Node-testable.
 */

import { asc, inArray } from 'drizzle-orm';

import type { Db } from '../db/types';
import { markOpDone, markOpFailed } from './outbox';
import { syncOps, type SyncOp } from './schema';
import { applyRemoteRows, type EntityTable, type RemoteRow } from './reconcile';

/**
 * The wire shape of a single op handed to the transport. Derived from a stored
 * {@link SyncOp}, minus the local-only lifecycle bookkeeping (`status`,
 * `attempts`, `lastError`, `createdAt`) the server has no use for.
 */
export interface SyncOpPayload {
  id: string;
  entityTable: string;
  entityId: string;
  op: 'upsert' | 'delete';
  payload: unknown;
  entityUpdatedAt: number;
}

/** A row pulled from the server, tagged with the table it belongs to. */
export interface PulledRow {
  entityTable: string;
  row: RemoteRow;
}

/**
 * The injected sync transport. In production this is an HTTP client hitting the
 * Go `/sync` endpoints (S19); in tests it's a mock. `push` sends a batch of ops;
 * `pull` fetches rows changed since a cursor (ms epoch / opaque high-water mark).
 */
export interface SyncTransport {
  push(ops: SyncOpPayload[]): Promise<void>;
  pull(since: number): Promise<{ rows: PulledRow[]; cursor: number }>;
}

/** Outcome of a drain push pass. */
export interface DrainResult {
  pushed: number;
  failed: number;
}

/** Project a stored op into its wire payload. */
function toPayload(op: SyncOp): SyncOpPayload {
  return {
    id: op.id,
    entityTable: op.entityTable,
    entityId: op.entityId,
    op: op.op,
    payload: op.payload,
    entityUpdatedAt: op.entityUpdatedAt,
  };
}

/**
 * Retryable ops in UUIDv7 (creation-time) order: everything not yet `done`.
 * `pending` are fresh; `failed` are prior-attempt retries. `inflight` is
 * included defensively (a process that died mid-drain leaves an op inflight; the
 * next drain should re-attempt it rather than strand it). `done` is excluded.
 */
function listRetryableOps(db: Db): SyncOp[] {
  return db
    .select()
    .from(syncOps)
    .where(inArray(syncOps.status, ['pending', 'failed', 'inflight']))
    .orderBy(asc(syncOps.id))
    .all();
}

/**
 * Push all retryable outbox ops to the transport.
 *
 * Marks each op `inflight`, pushes the whole batch, then on success marks every
 * op `done`; on transport failure marks every op `failed` (incrementing
 * attempts + recording the error) and leaves them queued for the next drain.
 */
export async function drain(db: Db, transport: SyncTransport): Promise<DrainResult> {
  const ops = listRetryableOps(db);
  if (ops.length === 0) return { pushed: 0, failed: 0 };

  // Mark the batch inflight before the (async) network call.
  db.update(syncOps)
    .set({ status: 'inflight' })
    .where(
      inArray(
        syncOps.id,
        ops.map((o) => o.id),
      ),
    )
    .run();

  try {
    await transport.push(ops.map(toPayload));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    for (const op of ops) markOpFailed(db, op.id, message);
    return { pushed: 0, failed: ops.length };
  }

  for (const op of ops) markOpDone(db, op.id);
  return { pushed: ops.length, failed: 0 };
}

/**
 * Optional pull pass: fetch rows changed since `since`, group by table, and
 * apply each group under LWW via {@link applyRemoteRows}. Returns the new cursor
 * plus applied/skipped totals.
 *
 * The caller supplies a `tableFor` resolver (entityTable name → drizzle table)
 * because this module must not hard-wire the entity-table registry. The LWW
 * behavior itself is proven in `reconcile.test.ts`.
 */
export async function drainPull(
  db: Db,
  transport: SyncTransport,
  since: number,
  tableFor: (entityTable: string) => EntityTable | undefined,
): Promise<{ cursor: number; applied: number; skipped: number }> {
  const { rows, cursor } = await transport.pull(since);

  const byTable = new Map<string, RemoteRow[]>();
  for (const { entityTable, row } of rows) {
    const bucket = byTable.get(entityTable) ?? [];
    bucket.push(row);
    byTable.set(entityTable, bucket);
  }

  let applied = 0;
  let skipped = 0;
  for (const [entityTable, group] of byTable) {
    const table = tableFor(entityTable);
    if (table === undefined) continue;
    const res = applyRemoteRows(db, table, group);
    applied += res.applied;
    skipped += res.skipped;
  }

  return { cursor, applied, skipped };
}
