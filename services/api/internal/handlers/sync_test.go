package handlers_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/khoi8/mybowl/services/api/internal/domain"
	"github.com/khoi8/mybowl/services/api/internal/handlers"
)

// fakeSyncer is an in-memory Syncer so the handler layer is testable without a
// DB — the real LWW/SQL path is covered by store/postgres_test.go. These tests
// assert the thin HTTP contract: decode, status codes, error mapping, auth.
type fakeSyncer struct {
	applyErr error
	applied  int
	skipped  int
	pull     domain.PullResponse
	pullErr  error
	gotOps   []domain.Op
}

func (f *fakeSyncer) ApplyOps(_ context.Context, ops []domain.Op) (int, int, error) {
	f.gotOps = ops
	return f.applied, f.skipped, f.applyErr
}

func (f *fakeSyncer) Changed(_ context.Context, _ int64) (domain.PullResponse, error) {
	return f.pull, f.pullErr
}

// router mounts the same /sync routes + auth middleware main.go uses.
func router(s handlers.Syncer) http.Handler {
	mux := http.NewServeMux()
	h := handlers.NewSyncHandler(s)
	mux.Handle("POST /sync/push", handlers.AuthMiddleware(http.HandlerFunc(h.Push)))
	mux.Handle("GET /sync/pull", handlers.AuthMiddleware(http.HandlerFunc(h.Pull)))
	return mux
}

func TestPushRequiresAuth(t *testing.T) {
	srv := httptest.NewServer(router(&fakeSyncer{}))
	defer srv.Close()

	resp, err := http.Post(srv.URL+"/sync/push", "application/json", bytes.NewBufferString(`{"ops":[]}`))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("status=%d, want 401", resp.StatusCode)
	}
}

func TestPushHappyPath(t *testing.T) {
	fake := &fakeSyncer{applied: 2, skipped: 1}
	srv := httptest.NewServer(router(fake))
	defer srv.Close()

	body := `{"ops":[{"entityTable":"users","entityId":"u1","op":"upsert","payload":{"id":"u1"},"entityUpdatedAt":123}]}`
	req, _ := http.NewRequest(http.MethodPost, srv.URL+"/sync/push", bytes.NewBufferString(body))
	req.Header.Set("X-User-Id", "u1")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status=%d, want 200", resp.StatusCode)
	}
	var out domain.PushResponse
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		t.Fatal(err)
	}
	if out.Applied != 2 || out.Skipped != 1 {
		t.Fatalf("got %+v, want applied=2 skipped=1", out)
	}
	if len(fake.gotOps) != 1 || fake.gotOps[0].EntityTable != "users" {
		t.Fatalf("ops not decoded into store: %+v", fake.gotOps)
	}
}

func TestPushUnknownTableIs400(t *testing.T) {
	fake := &fakeSyncer{applyErr: domain.ErrUnknownTable}
	srv := httptest.NewServer(router(fake))
	defer srv.Close()

	req, _ := http.NewRequest(http.MethodPost, srv.URL+"/sync/push", bytes.NewBufferString(`{"ops":[]}`))
	req.Header.Set("X-User-Id", "u1")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status=%d, want 400", resp.StatusCode)
	}
}

func TestPullReturnsRowsAndCursor(t *testing.T) {
	now := time.Now().UnixMilli()
	fake := &fakeSyncer{pull: domain.PullResponse{
		Rows:   []domain.PulledRow{{EntityTable: "players", Row: map[string]any{"id": "p1"}}},
		Cursor: now,
	}}
	srv := httptest.NewServer(router(fake))
	defer srv.Close()

	req, _ := http.NewRequest(http.MethodGet, srv.URL+"/sync/pull?since=10", nil)
	req.Header.Set("Authorization", "Bearer u1")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status=%d, want 200", resp.StatusCode)
	}
	var out domain.PullResponse
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		t.Fatal(err)
	}
	if len(out.Rows) != 1 || out.Cursor != now {
		t.Fatalf("got %+v", out)
	}
}

func TestPullBadSinceIs400(t *testing.T) {
	srv := httptest.NewServer(router(&fakeSyncer{}))
	defer srv.Close()

	req, _ := http.NewRequest(http.MethodGet, srv.URL+"/sync/pull?since=notanumber", nil)
	req.Header.Set("X-User-Id", "u1")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status=%d, want 400", resp.StatusCode)
	}
}
