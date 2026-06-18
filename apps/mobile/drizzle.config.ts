/**
 * drizzle-kit configuration. Migration generation lands in S6; this file just
 * declares where the schema lives and where generated SQL/journal go.
 *
 * Dialect is plain `sqlite` (driver-agnostic). The runtime driver (expo-sqlite)
 * is wired in `db/client.ts`, not here — drizzle-kit only reads the schema
 * metadata to emit forward-only migrations.
 *
 * `schema` is an ARRAY so drizzle-kit picks up both the entity tables
 * (`db/schema.ts`) and the local sync outbox (`sync/schema.ts`, added in S17),
 * which lives under the `sync/` vertical slice but still needs DDL generated.
 *
 * `driver: 'expo'` makes drizzle-kit additionally emit `drizzle/migrations.js`
 * (a JS bundle of the SQL + journal) alongside the raw `*.sql` files. That
 * bundle is what the on-device Expo migrator (`useMigrations`) consumes at app
 * launch — RN's Metro bundler can't read `*.sql` from disk, so the SQL has to be
 * bundled as a JS module. The raw `*.sql`/`meta` files are unchanged by this
 * flag; the Node-side `migrate.ts` still replays them directly for tests.
 */

import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  driver: 'expo',
  schema: ['./src/db/schema.ts', './src/sync/schema.ts'],
  out: './drizzle',
});
