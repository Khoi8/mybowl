/**
 * Shared `Db` handle type accepted by every repository.
 *
 * Repositories take an INJECTED database handle rather than reaching for a
 * global singleton — that is precisely what makes them headless-testable in
 * plain Node (against a `better-sqlite3` `:memory:` connection) while the app
 * later passes the Expo-SQLite drizzle instance unchanged.
 *
 * To accept BOTH drivers we type `Db` as the driver-agnostic Drizzle base,
 * `BaseSQLiteDatabase`. Both drivers we care about run SYNCHRONOUSLY:
 * better-sqlite3 is `BaseSQLiteDatabase<'sync', ...>` and Drizzle's
 * `ExpoSQLiteDatabase` is ALSO `<'sync', ...>` (expo-sqlite exposes a sync API).
 * So we pin the result kind to `'sync'` — this keeps `.all()`/`.run()`/
 * `.get()` returning plain values (not promises), letting repos stay
 * synchronous. The `unknown` slot is Drizzle's run-result type parameter, which
 * repos never inspect; we deliberately avoid `any`. Bound to our `schema` so the
 * query builder and `.transaction(...)` stay fully typed.
 *
 * NOTE: importing the schema here is type-only (`import type`) so this module
 * stays a pure type surface with zero runtime/driver coupling.
 */

import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';

import type { schema } from './schema';

/**
 * A Drizzle SQLite handle bound to bowli's schema, agnostic to whether the
 * underlying driver resolves queries synchronously (better-sqlite3) or
 * asynchronously (expo-sqlite). Repos use only the shared query-builder surface.
 */
export type Db = BaseSQLiteDatabase<'sync', unknown, typeof schema>;
