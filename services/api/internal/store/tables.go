package store

// Per-table column metadata for the generic LWW upsert. The device sends row
// snapshots shaped by Drizzle's $inferSelect — i.e. camelCase JS property names
// (apps/mobile/src/db/schema.ts) — so each column records both the wire key the
// payload uses and the snake_case Postgres column it maps to (migrations/0001).
//
// jsonb marks columns stored as JSONB (the frame arrays); the store marshals
// those payload values to a JSON string and casts ($n::jsonb) on write.
type column struct {
	// wireKey is the camelCase key in the op payload (Drizzle property name).
	wireKey string
	// col is the snake_case Postgres column name.
	col string
	// jsonb is true when the column type is JSONB.
	jsonb bool
}

// syncCols are the four columns every entity table shares. id is handled
// separately (it is the conflict target and comes from entityId); these are the
// remaining sync columns that flow through every upsert.
var syncCols = []column{
	{wireKey: "updatedAt", col: "updated_at"},
	{wireKey: "deletedAt", col: "deleted_at"},
	{wireKey: "syncStatus", col: "sync_status"},
}

// tableColumns maps each allowed entity table to its non-id columns (sync
// columns + entity columns). Order is irrelevant; the upsert builds SQL from it.
var tableColumns = map[string][]column{
	"users": withSync(),
	"players": withSync(
		column{wireKey: "userId", col: "user_id"},
		column{wireKey: "name", col: "name"},
		column{wireKey: "isSelf", col: "is_self"},
		column{wireKey: "avatar", col: "avatar"},
	),
	"balls": withSync(
		column{wireKey: "ownerUserId", col: "owner_user_id"},
		column{wireKey: "name", col: "name"},
		column{wireKey: "brand", col: "brand"},
		column{wireKey: "coverstock", col: "coverstock"},
		column{wireKey: "layout", col: "layout"},
		column{wireKey: "surface", col: "surface"},
		column{wireKey: "weight", col: "weight"},
		column{wireKey: "retired", col: "retired"},
	),
	"oil_patterns": withSync(
		column{wireKey: "name", col: "name"},
		column{wireKey: "lengthFt", col: "length_ft"},
		column{wireKey: "volume", col: "volume"},
		column{wireKey: "ratio", col: "ratio"},
		column{wireKey: "notes", col: "notes"},
	),
	"locations": withSync(
		column{wireKey: "name", col: "name"},
		column{wireKey: "address", col: "address"},
		column{wireKey: "lat", col: "lat"},
		column{wireKey: "lng", col: "lng"},
		column{wireKey: "laneCount", col: "lane_count"},
		column{wireKey: "pinsetterType", col: "pinsetter_type"},
		column{wireKey: "notes", col: "notes"},
	),
	"leagues": withSync(
		column{wireKey: "name", col: "name"},
		column{wireKey: "season", col: "season"},
		column{wireKey: "house", col: "house"},
	),
	"sessions": withSync(
		column{wireKey: "ownerUserId", col: "owner_user_id"},
		column{wireKey: "date", col: "date"},
		column{wireKey: "locationId", col: "location_id"},
		column{wireKey: "lane", col: "lane"},
		column{wireKey: "oilPatternId", col: "oil_pattern_id"},
		column{wireKey: "isGroup", col: "is_group"},
		column{wireKey: "notes", col: "notes"},
	),
	"session_players": withSync(
		column{wireKey: "sessionId", col: "session_id"},
		column{wireKey: "playerId", col: "player_id"},
		column{wireKey: "turnOrder", col: "turn_order"},
	),
	"games": withSync(
		column{wireKey: "ownerUserId", col: "owner_user_id"},
		column{wireKey: "sessionId", col: "session_id"},
		column{wireKey: "playerId", col: "player_id"},
		column{wireKey: "leagueId", col: "league_id"},
		column{wireKey: "date", col: "date"},
		column{wireKey: "locationId", col: "location_id"},
		column{wireKey: "lane", col: "lane"},
		column{wireKey: "oilPatternId", col: "oil_pattern_id"},
		column{wireKey: "notes", col: "notes"},
	),
	"frames": withSync(
		column{wireKey: "gameId", col: "game_id"},
		column{wireKey: "frameNo", col: "frame_no"},
		column{wireKey: "throws", col: "throws", jsonb: true},
		column{wireKey: "ballIdPerThrow", col: "ball_id_per_throw", jsonb: true},
		column{wireKey: "pinState", col: "pin_state", jsonb: true},
	),
	"lane_condition_logs": withSync(
		column{wireKey: "ownerUserId", col: "owner_user_id"},
		column{wireKey: "locationId", col: "location_id"},
		column{wireKey: "sessionId", col: "session_id"},
		column{wireKey: "date", col: "date"},
		column{wireKey: "oilPatternId", col: "oil_pattern_id"},
		column{wireKey: "freshness", col: "freshness"},
		column{wireKey: "playStyle", col: "play_style"},
		column{wireKey: "carrydown", col: "carrydown"},
		column{wireKey: "holdNotes", col: "hold_notes"},
		column{wireKey: "breakpointNotes", col: "breakpoint_notes"},
		column{wireKey: "rating1to5", col: "rating_1_to_5"},
	),
}

// withSync prepends the shared sync columns to a table's entity columns.
func withSync(entity ...column) []column {
	out := make([]column, 0, len(syncCols)+len(entity))
	out = append(out, syncCols...)
	out = append(out, entity...)
	return out
}

// allColumns returns "id" plus every non-id column name for a table, used to
// build the SELECT in a pull. Returns nil for an unknown table.
func allColumns(table string) []string {
	cols, ok := tableColumns[table]
	if !ok {
		return nil
	}
	names := make([]string, 0, len(cols)+1)
	names = append(names, "id")
	for _, c := range cols {
		names = append(names, c.col)
	}
	return names
}

// wireKeyForColumn reverses col -> wireKey so pull can re-emit camelCase rows
// the device expects. id maps to "id" (shared by both sides).
func wireKeyForColumn(table, col string) string {
	if col == "id" {
		return "id"
	}
	for _, c := range tableColumns[table] {
		if c.col == col {
			return c.wireKey
		}
	}
	return col
}
