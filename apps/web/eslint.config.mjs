import js from '@eslint/js';
import { FlatCompat } from '@eslint/eslintrc';
import globals from 'globals';
import { fileURLToPath } from 'node:url';

import baseConfig from '../../eslint.config.mjs';

const baseDirectory = fileURLToPath(new URL('.', import.meta.url));
const compat = new FlatCompat({ baseDirectory, recommendedConfig: js.configs.recommended });

/**
 * El panel hereda la configuración ESLint de la raíz (`no-explicit-any` como error,
 * sin `console`, etc.) y le suma las reglas de Next: hooks, `jsx-a11y` y las de
 * core-web-vitals. No se relaja ninguna regla del backend.
 */
export default [
  ...baseConfig,
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
  },
];