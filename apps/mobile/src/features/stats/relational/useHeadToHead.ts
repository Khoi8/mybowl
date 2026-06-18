/**
 * React binding for relational stats: a thin TanStack Query wrapper.
 *
 * This is the ONLY relational-stats module allowed to import `react` /
 * `@tanstack/react-query`. All the DB→domain compute lives in the RN-free
 * `loadRelationalStats.ts` (root-testable); this hook merely caches its result
 * keyed on the (self, opponent) pair.
 *
 * Reads are cheap, local-only recomputations from the SQLite source of truth
 * (CLAUDE.md §5) — no network — so the query runs synchronously under the
 * offline-first defaults configured in `app/queryClient.ts`.
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { getDb } from '../../../db/client';
import { loadRelationalStats, type RelationalStats } from './loadRelationalStats';

/** Query key factory so screens / invalidations stay in sync. */
export function headToHeadKey(
  selfPlayerId: string,
  opponentPlayerId: string,
): readonly [string, string, string] {
  return ['relationalStats', selfPlayerId, opponentPlayerId] as const;
}

/**
 * Subscribe to recomputed relational stats between the self player and one
 * opponent. Keyed on `['relationalStats', selfPlayerId, opponentPlayerId]`; the
 * compute lives in `loadRelationalStats(getDb(), …)`.
 */
export function useHeadToHead(
  selfPlayerId: string,
  opponentPlayerId: string,
): UseQueryResult<RelationalStats> {
  return useQuery({
    queryKey: headToHeadKey(selfPlayerId, opponentPlayerId),
    queryFn: () => loadRelationalStats(getDb(), selfPlayerId, opponentPlayerId),
  });
}
