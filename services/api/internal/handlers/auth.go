package handlers

import (
	"context"
	"net/http"
	"strings"
)

// ctxKey is the unexported context key type for request-scoped values.
type ctxKey int

const userIDKey ctxKey = iota

// AuthMiddleware extracts the owner user id from the request and stows it on the
// context for handlers to scope writes/reads.
//
// SCAFFOLD ONLY (S22 deferred): real Cognito JWT verification is a later slice.
// For now we accept the user id from the `X-User-Id` header, or from a stubbed
// bearer token (`Authorization: Bearer <user-id>`) so callers can exercise the
// usual header path. A missing id yields 401 — the route is "authenticated",
// just not yet against Cognito. When S22 lands, swap the body of this function
// for JWT validation and pull the `sub` claim into the same context key; no
// handler changes required.
func AuthMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		uid := r.Header.Get("X-User-Id")
		if uid == "" {
			if auth := r.Header.Get("Authorization"); strings.HasPrefix(auth, "Bearer ") {
				uid = strings.TrimSpace(strings.TrimPrefix(auth, "Bearer "))
			}
		}
		if uid == "" {
			writeError(w, http.StatusUnauthorized, "missing user identity (X-User-Id or Bearer token)")
			return
		}
		ctx := context.WithValue(r.Context(), userIDKey, uid)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// UserIDFromContext returns the authenticated user id set by AuthMiddleware.
func UserIDFromContext(ctx context.Context) (string, bool) {
	uid, ok := ctx.Value(userIDKey).(string)
	return uid, ok
}
