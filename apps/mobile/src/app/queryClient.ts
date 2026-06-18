/**
 * TanStack Query client factory.
 *
 * This module is deliberately RN-free (no `react-native` / `expo` imports) so it
 * runs under the root Vitest pure gate and is unit-testable in plain Node. It
 * exports a factory rather than a singleton so tests get a fresh client and the
 * provider owns instance lifetime.
 *
 * Defaults are tuned for offline-first on flaky bowling-alley wifi (CLAUDE.md
 * §2/§5):
 *
 * - `networkMode: 'offlineFirst'` — queries/mutations RUN even when the device
 *   reports offline (they hit the SQLite-backed source of truth first); they
 *   don't sit "paused" waiting for a connection. SQLite is the source of truth;
 *   the network is only the sync target.
 * - `retry: 2` with capped exponential backoff — a couple of retries smooth over
 *   transient drops without hammering a flaky connection or stalling the UI.
 * - `staleTime: 30s` / `gcTime: 24h` — local reads are cheap and rarely change
 *   out from under us (single-device MVP), so we avoid refetch churn and keep
 *   cache around across brief unmounts for snappy navigation.
 * - refetch-on-focus/reconnect OFF — avoids surprise network work mid-game; sync
 *   is driven explicitly by the outbox, not by query refetch.
 */
import { QueryClient } from '@tanstack/react-query';

/** Cap (ms) for retry backoff so a flaky connection never stalls the UI long. */
const MAX_RETRY_DELAY_MS = 30_000;

/** Queries are considered fresh for this long before a refetch is allowed. */
export const DEFAULT_STALE_TIME_MS = 30_000;

/** Inactive cache entries are garbage-collected after this long. */
export const DEFAULT_GC_TIME_MS = 24 * 60 * 60 * 1000;

/** Number of automatic retries for both queries and mutations. */
export const DEFAULT_RETRY_COUNT = 2;

/**
 * Build a fresh `QueryClient` with bowli's offline-first defaults.
 *
 * @returns a new client; callers (the provider, or a test) own its lifetime.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        networkMode: 'offlineFirst',
        retry: DEFAULT_RETRY_COUNT,
        retryDelay: (attemptIndex: number) =>
          Math.min(1000 * 2 ** attemptIndex, MAX_RETRY_DELAY_MS),
        staleTime: DEFAULT_STALE_TIME_MS,
        gcTime: DEFAULT_GC_TIME_MS,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
      },
      mutations: {
        networkMode: 'offlineFirst',
        retry: DEFAULT_RETRY_COUNT,
      },
    },
  });
}
