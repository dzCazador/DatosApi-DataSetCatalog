import type {
  ColumnSource,
  ColumnType,
  DatasetStatus,
  FilterOperator,
  SortDirection,
  SourceStatus,
  SourceType,
} from './enums';

/** Valores admitidos en una celda: la clave de columna va en snake_case. */
export type Row = Record<string, string | number | boolean | null>;

export interface ColumnSchema {
  key: string;
  label: string;
  type: ColumnType;
  nullable: boolean;
  decimalScale?: number;
  source?: ColumnSource;
}

export interface ExtractionMeta {
  method: string;
  pageCount?: number;
  tableCount?: number;
  rawRowCount: number;
  sourceUrl?: string;
  fetchedAt?: Date;
  contentType?: string;
  bytes?: number;
  durationMs?: number;
}

export interface FilterDef {
  field: string;
  op: FilterOperator;
  required?: boolean;
}

export interface SortDef {
  field: string;
  dir: SortDirection;
}

interface BaseSourceConfig {
  requestHeaders?: Record<string, string>;
}

export interface ManualSourceConfig extends BaseSourceConfig {
  format: 'json' | 'csv';
  payload: string;
  delimiter?: string;
  hasHeaderRow?: boolean;
}

export interface ApiSourceConfig extends BaseSourceConfig {
  url: string;
  method: 'GET' | 'POST';
  body?: unknown;
  jsonPath?: string;
}

export interface UrlSourceConfig extends BaseSourceConfig {
  url: string;
  contentTypeHint?: string;
}

export interface PdfSourceConfig extends BaseSourceConfig {
  url: string;
  pages?: number[];
  tableIndex?: number;
  headerHints?: string[];
}

export type SourceConfig = ManualSourceConfig | ApiSourceConfig | UrlSourceConfig | PdfSourceConfig;

export interface IngestResult {
  rows: Row[];
  schema: ColumnSchema[];
  meta: ExtractionMeta;
  warnings: string[];
}

export interface IngestLimits {
  timeoutMs: number;
  maxBytes: number;
  maxRows: number;
}

export interface IngestContext {
  now: Date;
  storageDir: string;
  limits: IngestLimits;
}

export interface Paginated<T> {
  data: T[];
  meta: PaginationMeta;
}

export interface PaginationMeta {
  total: number;
  count: number;
  page: number;
  limit: number;
  pages: number;
}

export interface PaginationQuery {
  page: number;
  limit: number;
}

export interface SourceEntity {
  id: string;
  name: string;
  type: SourceType;
  description?: string;
  config: SourceConfig;
  status: SourceStatus;
  lastIngestAt?: Date;
  lastError?: string;
  lastDatasetId?: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface DatasetEntity {
  id: string;
  sourceId: string;
  version: number;
  name: string;
  status: DatasetStatus;
  schema: ColumnSchema[];
  rows: Row[];
  rowCount: number;
  columnsCount: number;
  warnings: string[];
  meta: ExtractionMeta;
  publishedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export type DatasetListItem = Omit<DatasetEntity, 'rows'>;

export interface EndpointDefinitionEntity {
  id: string;
  name: string;
  slug: string;
  description?: string;
  sourceId: string;
  datasetId?: string;
  followLatest: boolean;
  fields?: string[];
  filters: FilterDef[];
  sort: SortDef[];
  defaultLimit: number;
  maxLimit: number;
  enabled: boolean;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}
