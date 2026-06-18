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

## Iteration 7 — S7 repository modules

- **Slice:** S7 · **Dev:** BE Dev · **Reviewer:** Code Reviewer
- **Scope:** `db/repositories/{players,sessions,games,frames,index}.ts` — offline-
  first CRUD taking an injected `Db` handle (no global singleton). Every
  mutation re-stamps sync metadata: create ⇒ `pending`+UUIDv7+updatedAt;
  update ⇒ bumps updatedAt + resets `pending`; softDelete ⇒ tombstone
  (`deletedAt`) + `pending`, never a physical DELETE. `list*`/`get*ById` exclude
  tombstones. `createGameWithFrames` is transactional. `db/testing/memoryDb.ts`
  builds a better-sqlite3 `:memory:` Drizzle instance via S6's `applyMigrations`.
  `db/types.ts` defines `Db = BaseSQLiteDatabase<'sync', unknown, typeof schema>`.
  Test-first (20 new cases, 142 total).
- **Review:** PASS first pass. Verified: (1) transactional rollback genuinely
  proves atomicity (dup-id PK violation mid-tx ⇒ game+frames count 0);
  (2) `Db` 'sync' type accepts BOTH better-sqlite3 and the future expo-sqlite
  driver (both extend `BaseSQLiteDatabase<'sync',…>`), `unknown` not `any`;
  (3) update/softDelete always re-stamp `syncStatus='pending'` (regression
  tested per entity). Identity model, tombstone-not-delete, frame ordering,
  one-self backstop, no-any/noUncheckedIndexedAccess all confirmed.
- **Notes:** memoryDb excluded from root tsc (imports better-sqlite3/node:\*) but
  still linted; get-by-id treats tombstoned rows as gone (returns undefined),
  documented per repo.
- **Gate:** 142 tests passing; typecheck, lint, format all green.
- **Commit:** `feat(db): add offline-first repositories with tombstones (S7)` (PR #1).

## Iteration 8 — S8 read-model adapters (rows→domain)

- **Slice:** S8 · **Dev:** BE Dev · **Reviewer:** Code Reviewer
- **Scope:** `db/readmodels/{gameFrames,seriesForPlayer,h2hSessions,index}.ts` —
  map persisted rows into the pure-domain input shapes. `loadGameFrames`/
  `loadLeaveMasks` (per-frame leave = `pinState[1] ?? 0`, the rack facing the
  second throw); `loadSeriesForPlayer`/`loadAllGamesForPlayer`; `loadH2HSessions`/
  `loadWithWithout`. Sessions enumerated via `games` (null-session solo games
  excluded from shared/h2h); deterministic ordering by UUIDv7 id. Integration
  tests (12) seed via S7 repos → adapters → ACTUAL domain functions, asserting
  known scores/W-L-T/margins.
- **Review:** PASS first pass. The subtle `pinState[1]` leave-mask mapping
  verified correct (strike ⇒ 0, never pollutes split/single-pin stats); one-way
  dependency (domain imports nothing from db) intact; end-to-end arithmetic
  spot-checked (300 vs 40 ⇒ +260 win; 70 vs 80 ⇒ −10 loss; unequal counts drop
  the trailing game; with/without partitions).
- **Notes:** `loadAllGamesForPlayer` added as a companion (whole-career solo
  stats) beyond the backlog contract list. FE S15 should source the "bowled with
  X N times" headline from `timesBowledWith` over h2h views, not with/without
  `sessionsWith`.
- **Gate:** 154 tests passing; typecheck, lint, format all green.
- **Commit:** `feat(db): add read-model adapters wiring rows to the domain (S8)` (PR #1).
- **Milestone:** headless persistence layer complete — schema, migrations, ids,
  repos, and read-models, with the stats/head-to-head domain proven end-to-end
  against real SQLite data. Remaining headless work: S17–S18 (sync). S9–S16
  (Expo) and S19–S22 (Go/AWS) need heavier toolchains.

## Iteration 9 — S17 sync outbox

- **Slice:** S17 · **Dev:** BE Dev · **Reviewer:** Code Reviewer
- **Scope:** `sync/schema.ts` (`sync_ops` table) + `sync/outbox.ts`
  (`enqueueOp`, `enqueueWithWrite` transactional primitive, `listPendingOps`,
  `markOpInflight/Done/Failed`). All repo mutations now route through the
  outbox: create/update ⇒ `upsert` op, softDelete ⇒ `delete` op;
  `createGameWithFrames` enqueues the game op + one per frame inside its single
  transaction. New migration `0001_massive_norrin_radd.sql` (sync_ops only;
  0000 untouched). drizzle.config multi-file schema array; root tsconfig now
  covers `sync/**`. Test-first (outbox.test.ts; 168 total).
- **Review:** PASS first pass. Atomicity proven BOTH directions (op-insert fail
  ⇒ entity write rolled back; write fail ⇒ no op) via raw counts;
  createGameWithFrames enqueues all ops in-transaction (rollback ⇒ zero ops);
  outbox correctly a local-only queue (no entity-sync columns); status
  transitions + attempts/lastError verified. A same-millisecond UUIDv7
  tie-break test flake was fixed (select ops by value, not list position).
- **Decisions:** softDelete now also bumps `updatedAt` so the delete op's
  `entityUpdatedAt` is meaningful for S18 LWW; `payload` carries the full row on
  upsert / `{id}` on delete; migrate.test asserts `sync_ops` separately from the
  11 entity tables (it's a non-entity local table).
- **Carry into S18 (non-blocking):** merge `syncOps` into the `Db` schema
  binding (`db/types.ts`) so the drain can use typed relational reads; reconcile
  BACKLOG S17 wording (`updatedAt`) with the shipped `entityUpdatedAt`.
- **Gate:** 168 tests passing; typecheck, lint, format all green.
- **Commit:** `feat(sync): add transactional outbox wiring repo writes to sync ops (S17)` (PR #1).

## Iteration 10 — S18 LWW reconciliation + drain

- **Slice:** S18 · **Dev:** BE Dev · **Reviewer:** Code Reviewer
- **Scope:** `sync/reconcile.ts` (`reconcile` LWW decision + `applyRemoteRows`),
  `sync/drain.ts` (push pending ops via injected transport + `drainPull` helper),
  `sync/connectivity.ts` (Expo NetInfo stub, excluded from Node lanes). Also
  folded the S17 carry-over: merged `syncOps` into the `schema` aggregate (no
  import cycle: db/schema → sync/schema → db/id). Test-first (+20; 188 total).
- **Review:** PASS first pass. Verified: LWW is a deterministic total order over
  (updatedAt, isTombstone, id) and converges symmetrically on both peers;
  applyRemoteRows marks pulled rows `synced` and never clobbers a newer local
  edit; drain is idempotent/retry-safe (failed ops re-pushed, done never
  re-pushed, UUIDv7 order); the `as unknown as {id}` cast is contained/safe
  (entity tables all get `id` from `syncColumns()`).
- **Decisions:** LWW tie rule = tombstone wins, else higher UUIDv7 id, else
  keep-local; `inflight` ops are retryable (recover from a crash mid-drain;
  safe because server LWW upserts are idempotent); full multi-device pull
  deferred to S19 (push fully implemented; pull-apply unit-tested via
  applyRemoteRows).
- **Gate:** 188 tests passing; typecheck, lint, format all green.
- **Commit:** `feat(sync): add LWW reconciliation and outbox drain (S18)` (PR #1).
- **MILESTONE — headless lane complete (10/22 slices).** Pure domain (scoring,
  validation, splits, stats, head-to-head) + persistence (ids, schema,
  migrations, repos, read-models) + sync (outbox, reconciliation, drain), all
  test-proven in plain Node with 188 tests. Remaining: S9–S16 (Expo UI,
  heavy-expo) and S19–S22 (Go/Postgres/Cognito/CDK, heavy-go-aws) — need
  toolchains beyond the headless container; logic in those lands in
  unit-testable hooks/stores with thin components/handlers verified manually.

## Iteration 11 — S19 + S20 Go sync API + Postgres migrations

- **Slices:** S19 + S20 (delivered together — the API can't be tested without
  its schema) · **Dev:** BE Dev (Go) · **Reviewer:** Code Reviewer
- **Scope:** `services/api` — chi service with `POST /sync/push` (batched ops,
  one transaction) and `GET /sync/pull?since=` (changed rows incl. tombstones,
  cursor). `internal/domain` holds wire types + the pure `IncomingWins` LWW
  decision; `internal/store` is a pgx store applying LWW via guarded
  `ON CONFLICT DO UPDATE` (upsert) and guarded UPDATE (tombstone delete);
  generic upsert keyed on an entityTable→columns registry with a strict
  allowlist. `migrations/0001_init.sql` (goose, forward-only) mirrors all 11
  entity tables + identity FKs + the one-self partial index; frame arrays JSONB;
  sync_ops NOT mirrored (local-only). Auth is a documented `X-User-Id`/Bearer
  stub (real Cognito → S22). Real integration tests via testcontainers Postgres.
- **Review:** PASS. LWW SQL guard verified byte-for-byte equal to the device
  `reconcile` rule (newer wins; tie⇒tombstone; tie⇒higher id; equal id+ts⇒lose);
  SQL-injection safety confirmed (table+column names only from a validated
  allowlist/registry, all values bound as params); identity model, batch
  atomicity, tombstone-not-delete, %w wrapping, thin handlers all verified.
- **Tech Lead hardening:** made `go test ./...` reproducible with no out-of-band
  env — `testsupport.StartPostgres` now honors `TEST_DATABASE_URL` and defaults
  `TESTCONTAINERS_RYUK_DISABLED=true` (ryuk image unpullable here; containers
  still cleaned up). Added `services/api/README.md` (documents Go ≥ 1.25 +
  Docker requirement).
- **Decisions:** toolchain bumped to Go 1.25.x (dependency-forced by
  goose/pgx/testcontainers; not gratuitous). Generic table-driven upsert.
- **Follow-ups (non-blocking):** `pull` has no LIMIT/pagination yet (fine for
  MVP); server stores device `sync_status` verbatim (cosmetic).
- **Gate:** Go — `gofmt -l` clean, `go vet` clean, `go build` clean,
  `go test ./...` green incl. full Postgres integration (Tech-Lead-verified,
  12.4s fresh). JS — `pnpm exec vitest run` 188 passed, lint/format clean
  (workspace untouched).
- **Commit:** `feat(api): add Go sync service + Postgres migrations (S19, S20)` (PR #1).

## Iteration 12 — S21 generated wire types (Go→TS)

- **Slice:** S21 · **Dev:** BE Dev · **Reviewer:** Code Reviewer
- **Scope:** Inverted the type direction — Go is now the source of truth for the
  sync WIRE types. `packages/shared/generated/wire.ts` is generated from the Go
  structs via tygo (`go run github.com/gzuidhof/tygo@latest generate`, config
  `services/api/tygo.yaml`; added nothing to go.mod). Split the server-internal
  LWW helpers into `services/api/internal/domain/lww.go` so tygo emits only wire
  types from `sync.go`. `apps/mobile/src/sync/wireMap.ts` maps the outbox op ↔
  wire `Op` and pulled rows ↔ `applyRemoteRows` input, typed against the
  generated `@bowli/shared` types so Go drift breaks `pnpm typecheck` at one
  seam. `@bowli/shared` re-exports `./wire`. Test-first (+7; 195 total).
- **Review:** PASS first pass. Reviewer **regenerated** wire.ts and confirmed the
  committed file is byte-for-byte identical (no drift, not hand-edited);
  go.mod/go.sum untouched; the LWW-split refactor is behavior-preserving (same
  package, domain tests green); drift guard real; no `any` (Go `any` → `unknown`).
- **Decisions:** `OpKind = string` (tygo default; device union is assignable;
  server `Op.Validate()` enforces valid kinds) — acceptable.
- **Gate:** JS — vitest 195 pass, typecheck/lint/format clean. Go — gofmt/vet
  clean, domain tests pass. Generated file prettier-ignored.
- **Commit:** `feat(shared): generate TS wire types from Go + domain↔wire mapping (S21)` (PR #1).

## Iteration 13 — S22 Cognito + CDK infra

- **Slice:** S22 · **Dev:** BE Dev · **Reviewer:** Code Reviewer
- **Scope:** **Part A (infra):** `infra/` CDK app — auth-stack (Cognito user pool
  email sign-in + app client, Apple/Google IdP seam documented/parked),
  db-stack (Aurora Serverless v2 Postgres 16, 0.5–4 ACU), api-stack (API Gateway
  REST → Lambda provided.al2023/arm64 with a COGNITO_USER_POOLS authorizer on
  `/sync/*`, `/health` public). `cdk synth` verified creds-free; 7
  `Template.fromStack` assertion tests. Infra is isolated (own tsconfig+vitest;
  excluded from root tsc/eslint/vitest) so it can't destabilize the 195-test
  root run. Lambda points at a placeholder asset (real Go bundling = deploy-time,
  documented). **Part B (Go auth):** `internal/auth/cognito.go` — RS256 Cognito
  JWT verifier (JWKS by kid; enforces RS256-only, exp-required, exact issuer,
  token_use→client_id/aud, sub extraction), wired behind the middleware seam:
  verifier when `COGNITO_ISSUER`/`COGNITO_CLIENT_ID` set, else the S19 stub.
  Dep +golang-jwt/jwt/v5. AWS-free unit tests (httptest JWKS, locally-signed).
- **Review:** CHANGES-REQUESTED → fixed. Reviewer probed the auth boundary
  directly (alg=none, HS256 alg-confusion, missing-exp, unknown-kid → all
  rejected; configured mode can't be downgraded to the stub). One blocking
  catch: `infra/cdk.out/` wasn't gitignored (generated CFN would be staged).
  **Fix:** added `infra/.gitignore` (`cdk.out/`, `node_modules/`); confirmed via
  `git check-ignore` (0 generated paths staged). Re-verified clean.
- **Gate:** infra — `cdk synth` clean + 7 tests. Go — gofmt/vet clean,
  `go test ./...` all packages ok (auth + Postgres store), `go mod tidy` no diff.
  Root — vitest 195, typecheck/lint/format clean (infra separate). Also fixed a
  stale unformatted BUILD_LOG entry from the S21 commit.
- **Commit:** `feat(infra): add Cognito+CDK stacks and Go JWT verifier (S22)` (PR #1).
- **MILESTONE — backend + infra lane complete (14/22).** Go sync API + Postgres
  - wire-type generation + Cognito/CDK all done and verified (synth/`go test`).
    Remaining: the Expo UI lane S9–S16 (heavy-expo; logic unit-tested, components
  - boot verified manually).

## Iteration 14 — S9 Expo app scaffold + providers

- **Slice:** S9 · **Dev:** FE Dev · **Reviewer:** Code Reviewer · **Lane:** heavy-expo
- **Scope:** Expo SDK 52 app shell — `App.tsx`/`index.ts` (RNG polyfill imported
  first), `app.json`/babel/metro/tailwind/global.css/nativewind, a standalone
  `apps/mobile/tsconfig.json` (extends expo base; covers all RN/tsx incl.
  `client.ts`). `src/app/providers.tsx` = QueryClientProvider + a `MigrationGate`
  that runs `useMigrations(getDb(), migrations)` (drizzle expo migrator) and
  blocks UI until the local schema is ready; `navigation.tsx` placeholder stack.
  `src/app/queryClient.ts` = RN-free `createQueryClient()` with offline-first
  defaults (networkMode 'offlineFirst', capped backoff, refetch-on-focus/reconnect
  off — sync is outbox-driven), unit-tested in the ROOT run (+4 → 199).
- **Deps (flagged batch):** expo 52, react 18.3 / react-native 0.76.9, expo-sqlite,
  react-native-get-random-values (UUIDv7 polyfill), @tanstack/react-query,
  zustand, @react-navigation v7 (+screens/safe-area), nativewind 4 + tailwind 3,
  reanimated/gesture-handler (NativeWind dep), @types/react.
- **Gate isolation (critical, verified):** root `tsconfig.json` NOT changed to
  include `app/`/`features/`/`ui/` — no RN in the lean root; new RN/tsx is
  typechecked only by the mobile tsconfig. Root vitest 199, typecheck, lint,
  format all green; `cd apps/mobile && pnpm typecheck` exit 0; `npx expo config`
  resolves (only network-dependent expo-doctor checks fail). App boot is manual
  (no simulator).
- **Review:** PASS first pass. Reviewer traced the on-device migrator and
  confirmed the hand-generated `drizzle/migrations.js` bundle is correct (journal
  matches `_journal.json`; m0000/m0001 keys map to the right `.sql`; raw
  migrations untouched/forward-only); gate isolation preserved; removing
  `"type": "module"` from the mobile package is correct (Expo configs are CJS).
  One doc nit (stale `client.ts` comment) fixed by Tech Lead.
- **Judgment calls:** `migrations.js` hand-generated byte-identical to drizzle-kit's
  embeddedMigrations template (db:generate had nothing new to emit); pinned
  SDK-52-compatible versions (no network for `expo install`).
- **Commit:** `feat(mobile): scaffold Expo app shell + providers (S9)` (PR #1).

## Iteration 15 — S10 scoring entry feature

- **Slice:** S10 · **Dev:** FE Dev · **Reviewer:** Code Reviewer · **Lane:** heavy-expo
- **Scope:** `features/scoring/` — RN-free vanilla-zustand `store.ts`
  (`recordThrow`/`undoLastThrow`/`reset`/`scored()`/`commit()` + `legalNextPins`),
  `pinState.ts`, react bridge `useScoreEntry.ts`, thin `FrameInput`/`Scorecard`/
  `ScoreEntryScreen` (.tsx), wired into navigation as the `Score` route. Legality
  via `validateFrame`, running score via `scoreGame` (no reimplementation; only
  store-local rule is cursor-advance sequencing). `commit` persists via the
  atomic `createGameWithFrames` (offline-first; outbox enqueues). Test-first
  (+11; 210 total).
- **Review:** PASS first pass. Reviewer mechanically verified the **pinState
  placeholder** is safe: per-throw pin COUNT is exact (popcount==N), and lowest-N
  masks always keep bit 0 (headpin) set → can NEVER collide with a recognized
  split (all splits have the headpin down), so no false splits/leave stats; only
  consequence is heatmap pin _positions_ + split _naming_ are placeholder until a
  per-pin picker. Offline-first path, gate isolation, thin components all confirmed.
- **Decision:** pinState records counts (N lowest bits), not pin identities —
  documented MVP limitation. **Follow-up for the architect:** plan a future
  "per-pin leave picker" slice so heatmap positions + split naming become exact.
- **Gate:** root vitest 210 pass, typecheck/lint/format clean; `cd apps/mobile &&
pnpm typecheck` exit 0. Boot manual.
- **Commit:** `feat(mobile): add scoring entry feature (S10)` (PR #1).

## Iteration 16 — S11 players/contacts feature

- **Slice:** S11 · **Dev:** FE Dev · **Reviewer:** Code Reviewer · **Lane:** heavy-expo
- **Scope:** `features/players/` — RN-free vanilla-zustand store (`load`,
  `search` reuse-first ranking exact→prefix→substring, `createGuest`,
  `ensureSelf`, update/remove), `usePlayers` hook (module singleton — global
  contacts), `PlayersScreen`/`AddPlayerSheet` (.tsx) with reuse-first UX
  (existing matches prominent; "Create new guest" a gated, visually-secondary
  fallback). Test-first (+10; 220 total).
- **Review:** PASS first pass. Single-self invariant verified defense-in-depth
  (`ensureSelf` idempotent via `getSelfPlayer`; DB partial unique index backstops
  a raw second-self insert — both tested); reuse-first ranking genuine + stable;
  guest = userId null/isSelf false; tombstone soft-delete; gate isolation + no
  `any`; tests use the store factory + memoryDb (no singleton leakage).
- **Gate:** root vitest 220, typecheck/lint/format clean; `cd apps/mobile &&
pnpm typecheck` exit 0. Boot manual.
- **Commit:** `feat(mobile): add players/contacts feature (S11)` (PR #1).

## Iteration 17 — S12 sessions feature (solo = one-participant)

- **Slice:** S12 · **Dev:** FE Dev · **Reviewer:** Code Reviewer · **Lane:** heavy-expo
- **Scope:** `features/sessions/` — RN-free store (`createSession`,
  `addParticipant`, `startSolo`, `gameMetaFor`, `listParticipants`,
  `listSessionGamesByPlayer`), `useSession` hook, `SessionScreen`/
  `NewSessionScreen`/`ParticipantList` (.tsx). `startSolo` delegates to the SAME
  `createSession`+`addSessionPlayer` as group outings (no solo path).
  `gameMetaFor` inherits session context into the game meta the scoring `commit`
  consumes; ScoreEntryScreen now forwards that inherited context. Test-first
  (+7; 227 total).
- **Review:** PASS first pass. Verified the solo-is-one-participant proof is
  genuine (same row shape; only `isGroup`+count differ; same table/functions),
  context inheritance end-to-end (commit → read back matches session), identity
  model (addParticipant links existing players only), gate isolation, no `any`.
- **Decisions:** ownerUserId derived from the self player's `userId` (Cognito
  parked) with a guard; `Sessions` route opens the create-outing flow (dedicated
  sessions-list is later scope).
- **Gate:** root vitest 227, typecheck/lint/format clean; `cd apps/mobile &&
pnpm typecheck` exit 0. Boot manual.
- **Commit:** `feat(mobile): add sessions feature, solo as one-participant (S12)` (PR #1).

## Iteration 18 — S13 arsenal (balls) feature

- **Slice:** S13 · **Dev:** FE Dev · **Reviewer:** Code Reviewer · **Lane:** heavy-expo
- **Scope:** New `db/repositories/balls.ts` (mirrors the repo pattern: injected
  Db, outbox enqueue, tombstone; `listActiveBalls` excludes retired+tombstones)
  - `Ball`/`NewBall` schema exports. `features/arsenal/` store/hook/screens
    (CRUD + retire/unretire). Per-throw ball tagging threaded through the scoring
    store: `recordThrow(pins, ballId?)` keeps `ballIdPerThrow` aligned with
    `frames` across record/undo/reset; `commit` now persists real tags (was
    all-null). Domain stays ball-agnostic. Test-first (+13; 240 total).
- **Review:** PASS first pass. Verified ballIdPerThrow alignment across all three
  mutators (no drift), domain never sees ballId (grep-confirmed), retired balls
  hidden from BallPicker but kept live for history, repo pattern parity, gate
  isolation, no `any`, S10 pinState/validation untouched.
- **Gate:** root vitest 240, typecheck/lint/format clean; `cd apps/mobile &&
pnpm typecheck` exit 0. Boot manual.
- **Commit:** `feat(mobile): add arsenal + per-throw ball tagging (S13)` (PR #1).

<!-- New iterations are appended below this line by the Tech Lead. -->
