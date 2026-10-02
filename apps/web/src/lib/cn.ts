export type ClassValue = string | false | null | undefined;

/** Concatena clases sin dependencias. Todos los componentes aceptan `className` para extenderse. */
export function cn(...values: ClassValue[]): string {
  return values.filter((value): value is string => typeof value === 'string' && value !== '').join(' ');
}