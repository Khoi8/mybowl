// Package testsupport provides shared test scaffolding: spinning up a real
// Postgres (via testcontainers-go) and running goose migrations against it. It
// lives under internal/ so it is test-only infrastructure, not part of the API.
package testsupport

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"testing"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib" // pgx stdlib driver for goose
	"github.com/pressly/goose/v3"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/modules/postgres"
	"github.com/testcontainers/testcontainers-go/wait"
)

// StartPostgres launches a throwaway Postgres container and returns its DSN plus
// a cleanup func. Uses the postgres:16-alpine image (pre-pulled in CI/dev).
//
// Two escape hatches keep the suite reproducible across environments:
//   - If TEST_DATABASE_URL is set, that DSN is used directly and no container is
//     started (cleanup is a no-op) — handy where Docker is unavailable.
//   - Otherwise the testcontainers "ryuk" reaper is disabled by default
//     (TESTCONTAINERS_RYUK_DISABLED), since its image isn't always pullable
//     (e.g. behind Docker Hub rate limits). Containers are still torn down via
//     the returned cleanup func. Set the env var explicitly to override.
func StartPostgres(ctx context.Context, t *testing.T) (string, func()) {
	t.Helper()

	if dsn := os.Getenv("TEST_DATABASE_URL"); dsn != "" {
		return dsn, func() {}
	}

	if _, set := os.LookupEnv("TESTCONTAINERS_RYUK_DISABLED"); !set {
		// Reaper image is frequently unpullable here; we clean up explicitly.
		_ = os.Setenv("TESTCONTAINERS_RYUK_DISABLED", "true")
	}

	container, err := postgres.Run(ctx,
		"postgres:16-alpine",
		postgres.WithDatabase("bowli_test"),
		postgres.WithUsername("bowli"),
		postgres.WithPassword("bowli"),
		testcontainers.WithWaitStrategy(
			wait.ForLog("database system is ready to accept connections").
				WithOccurrence(2).
				WithStartupTimeout(60*time.Second),
		),
	)
	if err != nil {
		t.Fatalf("start postgres container: %v", err)
	}

	dsn, err := container.ConnectionString(ctx, "sslmode=disable")
	if err != nil {
		t.Fatalf("connection string: %v", err)
	}

	cleanup := func() {
		_ = container.Terminate(context.Background())
	}
	return dsn, cleanup
}

// Migrate runs goose Up against dsn from dir. Shared by tests and main.
func Migrate(dsn, dir string) error {
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		return fmt.Errorf("open db: %w", err)
	}
	defer db.Close()

	if err := goose.SetDialect("postgres"); err != nil {
		return fmt.Errorf("set dialect: %w", err)
	}
	if err := goose.Up(db, dir); err != nil {
		return fmt.Errorf("goose up: %w", err)
	}
	return nil
}
