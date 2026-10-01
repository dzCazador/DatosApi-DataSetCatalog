export enum SourceType {
  MANUAL = 'manual',
  API = 'api',
  URL = 'url',
  PDF = 'pdf',
}

export enum SourceStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  READY = 'ready',
  ERROR = 'error',
}

export enum DatasetStatus {
  DRAFT = 'draft',
  PUBLISHED = 'published',
  ARCHIVED = 'archived',
}

export type ColumnType = 'string' | 'number' | 'boolean' | 'date' | 'json';

export type ColumnSource = 'pdf' | 'api' | 'manual' | 'url' | 'derived';

export enum FilterOperator {
  EQ = 'eq',
  NE = 'ne',
  GT = 'gt',
  GTE = 'gte',
  LT = 'lt',
  LTE = 'lte',
  IN = 'in',
  CONTAINS = 'contains',
  STARTS_WITH = 'starts_with',
  BETWEEN = 'between',
}

export type SortDirection = 'asc' | 'desc';
