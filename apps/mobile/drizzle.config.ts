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
 */

import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  schema: ['./src/db/schema.ts', './src/sync/schema.ts'],
  out: './drizzle',
});
