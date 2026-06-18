package domain

// Last-write-wins (LWW) decision — server-internal, NOT part of the sync wire.
//
// These types and IncomingWins are split out of sync.go so the tygo codegen
// (tygo.yaml: include_files: [sync.go]) emits ONLY the wire transport types
// into packages/shared/generated/wire.ts. The LWW helpers below are a
// server-side implementation detail and must never leak onto the wire.
//
// The rule is byte-for-byte the same decision the device makes in
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
