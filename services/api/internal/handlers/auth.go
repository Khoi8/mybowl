package handlers

import (
	"context"
	"net/http"
	"strings"

	"github.com/khoi8/mybowl/services/api/internal/auth"
)

// ctxKey is the unexported context key type for request-scoped values.
type ctxKey int

const userIDKey ctxKey = iota

// tokenVerifier is the seam the middleware verifies bearer tokens against. The
// Cognito *auth.Verifier satisfies it; tests can inject a fake. Kept as an
// interface so the handlers package doesn't hard-depend on a live verifier.
type tokenVerifier interface {
	Verify(ctx context.Context, raw string) (string, error)
}

// authConfig holds the optional Cognito verifier. When nil, AuthMiddleware
// falls back to the dev/test stub (X-User-Id / Bearer <user-id>).
type authConfig struct {
	verifier tokenVerifier
}

// AuthOption configures the auth middleware seam.
type AuthOption func(*authConfig)

// WithVerifier enables real token verification. Wire this up at startup from
// env config (issuer + client id); see NewCognitoVerifierFromEnv. When set, the
// Authorization: Bearer <jwt> header is verified and the `sub` claim becomes the
// owner user id. When unset the legacy stub remains active.
func WithVerifier(v tokenVerifier) AuthOption {
	return func(c *authConfig) { c.verifier = v }
}

// NewAuthMiddleware builds the /sync auth middleware.
//
// Seam: if a verifier is configured (production / Cognito), the bearer token is
// validated as a Cognito JWT and the `sub` claim is the owner user id. If no
// verifier is configured (local dev + the S19 integration tests), it falls back
// to the original stub: take the user id from `X-User-Id`, or from a bare
// `Authorization: Bearer <user-id>` token. This keeps existing tests green
// unchanged while production gets real auth.
func NewAuthMiddleware(opts ...AuthOption) func(http.Handler) http.Handler {
	cfg := &authConfig{}
	for _, opt := range opts {
		opt(cfg)
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			uid, ok := cfg.authenticate(r)
			if !ok {
				writeError(w, http.StatusUnauthorized, "missing or invalid user identity")
				return
			}
			ctx := context.WithValue(r.Context(), userIDKey, uid)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func (c *authConfig) authenticate(r *http.Request) (string, bool) {
	bearer := bearerToken(r)

	if c.verifier != nil {
		// Production path: bearer token must be a valid Cognito JWT.
		if bearer == "" {
			return "", false
		}
		sub, err := c.verifier.Verify(r.Context(), bearer)
		if err != nil {
			return "", false
		}
		return sub, true
	}

	// Stub path (no Cognito configured): X-User-Id wins, else the bearer value
	// is treated as the raw user id.
	if uid := r.Header.Get("X-User-Id"); uid != "" {
		return uid, true
	}
	if bearer != "" {
		return bearer, true
	}
	return "", false
}

func bearerToken(r *http.Request) string {
	auth := r.Header.Get("Authorization")
	if !strings.HasPrefix(auth, "Bearer ") {
		return ""
	}
	return strings.TrimSpace(strings.TrimPrefix(auth, "Bearer "))
}

// AuthMiddleware is the default stub middleware (no Cognito), preserved for
// existing callers/tests. Equivalent to NewAuthMiddleware() with no verifier.
func AuthMiddleware(next http.Handler) http.Handler {
	return NewAuthMiddleware()(next)
}

// NewCognitoVerifierFromEnv builds a Cognito verifier from environment config.
// Returns (nil, nil) when COGNITO_ISSUER / COGNITO_CLIENT_ID are unset, which
// signals callers to keep the stub fallback. This is the wiring point used by
// the server at startup.
func NewCognitoVerifierFromEnv(issuer, clientID string) (*auth.Verifier, error) {
	if issuer == "" || clientID == "" {
		return nil, nil
	}
	return auth.NewVerifier(auth.Config{Issuer: issuer, ClientID: clientID})
}

// UserIDFromContext returns the authenticated user id set by AuthMiddleware.
func UserIDFromContext(ctx context.Context) (string, bool) {
	uid, ok := ctx.Value(userIDKey).(string)
	return uid, ok
}
