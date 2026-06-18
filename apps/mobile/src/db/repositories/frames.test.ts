import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { frames, users } from '../schema';
import { createMemoryDb } from '../testing/memoryDb';
import { createGame } from './games';
import { createPlayer } from './players';
import {
  createFrame,
  getFrameById,
  listFramesByGame,
  softDeleteFrame,
  updateFrame,
} from './frames';

function seedGame(db: ReturnType<typeof createMemoryDb>['db']): {
  ownerUserId: string;
  gameId: string;
} {
  const [user] = db.insert(users).values({}).returning().all();
  if (user === undefined) throw new Error('unreachable');
  const self = createPlayer(db, { name: 'Me', isSelf: true, userId: user.id });
  const game = createGame(db, {
    ownerUserId: user.id,
    playerId: self.id,
    date: '2026-06-17',
  });
  return { ownerUserId: user.id, gameId: game.id };
}

describe('frames repository', () => {
  it('round-trips create -> getById with JSON columns', () => {
    const { db } = createMemoryDb();
    const { gameId } = seedGame(db);

    const created = createFrame(db, {
      gameId,
      frameNo: 1,
      throws: [10],
      ballIdPerThrow: [null],
      pinState: [0b1111111111],
    });
    expect(created.throws).toEqual([10]);
    expect(created.pinState).toEqual([0b1111111111]);
    expect(created.syncStatus).toBe('pending');

    expect(getFrameById(db, created.id)).toEqual(created);
  });

  it('update bumps updatedAt and resets syncStatus to pending', () => {
    const { db } = createMemoryDb();
    const { gameId } = seedGame(db);
    const created = createFrame(db, {
      gameId,
      frameNo: 1,
      throws: [7],
      ballIdPerThrow: [null],
      pinState: [0b1111111111],
    });

    db.update(frames)
      .set({ syncStatus: 'synced', updatedAt: created.updatedAt - 1000 })
      .where(eq(frames.id, created.id))
      .run();
    const before = getFrameById(db, created.id);
    if (before === undefined) throw new Error('unreachable');

    const updated = updateFrame(db, created.id, { throws: [7, 2] });
    expect(updated.throws).toEqual([7, 2]);
    expect(updated.syncStatus).toBe('pending');
    expect(updated.updatedAt).toBeGreaterThanOrEqual(before.updatedAt);
  });

  it('lists frames ordered by frameNo, excluding tombstones', () => {
    const { db, sqlite } = createMemoryDb();
    const { gameId } = seedGame(db);

    // Insert out of order to prove ordering.
    const f3 = createFrame(db, {
      gameId,
      frameNo: 3,
      throws: [9, 1],
      ballIdPerThrow: [null, null],
      pinState: [0b1111111111, 0b0000000001],
    });
    createFrame(db, {
      gameId,
      frameNo: 1,
      throws: [10],
      ballIdPerThrow: [null],
      pinState: [0b1111111111],
    });
    createFrame(db, {
      gameId,
      frameNo: 2,
      throws: [8, 1],
      ballIdPerThrow: [null, null],
      pinState: [0b1111111111, 0b0000000011],
    });

    expect(listFramesByGame(db, gameId).map((f) => f.frameNo)).toEqual([1, 2, 3]);

    softDeleteFrame(db, f3.id);
    expect(listFramesByGame(db, gameId).map((f) => f.frameNo)).toEqual([1, 2]);

    // Tombstoned frame still physically present.
    const raw = sqlite
      .prepare<
        [string],
        { deleted_at: number | null }
      >('SELECT deleted_at FROM frames WHERE id = ?')
      .get(f3.id);
    expect(raw?.deleted_at).not.toBeNull();
  });
});
