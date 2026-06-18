/**
 * Migration parity tests: applying the GENERATED forward-only SQL to a fresh
 * in-memory DB must produce exactly the S5 schema. This is the contract that
 * lets repos/tests trust `applyMigrations` as the single DDL source of truth.
 *
 * Node-only tooling (better-sqlite3, node:fs via migrate.ts); lives outside
 * `domain/`, so domain-purity rules do not apply.
 */

import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { applyMigrations, migrationFiles } from './migrate';
import { frames, games, players, sessions, users, schema } from './schema';

const EXPECTED_TABLES = [
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
] as const;

function migratedDb(): {
  sqlite: Database.Database;
  db: BetterSQLite3Database<typeof schema>;
} {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  applyMigrations(sqlite);
  return { sqlite, db: drizzle(sqlite, { schema }) };
}

describe('applyMigrations: schema parity with S5', () => {
  it('creates all 11 modeled tables', () => {
    const { sqlite } = migratedDb();
    const rows = sqlite
      .prepare<
        [],
        { name: string }
      >("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all();
    const names = new Set(rows.map((r) => r.name));
    expect(names.size).toBe(EXPECTED_TABLES.length);
    for (const table of EXPECTED_TABLES) {
      expect(names.has(table)).toBe(true);
    }
  });

  it('creates the partial one-self-player-per-account index', () => {
    const { sqlite } = migratedDb();
    const indexes = sqlite
      .prepare<
        [],
        { name: string }
      >("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'players_one_self_per_user'")
      .all();
    expect(indexes).toHaveLength(1);
  });

  it('produces usable tables: insert + read round-trips through the migrated schema', () => {
    const { db } = migratedDb();

    const [user] = db.insert(users).values({}).returning().all();
    if (user === undefined) throw new Error('unreachable');

    const [self] = db
      .insert(players)
      .values({ userId: user.id, name: 'Me', isSelf: true })
      .returning()
      .all();
    if (self === undefined) throw new Error('unreachable');

    const [session] = db
      .insert(sessions)
      .values({ ownerUserId: user.id, date: '2026-06-17' })
      .returning()
      .all();
    if (session === undefined) throw new Error('unreachable');

    const [game] = db
      .insert(games)
      .values({
        ownerUserId: user.id,
        sessionId: session.id,
        playerId: self.id,
        date: '2026-06-17',
      })
      .returning()
      .all();
    if (game === undefined) throw new Error('unreachable');

    db.insert(frames)
      .values({
        gameId: game.id,
        frameNo: 1,
        throws: [10],
        ballIdPerThrow: [null],
        pinState: [0b1111111111],
      })
      .run();

    const [frame] = db.select().from(frames).where(eq(frames.gameId, game.id)).all();
    if (frame === undefined) throw new Error('unreachable');
    expect(frame.throws).toEqual([10]);
    expect(frame.pinState).toEqual([0b1111111111]);
    // Sync-column defaults flow through the migrated DDL just like S5.
    expect(frame.syncStatus).toBe('pending');
    expect(frame.deletedAt).toBeNull();
  });
});

describe('applyMigrations: forward-only journal convention', () => {
  it('has exactly the expected, append-only set of migration files', () => {
    // Forward-only guard: the committed migration set is append-only. As new
    // migrations are added this list grows; it must never shrink or reorder,
    // and existing files must never be edited. Update this expectation only by
    // APPENDING when a new `db:generate` migration is committed.
    expect(migrationFiles()).toEqual(['0000_sleepy_misty_knight.sql']);
  });
});
