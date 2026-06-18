import { describe, expect, it } from 'vitest';

import { players, users } from '../../db/schema';
import { createMemoryDb } from '../../db/testing/memoryDb';
import { createPlayersStore } from './store';

function seedUser(db: ReturnType<typeof createMemoryDb>['db']): string {
  const [user] = db.insert(users).values({}).returning().all();
  if (user === undefined) throw new Error('unreachable');
  return user.id;
}

describe('players store', () => {
  describe('search (the reuse surface)', () => {
    it('ranks exact, then prefix, then substring; case-insensitive', () => {
      const { db } = createMemoryDb();
      const store = createPlayersStore();
      // Seed a spread of names that hit each tier for query "mi".
      for (const name of ['Jeremiah', 'Mike', 'Mi', 'Mitch']) {
        store.getState().createGuest(db, name);
      }

      const ranked = store
        .getState()
        .search('MI')
        .map((p) => p.name);
      // exact "Mi" first; prefix "Mike"/"Mitch" next; substring "Jeremiah" last.
      expect(ranked[0]).toBe('Mi');
      expect(ranked.slice(1, 3).sort()).toEqual(['Mike', 'Mitch']);
      expect(ranked[3]).toBe('Jeremiah');
    });

    it('empty/whitespace query returns the full list', () => {
      const { db } = createMemoryDb();
      const store = createPlayersStore();
      store.getState().createGuest(db, 'A');
      store.getState().createGuest(db, 'B');

      expect(
        store
          .getState()
          .search('')
          .map((p) => p.name),
      ).toEqual(['A', 'B']);
      expect(
        store
          .getState()
          .search('   ')
          .map((p) => p.name),
      ).toEqual(['A', 'B']);
    });

    it('drops non-matches', () => {
      const { db } = createMemoryDb();
      const store = createPlayersStore();
      store.getState().createGuest(db, 'Mike');
      store.getState().createGuest(db, 'Nancy');

      expect(store.getState().search('zzz')).toEqual([]);
    });

    it('excludes tombstoned contacts from search', () => {
      const { db } = createMemoryDb();
      const store = createPlayersStore();
      const mike = store.getState().createGuest(db, 'Mike');
      store.getState().createGuest(db, 'Mick');

      store.getState().removePlayer(db, mike.id);

      expect(
        store
          .getState()
          .search('mi')
          .map((p) => p.name),
      ).toEqual(['Mick']);
    });
  });

  describe('createGuest (the fallback)', () => {
    it('creates a guest (userId null, isSelf false) with pending sync metadata', () => {
      const { db } = createMemoryDb();
      const store = createPlayersStore();

      const guest = store.getState().createGuest(db, 'Mike');
      expect(guest.userId).toBeNull();
      expect(guest.isSelf).toBe(false);
      expect(guest.syncStatus).toBe('pending');
      expect(guest.deletedAt).toBeNull();
    });

    it('appears in subsequent search', () => {
      const { db } = createMemoryDb();
      const store = createPlayersStore();
      store.getState().createGuest(db, 'Mike');

      expect(
        store
          .getState()
          .search('Mike')
          .map((p) => p.name),
      ).toEqual(['Mike']);
    });
  });

  describe('ensureSelf (single-self invariant)', () => {
    it('creates the self player once (isSelf true, userId set)', () => {
      const { db } = createMemoryDb();
      const userId = seedUser(db);
      const store = createPlayersStore();

      const self = store.getState().ensureSelf(db, userId, 'Me');
      expect(self.isSelf).toBe(true);
      expect(self.userId).toBe(userId);
    });

    it('returns the SAME player on a second call (no duplicate)', () => {
      const { db } = createMemoryDb();
      const userId = seedUser(db);
      const store = createPlayersStore();

      const first = store.getState().ensureSelf(db, userId, 'Me');
      const second = store.getState().ensureSelf(db, userId, 'Different Name');

      expect(second.id).toBe(first.id);
      // No second self row was minted.
      const selfCount = db
        .select()
        .from(players)
        .all()
        .filter((p) => p.isSelf).length;
      expect(selfCount).toBe(1);
    });

    it('never mints a second distinct self for the same user (DB index backstops)', () => {
      const { db } = createMemoryDb();
      const userId = seedUser(db);
      const store = createPlayersStore();

      // First self via the guarded store path.
      store.getState().ensureSelf(db, userId, 'Me');
      // ensureSelf again is a no-op create (returns existing) — store guard holds.
      expect(() => store.getState().ensureSelf(db, userId, 'Me2')).not.toThrow();
      // Backstop: a raw second self insert for the same user is rejected by the
      // partial unique index, proving the DB protects the invariant too.
      expect(() =>
        db.insert(players).values({ name: 'Sneaky', isSelf: true, userId }).run(),
      ).toThrow();
    });
  });

  describe('soft delete', () => {
    it('removes a contact from list/search but the row physically remains', () => {
      const { db, sqlite } = createMemoryDb();
      const store = createPlayersStore();
      const mike = store.getState().createGuest(db, 'Mike');

      store.getState().removePlayer(db, mike.id);

      expect(store.getState().players.map((p) => p.id)).toEqual([]);
      expect(store.getState().search('Mike')).toEqual([]);

      const raw = sqlite
        .prepare<
          [string],
          { id: string; deleted_at: number | null }
        >('SELECT id, deleted_at FROM players WHERE id = ?')
        .get(mike.id);
      expect(raw?.id).toBe(mike.id);
      expect(raw?.deleted_at).not.toBeNull();
    });
  });
});
