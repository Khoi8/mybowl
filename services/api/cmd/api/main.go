// Command api is the bowli sync backend: a chi HTTP service exposing
// POST /sync/push and GET /sync/pull, backed by Postgres. Reads PORT and
// DATABASE_URL from the environment. Migrations are applied at startup via
// goose so a fresh deploy converges to the current schema.
package main

import (
	"context"
	"database/sql"
	"errors"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	_ "github.com/jackc/pgx/v5/stdlib" // database/sql driver "pgx" for goose
	"github.com/pressly/goose/v3"

	"github.com/khoi8/mybowl/services/api/internal/handlers"
	"github.com/khoi8/mybowl/services/api/internal/store"
)

func main() {
	if err := run(); err != nil {
		log.Fatalf("fatal: %v", err)
	}
}

func run() error {
	ctx := context.Background()

	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		return errors.New("DATABASE_URL is required")
	}
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	if err := Migrate(databaseURL, "migrations"); err != nil {
		return err
	}

	st, err := store.New(ctx, databaseURL)
	if err != nil {
		return err
	}
	defer st.Close()

	// Cognito wiring: when COGNITO_ISSUER + COGNITO_CLIENT_ID are set the /sync
	// routes require a valid Cognito JWT; otherwise the dev/test stub applies.
	verifier, err := handlers.NewCognitoVerifierFromEnv(
		os.Getenv("COGNITO_ISSUER"),
		os.Getenv("COGNITO_CLIENT_ID"),
	)
	if err != nil {
		return err
	}
	var authOpts []handlers.AuthOption
	if verifier != nil {
		log.Print("auth: Cognito JWT verification enabled")
		authOpts = append(authOpts, handlers.WithVerifier(verifier))
	} else {
		log.Print("auth: Cognito not configured; using header/bearer stub")
	}

	r := NewRouter(st, authOpts...)

	srv := &http.Server{
		Addr:              ":" + port,
		Handler:           r,
		ReadHeaderTimeout: 10 * time.Second,
	}
	log.Printf("bowli api listening on :%s", port)
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}

// NewRouter builds the chi router: middleware stack, health check, and the
// authenticated /sync routes. Exported so integration tests mount the real
// handlers against a test store.
// authOpts are forwarded to handlers.NewAuthMiddleware; with none, the /sync
// routes use the dev/test stub (so existing integration tests pass unchanged).
func NewRouter(st handlers.Syncer, authOpts ...handlers.AuthOption) http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Recoverer)

	r.Get("/health", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})

	authMiddleware := handlers.NewAuthMiddleware(authOpts...)
	sync := handlers.NewSyncHandler(st)
	r.Group(func(r chi.Router) {
		r.Use(authMiddleware)
		r.Post("/sync/push", sync.Push)
		r.Get("/sync/pull", sync.Pull)
	})

	return r
}

// Migrate runs forward-only goose migrations from dir against databaseURL using
// the pgx stdlib driver. Exported and reused by the integration tests so prod
// and tests apply the exact same SQL.
func Migrate(databaseURL, dir string) error {
	db, err := sql.Open("pgx", databaseURL)
	if err != nil {
		return err
	}
	defer db.Close()

	goose.SetBaseFS(nil)
	if err := goose.SetDialect("postgres"); err != nil {
		return err
	}
	if err := goose.Up(db, dir); err != nil {
		return err
	}
	return nil
}
