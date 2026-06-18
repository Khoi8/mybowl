package domain

import "errors"

// Sentinel errors so callers (handlers) can map to HTTP status codes via
// errors.Is, while the message chain stays wrapped with %w (CLAUDE.md §9).
var (
	// ErrUnknownTable means a sync op named a table outside the allowlist.
	ErrUnknownTable = errors.New("unknown entity table")
	// ErrInvalidOp means a sync op is structurally malformed.
	ErrInvalidOp = errors.New("invalid sync op")
)
