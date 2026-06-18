/**
 * Outbox tests (S17) — the write+enqueue transactional invariant.
 *
 * Run against the in-memory better-sqlite3 DB from `memoryDb`, which applies the
 * generated migrations (including 0001's `sync_ops`). Atomicity is asserted with
 * RAW row counts so we observe the actual persisted state, not repo return values.
 */

import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { uuidv7At } from '../db/id';
import { players, users } from '../db/schema';
import { createMemoryDb } from '../db/testing/memoryDb';
import { createPlayer, softDeletePlayer, updatePlayer } from '../db/repositories/players';
import { createGameWithFrames } from '../db/repositories/games';
import { createSession } from '../db/repositories/sessions';
import {
  enqueueWithWrite,
  listPendingOps,
  markOpDone,
  markOpFailed,
  markOpInflight,
} from './outbox';
import { syncOps } from './schema';

type MemDb = ReturnType<typeof createMemoryDb>;

function seedUser(db: MemDb['db']): string {
  const [user] = db.insert(users).values({}).returning().all();
  if (user === undefined) throw new Error('unreachable');
  return user.id;
}

/** Raw row count for a table, bypassing Drizzle (and tombstone filters). */
function rawCount(sqlite: MemDb['sqlite'], table: string): number {
  const row = sqlite
    .prepare<[], { c: number }>(`SELECT COUNT(*) AS c FROM ${table}`)
    .get();
  return row?.c ?? 0;
}

describe('enqueueWithWrite atomicity', () => {
  it('rolls back the entity write when the op builder throws (no entity, no op)', () => {
    const { db, sqlite } = createMemoryDb();

    expect(() =>
      enqueueWithWrite(
        db,
        (tx) => {
          tx.insert(players).values({ name: 'Doomed' }).run();
          return 'ignored';
        },
        () => {
          throw new Error('op builder blew up');
        },
      ),
    ).toThrow('op builder blew up');

    expect(rawCount(sqlite, 'players')).toBe(0);
    expect(rawCount(sqlite, 'sync_ops')).toBe(0);
  });

  it('enqueues no op when the write itself throws', () => {
    const { db, sqlite } = createMemoryDb();

    expect(() =>
      enqueueWithWrite(
        db,
        () => {
          throw new Error('write blew up');
        },
        () => ({
          entityTable: 'players',
          entityId: 'x',
          op: 'upsert',
          payload: null,
          entityUpdatedAt: 1,
        }),
      ),
    ).toThrow('write blew up');

    expect(rawCount(sqlite, 'players')).toBe(0);
    expect(rawCount(sqlite, 'sync_ops')).toBe(0);
  });

  it('lands both the write and the op on success', () => {
    const { db, sqlite } = createMemoryDb();

    const result = enqueueWithWrite(
      db,
      (tx) => {
        const [row] = tx.insert(players).values({ name: 'Ok' }).returning().all();
        if (row === undefined) throw new Error('unreachable');
        return row;
      },
      (row) => ({
        entityTable: 'players',
        entityId: row.id,
        op: 'upsert',
        payload: row,
        entityUpdatedAt: row.updatedAt,
      }),
    );

    expect(result.name).toBe('Ok');
    expect(rawCount(sqlite, 'players')).toBe(1);
    expect(rawCount(sqlite, 'sync_ops')).toBe(1);
  });
});

describe('repos enqueue a matching op for every mutation', () => {
  it('createPlayer enqueues a pending upsert op with matching fields', () => {
    const { db } = createMemoryDb();
    const created = createPlayer(db, { name: 'Mike' });

    const ops = listPendingOps(db);
    expect(ops).toHaveLength(1);
    const [op] = ops;
    if (op === undefined) throw new Error('unreachable');
    expect(op.entityTable).toBe('players');
    expect(op.entityId).toBe(created.id);
    expect(op.op).toBe('upsert');
    expect(op.status).toBe('pending');
    expect(op.entityUpdatedAt).toBe(created.updatedAt);
    expect(op.payload).toMatchObject({ id: created.id, name: 'Mike' });
  });

  it('updatePlayer enqueues a second upsert op carrying the new updatedAt', () => {
    const { db } = createMemoryDb();
    const created = createPlayer(db, { name: 'Mike' });
    const updated = updatePlayer(db, created.id, { name: 'Michael' });

    const ops = listPendingOps(db);
    expect(ops).toHaveLength(2);
    // Both ops touch the same player and are 'upsert'; the update's op carries
    // the bumped updatedAt. (Select by value, not position — two ops created in
    // the same millisecond have arbitrary UUIDv7-id tie-break order.)
    expect(ops.every((o) => o.op === 'upsert' && o.entityId === created.id)).toBe(true);
    expect(ops.some((o) => o.entityUpdatedAt === updated.updatedAt)).toBe(true);
  });

  it('softDeletePlayer enqueues a delete op (payload is the id marker)', () => {
    const { db } = createMemoryDb();
    const created = createPlayer(db, { name: 'Mike' });
    softDeletePlayer(db, created.id);

    const ops = listPendingOps(db);
    expect(ops).toHaveLength(2);
    // Select the delete op by type, not position: the create and delete ops can
    // land in the same millisecond, so their UUIDv7-id order is not insert order.
    const deleteOps = ops.filter((o) => o.op === 'delete');
    expect(deleteOps).toHaveLength(1);
    const del = deleteOps[0];
    if (del === undefined) throw new Error('unreachable');
    expect(del.entityTable).toBe('players');
    expect(del.entityId).toBe(created.id);
    expect(del.payload).toEqual({ id: created.id });

    // The tombstone bumped updatedAt; the op carries that value.
    const [row] = db.select().from(players).where(eq(players.id, created.id)).all();
    if (row === undefined) throw new Error('unreachable');
    expect(del.entityUpdatedAt).toBe(row.updatedAt);
  });
});

describe('listPendingOps ordering', () => {
  it('returns pending ops ordered ascending by op id (UUIDv7 = creation time)', () => {
    const { db } = createMemoryDb();
    createPlayer(db, { name: 'A' });
    createPlayer(db, { name: 'B' });
    createPlayer(db, { name: 'C' });

    // The ordering contract is on the op's OWN UUIDv7 id. (Entity ids and op ids
    // are distinct uuids; within a single millisecond UUIDv7 ties break on random
    // bits, so we assert the queue is sorted by op id — which IS the drain order —
    // rather than coupling it to entity-id generation order.)
    const opIds = listPendingOps(db).map((o) => o.id);
    expect(opIds).toHaveLength(3);
    expect([...opIds].sort()).toEqual(opIds);
  });

  it('orders ops across distinct timestamps by enqueue time', () => {
    const { db } = createMemoryDb();
    // Insert ops directly with explicit time-stamped UUIDv7 ids, out of time
    // order, to prove listPendingOps sorts by the time-sortable id (not insert
    // order). UUIDv7 across distinct milliseconds is strictly ordered.
    const later = uuidv7At(2_000);
    const earlier = uuidv7At(1_000);
    db.insert(syncOps)
      .values({
        id: later,
        entityTable: 'players',
        entityId: 'b',
        op: 'upsert',
        payload: null,
        entityUpdatedAt: 2_000,
      })
      .run();
    db.insert(syncOps)
      .values({
        id: earlier,
        entityTable: 'players',
        entityId: 'a',
        op: 'upsert',
        payload: null,
        entityUpdatedAt: 1_000,
      })
      .run();

    expect(listPendingOps(db).map((o) => o.id)).toEqual([earlier, later]);
  });

  it('excludes ops that are no longer pending', () => {
    const { db } = createMemoryDb();
    createPlayer(db, { name: 'A' });

    const [op] = listPendingOps(db);
    if (op === undefined) throw new Error('unreachable');
    markOpDone(db, op.id);

    expect(listPendingOps(db)).toHaveLength(0);
  });
});

describe('createGameWithFrames enqueues one op per entity in one transaction', () => {
  function seedGameDeps(db: MemDb['db']): { userId: string; playerId: string } {
    const userId = seedUser(db);
    const self = createPlayer(db, { name: 'Me', isSelf: true, userId });
    return { userId, playerId: self.id };
  }

  it('enqueues a game op + one op per frame', () => {
    const { db } = createMemoryDb();
    const { userId, playerId } = seedGameDeps(db);

    // Drain the player-create op so we measure only the game/frame ops.
    for (const o of listPendingOps(db)) markOpDone(db, o.id);

    const { game, frames: createdFrames } = createGameWithFrames(
      db,
      { ownerUserId: userId, playerId, date: '2026-06-17' },
      [
        { frameNo: 1, throws: [10], ballIdPerThrow: [null], pinState: [0b1111111111] },
        {
          frameNo: 2,
          throws: [7, 2],
          ballIdPerThrow: [null, null],
          pinState: [0b1111111111, 0b1110000000],
        },
      ],
    );

    const ops = listPendingOps(db);
    expect(ops).toHaveLength(3); // 1 game + 2 frames

    const gameOps = ops.filter((o) => o.entityTable === 'games');
    const frameOps = ops.filter((o) => o.entityTable === 'frames');
    expect(gameOps).toHaveLength(1);
    expect(frameOps).toHaveLength(2);
    expect(gameOps[0]?.entityId).toBe(game.id);
    expect(new Set(frameOps.map((o) => o.entityId))).toEqual(
      new Set(createdFrames.map((f) => f.id)),
    );
    for (const o of ops) expect(o.op).toBe('upsert');
  });

  it('rolls back the whole game (and all ops) if a frame insert fails', () => {
    const { db, sqlite } = createMemoryDb();
    const { userId, playerId } = seedGameDeps(db);
    for (const o of listPendingOps(db)) markOpDone(db, o.id);

    const beforeGames = rawCount(sqlite, 'games');
    const beforeFrames = rawCount(sqlite, 'frames');
    const beforeOps = rawCount(sqlite, 'sync_ops');

    // Two frames sharing an explicit id ⇒ PK violation on the second insert.
    expect(() =>
      createGameWithFrames(db, { ownerUserId: userId, playerId, date: '2026-06-17' }, [
        { id: 'dup', frameNo: 1, throws: [10], ballIdPerThrow: [null], pinState: [0] },
        { id: 'dup', frameNo: 2, throws: [10], ballIdPerThrow: [null], pinState: [0] },
      ]),
    ).toThrow();

    expect(rawCount(sqlite, 'games')).toBe(beforeGames);
    expect(rawCount(sqlite, 'frames')).toBe(beforeFrames);
    expect(rawCount(sqlite, 'sync_ops')).toBe(beforeOps);
  });
});

describe('op status transitions', () => {
  it('inflight then done', () => {
    const { db } = createMemoryDb();
    createSession(db, { ownerUserId: seedUser(db), date: '2026-06-17' });
    const [op] = listPendingOps(db);
    if (op === undefined) throw new Error('unreachable');

    markOpInflight(db, op.id);
    let row = db.select().from(syncOps).where(eq(syncOps.id, op.id)).all()[0];
    expect(row?.status).toBe('inflight');

    markOpDone(db, op.id);
    row = db.select().from(syncOps).where(eq(syncOps.id, op.id)).all()[0];
    expect(row?.status).toBe('done');
  });

  it('markOpFailed increments attempts and records lastError each time', () => {
    const { db } = createMemoryDb();
    createPlayer(db, { name: 'A' });
    const [op] = listPendingOps(db);
    if (op === undefined) throw new Error('unreachable');
    expect(op.attempts).toBe(0);

    markOpFailed(db, op.id, 'network down');
    let row = db.select().from(syncOps).where(eq(syncOps.id, op.id)).all()[0];
    expect(row?.status).toBe('failed');
    expect(row?.attempts).toBe(1);
    expect(row?.lastError).toBe('network down');

    markOpFailed(db, op.id, 'still down');
    row = db.select().from(syncOps).where(eq(syncOps.id, op.id)).all()[0];
    expect(row?.attempts).toBe(2);
    expect(row?.lastError).toBe('still down');
  });

  it('markOpFailed without a message clears lastError to null', () => {
    const { db } = createMemoryDb();
    createPlayer(db, { name: 'A' });
    const [op] = listPendingOps(db);
    if (op === undefined) throw new Error('unreachable');

    markOpFailed(db, op.id);
    const row = db.select().from(syncOps).where(eq(syncOps.id, op.id)).all()[0];
    expect(row?.attempts).toBe(1);
    expect(row?.lastError).toBeNull();
  });
});
