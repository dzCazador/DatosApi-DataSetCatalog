/**
 * Validación del slug en cliente. La API es la autoridad (`400 SLUG_INVALID`), pero el
 * panel avisa antes de mandar el request: el patrón sale de `data-model.md` §4.1 y el
 * `409 SLUG_TAKEN` se muestra en el campo, no como error genérico.
 */
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const SLUG_MIN_LENGTH = 3;
export const SLUG_MAX_LENGTH = 80;

export type SlugCheck = { ok: true; slug: string } | { ok: false; message: string };

export function validateSlug(raw: string): SlugCheck {
  const slug = raw.trim();

  if (slug.length < SLUG_MIN_LENGTH) return { ok: false, message: `Mínimo ${SLUG_MIN_LENGTH} caracteres.` };
  if (slug.length > SLUG_MAX_LENGTH) return { ok: false, message: `Máximo ${SLUG_MAX_LENGTH} caracteres.` };
  if (!SLUG_PATTERN.test(slug)) {
    return { ok: false, message: 'Sólo minúsculas, números y guiones simples: mi-endpoint-2.' };
  }
  return { ok: true, slug };
}

/** Sugerencia a partir del nombre: "Escala Retención 4ª" → "escala-retencion-4a". */
export function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ª/g, 'a')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, SLUG_MAX_LENGTH);
}