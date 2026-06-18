import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    // `client.ts` (expo-sqlite) and `sync/connectivity.ts` (NetInfo) are the
    // sole Expo/native-coupled files; those deps aren't installed until S9, so
    // linting them would fail import resolution. Excluded from Node typecheck
    // (tsconfig.json) and lint alike until then.
    ignores: [
      '**/node_modules/**',
      '**/coverage/**',
      '**/dist/**',
      'apps/mobile/src/db/client.ts',
      'apps/mobile/src/sync/connectivity.ts',
      // Ambient asset/module declarations (`*.sql`, the drizzle migrations
      // bundle, NativeWind types). These use TS `declare module` glob syntax
      // the lean non-type-aware root parser can't handle; they belong to the
      // Expo app's own TS project (apps/mobile/tsconfig.json), not the root.
      'apps/mobile/**/*.d.ts',
      // infra/ is its own package (CDK + Node types) with its own tsconfig; it
      // is not part of the lean root TS project, so the root lint skips it.
      'infra/**',
      '**/cdk.out/**',
    ],
  },
  {
    files: ['**/*.ts'],
    extends: [...tseslint.configs.recommended],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    // Enforce domain purity mechanically: no React Native / Expo / Node imports.
    files: ['apps/mobile/src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                'react-native',
                'react-native/*',
                'react',
                'expo',
                'expo-*',
                'expo/*',
                '@react-native/*',
                'node:*',
              ],
              message:
                'apps/mobile/src/domain must stay pure — no React Native, Expo, React, or Node imports.',
            },
          ],
        },
      ],
    },
  },
);
