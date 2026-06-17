/**
 * In-memory better-sqlite3 round-trip tests for the driver-agnostic schema.
 *
 * DDL approach: rather than hand-writing CREATE TABLE statements (duplicative
 * and drift-prone), we derive them directly from `schema.ts` using
 * drizzle-kit's programmatic API (`generateSQLiteDrizzleJson` +
 * `generateSQLiteMigration` against an empty baseline). That produces the exact
 * forward migration drizzle-kit would emit in S6, so this test exercises the
 * real schema shape. The generated SQL is test-only scaffolding here; S6 owns
 * the committed migration artifacts.
 *
 * This file uses Node-only tooling (better-sqlite3, drizzle-kit) and lives
 * outside `domain/`, so the domain-purity rules do not apply.
 */

import Database from 'better-sqlite3';
import { generateSQLiteDrizzleJson, generateSQLiteMigration } from 'drizzle-kit/api';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { isUuidV7 } from './id';
import {
  frames,
  games,
  players,
  sessionPlayers,
  sessions,
  users,
  schema,
} from './schema';

/**
 * Build a fresh in-memory DB with the schema's tables created, foreign-key
 * enforcement ON, and a drizzle handle wired to the schema.
 */
async function makeDb(): Promise<{
  sqlite: Database.Database;
  db: BetterSQLite3Database<typeof schema>;
}> {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');

  // Derive CREATE TABLE DDL from the schema (empty baseline -> current schema).
  const emptySnapshot = await generateSQLiteDrizzleJson({});
  const snapshot = await generateSQLiteDrizzleJson(schema);
  const statements = await generateSQLiteMigration(emptySnapshot, snapshot);
  for (const stmt of statements) {
    sqlite.exec(stmt);
  }

  const db = drizzle(sqlite, { schema });
  return { sqlite, db };
}

describe('schema: table creation', () => {
  it('creates every modeled table', async () => {
    const { sqlite } = await makeDb();
    const rows = sqlite
      .prepare<
        [],
        { name: string }
      >("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all();
    const names = new Set(rows.map((r) => r.name));
    // The partial unique index backstopping "one self player per account"
    // must be emitted by the schema.
    const indexes = sqlite
      .prepare<
        [],
        { name: string }
      >("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'players_one_self_per_user'")
      .all();
    expect(indexes).toHaveLength(1);
    for (const table of [
      'users',
      'players',
      'balls',
      'oil_patterns',
      'locations',
      'leagues',
      'sessions',
      'session_players',
      'games',
      'frames',
      'lane_condition_logs',
    ]) {
      expect(names.has(table)).toBe(true);
    }
  });
});

describe('schema: identity model + round-trip', () => {
  let db: BetterSQLite3Database<typeof schema>;

  beforeEach(async () => {
    ({ db } = await makeDb());
  });

  it('round-trips users, self+guest players, session, sessionPlayers, games, and frames with JSON arrays', () => {
    const [user] = db.insert(users).values({}).returning().all();
    expect(user).toBeDefined();
    if (user === undefined) throw new Error('unreachable');

    // Self player: isSelf true, userId set to the account.
    const [self] = db
      .insert(players)
      .values({ userId: user.id, name: 'Me', isSelf: true })
      .returning()
      .all();
    // Guest player: userId null, isSelf false — persists for relational stats.
    const [guest] = db
      .insert(players)
      .values({ name: 'Mike', isSelf: false })
      .returning()
      .all();
    expect(self).toBeDefined();
    expect(guest).toBeDefined();
    if (self === undefined || guest === undefined) throw new Error('unreachable');

    expect(self.userId).toBe(user.id);
    expect(self.isSelf).toBe(true);
    expect(guest.userId).toBeNull();
    expect(guest.isSelf).toBe(false);

    const [session] = db
      .insert(sessions)
      .values({
        ownerUserId: user.id,
        date: '2026-06-17',
        isGroup: true,
        lane: 'lanes 12-13',
      })
      .returning()
      .all();
    if (session === undefined) throw new Error('unreachable');
    expect(session.isGroup).toBe(true);

    db.insert(sessionPlayers)
      .values([
        { sessionId: session.id, playerId: self.id, turnOrder: 1 },
        { sessionId: session.id, playerId: guest.id, turnOrder: 2 },
      ])
      .run();
    const sps = db.select().from(sessionPlayers).all();
    expect(sps).toHaveLength(2);

    // One game per player, each attributed to its Player but owned by the recorder.
    const [selfGame] = db
      .insert(games)
      .values({
        ownerUserId: user.id,
        sessionId: session.id,
        playerId: self.id,
        date: '2026-06-17',
      })
      .returning()
      .all();
    const [guestGame] = db
      .insert(games)
      .values({
        ownerUserId: user.id,
        sessionId: session.id,
        playerId: guest.id,
        date: '2026-06-17',
      })
      .returning()
      .all();
    if (selfGame === undefined || guestGame === undefined) throw new Error('unreachable');

    // The recorder owns both games; the bowler identity differs per game.
    expect(selfGame.ownerUserId).toBe(user.id);
    expect(guestGame.ownerUserId).toBe(user.id);
    expect(selfGame.playerId).toBe(self.id);
    expect(guestGame.playerId).toBe(guest.id);

    // Frame with JSON arrays: a strike then a spare on a 7-pin.
    const throwsIn = [10, 0];
    const ballIdsIn: (string | null)[] = ['ball-uuid-a', null];
    const pinStateIn = [0b1111111111, 0b0000000001];
    db.insert(frames)
      .values({
        gameId: selfGame.id,
        frameNo: 1,
        throws: throwsIn,
        ballIdPerThrow: ballIdsIn,
        pinState: pinStateIn,
      })
      .run();

    const [frame] = db.select().from(frames).where(eq(frames.gameId, selfGame.id)).all();
    if (frame === undefined) throw new Error('unreachable');
    expect(frame.frameNo).toBe(1);
    // JSON arrays must round-trip intact (deep equality).
    expect(frame.throws).toEqual(throwsIn);
    expect(frame.ballIdPerThrow).toEqual(ballIdsIn);
    expect(frame.pinState).toEqual(pinStateIn);
  });

  it('supports a solo game with a null sessionId (degenerate one-participant case)', () => {
    const [user] = db.insert(users).values({}).returning().all();
    if (user === undefined) throw new Error('unreachable');
    const [self] = db
      .insert(players)
      .values({ userId: user.id, name: 'Me', isSelf: true })
      .returning()
      .all();
    if (self === undefined) throw new Error('unreachable');

    const [solo] = db
      .insert(games)
      .values({ ownerUserId: user.id, playerId: self.id, date: '2026-06-17' })
      .returning()
      .all();
    if (solo === undefined) throw new Error('unreachable');
    expect(solo.sessionId).toBeNull();
  });
});

describe('schema: one-self-player-per-account invariant', () => {
  it('rejects a second live self player for the same account', async () => {
    const { db } = await makeDb();
    const [user] = db.insert(users).values({}).returning().all();
    if (user === undefined) throw new Error('unreachable');

    db.insert(players).values({ userId: user.id, name: 'Me', isSelf: true }).run();

    expect(() =>
      db
        .insert(players)
        .values({ userId: user.id, name: 'Me Again', isSelf: true })
        .run(),
    ).toThrow(/UNIQUE/i);
  });

  it('allows multiple guests and multiple non-self linked players', async () => {
    const { db } = await makeDb();
    const [user] = db.insert(users).values({}).returning().all();
    if (user === undefined) throw new Error('unreachable');

    // Two guests (userId null) and one self — all permitted.
    db.insert(players)
      .values([
        { name: 'Mike', isSelf: false },
        { name: 'Nancy', isSelf: false },
        { userId: user.id, name: 'Me', isSelf: true },
      ])
      .run();
    expect(db.select().from(players).all()).toHaveLength(3);
  });
});

describe('schema: foreign-key enforcement', () => {
  it('rejects a game with a non-existent playerId when foreign_keys is ON', async () => {
    const { db } = await makeDb();
    const [user] = db.insert(users).values({}).returning().all();
    if (user === undefined) throw new Error('unreachable');

    expect(() =>
      db
        .insert(games)
        .values({
          ownerUserId: user.id,
          playerId: 'no-such-player',
          date: '2026-06-17',
        })
        .run(),
    ).toThrow(/FOREIGN KEY/i);
  });
});

describe('schema: sync-column defaults', () => {
  it('stamps a UUIDv7 id, numeric updatedAt, null deletedAt, and pending syncStatus on insert', async () => {
    const { db } = await makeDb();
    const before = Date.now();
    const [user] = db.insert(users).values({}).returning().all();
    if (user === undefined) throw new Error('unreachable');

    expect(isUuidV7(user.id)).toBe(true);
    expect(typeof user.updatedAt).toBe('number');
    expect(user.updatedAt).toBeGreaterThanOrEqual(before);
    expect(user.deletedAt).toBeNull();
    expect(user.syncStatus).toBe('pending');
  });
});
