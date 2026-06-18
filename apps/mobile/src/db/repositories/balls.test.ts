import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { balls, users } from '../schema';
import { createMemoryDb } from '../testing/memoryDb';
import {
  createBall,
  getBallById,
  listActiveBalls,
  listBalls,
  softDeleteBall,
  updateBall,
} from './balls';

function seedUser(db: ReturnType<typeof createMemoryDb>['db']): string {
  const [user] = db.insert(users).values({}).returning().all();
  if (user === undefined) throw new Error('unreachable');
  return user.id;
}

describe('balls repository', () => {
  it('round-trips create -> getById', () => {
    const { db } = createMemoryDb();
    const ownerUserId = seedUser(db);

    const created = createBall(db, {
      ownerUserId,
      name: 'Phaze II',
      brand: 'Storm',
      weight: 15,
    });
    expect(created.name).toBe('Phaze II');
    expect(created.brand).toBe('Storm');
    expect(created.weight).toBe(15);
    expect(created.retired).toBe(false);
    expect(created.syncStatus).toBe('pending');
    expect(created.deletedAt).toBeNull();

    const fetched = getBallById(db, created.id);
    expect(fetched).toEqual(created);
  });

  it('update bumps updatedAt and resets syncStatus to pending', () => {
    const { db } = createMemoryDb();
    const ownerUserId = seedUser(db);
    const created = createBall(db, { ownerUserId, name: 'IQ Tour' });

    // Pretend it has already synced, and pin the timestamp back.
    db.update(balls)
      .set({ syncStatus: 'synced', updatedAt: created.updatedAt - 1000 })
      .where(eq(balls.id, created.id))
      .run();
    const before = getBallById(db, created.id);
    if (before === undefined) throw new Error('unreachable');
    expect(before.syncStatus).toBe('synced');

    const updated = updateBall(db, created.id, { surface: '2000 grit' });
    expect(updated.surface).toBe('2000 grit');
    expect(updated.syncStatus).toBe('pending');
    expect(updated.updatedAt).toBeGreaterThanOrEqual(before.updatedAt);
  });

  it('retire toggling: retired ball stays live but drops out of listActiveBalls', () => {
    const { db } = createMemoryDb();
    const ownerUserId = seedUser(db);
    const ball = createBall(db, { ownerUserId, name: 'Hammer' });

    const retired = updateBall(db, ball.id, { retired: true });
    expect(retired.retired).toBe(true);
    // Still live + readable (history), just excluded from active.
    expect(getBallById(db, ball.id)?.id).toBe(ball.id);
    expect(listBalls(db, ownerUserId).map((b) => b.id)).toEqual([ball.id]);
    expect(listActiveBalls(db, ownerUserId)).toEqual([]);

    const unretired = updateBall(db, ball.id, { retired: false });
    expect(unretired.retired).toBe(false);
    expect(listActiveBalls(db, ownerUserId).map((b) => b.id)).toEqual([ball.id]);
  });

  it('listActiveBalls excludes retired but listBalls keeps it; scoped per owner', () => {
    const { db } = createMemoryDb();
    const ownerUserId = seedUser(db);
    const otherUserId = seedUser(db);

    const active = createBall(db, { ownerUserId, name: 'Active' });
    const old = createBall(db, { ownerUserId, name: 'Old', retired: true });
    createBall(db, { ownerUserId: otherUserId, name: 'NotMine' });

    expect(
      listBalls(db, ownerUserId)
        .map((b) => b.id)
        .sort(),
    ).toEqual([active.id, old.id].sort());
    expect(listActiveBalls(db, ownerUserId).map((b) => b.id)).toEqual([active.id]);
  });

  it('soft delete tombstones: excluded from both lists/get but physically present', () => {
    const { db, sqlite } = createMemoryDb();
    const ownerUserId = seedUser(db);
    const a = createBall(db, { ownerUserId, name: 'A' });
    const b = createBall(db, { ownerUserId, name: 'B' });

    softDeleteBall(db, a.id);

    expect(getBallById(db, a.id)).toBeUndefined();
    expect(listBalls(db, ownerUserId).map((x) => x.id)).toEqual([b.id]);
    expect(listActiveBalls(db, ownerUserId).map((x) => x.id)).toEqual([b.id]);

    // Raw query confirms the row is still physically present, just tombstoned.
    const raw = sqlite
      .prepare<
        [string],
        { id: string; deleted_at: number | null }
      >('SELECT id, deleted_at FROM balls WHERE id = ?')
      .get(a.id);
    expect(raw?.id).toBe(a.id);
    expect(raw?.deleted_at).not.toBeNull();
  });
});
