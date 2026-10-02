'use server';

import { getDatasetSchema } from '@/lib/api';
import { presentError } from '@/lib/api/errors';
import type { ColumnSchema } from '@/lib/api/types';

export interface SchemaPayload {
  ok: boolean;
  message: string;
  schema: ColumnSchema[];
}

/**
 * El editor necesita el `schema` del dataset elegido para ofrecer un desplegable por
 * columna. Se pide on-demand desde el cliente en vez de mandar todos los schemas de una,
 * que puede ser un payload grande sin necesidad.
 */
export async function loadDatasetSchemaAction(datasetId: string): Promise<SchemaPayload> {
  if (datasetId === '') return { ok: false, message: 'Elegí un dataset.', schema: [] };

  const result = await getDatasetSchema(datasetId);
  if (!result.ok) {
    const { title, detail } = presentError(result.error);
    return { ok: false, message: [title, detail].filter(Boolean).join(': '), schema: [] };
  }

  return { ok: true, message: `${result.data.schema.length} columnas.`, schema: result.data.schema };
}