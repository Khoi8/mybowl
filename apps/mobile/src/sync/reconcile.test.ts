/**
 * Tests for the LWW reconcile primitive and `applyRemoteRows`.
 *
 * `reconcile` is a pure decision function — tested directly. `applyRemoteRows`
 * is exercised against an in-memory better-sqlite3 DB (memoryDb) so we prove the
 * real upsert/tombstone/sync-status behavior, not a mock.
 */

import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { createMemoryDb } from '../db/testing/memoryDb';
import { players } from '../db/schema';
import { uuidv7 } from '../db/id';
import { applyRemoteRows, reconcile, type SyncableRow } from './reconcile';

const row = (over: Partial<SyncableRow> & Pick<SyncableRow, 'id'>): SyncableRow => ({
  updatedAt: 1000,
  deletedAt: null,
  ...over,
});

describe('reconcile (LWW decision)', () => {
  it('takes remote when remote.updatedAt is newer', () => {
    const local = row({ id: 'a', updatedAt: 1000 });
    const remote = row({ id: 'a', updatedAt: 2000 });
    expect(reconcile(local, remote)).toBe('take-remote');
  });

  it('keeps local when local.updatedAt is newer', () => {
    const local = row({ id: 'a', updatedAt: 3000 });
    const remote = row({ id: 'a', updatedAt: 2000 });
    expect(reconcile(local, remote)).toBe('keep-local');
  });

  it('always takes remote when local is undefined (row not present locally)', () => {
    const remote = row({ id: 'a', updatedAt: 1 });
    expect(reconcile(undefined, remote)).toBe('take-remote');
  });

  describe('tie rule on equal updatedAt', () => {
    it('a remote tombstone wins over a live local row', () => {
      const local = row({ id: 'a', updatedAt: 1000, deletedAt: null });
      const remote = row({ id: 'a', updatedAt: 1000, deletedAt: 1000 });
      expect(reconcile(local, remote)).toBe('take-remote');
    });

    it('a live remote does NOT clobber a local tombstone (local tombstone wins)', () => {
      const local = row({ id: 'a', updatedAt: 1000, deletedAt: 1000 });
      const remote = row({ id: 'a', updatedAt: 1000, deletedAt: null });
      expect(reconcile(local, remote)).toBe('keep-local');
    });

    it('both tombstones at equal updatedAt → higher id wins', () => {
      const local = row({ id: 'aaa', updatedAt: 1000, deletedAt: 1000 });
      const remote = row({ id: 'bbb', updatedAt: 1000, deletedAt: 1000 });
      expect(reconcile(local, remote)).toBe('take-remote');
      expect(reconcile(remote, local)).toBe('keep-local');
    });

    it('neither tombstone at equal updatedAt → higher id wins', () => {
      const local = row({ id: 'aaa', updatedAt: 1000 });
      const remote = row({ id: 'bbb', updatedAt: 1000 });
      expect(reconcile(local, remote)).toBe('take-remote');
    });

    it('neither tombstone, local id higher → keep-local', () => {
      const local = row({ id: 'zzz', updatedAt: 1000 });
      const remote = row({ id: 'aaa', updatedAt: 1000 });
      expect(reconcile(local, remote)).toBe('keep-local');
    });

    it('equal updatedAt AND equal id → keep-local (idempotent, no needless write)', () => {
      const local = row({ id: 'a', updatedAt: 1000 });
      const remote = row({ id: 'a', updatedAt: 1000 });
      expect(reconcile(local, remote)).toBe('keep-local');
    });
  });
});

describe('applyRemoteRows', () => {
  it('inserts a remote row not present locally and marks it synced', () => {
    const { db } = createMemoryDb();
    const id = uuidv7();
    const res = applyRemoteRows(db, players, [
      { id, updatedAt: 5000, deletedAt: null, name: 'Nancy', isSelf: false },
    ]);

    expect(res).toEqual({ applied: 1, skipped: 0 });
    const [stored] = db.select().from(players).where(eq(players.id, id)).all();
    expect(stored?.name).toBe('Nancy');
    expect(stored?.syncStatus).toBe('synced');
    expect(stored?.updatedAt).toBe(5000);
  });

  it('upserts (overwrites) a stale local row with a newer remote and marks synced', () => {
    const { db } = createMemoryDb();
    const id = uuidv7();
    db.insert(players)
      .values({ id, name: 'Mike', updatedAt: 1000, syncStatus: 'pending' })
      .run();

    const res = applyRemoteRows(db, players, [
      { id, updatedAt: 2000, deletedAt: null, name: 'Michael', isSelf: false },
    ]);

    expect(res).toEqual({ applied: 1, skipped: 0 });
    const [stored] = db.select().from(players).where(eq(players.id, id)).all();
    expect(stored?.name).toBe('Michael');
    expect(stored?.updatedAt).toBe(2000);
    expect(stored?.syncStatus).toBe('synced');
  });

  it('applies a remote tombstone locally (sets deletedAt)', () => {
    const { db } = createMemoryDb();
    const id = uuidv7();
    db.insert(players).values({ id, name: 'Mike', updatedAt: 1000 }).run();

    const res = applyRemoteRows(db, players, [
      { id, updatedAt: 2000, deletedAt: 2000, name: 'Mike', isSelf: false },
    ]);

    expect(res).toEqual({ applied: 1, skipped: 0 });
    const [stored] = db.select().from(players).where(eq(players.id, id)).all();
    expect(stored?.deletedAt).toBe(2000);
    expect(stored?.syncStatus).toBe('synced');
  });

  it('LWW does not clobber a newer local edit: older remote is skipped, local untouched', () => {
    const { db } = createMemoryDb();
    const id = uuidv7();
    db.insert(players)
      .values({ id, name: 'LocalEdit', updatedAt: 9000, syncStatus: 'pending' })
      .run();

    const res = applyRemoteRows(db, players, [
      { id, updatedAt: 1000, deletedAt: null, name: 'StaleRemote', isSelf: false },
    ]);

    expect(res).toEqual({ applied: 0, skipped: 1 });
    const [stored] = db.select().from(players).where(eq(players.id, id)).all();
    expect(stored?.name).toBe('LocalEdit');
    expect(stored?.updatedAt).toBe(9000);
    // A pending local edit that beat the remote must stay pending (not synced).
    expect(stored?.syncStatus).toBe('pending');
  });

  it('returns mixed applied/skipped counts over a batch', () => {
    const { db } = createMemoryDb();
    const winId = uuidv7();
    const loseId = uuidv7();
    db.insert(players).values({ id: loseId, name: 'KeepMe', updatedAt: 9000 }).run();

    const res = applyRemoteRows(db, players, [
      { id: winId, updatedAt: 100, deletedAt: null, name: 'New', isSelf: false },
      { id: loseId, updatedAt: 1, deletedAt: null, name: 'TooOld', isSelf: false },
    ]);

    expect(res).toEqual({ applied: 1, skipped: 1 });
    const [kept] = db.select().from(players).where(eq(players.id, loseId)).all();
    expect(kept?.name).toBe('KeepMe');
  });
});
