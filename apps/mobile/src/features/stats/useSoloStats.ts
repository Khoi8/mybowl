/**
 * React binding for solo stats: a thin TanStack Query wrapper.
 *
 * This is the ONLY stats module allowed to import `react` / `@tanstack/react-
 * query`. All the DB→domain compute lives in the RN-free `loadSoloStats.ts`
 * (root-testable); this hook merely caches its result keyed on the player.
 *
 * Reads are cheap, local-only recomputations from the SQLite source of truth
 * (CLAUDE.md §5) — no network — so the query runs synchronously under the
 * offline-first defaults configured in `app/queryClient.ts`.
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { getDb } from '../../db/client';
import { loadSoloStats, type SoloStats } from './loadSoloStats';

/** Query key factory so screens / invalidations stay in sync. */
export function soloStatsKey(playerId: string): readonly [string, string] {
  return ['soloStats', playerId] as const;
}

/**
 * Subscribe to a player's recomputed solo stats. Keyed on `['soloStats',
 * playerId]`; the compute lives in `loadSoloStats(getDb(), playerId)`.
 */
export function useSoloStats(playerId: string): UseQueryResult<SoloStats> {
  return useQuery({
    queryKey: soloStatsKey(playerId),
    queryFn: () => loadSoloStats(getDb(), playerId),
  });
}
