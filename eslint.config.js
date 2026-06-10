import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/node_modules/**', '**/coverage/**', '**/dist/**'],
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
