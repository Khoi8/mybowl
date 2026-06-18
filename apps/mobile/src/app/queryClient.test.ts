import { describe, expect, it } from 'vitest';

import {
  createQueryClient,
  DEFAULT_GC_TIME_MS,
  DEFAULT_RETRY_COUNT,
  DEFAULT_STALE_TIME_MS,
} from './queryClient';

describe('createQueryClient', () => {
  it('returns a fresh client instance each call (no shared singleton)', () => {
    const a = createQueryClient();
    const b = createQueryClient();
    expect(a).not.toBe(b);
  });

  it('configures queries for offline-first flaky-wifi use', () => {
    const opts = createQueryClient().getDefaultOptions().queries;
    expect(opts?.networkMode).toBe('offlineFirst');
    expect(opts?.retry).toBe(DEFAULT_RETRY_COUNT);
    expect(opts?.staleTime).toBe(DEFAULT_STALE_TIME_MS);
    expect(opts?.gcTime).toBe(DEFAULT_GC_TIME_MS);
    // Avoid surprise network work mid-game; sync is outbox-driven.
    expect(opts?.refetchOnWindowFocus).toBe(false);
    expect(opts?.refetchOnReconnect).toBe(false);
  });

  it('applies capped exponential backoff for retries', () => {
    const retryDelay = createQueryClient().getDefaultOptions().queries?.retryDelay;
    expect(typeof retryDelay).toBe('function');
    if (typeof retryDelay !== 'function') return;
    // First retry ~1s, doubling, then capped at 30s.
    const fakeError = new Error('boom');
    expect(retryDelay(0, fakeError)).toBe(1000);
    expect(retryDelay(1, fakeError)).toBe(2000);
    expect(retryDelay(4, fakeError)).toBe(16_000);
    expect(retryDelay(10, fakeError)).toBe(30_000);
  });

  it('configures mutations for offline-first as well', () => {
    const opts = createQueryClient().getDefaultOptions().mutations;
    expect(opts?.networkMode).toBe('offlineFirst');
    expect(opts?.retry).toBe(DEFAULT_RETRY_COUNT);
  });
});
