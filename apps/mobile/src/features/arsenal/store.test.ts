import { describe, expect, it } from 'vitest';

import { users } from '../../db/schema';
import { createMemoryDb } from '../../db/testing/memoryDb';
import { getBallById } from '../../db/repositories/balls';
import { createArsenalStore } from './store';

function seedUser(db: ReturnType<typeof createMemoryDb>['db']): string {
  const [user] = db.insert(users).values({}).returning().all();
  if (user === undefined) throw new Error('unreachable');
  return user.id;
}

describe('arsenal store', () => {
  it('create adds a ball, visible in both active and all lists', () => {
    const { db } = createMemoryDb();
    const ownerUserId = seedUser(db);
    const store = createArsenalStore();
    store.getState().load(db, ownerUserId);

    const ball = store.getState().create(db, { ownerUserId, name: 'Phaze II' });
    expect(ball.name).toBe('Phaze II');
    expect(
      store
        .getState()
        .activeBalls()
        .map((b) => b.id),
    ).toEqual([ball.id]);
    expect(
      store
        .getState()
        .allBalls()
        .map((b) => b.id),
    ).toEqual([ball.id]);
  });

  it('retire excludes from activeBalls() but keeps in allBalls() and history', () => {
    const { db } = createMemoryDb();
    const ownerUserId = seedUser(db);
    const store = createArsenalStore();
    store.getState().load(db, ownerUserId);
    const ball = store.getState().create(db, { ownerUserId, name: 'Hammer' });

    store.getState().retire(db, ball.id);

    expect(store.getState().activeBalls()).toEqual([]);
    expect(
      store
        .getState()
        .allBalls()
        .map((b) => b.id),
    ).toEqual([ball.id]);
    // Still readable as a live row — old games keep referencing it.
    expect(getBallById(db, ball.id)?.retired).toBe(true);
  });

  it('unretire returns a ball to the active picker', () => {
    const { db } = createMemoryDb();
    const ownerUserId = seedUser(db);
    const store = createArsenalStore();
    store.getState().load(db, ownerUserId);
    const ball = store.getState().create(db, { ownerUserId, name: 'IQ Tour' });

    store.getState().retire(db, ball.id);
    expect(store.getState().activeBalls()).toEqual([]);

    store.getState().unretire(db, ball.id);
    expect(
      store
        .getState()
        .activeBalls()
        .map((b) => b.id),
    ).toEqual([ball.id]);
  });

  it('remove tombstones: gone from both lists, row physically remains', () => {
    const { db, sqlite } = createMemoryDb();
    const ownerUserId = seedUser(db);
    const store = createArsenalStore();
    store.getState().load(db, ownerUserId);
    const a = store.getState().create(db, { ownerUserId, name: 'A' });
    const b = store.getState().create(db, { ownerUserId, name: 'B' });

    store.getState().remove(db, a.id);

    expect(
      store
        .getState()
        .activeBalls()
        .map((x) => x.id),
    ).toEqual([b.id]);
    expect(
      store
        .getState()
        .allBalls()
        .map((x) => x.id),
    ).toEqual([b.id]);
    expect(getBallById(db, a.id)).toBeUndefined();

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
