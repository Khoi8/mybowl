import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['apps/**/*.test.ts', 'packages/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['apps/mobile/src/domain/**/*.ts'],
      exclude: ['**/*.test.ts', '**/index.ts'],
      // The pure domain core must stay near-fully covered. Branch coverage is
      // set slightly lower because defensive guards on structurally-impossible
      // cases (e.g. `?? 0` under noUncheckedIndexedAccess) are intentionally
      // unreachable by tests.
      thresholds: {
        lines: 95,
        functions: 100,
        statements: 95,
        branches: 85,
      },
    },
  },
});
