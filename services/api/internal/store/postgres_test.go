package store_test

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/khoi8/mybowl/services/api/internal/domain"
	"github.com/khoi8/mybowl/services/api/internal/store"
	"github.com/khoi8/mybowl/services/api/internal/testsupport"
)

func errorsIs(err, target error) bool { return errors.Is(err, target) }

// migrationsDir resolves the goose migrations dir relative to this package.
func migrationsDir(t *testing.T) string {
	t.Helper()
	abs, err := filepath.Abs(filepath.Join("..", "..", "migrations"))
	if err != nil {
		t.Fatalf("resolve migrations dir: %v", err)
	}
	return abs
}

// newStore spins up (or reuses) a Postgres, runs migrations, and returns a
// connected Store. Honors TEST_DATABASE_URL if set (manual-container fallback),
// otherwise launches a throwaway testcontainer.
func newStore(t *testing.T) *store.Store {
	t.Helper()
	ctx := context.Background()

	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		var cleanup func()
		dsn, cleanup = testsupport.StartPostgres(ctx, t)
		t.Cleanup(cleanup)
	}

	if err := testsupport.Migrate(dsn, migrationsDir(t)); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	st, err := store.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect store: %v", err)
	}
	t.Cleanup(st.Close)
	return st
}

// seedBatch is a self-consistent insert batch: a user, its self player, a
// session, a game, and two frames (FKs satisfied in order within one tx).
func seedBatch(userID, playerID, sessionID, gameID, frame1ID, frame2ID string, ts int64) []domain.Op {
	return []domain.Op{
		{
			EntityTable:     "users",
			EntityID:        userID,
			Op:              domain.OpUpsert,
			EntityUpdatedAt: ts,
			Payload:         map[string]any{"id": userID, "updatedAt": ts, "deletedAt": nil, "syncStatus": "pending"},
		},
		{
			EntityTable:     "players",
			EntityID:        playerID,
			Op:              domain.OpUpsert,
			EntityUpdatedAt: ts,
			Payload: map[string]any{
				"id": playerID, "updatedAt": ts, "deletedAt": nil, "syncStatus": "pending",
				"userId": userID, "name": "Khoi", "isSelf": true,
			},
		},
		{
			EntityTable:     "sessions",
			EntityID:        sessionID,
			Op:              domain.OpUpsert,
			EntityUpdatedAt: ts,
			Payload: map[string]any{
				"id": sessionID, "updatedAt": ts, "deletedAt": nil, "syncStatus": "pending",
				"ownerUserId": userID, "date": "2026-06-18", "isGroup": false,
			},
		},
		{
			EntityTable:     "games",
			EntityID:        gameID,
			Op:              domain.OpUpsert,
			EntityUpdatedAt: ts,
			Payload: map[string]any{
				"id": gameID, "updatedAt": ts, "deletedAt": nil, "syncStatus": "pending",
				"ownerUserId": userID, "sessionId": sessionID, "playerId": playerID, "date": "2026-06-18",
			},
		},
		{
			EntityTable:     "frames",
			EntityID:        frame1ID,
			Op:              domain.OpUpsert,
			EntityUpdatedAt: ts,
			Payload: map[string]any{
				"id": frame1ID, "updatedAt": ts, "deletedAt": nil, "syncStatus": "pending",
				"gameId": gameID, "frameNo": 1,
				"throws": []any{10}, "ballIdPerThrow": []any{nil}, "pinState": []any{1023},
			},
		},
		{
			EntityTable:     "frames",
			EntityID:        frame2ID,
			Op:              domain.OpUpsert,
			EntityUpdatedAt: ts,
			Payload: map[string]any{
				"id": frame2ID, "updatedAt": ts, "deletedAt": nil, "syncStatus": "pending",
				"gameId": gameID, "frameNo": 2,
				"throws": []any{7, 3}, "ballIdPerThrow": []any{nil, nil}, "pinState": []any{1023, 568},
			},
		},
	}
}

func findRow(resp domain.PullResponse, table, id string) (map[string]any, bool) {
	for _, r := range resp.Rows {
		if r.EntityTable == table {
			if rid, _ := r.Row["id"].(string); rid == id {
				return r.Row, true
			}
		}
	}
	return nil, false
}

func TestPushThenPullRoundTrip(t *testing.T) {
	st := newStore(t)
	ctx := context.Background()
	ts := time.Now().UnixMilli()

	userID := "0190a0aa-0000-7000-8000-000000000001"
	playerID := "0190a0aa-0000-7000-8000-000000000002"
	sessionID := "0190a0aa-0000-7000-8000-000000000003"
	gameID := "0190a0aa-0000-7000-8000-000000000004"
	f1 := "0190a0aa-0000-7000-8000-000000000005"
	f2 := "0190a0aa-0000-7000-8000-000000000006"

	applied, skipped, err := st.ApplyOps(ctx, seedBatch(userID, playerID, sessionID, gameID, f1, f2, ts))
	if err != nil {
		t.Fatalf("ApplyOps: %v", err)
	}
	if applied != 6 || skipped != 0 {
		t.Fatalf("applied=%d skipped=%d, want 6/0", applied, skipped)
	}

	resp, err := st.Changed(ctx, ts-1)
	if err != nil {
		t.Fatalf("Changed: %v", err)
	}
	if len(resp.Rows) != 6 {
		t.Fatalf("pulled %d rows, want 6", len(resp.Rows))
	}
	if resp.Cursor != ts {
		t.Fatalf("cursor=%d, want %d", resp.Cursor, ts)
	}

	// Identity model survived the round trip: game points at player + owner.
	game, ok := findRow(resp, "games", gameID)
	if !ok {
		t.Fatal("game not in pull")
	}
	if game["playerId"] != playerID || game["ownerUserId"] != userID {
		t.Fatalf("game identity wrong: %+v", game)
	}

	// JSONB frame arrays decode back to arrays, not blobs.
	frame, ok := findRow(resp, "frames", f2)
	if !ok {
		t.Fatal("frame not in pull")
	}
	throws, ok := frame["throws"].([]any)
	if !ok || len(throws) != 2 {
		t.Fatalf("frame throws not a 2-elem array: %#v", frame["throws"])
	}
}

func TestLWWOlderDoesNotOverwrite(t *testing.T) {
	st := newStore(t)
	ctx := context.Background()
	ts := time.Now().UnixMilli()

	userID := "0190a0bb-0000-7000-8000-000000000001"
	playerID := "0190a0bb-0000-7000-8000-000000000002"

	mustApply(t, st, []domain.Op{userOp(userID, ts)})
	mustApply(t, st, []domain.Op{playerOp(playerID, userID, "Original", ts)})

	// Newer update wins.
	mustApply(t, st, []domain.Op{playerOp(playerID, userID, "Renamed", ts+10)})
	if got := playerName(t, st, ctx, playerID); got != "Renamed" {
		t.Fatalf("after newer update name=%q, want Renamed", got)
	}

	// Older update is rejected (name stays "Renamed").
	applied, skipped := mustApply(t, st, []domain.Op{playerOp(playerID, userID, "Stale", ts+5)})
	if applied != 0 || skipped != 1 {
		t.Fatalf("older op applied=%d skipped=%d, want 0/1", applied, skipped)
	}
	if got := playerName(t, st, ctx, playerID); got != "Renamed" {
		t.Fatalf("older update overwrote: name=%q, want Renamed", got)
	}
}

func TestDeleteTombstonesAndPullReturnsIt(t *testing.T) {
	st := newStore(t)
	ctx := context.Background()
	ts := time.Now().UnixMilli()

	userID := "0190a0cc-0000-7000-8000-000000000001"
	playerID := "0190a0cc-0000-7000-8000-000000000002"

	mustApply(t, st, []domain.Op{userOp(userID, ts)})
	mustApply(t, st, []domain.Op{playerOp(playerID, userID, "ToDelete", ts)})

	// Delete with a newer timestamp tombstones.
	applied, _ := mustApply(t, st, []domain.Op{{
		EntityTable: "players", EntityID: playerID, Op: domain.OpDelete, EntityUpdatedAt: ts + 100,
	}})
	if applied != 1 {
		t.Fatalf("delete applied=%d, want 1", applied)
	}

	resp, err := st.Changed(ctx, ts+99)
	if err != nil {
		t.Fatalf("Changed: %v", err)
	}
	row, ok := findRow(resp, "players", playerID)
	if !ok {
		t.Fatal("tombstone not returned by pull")
	}
	if row["deletedAt"] == nil {
		t.Fatalf("deletedAt nil, expected tombstone: %+v", row)
	}
}

func TestLWWTieBreakMatchesDeviceRule(t *testing.T) {
	st := newStore(t)
	ctx := context.Background()
	ts := time.Now().UnixMilli()

	userID := "0190a0dd-0000-7000-8000-000000000001"
	playerID := "0190a0dd-0000-7000-8000-000000000002"

	mustApply(t, st, []domain.Op{userOp(userID, ts)})
	mustApply(t, st, []domain.Op{playerOp(playerID, userID, "Live", ts)})

	// Tie on updated_at: a delete (tombstone) beats the live row.
	applied, skipped := mustApply(t, st, []domain.Op{{
		EntityTable: "players", EntityID: playerID, Op: domain.OpDelete, EntityUpdatedAt: ts,
	}})
	if applied != 1 || skipped != 0 {
		t.Fatalf("tie tombstone applied=%d skipped=%d, want 1/0", applied, skipped)
	}
	resp, _ := st.Changed(ctx, ts-1)
	row, _ := findRow(resp, "players", playerID)
	if row["deletedAt"] == nil {
		t.Fatal("tie: tombstone should have won over live row")
	}

	// Tie on updated_at with a live upsert vs the now-tombstoned row: live loses.
	applied, skipped = mustApply(t, st, []domain.Op{playerOp(playerID, userID, "Reborn", ts)})
	if applied != 0 || skipped != 1 {
		t.Fatalf("tie live-vs-tombstone applied=%d skipped=%d, want 0/1", applied, skipped)
	}
}

func TestUnknownTableRejected(t *testing.T) {
	st := newStore(t)
	ctx := context.Background()
	_, _, err := st.ApplyOps(ctx, []domain.Op{{
		EntityTable: "robots", EntityID: "x", Op: domain.OpUpsert, Payload: map[string]any{"id": "x"},
	}})
	if err == nil {
		t.Fatal("expected error for unknown table")
	}
	if !errorsIs(err, domain.ErrUnknownTable) {
		t.Fatalf("error %v is not ErrUnknownTable", err)
	}
}

// ---- helpers ----

func userOp(id string, ts int64) domain.Op {
	return domain.Op{
		EntityTable: "users", EntityID: id, Op: domain.OpUpsert, EntityUpdatedAt: ts,
		Payload: map[string]any{"id": id, "updatedAt": ts, "deletedAt": nil, "syncStatus": "pending"},
	}
}

func playerOp(id, userID, name string, ts int64) domain.Op {
	return domain.Op{
		EntityTable: "players", EntityID: id, Op: domain.OpUpsert, EntityUpdatedAt: ts,
		Payload: map[string]any{
			"id": id, "updatedAt": ts, "deletedAt": nil, "syncStatus": "pending",
			"userId": userID, "name": name, "isSelf": false,
		},
	}
}

func mustApply(t *testing.T, st *store.Store, ops []domain.Op) (int, int) {
	t.Helper()
	applied, skipped, err := st.ApplyOps(context.Background(), ops)
	if err != nil {
		t.Fatalf("ApplyOps: %v", err)
	}
	return applied, skipped
}

func playerName(t *testing.T, st *store.Store, ctx context.Context, id string) string {
	t.Helper()
	resp, err := st.Changed(ctx, 0)
	if err != nil {
		t.Fatalf("Changed: %v", err)
	}
	row, ok := findRow(resp, "players", id)
	if !ok {
		t.Fatalf("player %s not found", id)
	}
	name, _ := row["name"].(string)
	return name
}
