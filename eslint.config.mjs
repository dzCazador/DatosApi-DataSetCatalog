import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export const ignores = [
  '**/node_modules/**',
  '**/dist/**',
  '**/coverage/**',
  '**/.turbo/**',
  '**/*.d.ts',
];

export default tseslint.config({ ignores }, js.configs.recommended, tseslint.configs.recommended, {
  languageOptions: {
    ecmaVersion: 2023,
    sourceType: 'module',
    globals: {
      ...globals.node,
      ...globals.jest,
    },
  },
  linterOptions: {
    reportUnusedDisableDirectives: 'error',
  },
  rules: {
    'no-undef': 'off',
    'no-console': 'error',
    eqeqeq: ['error', 'always', { null: 'ignore' }],
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],
    // `@typescript-eslint/consistent-type-imports` queda desactivada a propósito: en Nest
    // la clase inyectada por constructor se usa sólo como tipo, y convertirla en
    // `import type` borra el `design:paramtypes` que usa el inyector de dependencias.
  },
});
