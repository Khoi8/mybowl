package domain

import "testing"

func ptr(v int64) *int64 { return &v }

// TestIncomingWins mirrors the device reconcile cases
// (apps/mobile/src/sync/reconcile.ts) — the server must decide identically.
func TestIncomingWins(t *testing.T) {
	cases := []struct {
		name     string
		existing *Existing
		exID     string
		incoming Incoming
		wantWins bool
	}{
		{
			name:     "no existing row: incoming always wins",
			existing: nil,
			exID:     "",
			incoming: Incoming{ID: "a", UpdatedAt: 100},
			wantWins: true,
		},
		{
			name:     "newer incoming wins",
			existing: &Existing{UpdatedAt: 100},
			exID:     "id-1",
			incoming: Incoming{ID: "id-1", UpdatedAt: 200},
			wantWins: true,
		},
		{
			name:     "older incoming loses",
			existing: &Existing{UpdatedAt: 200},
			exID:     "id-1",
			incoming: Incoming{ID: "id-1", UpdatedAt: 100},
			wantWins: false,
		},
		{
			name:     "tie, incoming tombstone beats live existing",
			existing: &Existing{UpdatedAt: 100, DeletedAt: nil},
			exID:     "id-1",
			incoming: Incoming{ID: "id-1", UpdatedAt: 100, IsTombstone: true},
			wantWins: true,
		},
		{
			name:     "tie, incoming live loses to existing tombstone",
			existing: &Existing{UpdatedAt: 100, DeletedAt: ptr(100)},
			exID:     "id-1",
			incoming: Incoming{ID: "id-1", UpdatedAt: 100, IsTombstone: false},
			wantWins: false,
		},
		{
			name:     "tie, both live, higher id wins",
			existing: &Existing{UpdatedAt: 100},
			exID:     "id-aaa",
			incoming: Incoming{ID: "id-bbb", UpdatedAt: 100},
			wantWins: true,
		},
		{
			name:     "tie, both live, lower id loses",
			existing: &Existing{UpdatedAt: 100},
			exID:     "id-bbb",
			incoming: Incoming{ID: "id-aaa", UpdatedAt: 100},
			wantWins: false,
		},
		{
			name:     "tie, both tombstones, higher id wins",
			existing: &Existing{UpdatedAt: 100, DeletedAt: ptr(100)},
			exID:     "id-aaa",
			incoming: Incoming{ID: "id-bbb", UpdatedAt: 100, IsTombstone: true},
			wantWins: true,
		},
		{
			name:     "tie, both live, equal id (idempotent re-push) loses",
			existing: &Existing{UpdatedAt: 100},
			exID:     "id-1",
			incoming: Incoming{ID: "id-1", UpdatedAt: 100},
			wantWins: false,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := IncomingWins(tc.existing, tc.exID, tc.incoming); got != tc.wantWins {
				t.Fatalf("IncomingWins = %v, want %v", got, tc.wantWins)
			}
		})
	}
}

func TestOpValidate(t *testing.T) {
	cases := []struct {
		name    string
		op      Op
		wantErr error
	}{
		{
			name:    "unknown table rejected",
			op:      Op{EntityTable: "nope", EntityID: "x", Op: OpUpsert, Payload: map[string]any{"id": "x"}},
			wantErr: ErrUnknownTable,
		},
		{
			name:    "invalid op kind",
			op:      Op{EntityTable: "users", EntityID: "x", Op: "weird"},
			wantErr: ErrInvalidOp,
		},
		{
			name:    "empty entity id",
			op:      Op{EntityTable: "users", EntityID: "", Op: OpUpsert, Payload: map[string]any{}},
			wantErr: ErrInvalidOp,
		},
		{
			name:    "upsert nil payload",
			op:      Op{EntityTable: "users", EntityID: "x", Op: OpUpsert, Payload: nil},
			wantErr: ErrInvalidOp,
		},
		{
			name:    "payload id mismatch",
			op:      Op{EntityTable: "users", EntityID: "x", Op: OpUpsert, Payload: map[string]any{"id": "y"}},
			wantErr: ErrInvalidOp,
		},
		{
			name:    "valid upsert",
			op:      Op{EntityTable: "users", EntityID: "x", Op: OpUpsert, Payload: map[string]any{"id": "x"}},
			wantErr: nil,
		},
		{
			name:    "valid delete (payload optional)",
			op:      Op{EntityTable: "users", EntityID: "x", Op: OpDelete},
			wantErr: nil,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := tc.op.Validate()
			if tc.wantErr == nil {
				if err != nil {
					t.Fatalf("unexpected error: %v", err)
				}
				return
			}
			if err == nil {
				t.Fatalf("expected error %v, got nil", tc.wantErr)
			}
			if !is(err, tc.wantErr) {
				t.Fatalf("error %v is not %v", err, tc.wantErr)
			}
		})
	}
}

// is is a tiny errors.Is wrapper kept local to avoid an import just for tests.
func is(err, target error) bool {
	for err != nil {
		if err == target {
			return true
		}
		type wrapped interface{ Unwrap() error }
		w, ok := err.(wrapped)
		if !ok {
			return false
		}
		err = w.Unwrap()
	}
	return false
}
