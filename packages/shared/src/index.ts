/**
 * @bowli/shared — hand-authored source of truth for the cross-cutting domain
 * vocabulary during the MVP. When the Go backend lands, wire types will be
 * generated FROM Go into a separate `generated/` folder; these hand-authored
 * domain types and the generated wire types may diverge — the sync layer maps
 * between them.
 *
 * IDs are client-generated UUIDv7 strings (time-sortable) so records exist
 * offline and merge cleanly.
 */

/**
 * Sync WIRE types — GENERATED from the Go structs in
 * services/api/internal/domain/sync.go (see packages/shared/generated/wire.ts).
 * Go is the source of truth for the wire; the hand-authored domain types below
 * are a separate vocabulary, and apps/mobile/src/sync/wireMap.ts maps between
 * them. Re-exported here so consumers `import { Op } from '@bowli/shared'`.
 */
export * from '../generated/wire';

export type UUID = string;

/** Millisecond epoch timestamp. */
export type Millis = number;

/** ISO-8601 calendar date or datetime string. */
export type ISODate = string;

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

/** An authenticated account. `owner_user_id` on records refers to a User.id. */
export interface User {
  id: UUID;
}

/**
 * A bowler identity. Every Game points at a Player (never directly at a User).
 * - self player: `isSelf = true`, `userId` = the account's id.
 * - linked friend: `userId` set to their account.
 * - guest: `userId = null` — just a name; persists and is reusable so
 *   head-to-head stats accumulate across outings.
 */
export interface Player {
  id: UUID;
  userId: UUID | null;
  name: string;
  isSelf: boolean;
  avatar?: string;
}

// ---------------------------------------------------------------------------
// Equipment & venue context
// ---------------------------------------------------------------------------

export interface Ball {
  id: UUID;
  ownerUserId: UUID;
  name: string;
  brand?: string;
  coverstock?: string;
  layout?: string;
  surface?: string;
  weight?: number;
  retired: boolean;
}

export interface OilPattern {
  id: UUID;
  name: string;
  lengthFt?: number;
  volume?: number;
  ratio?: number;
  notes?: string;
}

export type PinsetterType = 'free_fall' | 'string';

export interface Location {
  id: UUID;
  name: string;
  address?: string;
  lat?: number;
  lng?: number;
  laneCount?: number;
  pinsetterType?: PinsetterType;
  notes?: string;
}

export interface League {
  id: UUID;
  name: string;
  season?: string;
  house?: string;
}

// ---------------------------------------------------------------------------
// Sessions, games, frames
// ---------------------------------------------------------------------------

/**
 * A shared outing. Holds context (location/lane/conditions) once; participant
 * games inherit it. Solo play is the degenerate one-participant case — not a
 * separate code path.
 */
export interface Session {
  id: UUID;
  ownerUserId: UUID;
  date: ISODate;
  locationId?: UUID;
  /** Free-form, e.g. "lane 7" or "lanes 12-13". */
  lane?: string;
  oilPatternId?: UUID;
  isGroup: boolean;
  notes?: string;
}

/** Participant in a session (self, linked friend, or guest). */
export interface SessionPlayer {
  id: UUID;
  sessionId: UUID;
  playerId: UUID;
  turnOrder?: number;
}

/**
 * A single game attributed to a Player. `ownerUserId` is the account that
 * RECORDED the row — not necessarily the bowler.
 */
export interface Game {
  id: UUID;
  ownerUserId: UUID;
  sessionId: UUID | null;
  playerId: UUID;
  leagueId?: UUID;
  date: ISODate;
  locationId?: UUID;
  lane?: string;
  oilPatternId?: UUID;
  notes?: string;
}

/**
 * One frame of a game. `throws` are pin counts knocked down per throw.
 * `pinState` is, per throw, a 10-bit mask of pins STANDING before that throw
 * (bit i set => pin (i+1) standing) — drives pin-leave heatmaps and split
 * detection. `ballIdPerThrow` tags the ball used for each throw.
 */
export interface Frame {
  id: UUID;
  gameId: UUID;
  /** 1-10. */
  frameNo: number;
  throws: number[];
  ballIdPerThrow: (UUID | null)[];
  pinState: number[];
}

export type LaneFreshness = 'fresh' | 'broken_down' | 'burnt';

export interface LaneConditionLog {
  id: UUID;
  ownerUserId: UUID;
  locationId: UUID;
  sessionId?: UUID;
  date: ISODate;
  oilPatternId?: UUID;
  freshness?: LaneFreshness;
  playStyle?: string;
  carrydown?: string;
  holdNotes?: string;
  breakpointNotes?: string;
  rating1to5?: number;
}
