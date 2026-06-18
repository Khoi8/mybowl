import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { sessions, users } from '../schema';
import { createMemoryDb } from '../testing/memoryDb';
import { createPlayer } from './players';
import {
  addSessionPlayer,
  createSession,
  getSessionById,
  listSessionPlayers,
  listSessionsByOwner,
  softDeleteSession,
  softDeleteSessionPlayer,
  updateSession,
} from './sessions';

function seedUser(db: ReturnType<typeof createMemoryDb>['db']): string {
  const [user] = db.insert(users).values({}).returning().all();
  if (user === undefined) throw new Error('unreachable');
  return user.id;
}

describe('sessions repository', () => {
  it('round-trips create -> getById', () => {
    const { db } = createMemoryDb();
    const ownerUserId = seedUser(db);

    const created = createSession(db, {
      ownerUserId,
      date: '2026-06-17',
      lane: 'lane 7',
      isGroup: true,
    });
    expect(created.lane).toBe('lane 7');
    expect(created.isGroup).toBe(true);
    expect(created.syncStatus).toBe('pending');

    expect(getSessionById(db, created.id)).toEqual(created);
  });

  it('solo session defaults isGroup false (same code path as group)', () => {
    const { db } = createMemoryDb();
    const ownerUserId = seedUser(db);
    const solo = createSession(db, { ownerUserId, date: '2026-06-17' });
    expect(solo.isGroup).toBe(false);
  });

  it('update bumps updatedAt and resets syncStatus to pending', () => {
    const { db } = createMemoryDb();
    const ownerUserId = seedUser(db);
    const created = createSession(db, { ownerUserId, date: '2026-06-17' });

    db.update(sessions)
      .set({ syncStatus: 'synced', updatedAt: created.updatedAt - 1000 })
      .where(eq(sessions.id, created.id))
      .run();
    const before = getSessionById(db, created.id);
    if (before === undefined) throw new Error('unreachable');

    const updated = updateSession(db, created.id, { notes: 'league night' });
    expect(updated.notes).toBe('league night');
    expect(updated.syncStatus).toBe('pending');
    expect(updated.updatedAt).toBeGreaterThanOrEqual(before.updatedAt);
  });

  it('soft delete tombstones: excluded from list but physically present', () => {
    const { db, sqlite } = createMemoryDb();
    const ownerUserId = seedUser(db);
    const a = createSession(db, { ownerUserId, date: '2026-06-17' });
    const b = createSession(db, { ownerUserId, date: '2026-06-18' });

    softDeleteSession(db, a.id);
    expect(getSessionById(db, a.id)).toBeUndefined();
    expect(listSessionsByOwner(db, ownerUserId).map((s) => s.id)).toEqual([b.id]);

    const raw = sqlite
      .prepare<
        [string],
        { deleted_at: number | null }
      >('SELECT deleted_at FROM sessions WHERE id = ?')
      .get(a.id);
    expect(raw?.deleted_at).not.toBeNull();
  });

  it('group session with 2 participants persists and lists', () => {
    const { db } = createMemoryDb();
    const ownerUserId = seedUser(db);
    const self = createPlayer(db, { name: 'Me', isSelf: true, userId: ownerUserId });
    const mike = createPlayer(db, { name: 'Mike' });

    const session = createSession(db, { ownerUserId, date: '2026-06-17', isGroup: true });
    addSessionPlayer(db, { sessionId: session.id, playerId: self.id, turnOrder: 1 });
    const sp2 = addSessionPlayer(db, {
      sessionId: session.id,
      playerId: mike.id,
      turnOrder: 2,
    });

    expect(listSessionPlayers(db, session.id)).toHaveLength(2);

    softDeleteSessionPlayer(db, sp2.id);
    expect(listSessionPlayers(db, session.id).map((sp) => sp.playerId)).toEqual([
      self.id,
    ]);
  });
});
