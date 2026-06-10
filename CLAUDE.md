Project memory for **bowli** — a bowling performance tracker. Frame-by-frame scoring, arsenal management, pin-leave analytics, per-visit context (location, lane, lane conditions), and **group sessions** — start an outing with friends and track everyone’s games together, like starting a round with playing partners in 18Birdies.

---

## 1. Product vision

Core loops:

- **Solo track:** bowl → log frames (or tag live) → review stats → adjust equipment/approach.
- **Group session:** start a session → add the people you’re bowling with → record everyone’s frames on one shared scorecard → everyone’s games are tracked together.

Every game is logged with context (location, lane, conditions) **and** with _who you bowled with_. The long-term payoff is relational stats: **how well you bowl with a given person, and your head-to-head record against them.** Identity of the people you bowl with must persist across outings for any of that to work — that’s the central data-model decision.

### MVP scope

- Manual frame-by-frame scoring with correct bonus logic
- Per-shot ball tagging from a managed arsenal
- Location / lane / lane-condition logging per visit
- **Group sessions** — add participants (self + friends/guests), record all their games on one device
- **Players/contacts** — persistent identities for people you bowl with (app users or guests)
- Solo stats: average, high game/series, strike %, spare/split conversion %, pin-leave heatmap
- **Relational stats** — head-to-head record and “with vs against” performance per person
- Fully offline; sync when connected

### Parked for later (designed-around, not built)

- **Live multi-device sessions** — each bowler enters their own frames on their own phone, synced in real time. MVP is single-device recording; the schema must not block this later.
- Linking a guest contact to a real bowli account so the session data flows to _their_ profile too
- Beli-style ranking of locations; broader social (following, leaderboards, recommendations)
- Live center-scoring integrations, tournaments

> Don’t scaffold parked items. But keep `user_id` (record owner), a stable `player_id`, and `session_id` on logged data so the live/social layers attach cleanly later.

---

## 2. Tech stack

Mirrors the `reps` app — proven offline-first pattern.

| Layer    | Choice                                       |
| -------- | -------------------------------------------- |
| Mobile   | Expo (React Native) + TypeScript             |
| Local DB | SQLite via `expo-sqlite` + Drizzle ORM       |
| State    | Zustand (UI) + TanStack Query (server cache) |
| Styling  | NativeWind (Tailwind for RN)                 |
| Backend  | Go (chi router)                              |
| Cloud DB | PostgreSQL (Aurora Serverless v2)            |
| API      | REST over API Gateway → Lambda               |
| Infra    | AWS CDK (TypeScript)                         |
| Auth     | Cognito (email + Apple/Google)               |

**Offline-first is non-negotiable.** SQLite is the source of truth on device; Postgres is the sync target. Assume the user is mid-game on bad alley wifi.

> Location entry is free-text or pick-from-recent for MVP. Geo-backed shared catalog is a future nicety.

---

## 3. Repo structure (monorepo)

```
bowli/
├── apps/
│   └── mobile/              # Expo app
│       ├── src/
│       │   ├── features/    # scoring, arsenal, stats, sessions, players, locations, leagues
│       │   ├── db/          # Drizzle schema + migrations (SQLite)
│       │   ├── sync/        # sync queue + reconciliation
│       │   ├── domain/      # PURE logic: scoring, stats, headtohead (no RN imports)
│       │   └── ui/          # shared components
├── services/
│   └── api/                 # Go backend
│       ├── cmd/api/
│       ├── internal/{handlers,store,domain}/
│       └── migrations/      # Postgres (goose)
├── infra/                   # AWS CDK
└── packages/
    └── shared/              # TS types shared across mobile (+ generated from Go)
```

**Keep `apps/mobile/src/domain/` pure** — scoring, stats, and head-to-head math have zero React Native dependencies, so they’re unit-testable in plain Node and portable.

---

## 4. Commands

Primary dev machine is **Windows / PowerShell**; Mac is secondary. The JS workspace uses **pnpm**.

```bash
# Root (monorepo)
pnpm install
pnpm test                      # vitest run (domain tests + coverage gate)
pnpm exec vitest run --coverage
pnpm typecheck                 # tsc --noEmit over domain + shared
pnpm lint                      # eslint (enforces domain purity + no-any)
pnpm format                    # prettier --write

# Mobile (added in a later phase)
cd apps/mobile
npx expo start
npm run db:generate            # Drizzle migration from schema

# Backend
cd services/api
go run ./cmd/api
go test ./...
goose -dir migrations postgres "$env:DATABASE_URL" up   # PowerShell env var syntax

# Infra
cd infra
npx cdk diff
npx cdk deploy --all
```

> PowerShell: use `$env:VAR` not `$VAR`, and `;` not `&&` to chain if a tool balks.

---

## 5. Architecture notes

- **Write path:** UI mutation → write to SQLite immediately → enqueue sync op → optimistic UI. Network never blocks the user.
- **Sync:** outbox/queue pattern. Each op has a client-generated UUIDv7 and `updated_at`. Last-write-wins per record for MVP.
- **IDs:** UUIDv7 generated client-side so records exist offline and merge cleanly.
- **Group sessions are single-device for MVP.** The host records every participant’s frames on their phone. Guests and linked users are both just `Player` rows in the host’s local DB. No real-time multi-device coordination yet — that’s the parked “live session” feature.
- **Stats are derived, never stored as source of truth** — solo and relational alike. Recompute from frames/sessions on read.

---

## 6. Core data model

```
User
Player          { id, user_id?, name, is_self, avatar? }   # a bowler identity
Ball            { id, owner_user_id, name, brand, coverstock, layout, surface, weight, retired }
OilPattern      { id, name, length_ft, volume, ratio, notes }
Location        { id, name, address?, lat?, lng?, lane_count?, pinsetter_type?, notes? }
League          { id, name, season, house, ... }

Session         { id, owner_user_id, date, location_id?, lane?, oil_pattern_id?,
                  is_group, notes }
SessionPlayer   { id, session_id, player_id, turn_order? }   # participants in the session
Game            { id, owner_user_id, session_id?, player_id, league_id?, date,
                  location_id?, lane?, oil_pattern_id?, notes }
Frame           { id, game_id, frame_no (1-10), throws[], ball_id_per_throw[], pin_state[] }
LaneConditionLog{ id, owner_user_id, location_id, session_id?, date, oil_pattern_id?,
                  freshness, play_style, carrydown, hold_notes, breakpoint_notes, rating_1_5? }
```

The identity model (read this carefully — it’s the crux):

- **Every game points to a `Player`** via `player_id`, not directly to a `User`. `owner_user_id` is the account that _recorded_ the row.
- Each app user has exactly one **self `Player`** (`is_self = true`, `user_id` = their account).
- Friends/opponents are **`Player` rows too** — either linked to a real account (`user_id` set) or a **guest** (`user_id` null, just a name). Guests persist and are reusable so head-to-head stats accumulate across outings. The UI must encourage _reusing_ an existing contact (“Mike”) rather than creating a new one each visit, or the stats fragment.
- **Solo play is just a session with one participant** (or a game with `session_id = null`). Don’t build two parallel code paths — a solo game is the degenerate case of a group session.

Other notes:

- `Session` holds the shared context (location, lane, conditions) once; participant games inherit it. A player’s set of games within a session is effectively their series for that outing.
- `Game.lane` is free-form (“lane 7” or “lanes 12-13”).
- `pin_state` per throw is a 10-bit representation of pins standing **before** that throw → pin-leave heatmaps and split detection.
- `pinsetter_type` (`free_fall` vs `string`) is useful metadata for interpreting scores.

The TypeScript source of truth for these entities lives in `packages/shared/src/index.ts`.

---

## 7. Domain: bowling scoring rules (get these exactly right)

Encoded in `apps/mobile/src/domain/scoring.ts` with exhaustive tests.

**Frames 1–9:** Strike = 10 + next **two** throws. Spare = 10 + next **one** throw. Open = sum of two throws.

**10th frame:** Strike → two bonus balls (3 throws). Spare → one bonus ball (3 throws). Otherwise two throws. Bonus balls score only within frame 10; they are not their own frames.

**Running score** is cumulative; a frame’s score is blank (not 0) until its bonus throws are bowled.

**Stat definitions:** Strike % = strikes / first-ball opportunities. Spare conversion % = spares made / spare attempts. Split = headpin down + gapped leave — hardcoded recognized-split lookup (7-10, 4-6-7-10, 5-7, etc.), don’t infer. Track single-pin spare % separately. Clean game = every frame marked.

**Entry validation** (`apps/mobile/src/domain/validation.ts`): two throws (frames 1–9) can’t exceed 10 unless first is a strike; can’t knock down more pins than standing; 10th-frame throw count depends on strike/spare.

Canonical tests: perfect 300, all-spares with fill, “strike then 9-miss in 10th,” fully open game.

---

## 8. Domain: relational / head-to-head stats (the group payoff)

Encode in `apps/mobile/src/domain/headtohead.ts`, pure and fully tested. Everything here is computed from `Session` + `Game(player_id)` + `Frame` data already on device.

**Pairing unit.** Within a group session, pair the self-player’s games with an opponent’s games **by order** (game 1 vs their game 1, etc.). Unpaired trailing games (you bowled 3, they bowled 2) are excluded from head-to-head but still count toward personal averages. Series-total comparison is a secondary view; per-game is the default.

**“Against” (competitive) stats vs Player X:**

- **Head-to-head record:** W-L-T across all paired games in shared sessions (win = your game score > theirs).
- **Average margin** vs X (your score − their score, averaged).
- **Your avg vs their avg** when bowling together.

**“With” (does this person elevate your game) stats:**

- **Your average when X is in the session** vs your average when they’re not. Frames the “I bowl better with Nancy” question quantitatively.
- Optionally: your strike %/clean-game rate split the same way.

**Identity caveats to enforce:**

- All of the above are only meaningful if the same `Player` is reused across sessions. Surface “you’ve bowled with X N times” so fragmentation is visible.
- A guest `Player` and a self `Player` are compared identically — the math doesn’t care whether the opponent has an account.

Tests: record tallies W/L/T correctly incl. ties; unequal game counts pair by order and drop the remainder; margin sign is (self − opponent); with/without split partitions sessions correctly; single shared session produces sane (not divide-by-zero) output.

---

## 9. Conventions

- **TypeScript:** strict mode, no `any`. Shared domain types in `packages/shared`. The root `tsconfig.base.json` also enables `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` — array access yields `T | undefined`, so guard or sum rather than index blindly.
- **Domain purity is enforced mechanically:** the domain `tsconfig` has an RN-free `lib`/`types`, and ESLint bans `react-native`/`expo`/`react`/`node:*` imports under `apps/mobile/src/domain/**`.
- **Go:** standard layout, `internal/` for non-exported packages, errors wrapped with `%w`.
- **Features are vertical slices** (`features/sessions/`), not layered by type.
- **No business logic in components or handlers** — it lives in `domain/`.
- **Migrations are forward-only.** Never edit a shipped migration. No down-migrations in MVP.
- **Commits:** conventional commits.

---

## 10. Testing expectations

- `domain/scoring`, `domain/stats`, and `domain/headtohead` must have near-100% coverage — pure functions, no excuse. Coverage gate lives in `vitest.config.ts` (lines/statements/functions ≥ 95, functions 100; branches ≥ 85, lower only because defensive guards on structurally-impossible cases are intentionally unreachable).
- Include the canonical scoring cases and the head-to-head pairing cases above.
- Sync logic gets integration tests against ephemeral SQLite + a Postgres test container.

---

## 11. Working agreements for Claude

- Treat **solo play as a one-participant session**, not a separate code path.
- Every game attributes to a `Player`; `owner_user_id` is just the recorder. Don’t conflate the two.
- Encourage reusing existing `Player`/contact records — fragmented identities silently break relational stats.
- Never store derived stats (solo or relational) as source-of-truth data.
- Keep lane conditions as per-visit session context — don’t collapse into a per-location score.
- Don’t introduce new dependencies without flagging the tradeoff — this stack is intentionally lean.
- When generating scoring or head-to-head code, **show the test first** if behavior is non-obvious.
- Live multi-device sessions, account-linking of guests, ranking, and social are parked. Don’t scaffold them, but don’t make schema choices that block them.

---

## 12. Build status & roadmap

Phased plan (build order): **pure domain core → shared types → SQLite/Drizzle persistence → mobile feature slices (scoring first) → sync outbox → backend/infra last.** Rationale: the domain is the defensible value and is fully testable with zero infra; stats are derived so the domain defines the shape the DB must produce; offline-first means the backend unblocks nothing in the MVP loop.

**Done**

- **Phase 0 — bootstrap.** pnpm workspaces, strict root TS config, Vitest + coverage gate, ESLint (no-any + domain-purity rule), Prettier. `packages/shared` holds hand-authored entity types.
- **Phase 1 (partial) — scoring + validation.** `apps/mobile/src/domain/scoring.ts` (`scoreGame`) and `validation.ts` (`validateFrame`), test-first, with the canonical cases. 100% line/function coverage.

**Next, in order**

1. Finish Phase 1: `domain/stats.ts` (strike%, spare conversion%, single-pin spare%, clean game, high game/series, average, pin-leave aggregation) + `domain/splits.ts` (hardcoded recognized-split lookup keyed on the standing-pin mask). Show the test first.
2. Phase 2: `domain/headtohead.ts` — pairing-by-order, W-L-T, margin (self − opp), with/without partition. Show the test first.
3. Phase 3: Drizzle SQLite schema in `apps/mobile/src/db` — encode the identity model + sync columns (UUIDv7 PK, `updated_at`, `deleted_at` tombstone, `sync_status`). Forward-only migrations.
4. Phase 4: mobile feature slices — scoring entry first, then players/sessions, arsenal, solo stats, relational stats, lane conditions.
5. Phase 5: sync outbox (`apps/mobile/src/sync`).
6. Phase 7: Go backend + Postgres + Cognito + CDK (last). At that point, invert the type direction — generate TS wire types FROM Go into `packages/shared/generated/`.

> Pending Phase-0 nicety not yet wired: commitlint + husky for conventional-commit enforcement.
