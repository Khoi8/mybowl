/**
 * Test-only tooling: build a `better-sqlite3`-backed Drizzle instance with the
 * full S5 schema applied via S6's forward-only `applyMigrations`.
 *
 * This file imports `better-sqlite3` (and, transitively through `migrate.ts`,
 * `node:*`), so — like `migrate.ts`/`client.ts` — it is EXCLUDED from the lean
 * root `tsc` typecheck (which runs `lib: ES2022`, `types: []`, no `@types/node`).
 * It is still fully type-checked and exercised when Vitest compiles the repo
 * tests that import it, and it stays under ESLint (no `any`).
 *
 * Using `applyMigrations` (rather than `drizzle-kit push` or re-deriving DDL)
 * guarantees in-memory tests run against the EXACT migrated schema that ships
 * to the device.
 */

import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

import { applyMigrations } from '../migrate';
import { schema } from '../schema';

/**
 * The concrete Drizzle type for the in-memory better-sqlite3 connection. It is
 * assignable to the driver-agnostic `Db` type the repositories accept, so tests
 * can pass this straight into any repo function.
 */
export type Db = BetterSQLite3Database<typeof schema>;

/**
 * Create a fresh in-memory SQLite database with foreign keys enforced and the
 * full migrated schema applied.
 *
 * Returns both the Drizzle handle (for repo calls / typed queries) and the raw
 * `better-sqlite3` connection (for asserting tombstones are physically present,
 * inspecting `sqlite_master`, etc.).
 */
export function createMemoryDb(): { db: Db; sqlite: Database.Database } {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');

  // `applyMigrations` only needs an `exec(sql): unknown` surface. better-sqlite3's
  // `.exec` returns the Database (for chaining); wrap it so the return type is
  // narrowed to `unknown` to match `SqliteExecutor` without leaking the driver type.
  applyMigrations({ exec: (sql: string): unknown => sqlite.exec(sql) });

  const db = drizzle(sqlite, { schema });
  return { db, sqlite };
}
