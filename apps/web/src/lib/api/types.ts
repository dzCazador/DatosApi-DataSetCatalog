/**
 * Tipos del **contrato de la API** (`specs/api-contract.md`), no del dominio interno.
 *
 * Se duplican a propósito en vez de importar `@datosapi/common`: el panel es un cliente
 * de la API pública y lo que viaja por el cable no es el documento de Mongoose sino la
 * forma serializada (`_id` en vez de `id`, fechas ISO en vez de `Date`). Si un día el
 * contrato cambia, el compilador obliga a revisar el panel, que es justo lo que se busca.
 */

/** Códigos de error del contrato (`api-contract.md` §1.2). Lista cerrada y estable. */
export const ERROR_CODES = [
  'VALIDATION_ERROR',
  'SOURCE_CONFIG_INVALID',
  'SLUG_INVALID',
  'SLUG_TAKEN',
  'INGEST_ALREADY_RUNNING',
  'VERSION_CONFLICT',
  'SOURCE_NOT_FOUND',
  'DATASET_NOT_FOUND',
  'DATASET_INVALID_STATE',
  'ENDPOINT_NOT_FOUND',
  'SLUG_NOT_FOUND',
  'PAYLOAD_TOO_LARGE',
  'UNSUPPORTED_MEDIA_TYPE',
  'UNPROCESSABLE_CONTENT',
  'ROWS_LIMIT_EXCEEDED',
  'FILTER_NOT_ALLOWED',
  'SORT_NOT_ALLOWED',
  'INVALID_PAGINATION',
  'SCHEMA_MISMATCH',
  'UPSTREAM_ERROR',
  'UPSTREAM_TIMEOUT',
  'ROUTE_NOT_FOUND',
  'HTTP_ERROR',
  'INTERNAL_ERROR',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export type SourceType = 'manual' | 'api' | 'url' | 'pdf';

export type SourceStatus = 'pending' | 'processing' | 'ready' | 'error';

export type DatasetStatus = 'draft' | 'published' | 'archived';

export type ColumnType = 'string' | 'number' | 'boolean' | 'date' | 'json';

export type ColumnSource = 'pdf' | 'api' | 'manual' | 'url' | 'derived';

export type FilterOperator =
  | 'eq'
  | 'ne'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'in'
  | 'contains'
  | 'starts_with'
  | 'between';

export type SortDirection = 'asc' | 'desc';

/** Una celda de `rows`: una fila = un objeto plano (`data-model.md` §3). */
export type Cell = string | number | boolean | null;

export type Row = Record<string, Cell>;

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
  fetchedAt?: string;
  contentType?: string;
  bytes?: number;
  durationMs?: number;
}

export interface DatasetDetailMeta extends ExtractionMeta {
  /** `GET /datasets/:id` siempre lo manda; el preview se recortó. */
  previewTruncated: boolean;
}

/* ── sources ─────────────────────────────────────────────────────────── */

export interface BaseSourceConfig {
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

export type SourceConfig =
  | ManualSourceConfig
  | ApiSourceConfig
  | UrlSourceConfig
  | PdfSourceConfig;

export interface Source {
  _id: string;
  name: string;
  type: SourceType;
  description?: string;
  config: SourceConfig;
  status: SourceStatus;
  lastIngestAt?: string;
  lastError?: string;
  lastDatasetId?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/** `POST /sources/:id/ingest` — los ids acá son camelCase, no `_id` (`api-contract.md` §3). */
export interface IngestOutcome {
  sourceId: string;
  datasetId: string;
  version: number;
  rowCount: number;
  columnsCount: number;
  warnings: string[];
  meta: ExtractionMeta;
}

/* ── datasets ────────────────────────────────────────────────────────── */

export interface DatasetListItem {
  _id: string;
  sourceId: string;
  version: number;
  name: string;
  status: DatasetStatus;
  schema: ColumnSchema[];
  rowCount: number;
  columnsCount: number;
  warnings: string[];
  meta: ExtractionMeta;
  publishedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DatasetDetail extends Omit<DatasetListItem, 'meta'> {
  rows: Row[];
  meta: DatasetDetailMeta;
}

/* ── endpoint_definitions ────────────────────────────────────────────── */

export interface FilterDef {
  field: string;
  op: FilterOperator;
  required?: boolean;
}

export interface SortDef {
  field: string;
  dir: SortDirection;
}

export interface EndpointDefinition {
  _id: string;
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
  createdAt: string;
  updatedAt: string;
}

export interface ResolvedDataset {
  datasetId: string;
  version: number;
  status: DatasetStatus;
  rowCount: number;
}

/** `GET /endpoints/:id`: la definición más qué dataset usaría ahora. Nunca es 404. */
export interface EndpointDetail extends EndpointDefinition {
  resolved: ResolvedDataset | null;
  resolvedReason: string | null;
}

export interface UnknownFieldReport {
  /** Ubicación exacta dentro de la definición, tal como la nombra `api-contract.md` §5. */
  where: string;
  field: string;
  reason: string;
}

/** `POST /endpoints/:id/validate` — siempre 200, es un reporte y no un fallo. */
export interface ValidationReport {
  valid: boolean;
  datasetId: string | null;
  version: number | null;
  status: DatasetStatus | null;
  unknownFields: UnknownFieldReport[];
  reason: string | null;
}

/* ── endpoint dinámico ───────────────────────────────────────────────── */

export interface DynamicDatasetMeta {
  id: string;
  version: number;
  sourceId: string;
  updatedAt: string;
}

export interface DynamicMeta {
  total: number;
  count: number;
  page: number;
  limit: number;
  pages: number;
  dataset: DynamicDatasetMeta;
}

export interface DynamicPayload {
  data: Row[];
  meta: DynamicMeta;
}

/* ── salud ───────────────────────────────────────────────────────────── */

export interface HealthStatus {
  status: 'ok' | 'error';
  uptime: number;
  database: {
    status: 'up' | 'down';
    ping: number | null;
    message?: string;
  };
}

/* ── envelopes ───────────────────────────────────────────────────────── */

export interface PaginationMeta {
  total: number;
  count: number;
  page: number;
  limit: number;
  /** `0` cuando `total === 0`: la API no redondea a una página vacía. */
  pages: number;
}

export interface Paginated<T> {
  data: T[];
  meta: PaginationMeta;
}