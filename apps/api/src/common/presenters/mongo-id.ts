/**
 * El dominio llama `id` a la clave primaria y la API expone `_id` (api-contract.md §3 y §5:
 * `201 { _id: "66f0…" }`). Renombrar en la entidad would arrastrar el nombre de Mongo al
 * dominio; renombrar acá mantiene ambos mundos intactos y hace explícito que la traducción
 * ocurre sólo en el borde HTTP.
 */
export type WithMongoId<T> = Omit<T, 'id'> & { _id: string };

export function withMongoId<T extends { id: string }>(entity: T): WithMongoId<T> {
  const { id, ...rest } = entity;

  return { ...rest, _id: id };
}