/**
 * drizzle-kit configuration. Migration generation lands in S6; this file just
 * declares where the schema lives and where generated SQL/journal go.
 *
 * Dialect is plain `sqlite` (driver-agnostic). The runtime driver (expo-sqlite)
 * is wired in `db/client.ts`, not here — drizzle-kit only reads the schema
 * metadata to emit forward-only migrations.
 */

import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema.ts',
  out: './drizzle',
});
