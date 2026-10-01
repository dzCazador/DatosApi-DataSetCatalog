import type { SourceConfig } from '@datosapi/common';

import { SourceConfigInvalidError, UnprocessableContentError } from '../errors/ingestion.errors';

/**
 * Verifica que el `config` corresponda al `type` de la source y lo estrecha. El service llama
 * a esto antes de ingerir, así un `config` incoherente devuelve `400` y deja la source
 * `pending`, no `error` (ingestion.md §7, primera fila).
 */
export function assertConfig<T extends SourceConfig>(
  config: SourceConfig,
  guard: (value: SourceConfig) => value is T,
  expectedType: string,
): asserts config is T {
  if (guard(config)) return;

  throw new SourceConfigInvalidError(
    `El config no corresponde a un source de tipo '${expectedType}'`,
    // Sólo los nombres de las claves y su tipo: el valor puede traer credenciales.
    { expected: expectedType, received: describeShape(config) },
  );
}

/**
 * Describe la *forma* del config y nunca su valor: `requestHeaders` puede llevar un token y
 * `payload` puede llevar datos que no pertenecen en una respuesta de error.
 */
function describeShape(config: SourceConfig): Record<string, string> {
  const record = config as unknown as Record<string, unknown>;

  return Object.fromEntries(Object.keys(record).map((key) => [key, typeof record[key]]));
}

/**
 * Resuelve un `jsonPath` recorriendo **segmento por segmento** (ingestion.md §4.2 punto 4).
 *
 * Nunca `eval`, nunca `Function`, nunca construcción de expresiones: el `jsonPath` viene del
 * usuario y esto corre en el servidor. Cada segmento se busca como clave propia del objeto,
 * así que un path con `__proto__` o `constructor` no alcanza el prototipo.
 */
export function resolveJsonPath(body: unknown, jsonPath: string | undefined): unknown {
  if (jsonPath === undefined || jsonPath.trim() === '') return body;

  const segments = jsonPath
    .split('.')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  if (segments.length === 0) return body;

  let current: unknown = body;

  for (const [index, segment] of segments.entries()) {
    if (current === null || typeof current !== 'object') {
      throw new UnprocessableContentError(
        `jsonPath '${jsonPath}' no se puede resolver: '${segments.slice(0, index).join('.')}' no es un objeto`,
        { jsonPath },
      );
    }

    if (Array.isArray(current)) {
      const position = Number(segment);

      if (!Number.isInteger(position)) {
        // Un segmento no numérico sobre un array no es "índice fuera de rango": es que la
        // propiedad no existe, y reportarlo así evita mandar al usuario a revisar el rango.
        throw new UnprocessableContentError(
          `jsonPath '${jsonPath}' no se puede resolver: '${segment}' no existe (se esperaba un índice)`,
          { jsonPath, arrayLength: current.length },
        );
      }

      if (position < 0 || position >= current.length) {
        throw new UnprocessableContentError(
          `jsonPath '${jsonPath}': el índice '${segment}' está fuera de rango`,
          { jsonPath, arrayLength: current.length },
        );
      }

      current = current[position];
      continue;
    }

    if (!Object.prototype.hasOwnProperty.call(current, segment)) {
      throw new UnprocessableContentError(
        `jsonPath '${jsonPath}' no se puede resolver: '${segment}' no existe en la respuesta`,
        { jsonPath, availableKeys: Object.keys(current).slice(0, 25) },
      );
    }

    current = (current as Record<string, unknown>)[segment];
  }

  return current;
}

/**
 * Interpreta el buffer de una respuesta JSON. Un `content-type` ausente o equivocado no
 * invalida el cuerpo: se intenta el parse y sólo si falla se explica por qué
 * (ingestion.md §4.2 punto 3).
 */
export function parseJsonPayload(buffer: Buffer, contentType: string): unknown {
  try {
    return JSON.parse(buffer.toString('utf8')) as unknown;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);

    if (contentType.includes('json')) {
      throw new UnprocessableContentError(`invalid JSON: ${reason}`, { contentType });
    }

    throw new UnprocessableContentError(
      `El origen respondió content-type '${contentType || 'desconocido'}' y su cuerpo no es JSON`,
      { contentType, preview: buffer.toString('utf8').slice(0, 200) },
    );
  }
}