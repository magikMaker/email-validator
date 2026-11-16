/**
 * ESLint: the recommended JavaScript and TypeScript rules, no `any`,
 * JSDoc on every function, lines under 80 characters. The generated
 * data modules are left out.
 */

import js from '@eslint/js'
import stylistic from '@stylistic/eslint-plugin'
import jsdoc from 'eslint-plugin-jsdoc'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: ['dist/**', 'coverage/**', 'node_modules/**', 'src/data/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser },
    },
    plugins: { '@stylistic': stylistic },
    rules: {
      '@stylistic/max-len': [
        'error',
        {
          code: 80,
          ignoreUrls: true,
          ignoreRegExpLiterals: true,
        },
      ],
    },
  },
  {
    files: ['**/*.ts'],
    ...jsdoc.configs['flat/recommended-typescript-error'],
  },
  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      'jsdoc/require-jsdoc': [
        'error',
        {
          publicOnly: false,
          require: {
            FunctionDeclaration: true,
            ClassDeclaration: true,
            MethodDefinition: true,
          },
        },
      ],
      'jsdoc/tag-lines': 'off',
    },
  },
  {
    files: ['**/*.test.ts', '**/*.fixtures.ts'],
    rules: {
      'jsdoc/require-jsdoc': 'off',
    },
  },
  {
    files: ['scripts/**/*.mjs'],
    ...jsdoc.configs['flat/recommended-error'],
  },
  {
    files: ['scripts/**/*.mjs'],
    rules: {
      'jsdoc/tag-lines': 'off',
      'jsdoc/require-returns': 'off',
    },
  }
)
