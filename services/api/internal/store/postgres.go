// Package store is the pgx-backed persistence layer for the sync API. It owns
// all SQL; the handlers and domain stay DB-free. The LWW *decision* lives in
// internal/domain (pure, unit-tested); here we enforce it transactionally in
// SQL via INSERT ... ON CONFLICT (id) DO UPDATE ... WHERE <incoming wins>.
package store

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/khoi8/mybowl/services/api/internal/domain"
)

// Store wraps a pgx pool.
type Store struct {
	pool *pgxpool.Pool
}

// New connects to Postgres at databaseURL and returns a Store. The caller owns
// the lifecycle and must call Close.
func New(ctx context.Context, databaseURL string) (*Store, error) {
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		return nil, fmt.Errorf("connect postgres: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping postgres: %w", err)
	}
	return &Store{pool: pool}, nil
}

// Close releases the pool.
func (s *Store) Close() { s.pool.Close() }

// Pool exposes the underlying pool (used by goose migration wiring in main).
func (s *Store) Pool() *pgxpool.Pool { return s.pool }

// ApplyOps applies a batch of ops under server-side LWW in a single
// transaction, returning how many were applied vs skipped (lost the LWW race).
// All-or-nothing: if any op errors, the whole batch rolls back so the device
// can safely retry the same batch (the drain is idempotent).
func (s *Store) ApplyOps(ctx context.Context, ops []domain.Op) (applied, skipped int, err error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return 0, 0, fmt.Errorf("begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }() // no-op after a successful Commit

	for i, op := range ops {
		if vErr := op.Validate(); vErr != nil {
			return 0, 0, fmt.Errorf("op %d: %w", i, vErr)
		}
		won, aErr := s.applyOp(ctx, tx, op)
		if aErr != nil {
			return 0, 0, fmt.Errorf("op %d (%s/%s): %w", i, op.EntityTable, op.EntityID, aErr)
		}
		if won {
			applied++
		} else {
			skipped++
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return 0, 0, fmt.Errorf("commit tx: %w", err)
	}
	return applied, skipped, nil
}

// applyOp upserts or tombstones a single row, returning whether the incoming op
// won the LWW race. The WHERE clause on the ON CONFLICT path encodes the exact
// device tie rule: newer updated_at wins; on a tie a tombstone beats a live row;
// on a tie with equal tombstone-ness the higher id wins.
func (s *Store) applyOp(ctx context.Context, tx pgx.Tx, op domain.Op) (bool, error) {
	if op.Op == domain.OpDelete {
		return s.applyDelete(ctx, tx, op)
	}
	return s.applyUpsert(ctx, tx, op)
}

// applyUpsert inserts-or-updates a row under LWW. The full payload is written,
// so NOT NULL entity columns are satisfied. The ON CONFLICT WHERE clause encodes
// the device tie rule.
func (s *Store) applyUpsert(ctx context.Context, tx pgx.Tx, op domain.Op) (bool, error) {
	cols := tableColumns[op.EntityTable] // existence guaranteed by Validate
	table := op.EntityTable
	payload := op.Payload

	// Build the column/value lists. id is always first (conflict target).
	insertCols := []string{"id"}
	placeholders := []string{"$1"}
	args := []any{op.EntityID}
	argN := 1

	for _, c := range cols {
		val, present := payload[c.wireKey]
		if !present {
			// Column absent from the payload: let it default / stay NULL on
			// insert. Skip it from the INSERT list entirely.
			continue
		}
		argN++
		insertCols = append(insertCols, c.col)
		v, ph := s.bindValue(c, val, argN)
		placeholders = append(placeholders, ph)
		args = append(args, v)
	}

	// ON CONFLICT update set: every inserted non-id column gets refreshed from
	// EXCLUDED (the proposed row). For a delete that's just the sync columns.
	setParts := make([]string, 0, len(insertCols)-1)
	for _, name := range insertCols[1:] {
		setParts = append(setParts, fmt.Sprintf("%s = EXCLUDED.%s", name, name))
	}

	// The LWW guard: only take EXCLUDED when it wins against the stored row.
	//   EXCLUDED.updated_at > table.updated_at                       -> newer wins
	//   OR (= updated_at AND incoming-tombstone AND stored-live)     -> tomb wins on tie
	//   OR (= updated_at AND tombstone-ness equal AND EXCLUDED.id>id)-> id tiebreak
	winGuard := fmt.Sprintf(
		`EXCLUDED.updated_at > %[1]s.updated_at
		 OR (EXCLUDED.updated_at = %[1]s.updated_at
		     AND (EXCLUDED.deleted_at IS NOT NULL) <> (%[1]s.deleted_at IS NOT NULL)
		     AND EXCLUDED.deleted_at IS NOT NULL)
		 OR (EXCLUDED.updated_at = %[1]s.updated_at
		     AND (EXCLUDED.deleted_at IS NOT NULL) = (%[1]s.deleted_at IS NOT NULL)
		     AND EXCLUDED.id > %[1]s.id)`,
		table,
	)

	query := fmt.Sprintf(
		`INSERT INTO %s (%s) VALUES (%s)
		 ON CONFLICT (id) DO UPDATE SET %s
		 WHERE %s`,
		table,
		strings.Join(insertCols, ", "),
		strings.Join(placeholders, ", "),
		strings.Join(setParts, ", "),
		winGuard,
	)

	tag, err := tx.Exec(ctx, query, args...)
	if err != nil {
		return false, fmt.Errorf("exec upsert: %w", err)
	}
	if tag.RowsAffected() > 0 {
		// Either an insert (new row) or a winning update.
		return true, nil
	}

	// No row affected: the conflict guard rejected the update (incoming lost),
	// OR the insert hit a different unique constraint via ON CONFLICT(id) not
	// matching. Disambiguate: if a row with this id exists, it's a true LWW
	// skip. Otherwise something else blocked the insert — surface it as a skip
	// is wrong, so re-check existence.
	var exists bool
	if err := tx.QueryRow(ctx,
		fmt.Sprintf(`SELECT EXISTS(SELECT 1 FROM %s WHERE id = $1)`, table),
		op.EntityID,
	).Scan(&exists); err != nil {
		return false, fmt.Errorf("recheck existence: %w", err)
	}
	if exists {
		return false, nil // genuine LWW skip
	}
	return false, fmt.Errorf("insert affected no row and id absent (constraint?): %w", domain.ErrInvalidOp)
}

// applyDelete tombstones an existing row under LWW. A delete carries no full
// payload (only id + entityUpdatedAt), so we can't satisfy the NOT NULL entity
// columns of an INSERT; instead we UPDATE the existing row's sync columns,
// guarded by the same tie rule. A delete for a row that doesn't exist yet is a
// no-op skip (delete-before-insert is not a real device flow; the device always
// has the row locally before enqueuing its delete op). The guard:
//   - newer delete updated_at wins; OR
//   - tie AND the stored row is still live (a tombstone beats a live row); OR
//   - tie AND stored already a tombstone AND incoming id (== stored id) wins —
//     which for the same id is false, so an equal-time re-delete is idempotent.
func (s *Store) applyDelete(ctx context.Context, tx pgx.Tx, op domain.Op) (bool, error) {
	table := op.EntityTable
	query := fmt.Sprintf(
		`UPDATE %[1]s
		 SET deleted_at = $2, updated_at = $2, sync_status = 'synced'
		 WHERE id = $1
		   AND ($2 > %[1]s.updated_at
		        OR ($2 = %[1]s.updated_at AND %[1]s.deleted_at IS NULL))`,
		table,
	)
	tag, err := tx.Exec(ctx, query, op.EntityID, op.EntityUpdatedAt)
	if err != nil {
		return false, fmt.Errorf("exec delete: %w", err)
	}
	return tag.RowsAffected() > 0, nil
}

// bindValue prepares a payload value for binding. JSONB columns are marshaled to
// a JSON string and cast with ::jsonb; everything else binds as-is. JSON numbers
// decode to float64; integer-typed Postgres columns accept that fine via pgx.
func (s *Store) bindValue(c column, val any, argN int) (any, string) {
	ph := "$" + strconv.Itoa(argN)
	if c.jsonb && val != nil {
		b, err := json.Marshal(val)
		if err == nil {
			return string(b), ph + "::jsonb"
		}
	}
	return val, ph
}

// Changed returns all rows across the entity tables whose updated_at > since,
// including tombstones (so deletes propagate), plus the new cursor (the max
// updated_at returned, or `since` if nothing changed). Rows are emitted in
// camelCase to match the device wire shape.
func (s *Store) Changed(ctx context.Context, since int64) (domain.PullResponse, error) {
	resp := domain.PullResponse{Rows: []domain.PulledRow{}, Cursor: since}
	maxUpdated := since

	for table := range domain.AllowedTables {
		names := allColumns(table)
		query := fmt.Sprintf(
			`SELECT %s FROM %s WHERE updated_at > $1 ORDER BY updated_at ASC`,
			strings.Join(names, ", "), table,
		)
		rows, err := s.pool.Query(ctx, query, since)
		if err != nil {
			return domain.PullResponse{}, fmt.Errorf("query %s: %w", table, err)
		}

		vals, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (map[string]any, error) {
			raw, scanErr := r.Values()
			if scanErr != nil {
				return nil, fmt.Errorf("scan %s row: %w", table, scanErr)
			}
			out := make(map[string]any, len(names))
			for i, name := range names {
				out[wireKeyForColumn(table, name)] = normalize(raw[i])
			}
			return out, nil
		})
		if err != nil {
			return domain.PullResponse{}, fmt.Errorf("collect %s: %w", table, err)
		}

		for _, row := range vals {
			if ua, ok := row["updatedAt"].(int64); ok && ua > maxUpdated {
				maxUpdated = ua
			}
			resp.Rows = append(resp.Rows, domain.PulledRow{EntityTable: table, Row: row})
		}
	}

	resp.Cursor = maxUpdated
	return resp, nil
}

// normalize converts pgx-scanned values into JSON-friendly Go values. JSONB
// columns scan as []byte (raw JSON); decode them so they re-marshal as real
// arrays/objects rather than a base64 blob.
func normalize(v any) any {
	if b, ok := v.([]byte); ok {
		var decoded any
		if err := json.Unmarshal(b, &decoded); err == nil {
			return decoded
		}
		return string(b)
	}
	return v
}
