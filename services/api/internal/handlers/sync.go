// Package handlers holds the thin HTTP layer: decode/encode JSON and delegate
// to the store/domain. No business logic lives here (CLAUDE.md §9).
package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"github.com/khoi8/mybowl/services/api/internal/domain"
)

// Syncer is the store behavior the sync handlers depend on. Keeping it an
// interface lets handlers be unit-tested with a fake and keeps the layering
// one-directional (handlers -> domain/store, never the reverse).
type Syncer interface {
	ApplyOps(ctx context.Context, ops []domain.Op) (applied, skipped int, err error)
	Changed(ctx context.Context, since int64) (domain.PullResponse, error)
}

// SyncHandler wires the /sync routes to a Syncer.
type SyncHandler struct {
	store Syncer
}

// NewSyncHandler constructs a SyncHandler.
func NewSyncHandler(store Syncer) *SyncHandler {
	return &SyncHandler{store: store}
}

// Push handles POST /sync/push: decode a batch and apply it under server LWW.
func (h *SyncHandler) Push(w http.ResponseWriter, r *http.Request) {
	if _, ok := UserIDFromContext(r.Context()); !ok {
		writeError(w, http.StatusUnauthorized, "unauthenticated")
		return
	}

	var req domain.PushRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}

	applied, skipped, err := h.store.ApplyOps(r.Context(), req.Ops)
	if err != nil {
		switch {
		case errors.Is(err, domain.ErrUnknownTable):
			writeError(w, http.StatusBadRequest, err.Error())
		case errors.Is(err, domain.ErrInvalidOp):
			writeError(w, http.StatusBadRequest, err.Error())
		default:
			writeError(w, http.StatusInternalServerError, "failed to apply ops")
		}
		return
	}

	writeJSON(w, http.StatusOK, domain.PushResponse{Applied: applied, Skipped: skipped})
}

// Pull handles GET /sync/pull?since=<ms>: return rows changed since the cursor,
// including tombstones, plus the next cursor.
func (h *SyncHandler) Pull(w http.ResponseWriter, r *http.Request) {
	if _, ok := UserIDFromContext(r.Context()); !ok {
		writeError(w, http.StatusUnauthorized, "unauthenticated")
		return
	}

	var since int64
	if raw := r.URL.Query().Get("since"); raw != "" {
		v, err := strconv.ParseInt(raw, 10, 64)
		if err != nil {
			writeError(w, http.StatusBadRequest, "since must be an integer (ms epoch)")
			return
		}
		since = v
	}

	resp, err := h.store.Changed(r.Context(), since)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to pull changes")
		return
	}

	writeJSON(w, http.StatusOK, resp)
}

// writeJSON encodes v as JSON with the given status.
func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// writeError emits a JSON error envelope.
func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}
