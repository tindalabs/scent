import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import prettier from 'eslint-config-prettier';

export default [
  {
    // Source is covered by each package's tsconfig — use typed parsing.
    // Colocated *.test.ts files are excluded here (tsconfig excludes them too,
    // so `project` parsing would fail) and handled by the block below.
    files: ['packages/*/src/**/*.ts', 'apps/*/src/**/*.{ts,tsx}'],
    ignores: ['**/*.test.{ts,tsx}'],
    languageOptions: {
      parser: tsparser,
      parserOptions: { project: true },
    },
    plugins: { '@typescript-eslint': tseslint },
    rules: {
      ...tseslint.configs.recommended.rules,
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/explicit-function-return-type': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // Tests are excluded from tsconfig (kept out of dist), so parse them without
    // a project. None of the enabled rules need type info. The two strict
    // src-only rules are relaxed — tests legitimately use `any` and inline
    // callbacks without return-type annotations.
    files: ['**/*.test.{ts,tsx}'],
    languageOptions: {
      parser: tsparser,
    },
    plugins: { '@typescript-eslint': tseslint },
    rules: {
      ...tseslint.configs.recommended.rules,
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  prettier,
];
