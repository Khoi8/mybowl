import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { laneConditionLogs, locations, sessions, users } from '../schema';
import { createMemoryDb } from '../testing/memoryDb';
import {
  createLaneConditionLog,
  getLaneConditionLogById,
  listLaneConditionLogsByLocation,
  listLaneConditionLogsBySession,
  softDeleteLaneConditionLog,
  updateLaneConditionLog,
} from './laneConditions';

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

describe('laneConditions repository', () => {
  it('round-trips create -> getById with the condition fields', () => {
    const { db } = createMemoryDb();
    const ownerUserId = seedUser(db);
    const locationId = seedLocation(db, 'Sunset Lanes');
    const sessionId = seedSession(db, ownerUserId, locationId);

    const created = createLaneConditionLog(db, {
      ownerUserId,
      locationId,
      sessionId,
      date: '2026-06-18',
      freshness: 'broken_down',
      playStyle: 'play deep, swing to the gutter',
      carrydown: 'noticeable past arrows by game 2',
      holdNotes: 'no hold inside, ball checks up early',
      breakpointNotes: 'breakpoint at the 7 board',
      rating1to5: 4,
    });

    expect(created.ownerUserId).toBe(ownerUserId);
    expect(created.locationId).toBe(locationId);
    expect(created.sessionId).toBe(sessionId);
    expect(created.freshness).toBe('broken_down');
    expect(created.playStyle).toBe('play deep, swing to the gutter');
    expect(created.carrydown).toBe('noticeable past arrows by game 2');
    expect(created.holdNotes).toBe('no hold inside, ball checks up early');
    expect(created.breakpointNotes).toBe('breakpoint at the 7 board');
    expect(created.rating1to5).toBe(4);
    expect(created.syncStatus).toBe('pending');
    expect(created.deletedAt).toBeNull();

    expect(getLaneConditionLogById(db, created.id)).toEqual(created);
  });

  it('update bumps updatedAt and resets syncStatus to pending', () => {
    const { db } = createMemoryDb();
    const ownerUserId = seedUser(db);
    const locationId = seedLocation(db, 'Sunset Lanes');
    const sessionId = seedSession(db, ownerUserId, locationId);
    const created = createLaneConditionLog(db, {
      ownerUserId,
      locationId,
      sessionId,
      date: '2026-06-18',
      freshness: 'fresh',
    });

    // Pretend it has already synced, and pin the timestamp back.
    db.update(laneConditionLogs)
      .set({ syncStatus: 'synced', updatedAt: created.updatedAt - 1000 })
      .where(eq(laneConditionLogs.id, created.id))
      .run();
    const before = getLaneConditionLogById(db, created.id);
    if (before === undefined) throw new Error('unreachable');
    expect(before.syncStatus).toBe('synced');

    const updated = updateLaneConditionLog(db, created.id, { rating1to5: 5 });
    expect(updated.rating1to5).toBe(5);
    expect(updated.syncStatus).toBe('pending');
    expect(updated.updatedAt).toBeGreaterThanOrEqual(before.updatedAt);
  });

  it('soft delete tombstones: gone from lists/get but physically present', () => {
    const { db, sqlite } = createMemoryDb();
    const ownerUserId = seedUser(db);
    const locationId = seedLocation(db, 'Sunset Lanes');
    const sessionId = seedSession(db, ownerUserId, locationId);
    const log = createLaneConditionLog(db, {
      ownerUserId,
      locationId,
      sessionId,
      date: '2026-06-18',
    });

    softDeleteLaneConditionLog(db, log.id);

    expect(getLaneConditionLogById(db, log.id)).toBeUndefined();
    expect(listLaneConditionLogsBySession(db, sessionId)).toEqual([]);
    expect(listLaneConditionLogsByLocation(db, locationId)).toEqual([]);

    const raw = sqlite
      .prepare<
        [string],
        { id: string; deleted_at: number | null }
      >('SELECT id, deleted_at FROM lane_condition_logs WHERE id = ?')
      .get(log.id);
    expect(raw?.id).toBe(log.id);
    expect(raw?.deleted_at).not.toBeNull();
  });

  it('listBySession returns only that visit’s logs', () => {
    const { db } = createMemoryDb();
    const ownerUserId = seedUser(db);
    const locationId = seedLocation(db, 'Sunset Lanes');
    const visitA = seedSession(db, ownerUserId, locationId);
    const visitB = seedSession(db, ownerUserId, locationId);

    const a = createLaneConditionLog(db, {
      ownerUserId,
      locationId,
      sessionId: visitA,
      date: '2026-06-18',
    });
    createLaneConditionLog(db, {
      ownerUserId,
      locationId,
      sessionId: visitB,
      date: '2026-06-19',
    });

    expect(listLaneConditionLogsBySession(db, visitA).map((l) => l.id)).toEqual([a.id]);
  });

  it('per-visit: two sessions at the SAME location keep distinct logs (no merge/overwrite)', () => {
    const { db } = createMemoryDb();
    const ownerUserId = seedUser(db);
    const locationId = seedLocation(db, 'Sunset Lanes');

    // First visit to the house.
    const visit1 = seedSession(db, ownerUserId, locationId);
    const log1 = createLaneConditionLog(db, {
      ownerUserId,
      locationId,
      sessionId: visit1,
      date: '2026-06-18',
      freshness: 'fresh',
      rating1to5: 5,
    });

    // Second, LATER visit to the SAME house. This must NOT update visit1's log.
    const visit2 = seedSession(db, ownerUserId, locationId);
    const log2 = createLaneConditionLog(db, {
      ownerUserId,
      locationId,
      sessionId: visit2,
      date: '2026-07-01',
      freshness: 'burnt',
      rating1to5: 2,
    });

    // Two distinct rows for the one location — proof there's no per-location upsert.
    expect(log2.id).not.toBe(log1.id);
    const byLocation = listLaneConditionLogsByLocation(db, locationId);
    expect(byLocation).toHaveLength(2);
    expect(byLocation.map((l) => l.id).sort()).toEqual([log1.id, log2.id].sort());

    // The FIRST visit's log is untouched by logging the second visit.
    const first = getLaneConditionLogById(db, log1.id);
    expect(first?.freshness).toBe('fresh');
    expect(first?.rating1to5).toBe(5);

    // Each visit's session view holds exactly its own log.
    expect(listLaneConditionLogsBySession(db, visit1).map((l) => l.id)).toEqual([
      log1.id,
    ]);
    expect(listLaneConditionLogsBySession(db, visit2).map((l) => l.id)).toEqual([
      log2.id,
    ]);
  });
});
