// Package domain holds the pure, DB-free sync logic shared by the handlers and
// the store: the wire op/row types and the last-write-wins (LWW) decision.
//
// The LWW rule here is byte-for-byte the same decision the device makes in
// apps/mobile/src/sync/reconcile.ts, so client and server converge without
// coordination (CLAUDE.md §5):
//
//   - newer updated_at wins;
//   - on a tie, a tombstone (deleted_at set) beats a live row — deletes are
//     sticky;
//   - on a tie with equal tombstone-ness, the higher UUIDv7 id wins (ids are
//     time-sortable and globally unique, so this is a stable, content-
//     independent tiebreak both sides compute identically);
//   - if there is no existing row, the incoming op always wins.
package domain

import "fmt"

// AllowedTables is the allowlist of entity table names a sync op may target.
// Anything else is rejected — the wire never names a raw SQL identifier we
// haven't vetted, which also keeps the table name safe to interpolate into the
// per-table SQL the store builds. Mirrors the 11 syncable tables in
// apps/mobile/src/db/schema.ts (the local-only sync_ops outbox is NOT synced).
var AllowedTables = map[string]struct{}{
	"users":               {},
	"players":             {},
	"balls":               {},
	"oil_patterns":        {},
	"locations":           {},
	"leagues":             {},
	"sessions":            {},
	"session_players":     {},
	"games":               {},
	"frames":              {},
	"lane_condition_logs": {},
}

// IsAllowedTable reports whether table is a known syncable entity table.
func IsAllowedTable(table string) bool {
	_, ok := AllowedTables[table]
	return ok
}

// OpKind is the mutation kind carried by a sync op.
type OpKind string

const (
	// OpUpsert creates or updates the entity row from the op payload.
	OpUpsert OpKind = "upsert"
	// OpDelete tombstones the entity row (sets deleted_at).
	OpDelete OpKind = "delete"
)

// Op is one wire sync operation, mirroring the device SyncOpInput
// (apps/mobile/src/sync/outbox.ts). Payload is the full row snapshot for an
// upsert, or a minimal { id } marker for a delete.
type Op struct {
	EntityTable     string         `json:"entityTable"`
	EntityID        string         `json:"entityId"`
	Op              OpKind         `json:"op"`
	Payload         map[string]any `json:"payload"`
	EntityUpdatedAt int64          `json:"entityUpdatedAt"`
}

// PushRequest is the body of POST /sync/push: a batch of ops.
type PushRequest struct {
	Ops []Op `json:"ops"`
}

// PushResponse reports how the batch was applied.
type PushResponse struct {
	Applied int `json:"applied"`
	Skipped int `json:"skipped"`
}

// PulledRow is one row returned by GET /sync/pull, tagged with its table.
type PulledRow struct {
	EntityTable string         `json:"entityTable"`
	Row         map[string]any `json:"row"`
}

// PullResponse is the body of GET /sync/pull: changed rows plus the next cursor.
type PullResponse struct {
	Rows   []PulledRow `json:"rows"`
	Cursor int64       `json:"cursor"`
}

// Validate checks an op's shape before it reaches the store: known table, kind,
// non-empty id, and (for upsert) a payload whose id agrees with entityId.
func (o Op) Validate() error {
	if !IsAllowedTable(o.EntityTable) {
		return fmt.Errorf("unknown entity table %q: %w", o.EntityTable, ErrUnknownTable)
	}
	if o.Op != OpUpsert && o.Op != OpDelete {
		return fmt.Errorf("invalid op kind %q: %w", o.Op, ErrInvalidOp)
	}
	if o.EntityID == "" {
		return fmt.Errorf("empty entityId: %w", ErrInvalidOp)
	}
	if o.Op == OpUpsert {
		if o.Payload == nil {
			return fmt.Errorf("upsert with nil payload: %w", ErrInvalidOp)
		}
		if id, ok := o.Payload["id"].(string); ok && id != o.EntityID {
			return fmt.Errorf("payload id %q != entityId %q: %w", id, o.EntityID, ErrInvalidOp)
		}
	}
	return nil
}

// Existing is the minimal view of a stored row the LWW decision needs.
type Existing struct {
	UpdatedAt int64
	DeletedAt *int64
}

// Incoming is the minimal view of an inbound op the LWW decision needs.
type Incoming struct {
	ID        string
	UpdatedAt int64
	// IsTombstone is true for a delete op (the incoming change tombstones).
	IsTombstone bool
}

// IncomingWins reports whether the incoming op should overwrite the existing
// row under LWW. existing == nil (no row yet) always wins. The comparison is
// identical to the device reconcile in apps/mobile/src/sync/reconcile.ts.
//
// existingID is the stored row's id; for our per-id upsert it equals
// incoming.ID, but it is passed explicitly to make the tiebreak total and to
// keep this function pure/testable.
func IncomingWins(existing *Existing, existingID string, incoming Incoming) bool {
	if existing == nil {
		return true
	}
	if incoming.UpdatedAt > existing.UpdatedAt {
		return true
	}
	if existing.UpdatedAt > incoming.UpdatedAt {
		return false
	}
	// Equal updated_at — apply the documented tie rule.
	existingTomb := existing.DeletedAt != nil
	if incoming.IsTombstone != existingTomb {
		// A tombstone beats a live row.
		return incoming.IsTombstone
	}
	// Both or neither are tombstones: higher UUIDv7 id wins.
	return incoming.ID > existingID
}
