/**
 * Tests for `drain` — pushing the local outbox to a transport.
 *
 * The transport is dependency-injected, so we mock it: a success transport that
 * records what it received, and a failing transport that throws. The DB is a
 * real in-memory better-sqlite3 (memoryDb) so op lifecycle transitions
 * (pending → inflight → done | failed, attempts/lastError) are exercised for
 * real, not stubbed.
 */

import { asc, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { createMemoryDb, type Db } from '../db/testing/memoryDb';
import { enqueueOp, listPendingOps } from './outbox';
import { syncOps } from './schema';
import { drain, type SyncOpPayload, type SyncTransport } from './drain';

/** A transport that always succeeds and records every pushed batch. */
class RecordingTransport implements SyncTransport {
  pushed: SyncOpPayload[][] = [];
  async push(ops: SyncOpPayload[]): Promise<void> {
    this.pushed.push(ops);
  }
  async pull(): Promise<{ rows: never[]; cursor: number }> {
    return { rows: [], cursor: 0 };
  }
  /** Flat list of every op id pushed, across all batches, in push order. */
  pushedIds(): string[] {
    return this.pushed.flat().map((o) => o.id);
  }
}

/** A transport whose push always rejects. */
class FailingTransport implements SyncTransport {
  attempts = 0;
  async push(): Promise<void> {
    this.attempts += 1;
    throw new Error('network down');
  }
  async pull(): Promise<{ rows: never[]; cursor: number }> {
    return { rows: [], cursor: 0 };
  }
}

/** Seed N pending upsert ops with explicit (ascending) UUIDv7-ish ids. */
function seedOps(db: Db, ids: string[]): void {
  for (const id of ids) {
    db.insert(syncOps)
      .values({
        id,
        entityTable: 'players',
        entityId: id,
        op: 'upsert',
        payload: { id },
        entityUpdatedAt: 1000,
      })
      .run();
  }
}

describe('drain (push)', () => {
  it('pushes all pending ops in UUIDv7 order and marks them done', async () => {
    const { db } = createMemoryDb();
    // Intentionally insert out of id order to prove draining sorts.
    seedOps(db, ['0000c', '0000a', '0000b']);

    const transport = new RecordingTransport();
    const res = await drain(db, transport);

    expect(res.pushed).toBe(3);
    expect(res.failed).toBe(0);
    // Transport received them in ascending id (creation-time) order.
    expect(transport.pushedIds()).toEqual(['0000a', '0000b', '0000c']);

    // Nothing pending afterwards; all done.
    expect(listPendingOps(db)).toHaveLength(0);
    const rows = db.select().from(syncOps).orderBy(asc(syncOps.id)).all();
    expect(rows.map((r) => r.status)).toEqual(['done', 'done', 'done']);
  });

  it('no-ops cleanly when there is nothing pending', async () => {
    const { db } = createMemoryDb();
    const transport = new RecordingTransport();
    const res = await drain(db, transport);
    expect(res).toEqual({ pushed: 0, failed: 0 });
    expect(transport.pushed).toHaveLength(0);
  });

  it('carries the op shape (entityTable/entityId/op/payload) to the transport', async () => {
    const { db } = createMemoryDb();
    enqueueOp(db, {
      entityTable: 'games',
      entityId: 'g1',
      op: 'delete',
      payload: { id: 'g1' },
      entityUpdatedAt: 4242,
    });
    const transport = new RecordingTransport();
    await drain(db, transport);

    const op = transport.pushed.flat()[0];
    expect(op?.entityTable).toBe('games');
    expect(op?.entityId).toBe('g1');
    expect(op?.op).toBe('delete');
    expect(op?.entityUpdatedAt).toBe(4242);
    expect(op?.payload).toEqual({ id: 'g1' });
  });
});

describe('drain (transport failure + retry safety)', () => {
  it('marks ops failed with attempts incremented + lastError on transport error', async () => {
    const { db } = createMemoryDb();
    seedOps(db, ['0000a', '0000b']);

    const transport = new FailingTransport();
    const res = await drain(db, transport);

    expect(res.pushed).toBe(0);
    expect(res.failed).toBe(2);

    const rows = db.select().from(syncOps).orderBy(asc(syncOps.id)).all();
    for (const r of rows) {
      expect(r.status).toBe('failed');
      expect(r.attempts).toBe(1);
      expect(r.lastError).toBe('network down');
    }
  });

  it('a subsequent successful drain re-pushes still-pending/failed ops and marks done', async () => {
    const { db } = createMemoryDb();
    seedOps(db, ['0000a', '0000b']);

    // First drain fails everything.
    await drain(db, new FailingTransport());

    // Second drain succeeds: failed ops are retried.
    const ok = new RecordingTransport();
    const res = await drain(db, ok);

    expect(res.pushed).toBe(2);
    expect(res.failed).toBe(0);
    expect(ok.pushedIds()).toEqual(['0000a', '0000b']);

    const rows = db.select().from(syncOps).orderBy(asc(syncOps.id)).all();
    expect(rows.map((r) => r.status)).toEqual(['done', 'done']);
    // attempts carries over and increments only on failure, not on success.
    expect(rows.map((r) => r.attempts)).toEqual([1, 1]);
  });

  it('is idempotent: done ops are never re-pushed by a later drain', async () => {
    const { db } = createMemoryDb();
    seedOps(db, ['0000a']);

    const ok = new RecordingTransport();
    await drain(db, ok);
    expect(ok.pushedIds()).toEqual(['0000a']);

    // Enqueue a new op; the already-done one must not be pushed again.
    seedOps(db, ['0000b']);
    await drain(db, ok);

    expect(ok.pushedIds()).toEqual(['0000a', '0000b']);
    const done = db.select().from(syncOps).where(eq(syncOps.id, '0000a')).all();
    expect(done[0]?.status).toBe('done');
  });
});
