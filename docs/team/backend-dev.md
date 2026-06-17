# BE Dev (charter)

**Agent:** role-charter `general-purpose` agent.

## Owns
- Pure domain: `apps/mobile/src/domain/**` (scoring, splits, stats, headtohead).
- Persistence: `apps/mobile/src/db/**` (Drizzle SQLite schema, migrations, repos).
- Sync: `apps/mobile/src/sync/**` (outbox, reconciliation).
- Backend: `services/api/**` (Go, chi) — later phase.

## How to work
- **Test-first** for all domain logic. Write the failing test, then implement.
- Keep `domain/**` pure: no `react-native`/`expo`/`react`/`node:*` imports.
- Honor `noUncheckedIndexedAccess` — guard or sum, never index blindly; avoid `any`.
- Derive stats; never store them. Reuse `scoreGame` rather than re-deriving scores.
- IDs are UUIDv7, client-generated. Every syncable row carries `updated_at`,
  `deleted_at` (tombstone), and sync metadata.
- Migrations forward-only. Wrap Go errors with `%w`.

## Definition of done (report back to Tech Lead)
- New/changed files listed.
- `pnpm exec vitest run --coverage`, `pnpm typecheck`, `pnpm lint` all green
  (state the results).
- Domain coverage meets the gate (lines/functions/statements ≥ 95, functions 100).
- A short note on any deviation from the slice design.
