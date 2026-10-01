import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema } from 'mongoose';
import type { HydratedDocument, Types } from 'mongoose';

import { DatasetStatus } from '@datosapi/common';
import type { ColumnSchema, ExtractionMeta, Row } from '@datosapi/common';

export type DatasetDocument = HydratedDocument<DatasetDoc>;

@Schema({
  collection: 'datasets',
  timestamps: true,
  versionKey: false,
  strict: true,
  toJSON: { virtuals: false },
  toObject: { virtuals: false },
})
export class DatasetDoc {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, index: false })
  sourceId: Types.ObjectId;

  @Prop({ required: true, min: 1 })
  version: number;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, enum: DatasetStatus, type: String, default: DatasetStatus.DRAFT })
  status: DatasetStatus;

  // `schema`, `rows` y `warnings` son `Mixed` y no `[Object]`/`[String]`: un path llamado
  // `schema` sombrea `Document.prototype.schema`, y entonces el cast de cualquier array
  // vacío de este documento (`SchemaArray.cast` → `doc.schema.indexedPaths()`) explota.
  // El nombre del campo lo fija data-model.md §3, así que el tipo se relaja en vez del nombre.
  // La forma de cada fila y de cada columna la garantiza la ingesta (data-model.md §3.1).
  @Prop({ type: MongooseSchema.Types.Mixed, required: true })
  schema: ColumnSchema[];

  // Embebido en el MVP (data-model.md §3.1). La transición a una colección `dataset_rows`
  // se hace por detrás de la interfaz del repositorio, sin tocar los services.
  @Prop({ type: MongooseSchema.Types.Mixed, default: [] })
  rows: Row[];

  @Prop({ required: true, min: 0 })
  rowCount: number;

  @Prop({ required: true, min: 0 })
  columnsCount: number;

  @Prop({ type: MongooseSchema.Types.Mixed, default: [] })
  warnings: string[];

  @Prop({ type: Object, required: true })
  meta: ExtractionMeta;

  @Prop()
  publishedAt?: Date;

  // Declarados explícitamente aunque `timestamps: true` los agregue: así el tipo del
  // documento los incluye y el mapper no depende de `InferSchemaType`.
  @Prop({ type: Date, immutable: true })
  createdAt: Date;

  @Prop({ type: Date })
  updatedAt: Date;
}

export const DatasetSchema = SchemaFactory.createForClass(DatasetDoc);

DatasetSchema.index({ sourceId: 1, version: -1 }, { unique: true });
DatasetSchema.index({ status: 1, sourceId: 1, version: -1 });
DatasetSchema.index({ createdAt: -1 });
DatasetSchema.index({ rowCount: -1 });
