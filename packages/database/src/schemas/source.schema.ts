import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema } from 'mongoose';
import type { HydratedDocument, Types } from 'mongoose';

import { SourceStatus, SourceType } from '@datosapi/common';
import type { SourceConfig } from '@datosapi/common';

export type SourceDocument = HydratedDocument<SourceDoc>;

@Schema({
  collection: 'sources',
  timestamps: true,
  versionKey: false,
  strict: true,
  toJSON: { virtuals: false },
  toObject: { virtuals: false },
})
export class SourceDoc {
  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, enum: SourceType, type: String })
  type: SourceType;

  @Prop()
  description?: string;

  // La forma válida de `config` depende de `type`: se valida en la ingesta, no en el esquema.
  @Prop({ type: Object, required: true })
  config: SourceConfig;

  @Prop({ required: true, enum: SourceStatus, type: String, default: SourceStatus.PENDING })
  status: SourceStatus;

  @Prop()
  lastIngestAt?: Date;

  @Prop()
  lastError?: string;

  @Prop({ type: MongooseSchema.Types.ObjectId })
  lastDatasetId?: Types.ObjectId;

  @Prop({ type: Object })
  metadata?: Record<string, unknown>;

  // Declarados explícitamente aunque `timestamps: true` los agregue: así el tipo del
  // documento los incluye y el mapper no depende de `InferSchemaType`.
  @Prop({ type: Date, immutable: true })
  createdAt: Date;

  @Prop({ type: Date })
  updatedAt: Date;
}

export const SourceSchema = SchemaFactory.createForClass(SourceDoc);

SourceSchema.index({ name: 1 });
SourceSchema.index({ type: 1, status: 1 });
SourceSchema.index({ createdAt: -1 });
