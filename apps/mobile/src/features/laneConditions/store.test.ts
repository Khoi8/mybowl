import { describe, expect, it } from 'vitest';

import { locations, sessions, users } from '../../db/schema';
import { createMemoryDb } from '../../db/testing/memoryDb';
import { createLaneConditionsStore } from './store';

type MemoryDb = ReturnType<typeof createMemoryDb>['db'];

function seedUser(db: MemoryDb): string {
  const [user] = db.insert(users).values({}).returning().all();
  if (user === undefined) throw new Error('unreachable');
  return user.id;
}

function seedLocation(db: MemoryDb, name: string): string {
  const [loc] = db.insert(locations).values({ name }).returning().all();
  if (loc === undefined) throw new Error('unreachable');
  return loc.id;
}

function seedSession(db: MemoryDb, ownerUserId: string, locationId: string): string {
  const [session] = db
    .insert(sessions)
    .values({ ownerUserId, date: '2026-06-18', locationId })
    .returning()
    .all();
  if (session === undefined) throw new Error('unreachable');
  return session.id;
}

describe('lane conditions store', () => {
  it('logForSession persists with the right session/location + sync metadata', () => {
    const { db } = createMemoryDb();
    const ownerUserId = seedUser(db);
    const locationId = seedLocation(db, 'Sunset Lanes');
    const sessionId = seedSession(db, ownerUserId, locationId);
    const store = createLaneConditionsStore();

    const log = store.getState().logForSession(db, {
      ownerUserId,
      locationId,
      sessionId,
      date: '2026-06-18',
      freshness: 'fresh',
      rating1to5: 5,
    });

    expect(log.ownerUserId).toBe(ownerUserId);
    expect(log.locationId).toBe(locationId);
    expect(log.sessionId).toBe(sessionId);
    expect(log.freshness).toBe('fresh');
    expect(log.rating1to5).toBe(5);
    expect(log.syncStatus).toBe('pending');
    expect(log.deletedAt).toBeNull();
  });

  it('listForSession returns the visit’s logs', () => {
    const { db } = createMemoryDb();
    const ownerUserId = seedUser(db);
    const locationId = seedLocation(db, 'Sunset Lanes');
    const sessionId = seedSession(db, ownerUserId, locationId);
    const store = createLaneConditionsStore();

    const log = store
      .getState()
      .logForSession(db, { ownerUserId, locationId, sessionId, date: '2026-06-18' });

    expect(
      store
        .getState()
        .listForSession(db, sessionId)
        .map((l) => l.id),
    ).toEqual([log.id]);
  });

  it('two visits at the same location stay distinct', () => {
    const { db } = createMemoryDb();
    const ownerUserId = seedUser(db);
    const locationId = seedLocation(db, 'Sunset Lanes');
    const store = createLaneConditionsStore();

    const visit1 = seedSession(db, ownerUserId, locationId);
    const log1 = store.getState().logForSession(db, {
      ownerUserId,
      locationId,
      sessionId: visit1,
      date: '2026-06-18',
      freshness: 'fresh',
    });

    const visit2 = seedSession(db, ownerUserId, locationId);
    const log2 = store.getState().logForSession(db, {
      ownerUserId,
      locationId,
      sessionId: visit2,
      date: '2026-07-01',
      freshness: 'burnt',
    });

    expect(log2.id).not.toBe(log1.id);
    // Each visit's view holds only its own log — no per-location merge.
    expect(
      store
        .getState()
        .listForSession(db, visit1)
        .map((l) => l.id),
    ).toEqual([log1.id]);
    expect(
      store
        .getState()
        .listForSession(db, visit2)
        .map((l) => l.id),
    ).toEqual([log2.id]);
  });

  it('update and remove delegate to the repo', () => {
    const { db } = createMemoryDb();
    const ownerUserId = seedUser(db);
    const locationId = seedLocation(db, 'Sunset Lanes');
    const sessionId = seedSession(db, ownerUserId, locationId);
    const store = createLaneConditionsStore();

    const log = store
      .getState()
      .logForSession(db, { ownerUserId, locationId, sessionId, date: '2026-06-18' });

    const updated = store.getState().update(db, log.id, { rating1to5: 3 });
    expect(updated.rating1to5).toBe(3);

    store.getState().remove(db, log.id);
    expect(store.getState().listForSession(db, sessionId)).toEqual([]);
  });
});
