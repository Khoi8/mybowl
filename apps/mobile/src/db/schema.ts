/**
 * Driver-agnostic Drizzle SQLite schema for bowli.
 *
 * IMPORTANT: this module imports NOTHING from `expo-sqlite` (or any other
 * concrete driver). It only depends on `drizzle-orm/sqlite-core` (table/column
 * builders, which are pure metadata) and the local UUIDv7 generator. That keeps
 * it importable under plain Node for tests (better-sqlite3) and reusable from
 * the Expo runtime alike. The single Expo-coupled boundary lives in
 * `db/client.ts` (S6), never here.
 *
 * Mirrors the entity vocabulary in `packages/shared/src/index.ts` and the data
 * model in CLAUDE.md §6. The identity crux: every Game points at a Player
 * (`playerId`), and `ownerUserId` is merely the recording account — the two are
 * deliberately distinct columns and must not be conflated.
 *
 * Sync model (CLAUDE.md §5): every syncable row carries a client-generated
 * UUIDv7 primary key, an `updatedAt` (ms epoch), a nullable `deletedAt`
 * tombstone (rows are soft-deleted, never hard-deleted), and a `syncStatus`.
 */

import { sql } from 'drizzle-orm';
import {
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from 'drizzle-orm/sqlite-core';

import { uuidv7 } from './id';

/**
 * Columns present on EVERY syncable table. Factored out to guarantee every
 * table shares an identical sync contract.
 *
 * Returned fresh per table so each table's `id` column gets its own builder
 * instance (Drizzle column builders are stateful and must not be shared).
 *
 * - `id`           — UUIDv7 string PK, client-generated so rows exist offline
 *                    and merge cleanly; time-sortable.
 * - `updatedAt`    — ms epoch, stamped on every write; drives last-write-wins.
 * - `deletedAt`    — ms epoch tombstone; null = live. Never hard-delete.
 * - `syncStatus`   — local sync lifecycle; defaults to 'pending' on insert.
 */
function syncColumns() {
  return {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    updatedAt: integer('updated_at')
      .notNull()
      .$defaultFn(() => Date.now()),
    deletedAt: integer('deleted_at'),
    syncStatus: text('sync_status', { enum: ['pending', 'synced', 'conflict'] })
      .notNull()
      .default('pending'),
  } as const;
}

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

export const users = sqliteTable('users', {
  ...syncColumns(),
});

export const players = sqliteTable(
  'players',
  {
    ...syncColumns(),
    /** Null = guest (just a name); set = linked account or the self player. */
    userId: text('user_id').references((): AnySQLiteColumn => users.id),
    name: text('name').notNull(),
    isSelf: integer('is_self', { mode: 'boolean' }).notNull().default(false),
    avatar: text('avatar'),
  },
  (table) => [
    // Enforce "exactly one self player per account" at the DB level for linked
    // rows: a partial unique index over user_id, scoped to self rows that are
    // both attributed to an account and live (not tombstoned). Guests
    // (user_id NULL) and tombstoned rows are exempt. The app layer is still the
    // primary guardian of this invariant (S11); this index is a backstop.
    uniqueIndex('players_one_self_per_user')
      .on(table.userId)
      .where(
        sql`${table.isSelf} = 1 AND ${table.userId} IS NOT NULL AND ${table.deletedAt} IS NULL`,
      ),
  ],
);

// ---------------------------------------------------------------------------
// Equipment & venue context
// ---------------------------------------------------------------------------

export const balls = sqliteTable('balls', {
  ...syncColumns(),
  ownerUserId: text('owner_user_id')
    .notNull()
    .references(() => users.id),
  name: text('name').notNull(),
  brand: text('brand'),
  coverstock: text('coverstock'),
  layout: text('layout'),
  surface: text('surface'),
  weight: real('weight'),
  retired: integer('retired', { mode: 'boolean' }).notNull().default(false),
});

export const oilPatterns = sqliteTable('oil_patterns', {
  ...syncColumns(),
  name: text('name').notNull(),
  lengthFt: integer('length_ft'),
  volume: integer('volume'),
  ratio: real('ratio'),
  notes: text('notes'),
});

export const locations = sqliteTable('locations', {
  ...syncColumns(),
  name: text('name').notNull(),
  address: text('address'),
  lat: real('lat'),
  lng: real('lng'),
  laneCount: integer('lane_count'),
  pinsetterType: text('pinsetter_type', { enum: ['free_fall', 'string'] }),
  notes: text('notes'),
});

export const leagues = sqliteTable('leagues', {
  ...syncColumns(),
  name: text('name').notNull(),
  season: text('season'),
  house: text('house'),
});

// ---------------------------------------------------------------------------
// Sessions, games, frames
// ---------------------------------------------------------------------------

export const sessions = sqliteTable('sessions', {
  ...syncColumns(),
  ownerUserId: text('owner_user_id')
    .notNull()
    .references(() => users.id),
  date: text('date').notNull(),
  locationId: text('location_id').references(() => locations.id),
  /** Free-form, e.g. "lane 7" or "lanes 12-13". */
  lane: text('lane'),
  oilPatternId: text('oil_pattern_id').references(() => oilPatterns.id),
  isGroup: integer('is_group', { mode: 'boolean' }).notNull().default(false),
  notes: text('notes'),
});

export const sessionPlayers = sqliteTable('session_players', {
  ...syncColumns(),
  sessionId: text('session_id')
    .notNull()
    .references(() => sessions.id),
  playerId: text('player_id')
    .notNull()
    .references(() => players.id),
  turnOrder: integer('turn_order'),
});

export const games = sqliteTable('games', {
  ...syncColumns(),
  /** The recording account — NOT necessarily the bowler. */
  ownerUserId: text('owner_user_id')
    .notNull()
    .references(() => users.id),
  /** Null for a solo game logged outside a session. */
  sessionId: text('session_id').references(() => sessions.id),
  /** The bowler identity. Games point at a Player, NEVER directly at a User. */
  playerId: text('player_id')
    .notNull()
    .references(() => players.id),
  leagueId: text('league_id').references(() => leagues.id),
  date: text('date').notNull(),
  locationId: text('location_id').references(() => locations.id),
  lane: text('lane'),
  oilPatternId: text('oil_pattern_id').references(() => oilPatterns.id),
  notes: text('notes'),
});

export const frames = sqliteTable('frames', {
  ...syncColumns(),
  gameId: text('game_id')
    .notNull()
    .references(() => games.id),
  /** 1-10. */
  frameNo: integer('frame_no').notNull(),
  /** Pin counts knocked down per throw. */
  throws: text('throws', { mode: 'json' }).$type<number[]>().notNull(),
  /** Ball used per throw; null where untagged. Indexed parallel to `throws`. */
  ballIdPerThrow: text('ball_id_per_throw', { mode: 'json' })
    .$type<(string | null)[]>()
    .notNull(),
  /** Per throw, 10-bit mask of pins STANDING before that throw. */
  pinState: text('pin_state', { mode: 'json' }).$type<number[]>().notNull(),
});

export const laneConditionLogs = sqliteTable('lane_condition_logs', {
  ...syncColumns(),
  ownerUserId: text('owner_user_id')
    .notNull()
    .references(() => users.id),
  locationId: text('location_id')
    .notNull()
    .references(() => locations.id),
  sessionId: text('session_id').references(() => sessions.id),
  date: text('date').notNull(),
  oilPatternId: text('oil_pattern_id').references(() => oilPatterns.id),
  freshness: text('freshness', { enum: ['fresh', 'broken_down', 'burnt'] }),
  playStyle: text('play_style'),
  carrydown: text('carrydown'),
  holdNotes: text('hold_notes'),
  breakpointNotes: text('breakpoint_notes'),
  rating1to5: integer('rating_1_to_5'),
});

// ---------------------------------------------------------------------------
// Schema aggregate + inferred types
// ---------------------------------------------------------------------------

/** All tables, for `drizzle(sqlite, { schema })` and drizzle-kit generation. */
export const schema = {
  users,
  players,
  balls,
  oilPatterns,
  locations,
  leagues,
  sessions,
  sessionPlayers,
  games,
  frames,
  laneConditionLogs,
} as const;

export type Player = typeof players.$inferSelect;
export type NewPlayer = typeof players.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
export type Game = typeof games.$inferSelect;
export type NewGame = typeof games.$inferInsert;
export type Frame = typeof frames.$inferSelect;
export type NewFrame = typeof frames.$inferInsert;
