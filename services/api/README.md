# bowli sync API (Go)

The cloud sync target for the offline-first mobile app: a chi HTTP service over
Postgres that accepts batched sync ops and serves changed rows back, applying
**server-side last-write-wins** that mirrors the device's `reconcile` rule
exactly (newer `updated_at` wins; on tie, a tombstone wins; else the higher
UUIDv7 id wins).

## Endpoints

- `POST /sync/push` — apply a batch of ops `{ ops: [{ entityTable, entityId, op:
"upsert"|"delete", payload, entityUpdatedAt }] }` in a single transaction.
  Each op is applied only if it wins LWW against the stored row.
- `GET /sync/pull?since=<ms>` — rows across the entity tables with
  `updated_at > since`, **including tombstones** so deletes propagate. Returns a
  `cursor` for the next pull.
- `GET /health` — liveness.

Auth is a documented stub for now (`X-User-Id` / `Bearer <id>` → owner user id,
401 if missing). Real Cognito JWT validation is deferred to the infra slice
(S22) and only changes the middleware body.

## Layout

```
cmd/api/             # main: router wiring, startup migrations
internal/domain/     # wire types + pure LWW decision (IncomingWins) — no DB
internal/store/      # pgx store: guarded upsert/delete (LWW), changed-since pull
internal/handlers/   # thin HTTP handlers over a Syncer interface
internal/testsupport # testcontainers Postgres + goose migrate helper (test-only)
migrations/          # goose forward-only Postgres migrations (mirror SQLite)
```

## Requirements

- **Go ≥ 1.25** — dependency-forced (goose/pgx/testcontainers transitively
  require it); `GOTOOLCHAIN=auto` fetches it automatically.
- **Docker** + the `postgres:16-alpine` image for the integration tests.

## Commands

```bash
go run ./cmd/api          # serve (reads PORT, DATABASE_URL)
go test ./...             # unit + Postgres integration (spins a throwaway container)
go vet ./...
gofmt -l .                # must print nothing
```

The test suite starts a throwaway Postgres via testcontainers. It disables the
ryuk reaper by default (its image isn't always pullable) and tears containers
down via cleanup hooks. To run against an existing database instead, set
`TEST_DATABASE_URL`. Forward-only migrations: never edit a shipped migration.
