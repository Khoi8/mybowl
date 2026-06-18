# bowli MVP slice backlog

Source of truth for remaining work. Status is updated by the Tech Lead after
each iteration. Designs/notes for in-flight slices live in `docs/slices/<id>.md`.

## Status board

| ID  | Title                                 | Owner          | Depends on | Lane           | Status |
| --- | ------------------------------------- | -------------- | ---------- | -------------- | ------ |
| S1  | recognized-split lookup               | BE domain      | —          | CI-pure        | DONE   |
| S2  | solo stats domain                     | BE domain      | S1         | CI-pure        | DONE   |
| S3  | head-to-head domain                   | BE domain      | S2         | CI-pure        | DONE   |
| S4  | UUIDv7 id utility                     | BE persistence | —          | CI-node-sqlite | DONE   |
| S5  | Drizzle SQLite schema                 | BE persistence | S4         | CI-node-sqlite | DONE   |
| S6  | forward-only migrations + db client   | BE persistence | S5         | CI-node-sqlite | DONE   |
| S7  | repository modules                    | BE persistence | S4,S5      | CI-node-sqlite | DONE   |
| S8  | read-model adapters (rows→domain)     | BE persistence | S2,S3,S7   | CI-node-sqlite | DONE   |
| S9  | Expo app scaffold + providers         | FE             | S6         | heavy-expo     | TODO   |
| S10 | scoring entry feature                 | FE             | S9,S7      | heavy-expo     | TODO   |
| S11 | players/contacts feature              | FE             | S9,S7      | heavy-expo     | TODO   |
| S12 | sessions feature (solo=1-participant) | FE             | S10,S11    | heavy-expo     | TODO   |
| S13 | arsenal (balls) feature               | FE             | S9,S7,S10  | heavy-expo     | TODO   |
| S14 | solo stats feature                    | FE             | S2,S8,S12  | heavy-expo     | TODO   |
| S15 | relational stats feature              | FE             | S3,S8,S12  | heavy-expo     | TODO   |
| S16 | lane conditions feature               | FE+persistence | S5,S7,S12  | heavy-expo     | TODO   |
| S17 | sync outbox: ops table + enqueue      | BE sync        | S5,S7      | CI-node-sqlite | DONE   |
| S18 | LWW reconciliation + drain            | BE sync        | S17        | CI-node-sqlite | DONE   |
| S19 | Go chi service + /sync endpoints      | BE Go          | S18        | heavy-go-aws   | DONE   |
| S20 | Postgres goose migrations             | BE Go          | S19        | heavy-go-aws   | DONE   |
| S21 | generated wire types (Go→TS)          | BE Go          | S19        | heavy-go-aws   | DONE   |
| S22 | Cognito + CDK infra                   | BE Go          | S19,S20    | heavy-go-aws   | DONE   |

**Lanes:** `CI-pure` = pure TS + Vitest, headless. `CI-node-sqlite` = + `better-sqlite3`
in Node, headless. `heavy-expo` = needs Expo/RN (logic lands in unit-testable
hooks/stores; thin components reviewed by eye). `heavy-go-aws` = needs Go +
Postgres container + AWS.

## Architect decisions (apply across slices)

- **splits before stats** — `stats.ts` reuses split classification; it must not re-infer splits.
- **stats consumes `scoreGame`** — never re-derives scores.
- **UUIDv7 lives outside `domain/`** (`db/id.ts`) — id generation is impure (clock+RNG).
- **Node-SQLite test strategy:** `schema.ts` imports no `expo-sqlite` (driver-agnostic);
  repo tests use `better-sqlite3` + `:memory:`. Only `db/client.ts` imports `expo-sqlite`,
  excluded from Node tests. Repos take an injected `Db` handle (no global singleton).
- **Ratios are `null` (not NaN) when the denominator is 0.**
- **Type-direction inversion at Phase 7:** Go becomes the wire-type source; generate TS into
  `packages/shared/generated/` (never hand-edited).

---

## S1 — recognized-split lookup `[CI-pure]`

- **Goal:** Pure, hardcoded recognized-split classifier keyed on the standing-pin mask, plus single-pin-leave detection, so stats never _infers_ splits.
- **Owner:** BE Dev domain · **Depends on:** —
- **Files:** create `apps/mobile/src/domain/splits.ts`, `splits.test.ts`; modify `domain/index.ts`.
- **Contracts:** `type PinMask = number` (10-bit, bit i ⇒ pin i+1 standing); `isSplit(standingAfterFirst): boolean`; `splitName(standingAfterFirst): string | null`; `isSinglePinLeave(standingAfterFirst): boolean`; `RECOGNIZED_SPLITS: ReadonlyArray<{mask;name}>`; `pinsFromMask`/`maskFromPins`.
- **Test plan (show the test first):** 7-10; 4-6-7-10 (big four); 5-7/5-10/3-10/2-7 baby splits; headpin standing ⇒ never a split; adjacent no-gap leave ⇒ not split; single-pin leaves ⇒ `isSinglePinLeave` true & `isSplit` false; full rack & empty mask ⇒ not split.
- **Acceptance:** all cases green; pure table lookup (no geometric inference); passes domain-purity lint; functions 100% covered.

## S2 — solo stats domain `[CI-pure]`

- **Goal:** All MVP solo stats as pure functions from frames/games, reusing `scoreGame` + `splits`; never stored.
- **Owner:** BE Dev domain · **Depends on:** S1
- **Files:** create `domain/stats.ts`, `stats.test.ts`; modify `domain/index.ts`.
- **Contracts:** `GameStats {strikePct; spareConversionPct; splitConversionPct; singlePinSparePct; isCleanGame; score}`; `SeriesStats {gameCount; average; highGame; highSeries; cleanGameCount; rolled-up %}`; `computeGameStats(frames, leaves?)`; `computeSeriesStats(games, leaves?)`; `aggregatePinLeaves(...)` → per-pin standing-count map (pins 1–10).
- **Definitions (CLAUDE.md §7):** strike% = strikes / first-ball opps; spare conv% = spares made / attempts; split conv% = splits converted / faced; single-pin spare% separate; clean = every frame marked. Ratios `null` when denominator 0.
- **Test plan (show the test first):** perfect game; all-spares; fully open; single-pin-spare; split faced converted vs missed; high game/series over 3 games; average; pin-leave aggregation; empty series ⇒ no NaN.
- **Acceptance:** no NaN/Infinity; derived live (no re-implemented scoring); coverage gate met.

## S3 — head-to-head domain `[CI-pure]`

- **Goal:** Competitive ("against") + contextual ("with") relational stats from session/game/frame data, pairing games by order, no divide-by-zero.
- **Owner:** BE Dev domain · **Depends on:** S2
- **Files:** create `domain/headtohead.ts`, `headtohead.test.ts`; modify `domain/index.ts`.
- **Contracts:** `H2HSessionView {sessionId; selfGames: number[][][]; opponentGames: number[][][]}`; `HeadToHeadRecord {wins;losses;ties;gamesPaired;avgMargin|null;selfAvg|null;opponentAvg|null}`; `headToHead(sessions)`; `WithWithoutSplit {...|null; sessionsWith; sessionsWithout}`; `withWithout(...)`; `timesBowledWith(sessions)`.
- **Test plan (show the test first):** W/L/T incl. ties; unequal counts pair-by-order drop remainder; margin sign self−opp; with/without partition; single shared session no NaN; zero shared sessions ⇒ nulls, counts 0, no throw.
- **Acceptance:** pairing/margin/partition verified; ratios `null` not NaN at denom 0; domain purity; coverage gate met.

## S4 — UUIDv7 id utility `[CI-node-sqlite]`

- **Goal:** Client-side, time-sortable UUIDv7 generator for every syncable row.
- **Owner:** BE Dev persistence · **Depends on:** —
- **Files:** create `apps/mobile/src/db/id.ts`, `id.test.ts`. Recommend **inline ~15-line impl (zero deps)**.
- **Contracts:** `uuidv7(): UUID`; `isUuidV7(s): boolean`.
- **Test plan:** valid v7 (version nibble 7, variant bits); sequence sorts ascending lexically; uniqueness over large batch.
- **Acceptance:** portable RNG (document RN polyfill if `crypto.getRandomValues` assumed); runs in Node Vitest.

## S5 — Drizzle SQLite schema (identity + sync columns) `[CI-node-sqlite]`

- **Goal:** Full data model + sync columns as a driver-agnostic Drizzle schema importing no `expo-sqlite`.
- **Owner:** BE Dev persistence · **Depends on:** S4
- **Files:** create `db/schema.ts`, `schema.test.ts`, `apps/mobile/drizzle.config.ts`, `apps/mobile/tsconfig.json`; modify root `tsconfig.json` include (`db/**`,`sync/**`); add devDeps `drizzle-orm`,`drizzle-kit`,`better-sqlite3`,`@types/better-sqlite3`.
- **Contracts:** tables `users,players,balls,oilPatterns,locations,leagues,sessions,sessionPlayers,games,frames,laneConditionLogs`. Identity: `games.playerId`→players, `games.ownerUserId`→users, `players.userId` nullable, `players.isSelf`, `sessions.isGroup`, `games.sessionId` nullable. Sync cols on every syncable table: `id TEXT PK`, `updatedAt INTEGER`, `deletedAt INTEGER NULL`, `syncStatus TEXT`. `frames.throws/ballIdPerThrow/pinState` as JSON. Exported `schema` object + inferred types.
- **Test plan (in-memory better-sqlite3):** push schema, assert tables/cols; insert self+guest players, session, 2 sessionPlayers, games, frames (JSON round-trip); FK enforcement rejects orphan game; sync-col defaults.
- **Acceptance:** zero expo/RN imports; identity FKs; 4 sync cols everywhere; JSON round-trips; in-memory test green in Node.

## S6 — forward-only migrations + db client `[CI-node-sqlite]`

- **Goal:** Forward-only Drizzle migration generation + single Expo-SQLite client boundary, schema still Node-testable.
- **Owner:** BE Dev persistence · **Depends on:** S5
- **Files:** create `apps/mobile/drizzle/` (generated SQL+journal), `db/client.ts` (ONLY expo-sqlite importer), `db/migrate.ts`, `migrate.test.ts`; add `db:generate` script.
- **Contracts:** `db:generate`; `getDb()` (Expo); Node `applyMigrations(sqlite)` helper not importing Expo.
- **Test plan:** apply generated SQL to fresh in-memory DB ⇒ schema matches S5; migration journal append-only (convention/CI check).
- **Acceptance:** migrations are generated artifacts (never hand-edited); `client.ts` sole expo importer (excluded from Node tests); migration test green.

## S7 — repository modules `[CI-node-sqlite]`

- **Goal:** Offline-first CRUD repos (stamp `updatedAt`,`syncStatus='pending'`, tombstone deletes) with in-memory tests.
- **Owner:** BE Dev persistence · **Depends on:** S4,S5
- **Files:** create `db/repositories/{players,sessions,games,frames}.ts` + tests, `repositories/index.ts`, `db/testing/memoryDb.ts`.
- **Contracts:** per entity `create*/update*/softDelete*/get*ById/list*` (list excludes tombstones); `createGameWithFrames` transactional; writers take injected `Db`.
- **Test plan:** round-trip; update bumps `updatedAt`+sets pending; soft delete tombstones & excluded from list but physically present; solo (sessionId null) + group persist; `createGameWithFrames` atomic rollback.
- **Acceptance:** injected DB; every mutation stamps sync metadata; deletes are tombstones; tests green.

## S8 — read-model adapters (rows→domain) `[CI-node-sqlite]`

- **Goal:** Map persisted rows into pure-domain input shapes so stats/h2h compute from real data without coupling domain to DB.
- **Owner:** BE Dev persistence · **Depends on:** S2,S3,S7
- **Files:** create `db/readmodels/{gameFrames,seriesForPlayer,h2hSessions}.ts` + tests.
- **Contracts:** `loadGameFrames`, `loadLeaveMasks`, `loadSeriesForPlayer`, `loadH2HSessions`, `loadWithWithout`.
- **Test plan:** seed session w/ self+opp games/frames; assert ordered paired games; reconstruct scoreGame array; feed into domain & assert end-to-end numbers.
- **Acceptance:** domain consumes adapter output unchanged; end-to-end numbers match; tests green.

## S9–S16 — mobile feature slices `[heavy-expo]`

Reviewability rule: all non-trivial logic in Zustand stores or plain hooks importing only `domain/**`+`db/**` (unit-tested headless); components thin, reviewed by eye.

- **S9 Expo scaffold + providers** (dep S6): app.json/App.tsx/babel/metro/tailwind/nativewind, `app/providers.tsx` (QueryClient + migration bootstrap), `app/navigation.tsx`; deps expo/react-native/nativewind/@tanstack/react-query/zustand/react-navigation. Node-testable `createQueryClient()` factory. Boot verified manually.
- **S10 scoring entry** (dep S9,S7): `features/scoring/` store+hook+screens; tests on store (validateFrame rejection, scoreGame running score, 10th fill, offline write w/ sync metadata).
- **S11 players/contacts** (dep S9,S7): `features/players/`; search-existing-first; guest=userId null; single-self invariant enforced+tested.
- **S12 sessions (solo=1-participant)** (dep S10,S11): `features/sessions/`; solo & group share one code path (test asserts only `isGroup` differs); context inheritance.
- **S13 arsenal** (dep S9,S7,S10): `features/arsenal/`; per-throw ball tag into `ballIdPerThrow`; retired hidden from new entry, kept in history.
- **S14 solo stats** (dep S2,S8,S12): `features/stats/` `useSoloStats` (TanStack Query); recomputed on read (no stats table); heatmap from `aggregatePinLeaves`.
- **S15 relational stats** (dep S3,S8,S12): `features/stats/relational/` `useHeadToHead`; surfaces "bowled with X N times"; no divide-by-zero.
- **S16 lane conditions** (dep S5,S7,S12): `db/repositories/laneConditions.ts` + `features/laneConditions/`; per-visit (not per-location score).

## S17 — sync outbox: ops table + transactional write+enqueue `[CI-node-sqlite]`

- **Owner:** BE Dev sync · **Depends on:** S5,S7
- **Files:** `sync/schema.ts` (sync_ops + generated migration), `sync/outbox.ts`, `outbox.test.ts`; route S7 repo writes through outbox.
- **Contracts:** `sync_ops {id,entityTable,entityId,op('upsert'|'delete'),payload,updatedAt,status('pending'|'inflight'|'done'|'failed'),attempts}`; `enqueueWithWrite(db,write,op)` transactional; `listPendingOps(db)`.
- **Test plan:** write+op atomic (either failing rolls back both); pending ops in UUIDv7 order; tombstone delete enqueues `'delete'`.
- **Acceptance:** no mutation without its op; time-stable order; tests green.

## S18 — LWW reconciliation + connectivity-triggered drain `[CI-node-sqlite / drain heavy-expo]`

- **Owner:** BE Dev sync · **Depends on:** S17
- **Files:** `sync/reconcile.ts` (+test), `sync/drain.ts`, `sync/connectivity.ts` (NetInfo wrapper, only Expo-coupled file), `drain.test.ts` (mock transport + in-memory DB).
- **Contracts:** `reconcile(local,remote): 'keep-local'|'take-remote'` (LWW on updatedAt; tombstone tie rule documented); `drain(db,transport)`; `onConnectivityRestored(cb)`.
- **Test plan:** newer updatedAt wins both ways; equal-timestamp deterministic; tombstone-vs-update per rule; drain marks done/failed+retry; pull applies remote without clobbering newer local.
- **Acceptance:** deterministic LWW; idempotent retry-safe drain; reconcile tests headless; green.

## S19–S22 — backend / infra `[heavy-go-aws]` (last)

- **S19 Go chi + /sync** (dep S18): `services/api/...`; `POST /sync/push` (server LWW), `GET /sync/pull?since=` (incl. tombstones); `go test` + Postgres container; handlers thin, logic in `internal/domain`; errors `%w`.
- **S20 Postgres goose migrations** (dep S19): `services/api/migrations/0001_init.sql`+; UUID PKs, updated_at, deleted_at, FK identity; forward-only; schema parity w/ S5.
- **S21 generated wire types Go→TS** (dep S19): codegen → `packages/shared/generated/wire.ts`; `sync/wireMap.ts` domain↔wire; mapping round-trip tested; generated never hand-edited.
- **S22 Cognito + CDK** (dep S19,S20): `infra/...` auth/api/db stacks; `cdk synth` clean; sync routes require valid Cognito JWT; deploy needs AWS creds (not headless).

## Dependency graph

```
S1 → S2 → S3
S4 → S5 → S6 → S9
     S5 → S7 → S8 (needs S2,S3)
     S7 → S10 → S12 → {S14(S2,S8), S15(S3,S8), S16}
     S7 → S11 → S12 ;  S7,S10 → S13
S5,S7 → S17 → S18 → S19 → {S20,S21} → S22
```

## Autonomous sequencing (Tech Lead)

- **Headless now:** S1,S2,S3 → S4,S5,S6,S7,S8 → S17,S18(reconcile) + S16(repo half). Bulk of domain/persistence/sync logic; no Expo/Go/AWS.
- **S9–S15:** land logic in hook/store `.test.ts` (headless), review thin components by eye; boot verified manually.
- **S19–S22:** heavier lane (Go + Postgres container; AWS for S22 deploy).
