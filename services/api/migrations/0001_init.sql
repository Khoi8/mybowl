-- bowli backend schema — Postgres parity with the device SQLite schema
-- (apps/mobile/src/db/schema.ts). Forward-only (CLAUDE.md §9): never edit a
-- shipped migration; no real Down in MVP (goose still needs the markers).
--
-- Sync model (CLAUDE.md §5): every entity table carries the four sync columns
--   - id          TEXT  client-generated UUIDv7 primary key (stored as text so a
--                       v7 lexically sorts by creation time, matching the device
--                       and the LWW id tiebreak).
--   - updated_at  BIGINT ms epoch, drives last-write-wins.
--   - deleted_at  BIGINT ms epoch tombstone, NULL = live. Soft delete only.
--   - sync_status TEXT  lifecycle marker carried on the wire row; server stores
--                       it verbatim for round-trip fidelity (defaults 'synced').
--
-- Identity crux (CLAUDE.md §6): games.player_id -> players (the bowler), while
-- games.owner_user_id -> users (the recording account); the two are distinct.

-- +goose Up
-- +goose StatementBegin

CREATE TABLE users (
    id          TEXT PRIMARY KEY,
    updated_at  BIGINT NOT NULL,
    deleted_at  BIGINT,
    sync_status TEXT NOT NULL DEFAULT 'synced'
);

CREATE TABLE players (
    id          TEXT PRIMARY KEY,
    updated_at  BIGINT NOT NULL,
    deleted_at  BIGINT,
    sync_status TEXT NOT NULL DEFAULT 'synced',
    -- NULL = guest (just a name); set = linked account or the self player.
    user_id     TEXT REFERENCES users (id),
    name        TEXT NOT NULL,
    is_self     BOOLEAN NOT NULL DEFAULT FALSE,
    avatar      TEXT
);

-- "Exactly one self player per account" backstop, mirroring the device partial
-- unique index: scoped to self rows attributed to an account and not tombstoned.
CREATE UNIQUE INDEX players_one_self_per_user
    ON players (user_id)
    WHERE is_self = TRUE AND user_id IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE balls (
    id            TEXT PRIMARY KEY,
    updated_at    BIGINT NOT NULL,
    deleted_at    BIGINT,
    sync_status   TEXT NOT NULL DEFAULT 'synced',
    owner_user_id TEXT NOT NULL REFERENCES users (id),
    name          TEXT NOT NULL,
    brand         TEXT,
    coverstock    TEXT,
    layout        TEXT,
    surface       TEXT,
    weight        DOUBLE PRECISION,
    retired       BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE oil_patterns (
    id          TEXT PRIMARY KEY,
    updated_at  BIGINT NOT NULL,
    deleted_at  BIGINT,
    sync_status TEXT NOT NULL DEFAULT 'synced',
    name        TEXT NOT NULL,
    length_ft   BIGINT,
    volume      BIGINT,
    ratio       DOUBLE PRECISION,
    notes       TEXT
);

CREATE TABLE locations (
    id             TEXT PRIMARY KEY,
    updated_at     BIGINT NOT NULL,
    deleted_at     BIGINT,
    sync_status    TEXT NOT NULL DEFAULT 'synced',
    name           TEXT NOT NULL,
    address        TEXT,
    lat            DOUBLE PRECISION,
    lng            DOUBLE PRECISION,
    lane_count     BIGINT,
    pinsetter_type TEXT,
    notes          TEXT
);

CREATE TABLE leagues (
    id          TEXT PRIMARY KEY,
    updated_at  BIGINT NOT NULL,
    deleted_at  BIGINT,
    sync_status TEXT NOT NULL DEFAULT 'synced',
    name        TEXT NOT NULL,
    season      TEXT,
    house       TEXT
);

CREATE TABLE sessions (
    id             TEXT PRIMARY KEY,
    updated_at     BIGINT NOT NULL,
    deleted_at     BIGINT,
    sync_status    TEXT NOT NULL DEFAULT 'synced',
    owner_user_id  TEXT NOT NULL REFERENCES users (id),
    date           TEXT NOT NULL,
    location_id    TEXT REFERENCES locations (id),
    lane           TEXT,
    oil_pattern_id TEXT REFERENCES oil_patterns (id),
    is_group       BOOLEAN NOT NULL DEFAULT FALSE,
    notes          TEXT
);

CREATE TABLE session_players (
    id          TEXT PRIMARY KEY,
    updated_at  BIGINT NOT NULL,
    deleted_at  BIGINT,
    sync_status TEXT NOT NULL DEFAULT 'synced',
    session_id  TEXT NOT NULL REFERENCES sessions (id),
    player_id   TEXT NOT NULL REFERENCES players (id),
    turn_order  BIGINT
);

CREATE TABLE games (
    id             TEXT PRIMARY KEY,
    updated_at     BIGINT NOT NULL,
    deleted_at     BIGINT,
    sync_status    TEXT NOT NULL DEFAULT 'synced',
    -- The recording account — NOT necessarily the bowler.
    owner_user_id  TEXT NOT NULL REFERENCES users (id),
    -- NULL for a solo game logged outside a session.
    session_id     TEXT REFERENCES sessions (id),
    -- The bowler identity. Games point at a Player, NEVER directly at a User.
    player_id      TEXT NOT NULL REFERENCES players (id),
    league_id      TEXT REFERENCES leagues (id),
    date           TEXT NOT NULL,
    location_id    TEXT REFERENCES locations (id),
    lane           TEXT,
    oil_pattern_id TEXT REFERENCES oil_patterns (id),
    notes          TEXT
);

CREATE TABLE frames (
    id                 TEXT PRIMARY KEY,
    updated_at         BIGINT NOT NULL,
    deleted_at         BIGINT,
    sync_status        TEXT NOT NULL DEFAULT 'synced',
    game_id            TEXT NOT NULL REFERENCES games (id),
    frame_no           BIGINT NOT NULL,
    -- JSON arrays mirroring the device (throws[], ball_id_per_throw[], pin_state[]).
    throws             JSONB NOT NULL,
    ball_id_per_throw  JSONB NOT NULL,
    pin_state          JSONB NOT NULL
);

CREATE TABLE lane_condition_logs (
    id              TEXT PRIMARY KEY,
    updated_at      BIGINT NOT NULL,
    deleted_at      BIGINT,
    sync_status     TEXT NOT NULL DEFAULT 'synced',
    owner_user_id   TEXT NOT NULL REFERENCES users (id),
    location_id     TEXT NOT NULL REFERENCES locations (id),
    session_id      TEXT REFERENCES sessions (id),
    date            TEXT NOT NULL,
    oil_pattern_id  TEXT REFERENCES oil_patterns (id),
    freshness       TEXT,
    play_style      TEXT,
    carrydown       TEXT,
    hold_notes      TEXT,
    breakpoint_notes TEXT,
    rating_1_to_5   BIGINT
);

-- Pull queries filter by updated_at across every table; index it so the
-- changed-since scan stays cheap as data grows.
CREATE INDEX users_updated_at_idx               ON users (updated_at);
CREATE INDEX players_updated_at_idx             ON players (updated_at);
CREATE INDEX balls_updated_at_idx               ON balls (updated_at);
CREATE INDEX oil_patterns_updated_at_idx        ON oil_patterns (updated_at);
CREATE INDEX locations_updated_at_idx           ON locations (updated_at);
CREATE INDEX leagues_updated_at_idx             ON leagues (updated_at);
CREATE INDEX sessions_updated_at_idx            ON sessions (updated_at);
CREATE INDEX session_players_updated_at_idx     ON session_players (updated_at);
CREATE INDEX games_updated_at_idx               ON games (updated_at);
CREATE INDEX frames_updated_at_idx              ON frames (updated_at);
CREATE INDEX lane_condition_logs_updated_at_idx ON lane_condition_logs (updated_at);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
-- Forward-only migrations (CLAUDE.md §9): no down-migration in MVP.
-- The markers are required by goose; the body is intentionally a no-op.
SELECT 1;
-- +goose StatementEnd
