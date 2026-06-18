/**
 * Pure DB→domain compute for the relational ("head-to-head") stats feature.
 *
 * RN-free (no `react-native` / `expo` / `react` imports) so it runs under the
 * root Vitest pure gate and is unit-testable in plain Node against an in-memory
 * SQLite db. The TanStack Query wiring lives in the sibling `useHeadToHead.ts`;
 * ALL the logic lives here.
 *
 * Relational stats are DERIVED, never stored (CLAUDE.md §5, §8): this function
 * only READS — it loads the shared-session views via the S8 read-model adapters
 * (`loadH2HSessions` / `loadWithWithout`) and recomputes everything through the
 * pure S3 domain (`headToHead` / `withWithout` / `timesBowledWith`) on every
 * call. There is no relational-stats table or column anywhere in the schema.
 *
 * The math keys ONLY on player ids — a guest `Player` (no account) and a linked
 * `Player` are treated identically.
 *
 * Zero shared sessions yields sane output: an all-zero/null `record`, all-null
 * `withWithout`, and `timesBowledWith` 0 — the domain's ratio convention is
 * `null` (never NaN) on a zero denominator, and nothing throws.
 */

import { loadH2HSessions, loadWithWithout } from '../../../db/readmodels';
import type { Db } from '../../../db/types';
import {
  headToHead,
  timesBowledWith,
  withWithout,
  type HeadToHeadRecord,
  type WithWithoutSplit,
} from '../../../domain/headtohead';

/** The full relational-stats payload the screen renders. */
export interface RelationalStats {
  /** Competitive ("against") tally + margins across paired shared-session games. */
  record: HeadToHeadRecord;
  /** Contextual ("with / without the opponent") averages for the self player. */
  withWithout: WithWithoutSplit;
  /**
   * How many shared sessions had a real head-to-head (both bowled ≥1 game).
   * The headline "you've bowled with X N times" — sourced here, NOT from
   * `withWithout.sessionsWith`, per the S8 review note.
   */
  timesBowledWith: number;
}

/**
 * Load and recompute every relational stat between the self player and one
 * opponent from session/game/frame data on read.
 *
 * Loads the shared-session H2H views and the self player's with/without session
 * views (`loadH2HSessions` / `loadWithWithout`), then derives the competitive
 * record, the contextual split, and the shared-session count through the pure
 * domain. With no shared history every read-model returns `[]` and the domain
 * returns its sane zero/null shape.
 */
export function loadRelationalStats(
  db: Db,
  selfPlayerId: string,
  opponentPlayerId: string,
): RelationalStats {
  const h2hSessions = loadH2HSessions(db, selfPlayerId, opponentPlayerId);
  const selfSessions = loadWithWithout(db, selfPlayerId, opponentPlayerId);

  return {
    record: headToHead(h2hSessions),
    withWithout: withWithout(selfSessions),
    timesBowledWith: timesBowledWith(h2hSessions),
  };
}
