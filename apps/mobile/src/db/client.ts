/**
 * The SOLE Expo-coupled database boundary.
 *
 * This is the ONLY module in the repo that imports `expo-sqlite`. Everything
 * else (schema, migrations, repositories, tests) stays driver-agnostic so it
 * runs under plain Node with `better-sqlite3`. Concentrating the Expo coupling
 * here keeps the rest of `db/**` portable and headlessly testable.
 *
 * EXCLUDED FROM NODE TYPECHECK + LINT until S9: `expo-sqlite` is not installed
 * yet (the Expo scaffold lands in S9), so resolving its types/module would fail
 * the root `tsc` and ESLint import resolution. This file is therefore listed in
 * the root `tsconfig.json` `exclude` array and in `eslint.config.js` `ignores`.
 * It is never imported by Vitest (nothing references it yet), so the test suite
 * stays green. S9 installs Expo, removes those excludes, and wires `getDb()`
 * into the app providers.
 *
 * App-launch migrations: at runtime the app applies the GENERATED `drizzle`
 * folder via `drizzle-orm/expo-sqlite/migrator` (`useMigrations` /
 * `migrate(db, migrations)`), driven from the journal in `drizzle/meta`. That
 * wiring is an S9 concern and intentionally not done here. The Node-side
 * equivalent for tests/repos lives in `./migrate` (`applyMigrations`).
 */

import { openDatabaseSync } from 'expo-sqlite';
import { drizzle } from 'drizzle-orm/expo-sqlite';

import { schema } from './schema';

/** On-device SQLite filename. Single source of truth on device (CLAUDE.md §2). */
const DB_NAME = 'bowli.db';

let sqlite: ReturnType<typeof openDatabaseSync> | undefined;
let db: ReturnType<typeof drizzle<typeof schema>> | undefined;

/**
 * Return the process-wide singleton Drizzle handle bound to the schema.
 *
 * Lazily opens `bowli.db` on first use so importing this module has no side
 * effects (and so a test/host that never calls `getDb()` never touches Expo).
 */
export function getDb(): ReturnType<typeof drizzle<typeof schema>> {
  if (db === undefined) {
    sqlite ??= openDatabaseSync(DB_NAME);
    db = drizzle(sqlite, { schema });
  }
  return db;
}
