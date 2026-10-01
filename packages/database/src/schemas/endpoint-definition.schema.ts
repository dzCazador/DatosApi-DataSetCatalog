import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema } from 'mongoose';
import type { HydratedDocument, Types } from 'mongoose';

import { FilterOperator } from '@datosapi/common';
import type { FilterDef, SortDef } from '@datosapi/common';

export type EndpointDefinitionDocument = HydratedDocument<EndpointDefinitionDoc>;

@Schema({
  collection: 'endpoint_definitions',
  timestamps: true,
  versionKey: false,
  strict: true,
  toJSON: { virtuals: false },
  toObject: { virtuals: false },
})
export class EndpointDefinitionDoc {
  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, trim: true })
  slug: string;

  @Prop()
  description?: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  sourceId: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId })
  datasetId?: Types.ObjectId;

  @Prop({ required: true, default: false })
  followLatest: boolean;

  @Prop({ type: [String] })
  fields?: string[];

  @Prop({
    type: [
      {
        _id: false,
        field: { type: String, required: true },
        op: { type: String, required: true, enum: Object.values(FilterOperator) },
        required: { type: Boolean },
      },
    ],
    default: [],
  })
  filters: FilterDef[];

  @Prop({
    type: [
      {
        _id: false,
        field: { type: String, required: true },
        dir: { type: String, required: true, enum: ['asc', 'desc'] },
      },
    ],
    default: [],
  })
  sort: SortDef[];

  @Prop({ required: true, min: 1 })
  defaultLimit: number;

  @Prop({ required: true, min: 1 })
  maxLimit: number;

  @Prop({ required: true, default: true })
  enabled: boolean;

  @Prop({ type: Object })
  metadata?: Record<string, unknown>;

  // Declarados explícitamente aunque `timestamps: true` los agregue: así el tipo del
  // documento los incluye y el mapper no depende de `InferSchemaType`.
  @Prop({ type: Date, immutable: true })
  createdAt: Date;

  @Prop({ type: Date })
  updatedAt: Date;
}

export const EndpointDefinitionSchema = SchemaFactory.createForClass(EndpointDefinitionDoc);

EndpointDefinitionSchema.index({ slug: 1 }, { unique: true });
EndpointDefinitionSchema.index({ sourceId: 1 });
EndpointDefinitionSchema.index({ enabled: 1 });
EndpointDefinitionSchema.index({ createdAt: -1 });
