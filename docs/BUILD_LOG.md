# bowli build log

Reverse-chronological record of delivery iterations. Each entry: what slice,
who did it, the gate result, and the commit.

---

## Iteration 0 — bootstrap + scoring/validation domain (pre-loop)

- **Role:** Tech Lead
- **Scope:** Phase 0 monorepo bootstrap (pnpm workspace, strict TS, Vitest +
  coverage gate, ESLint domain-purity rule, Prettier) and the first half of
  Phase 1 — `domain/scoring.ts` (`scoreGame`) and `domain/validation.ts`
  (`validateFrame`), written test-first.
- **Gate:** 31 tests passing; 100% line/function/statement coverage on the
  domain core; typecheck, lint, format all green.
- **Commit:** `chore: bootstrap monorepo and pure scoring domain` (PR #1).

---

## Iteration 1 — S1 recognized-split lookup

- **Slice:** S1 · **Dev:** BE Dev · **Reviewer:** Code Reviewer
- **Scope:** `domain/splits.ts` — hardcoded recognized-split table keyed on the
  10-bit standing-pin mask; `isSplit`, `splitName`, `isSinglePinLeave`,
  `maskFromPins`/`pinsFromMask`. Test-first (17 cases).
- **Review:** CHANGES-REQUESTED — reviewer caught that `4-5` and `5-6` are
  _adjacent_ (not gapped) leaves and must not be in the split table (CLAUDE.md
  §7 requires a gapped leave). Fix applied: removed both entries; rewrote the
  adjacent-non-split test to assert 2-3/4-5/5-6/9-10 are not splits. Re-reviewed
  clean.
- **Gate:** 46 tests passing; splits.ts 100% line/branch/function coverage;
  typecheck, lint, format all green.
- **Commit:** `feat(domain): add recognized-split lookup (S1)` (PR #1).

## Iteration 2 — S2 solo stats domain

- **Slice:** S2 · **Dev:** BE Dev · **Reviewer:** Code Reviewer
- **Scope:** `domain/stats.ts` — `computeGameStats`, `computeSeriesStats`,
  `aggregatePinLeaves`. Reuses `scoreGame` (never re-derives scores) and
  `isSplit`/`isSinglePinLeave` (never re-infers splits). Ratios exposed with
  their underlying counts; every ratio `null` at a zero denominator. Test-first
  (33 cases).
- **Review:** PASS first pass. Null-not-NaN guarantee, "splits also count as
  spare attempts," derivation, and domain purity all verified.
- **Design decisions recorded:**
  - **Frame-10 strike% denominator:** each _fresh-rack_ ball in the 10th is a
    first-ball opportunity (perfect game → 12 opps/12 strikes; all-spares →
    11 opps, strike% 0). Consciously chosen over the fixed-10 convention;
    documented in the module header. The stats-feature UI (S14) should note
    that the strike% denominator isn't a fixed 10.
  - **highSeries** = total pinfall across the given games.
  - **Clean game** = all 10 frames present and every frame marked.
  - Split/single-pin stats require per-frame leave masks; `null` when absent.
- **Follow-up (non-blocking):** partial-leaves case in `computeSeriesStats`
  (leaves shorter than games) is sane but untested — revisit if it matters.
- **Gate:** 81 tests passing; stats.ts 100% lines/functions (89% branches);
  typecheck, lint, format all green.
- **Commit:** `feat(domain): add solo stats (S2)` (PR #1).

## Iteration 3 — S3 head-to-head domain

- **Slice:** S3 · **Dev:** BE Dev · **Reviewer:** Code Reviewer
- **Scope:** `domain/headtohead.ts` — `headToHead` (pair-by-order, drop trailing
  remainder, W-L-T, avgMargin = self−opp, selfAvg/opponentAvg over paired
  games), `withWithout` (partition sessions by opponent presence; per-game
  averages + strike% via `computeSeriesStats`), `timesBowledWith`. Pure input
  view types decouple the domain from DB rows. Test-first (16 cases).
- **Review:** PASS first pass. Pairing/drop-remainder (no leak of dropped game),
  margin sign (self-loss ⇒ negative), null-not-NaN, derivation, purity, and
  guest-vs-self parity all verified.
- **Decisions:** `timesBowledWith` counts sessions where both players have ≥1
  game (a real shared outing); with/without averages are per-game means (not
  series totals) for apples-to-apples comparison.
- **Gate:** 97 tests passing; headtohead.ts 100% lines/functions (89% branches);
  typecheck, lint, format all green.
- **Commit:** `feat(domain): add head-to-head relational stats (S3)` (PR #1).
- **Milestone:** the entire pure-domain core (scoring, validation, splits,
  stats, head-to-head) is complete and proven — zero infra required.

## Iteration 4 — S4 UUIDv7 id utility

- **Slice:** S4 · **Dev:** BE Dev · **Reviewer:** Code Reviewer
- **Scope:** `apps/mobile/src/db/id.ts` — zero-dep inline UUIDv7 (`uuidv7`,
  `uuidv7At(ms)` for deterministic tests, `isUuidV7`). 48-bit big-endian ms
  timestamp (split hi/lo to avoid 32-bit overflow) ⇒ lexical order = chrono
  order. Test-first (14 cases incl. 10k-uniqueness + monotonicity).
- **Review:** PASS first pass. Bit math hand-verified
  (`uuidv7At(0x017F22E279B0)` → `017f22e279b0…`), version/variant nibbles,
  time-ordering, RN-portable RNG (`globalThis.crypto.getRandomValues`, throws
  if absent; documents the `react-native-get-random-values` polyfill), no `any`.
- **Notes:** lives in `db/` not `domain/` (impure — clock + RNG). Root
  `tsconfig.json` include extended to `apps/mobile/src/db/**`.
- **Gate:** 111 tests passing; typecheck, lint, format all green.
- **Commit:** `feat(db): add UUIDv7 id generator (S4)` (PR #1).

## Iteration 5 — S5 Drizzle SQLite schema

- **Slice:** S5 · **Dev:** BE Dev · **Reviewer:** Code Reviewer
- **Scope:** `apps/mobile/src/db/schema.ts` — all 11 tables, driver-agnostic
  (no expo-sqlite import). Identity model encoded: `games.playerId`→players
  (never users), `games.ownerUserId`→users (recorder), `games.sessionId`
  nullable (solo=null/one-participant); `players.userId` nullable (guest vs
  linked), `players.isSelf`. **One-self-player** partial unique index
  (`is_self=1 AND user_id IS NOT NULL AND deleted_at IS NULL`) — guests &
  tombstones exempt. Sync columns on every table via `syncColumns()` helper
  (UUIDv7 PK, updatedAt, deletedAt tombstone, syncStatus enum). Frame arrays as
  JSON columns. In-memory better-sqlite3 round-trip tests (9 cases) deriving DDL
  from the schema (forward-only honored).
- **Deps:** +drizzle-orm (dep), +drizzle-kit/better-sqlite3/@types (dev).
  Added `pnpm.onlyBuiltDependencies: [better-sqlite3, esbuild]` so the native
  build is reproducible in CI/fresh installs (the dev had to approve it manually).
- **Review:** PASS. Identity model + sync contract verified to spec and proven by
  tests. Non-blocking note applied immediately (table is empty, forward-only):
  **weight/lat/lng/ratio changed `integer`→`real`** to preserve fractional
  precision before any data ships.
- **Deferred:** per-package `apps/mobile/tsconfig.json` not created (root tsconfig
  already typechecks `db/**`); root include for `sync/**` deferred to S17.
- **Gate:** 118 tests passing; typecheck, lint, format all green.
- **Commit:** `feat(db): add Drizzle SQLite schema with identity model + sync columns (S5)` (PR #1).

## Iteration 6 — S6 forward-only migrations + db client
- **Slice:** S6 · **Dev:** BE Dev · **Reviewer:** Code Reviewer
- **Scope:** Generated the first forward-only migration
  `apps/mobile/drizzle/0000_sleepy_misty_knight.sql` (+ `meta/` journal) from the
  S5 schema — all 11 tables + the partial unique index, committed as
  never-hand-edited artifacts (`.prettierignore` covers `drizzle/`).
  `db/client.ts` = sole expo-sqlite importer (`getDb()` lazy singleton),
  excluded from root typecheck + lint until S9 installs Expo. `db/migrate.ts`
  `applyMigrations(sqlite)` reads `drizzle/*.sql` in lexical order, splits on the
  statement-breakpoint marker, execs each — uses a local `SqliteExecutor`
  interface (no hard better-sqlite3/Expo dependency). `migrate.test.ts` (4 cases)
  proves 11-table parity + partial-index + round-trip against a migrated
  `:memory:` DB, plus an append-only journal guard. `db:generate` script added.
- **Review:** PASS first pass. Migration contents, forward-only discipline,
  client.ts isolation, and the excludes all verified. The judgment call
  (migrate.ts excluded from root tsc because the lean root config has no node
  types) confirmed necessary and covered by Vitest+ESLint.
- **Follow-ups (non-blocking, recorded):**
  1. Add a dedicated `tsconfig.node.json` (lib + @types/node) for tooling/test
     files instead of growing the root `exclude` list as node-side utilities
     accumulate (S7+). 
  2. Wrap each migration file's statements in a transaction so a partial failure
     is atomic — matters when real device migrations chain.
- **Gate:** 122 tests passing; typecheck, lint, format all green.
- **Commit:** `feat(db): generate forward-only migration + Expo client boundary (S6)` (PR #1).

<!-- New iterations are appended below this line by the Tech Lead. -->
