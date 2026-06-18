/**
 * Node-side migration applier — the single real-migration application path for
 * repos and tests.
 *
 * Rather than re-deriving DDL from the schema (drift-prone, and a second source
 * of truth), tests and in-memory repos apply the SAME forward-only SQL that
 * ships to the device: the GENERATED files under `apps/mobile/drizzle/*.sql`.
 * This guarantees the Node-tested schema is byte-for-byte the migrated one.
 *
 * This is a Node/test UTILITY, not app runtime: it deliberately imports
 * `node:fs`/`node:path`/`node:url`. It is NOT in `domain/**`, so the
 * domain-purity lint (which bans `node:*`) does not apply. It imports NOTHING
 * from Expo — app-launch migrations run via Expo's drizzle migrator against the
 * same `drizzle` folder (see `client.ts`); this helper is the headless
 * equivalent, exercised by Vitest.
 *
 * EXCLUDED FROM THE ROOT `tsc` typecheck (see `tsconfig.json` `exclude`): the
 * root build is intentionally lean (`lib: ES2022`, `types: []`, no `@types/node`),
 * so `node:*` modules and `import.meta.url` don't resolve there. Vitest compiles
 * and runs this file with full Node typing, which is where it's validated.
 *
 * Forward-only (CLAUDE.md §5/§9): generated migrations are append-only and
 * never edited. Reading them in lexical filename order (`0000_`, `0001_`, …)
 * replays history exactly.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Drizzle delimits independently-executable statements with this marker. */
const STATEMENT_BREAKPOINT = '--> statement-breakpoint';

/** Directory holding the generated migration SQL, relative to this module. */
const MIGRATIONS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'drizzle',
);

/**
 * Minimal surface we need from a `better-sqlite3` connection. Declaring it
 * locally (instead of importing the type) keeps this helper usable with any
 * synchronous SQLite handle exposing `exec`, and avoids a hard type dependency.
 */
export interface SqliteExecutor {
  exec(sql: string): unknown;
}

/** Generated migration filenames, in forward (lexical) order. */
export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f: string) => f.endsWith('.sql'))
    .sort();
}

/**
 * Apply every generated forward migration, in order, to `sqlite`.
 *
 * Each file is split on the drizzle statement-breakpoint marker and the
 * resulting statements are executed sequentially. Empty fragments (e.g. a
 * trailing breakpoint) are skipped.
 */
export function applyMigrations(sqlite: SqliteExecutor): void {
  for (const file of migrationFiles()) {
    const contents = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    for (const statement of contents.split(STATEMENT_BREAKPOINT)) {
      const trimmed = statement.trim();
      if (trimmed.length > 0) {
        sqlite.exec(trimmed);
      }
    }
  }
}
