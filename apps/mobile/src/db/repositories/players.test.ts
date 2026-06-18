import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { players, users } from '../schema';
import { createMemoryDb } from '../testing/memoryDb';
import {
  createPlayer,
  getPlayerById,
  getSelfPlayer,
  listPlayers,
  softDeletePlayer,
  updatePlayer,
} from './players';

function seedUser(db: ReturnType<typeof createMemoryDb>['db']): string {
  const [user] = db.insert(users).values({}).returning().all();
  if (user === undefined) throw new Error('unreachable');
  return user.id;
}

describe('players repository', () => {
  it('round-trips create -> getById', () => {
    const { db } = createMemoryDb();
    const userId = seedUser(db);

    const created = createPlayer(db, { name: 'Me', isSelf: true, userId });
    expect(created.name).toBe('Me');
    expect(created.isSelf).toBe(true);
    expect(created.syncStatus).toBe('pending');
    expect(created.deletedAt).toBeNull();

    const fetched = getPlayerById(db, created.id);
    expect(fetched).toEqual(created);
  });

  it('creates guests with userId null', () => {
    const { db } = createMemoryDb();
    const guest = createPlayer(db, { name: 'Mike' });
    expect(guest.userId).toBeNull();
    expect(guest.isSelf).toBe(false);
  });

  it('update bumps updatedAt and resets syncStatus to pending', () => {
    const { db } = createMemoryDb();
    const created = createPlayer(db, { name: 'Mike' });

    // Pretend it has already synced, and pin the timestamp back.
    db.update(players)
      .set({ syncStatus: 'synced', updatedAt: created.updatedAt - 1000 })
      .where(eq(players.id, created.id))
      .run();
    const before = getPlayerById(db, created.id);
    if (before === undefined) throw new Error('unreachable');
    expect(before.syncStatus).toBe('synced');

    const updated = updatePlayer(db, created.id, { name: 'Michael' });
    expect(updated.name).toBe('Michael');
    expect(updated.syncStatus).toBe('pending');
    expect(updated.updatedAt).toBeGreaterThanOrEqual(before.updatedAt);
  });

  it('soft delete tombstones: excluded from list/get but physically present', () => {
    const { db, sqlite } = createMemoryDb();
    const a = createPlayer(db, { name: 'A' });
    const b = createPlayer(db, { name: 'B' });

    softDeletePlayer(db, a.id);

    expect(getPlayerById(db, a.id)).toBeUndefined();
    expect(listPlayers(db).map((p) => p.id)).toEqual([b.id]);

    // Raw query confirms the row is still physically present, just tombstoned.
    const raw = sqlite
      .prepare<
        [string],
        { id: string; deleted_at: number | null }
      >('SELECT id, deleted_at FROM players WHERE id = ?')
      .get(a.id);
    expect(raw?.id).toBe(a.id);
    expect(raw?.deleted_at).not.toBeNull();
  });

  it('getSelfPlayer returns the live self player for a user', () => {
    const { db } = createMemoryDb();
    const userId = seedUser(db);
    createPlayer(db, { name: 'Guest' });
    const self = createPlayer(db, { name: 'Me', isSelf: true, userId });

    expect(getSelfPlayer(db, userId)?.id).toBe(self.id);
  });

  it('self + guest coexist; a second live self for the same user is rejected by the index', () => {
    const { db } = createMemoryDb();
    const userId = seedUser(db);

    createPlayer(db, { name: 'Me', isSelf: true, userId });
    createPlayer(db, { name: 'Mike' }); // guest, fine

    expect(() => createPlayer(db, { name: 'Me again', isSelf: true, userId })).toThrow();
  });
});
