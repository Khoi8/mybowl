import { defineConfig } from 'vitest/config';

// Infra has its own Vitest config (run via `pnpm --filter @bowli/infra test`).
// It is intentionally NOT folded into the root run: aws-cdk-lib is heavy and
// CDK synth/assertion tests are slow relative to the pure-domain suite, and
// infra needs Node types the lean root forbids. Keeping it separate keeps the
// root `pnpm exec vitest run` fast and stable.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
  },
});
