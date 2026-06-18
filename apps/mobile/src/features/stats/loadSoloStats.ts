/**
 * Pure DB→domain compute for the solo-stats feature.
 *
 * This module is deliberately RN-free (no `react-native` / `expo` / `react`
 * imports) so it runs under the root Vitest pure gate and is unit-testable in
 * plain Node against an in-memory SQLite db. The TanStack Query wiring lives in
 * the sibling `useSoloStats.ts`; ALL the logic lives here.
 *
 * Stats are DERIVED, never stored (CLAUDE.md §5): this function only READS — it
 * loads the player's games + per-frame leave masks via the S8 read-model
 * adapters and recomputes everything through the pure S2 domain on every call.
 * There is no stats table or column anywhere in the schema.
 *
 * Empty history (a player with no games) yields sane zero/null output — the
 * domain's `computeSeriesStats([])` returns null ratios / 0 counts (never NaN),
 * and `aggregatePinLeaves([])` returns a full 1-10 map of zeros. No throw.
 */

import { loadAllGamesForPlayer, loadAllLeavesForPlayer } from '../../db/readmodels';
import type { Db } from '../../db/types';
import {
  aggregatePinLeaves,
  computeSeriesStats,
  type SeriesStats,
} from '../../domain/stats';

/** The full solo-stats payload the screen renders. */
export interface SoloStats {
  /** Whole-career series stats (avg, highs, rate stats) across ALL games. */
  series: SeriesStats;
  /**
   * Pin-leave heatmap: for each pin 1-10, how many frames left it standing
   * after the first ball. Always a complete 1-10 map (zeros included).
   */
  heatmap: Record<number, number>;
}

/**
 * Load and recompute every solo stat for a player from frame data on read.
 *
 * Loads ALL the player's games (`loadAllGamesForPlayer`) and their aligned
 * per-frame leave masks (`loadAllLeavesForPlayer`, same chronological order),
 * then derives series stats and the pin-leave heatmap through the pure domain.
 */
export function loadSoloStats(db: Db, playerId: string): SoloStats {
  const games = loadAllGamesForPlayer(db, playerId);
  const leaves = loadAllLeavesForPlayer(db, playerId);

  const series = computeSeriesStats(games, leaves);
  const heatmap = aggregatePinLeaves(
    games.map((frames, i) => ({ frames, leaves: leaves[i] ?? [] })),
  );

  return { series, heatmap };
}
