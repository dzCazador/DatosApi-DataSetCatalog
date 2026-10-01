import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const MAX_PARENT_LEVELS = 3;

/**
 * El `.env` vive en la raíz del monorepo, pero cada workspace corre con su propio
 * `process.cwd()`: se sube desde el cwd hasta encontrarlo.
 */
export function resolveEnvFilePaths(cwd: string = process.cwd()): string[] {
  let current = resolve(cwd);

  for (let level = 0; level <= MAX_PARENT_LEVELS; level += 1) {
    const candidate = resolve(current, '.env');

    if (existsSync(candidate)) {
      return [candidate];
    }

    const parent = dirname(current);

    if (parent === current) {
      break;
    }

    current = parent;
  }

  return ['.env'];
}
