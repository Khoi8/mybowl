import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    // `client.ts` is the sole Expo-coupled file; `expo-sqlite` isn't installed
    // until S9, so linting it would fail import resolution. Excluded from Node
    // typecheck (tsconfig.json) and lint alike until then.
    ignores: [
      '**/node_modules/**',
      '**/coverage/**',
      '**/dist/**',
      'apps/mobile/src/db/client.ts',
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
