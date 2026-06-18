/**
 * The SOLE Expo-coupled database boundary.
 *
 * This is the ONLY module in the repo that imports `expo-sqlite`. Everything
 * else (schema, migrations, repositories, tests) stays driver-agnostic so it
 * runs under plain Node with `better-sqlite3`. Concentrating the Expo coupling
 * here keeps the rest of `db/**` portable and headlessly testable.
 *
 * EXCLUDED FROM THE LEAN ROOT NODE TYPECHECK + LINT: resolving `expo-sqlite`
 * under the RN-free root `tsc`/ESLint would fail, so this file is listed in the
 * root `tsconfig.json` `exclude` array and in `eslint.config.js` `ignores`. It
 * is instead typechecked by the Expo project (`apps/mobile/tsconfig.json`, which
 * has the RN/Expo types). It is never imported by Vitest, so the Node test suite
 * stays green. `getDb()` is wired into the app providers (S9).
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
