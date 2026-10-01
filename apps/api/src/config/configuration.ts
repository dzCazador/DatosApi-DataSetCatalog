export type NodeEnv = 'development' | 'test' | 'production';

export interface AppConfiguration {
  NODE_ENV: NodeEnv;
  API_PORT: number;
  API_PREFIX: string;
  CORS_ORIGINS: string[];
  MONGODB_URI: string;
  INGEST_TIMEOUT_MS: number;
  INGEST_MAX_BYTES: number;
  INGEST_MAX_ROWS: number;
  INGEST_USER_AGENT: string;
  STORAGE_DIR: string;
  DEFAULT_LIMIT: number;
  MAX_LIMIT: number;
  PREVIEW_ROWS: number;
}

const WILDCARD_ORIGIN = '*';

export function parseCorsOrigins(value: string | undefined): string[] {
  if (value === undefined || value.trim() === '') {
    return [WILDCARD_ORIGIN];
  }

  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

export function isWildcardOrigin(origins: string[]): boolean {
  return origins.includes(WILDCARD_ORIGIN);
}

function readNumber(name: keyof AppConfiguration): number {
  const raw = process.env[name];
  const value = Number(raw);

  if (raw === undefined || raw.trim() === '' || !Number.isFinite(value)) {
    throw new Error(`Variable de entorno ausente o no numérica: ${name}`);
  }

  return value;
}

function readString(name: keyof AppConfiguration): string {
  const raw = process.env[name];

  if (raw === undefined || raw.trim() === '') {
    throw new Error(`Variable de entorno ausente o vacía: ${name}`);
  }

  return raw;
}

export function configuration(): AppConfiguration {
  return {
    NODE_ENV: (process.env.NODE_ENV ?? 'development') as NodeEnv,
    API_PORT: readNumber('API_PORT'),
    API_PREFIX: readString('API_PREFIX'),
    CORS_ORIGINS: parseCorsOrigins(process.env.CORS_ORIGINS),
    MONGODB_URI: readString('MONGODB_URI'),
    INGEST_TIMEOUT_MS: readNumber('INGEST_TIMEOUT_MS'),
    INGEST_MAX_BYTES: readNumber('INGEST_MAX_BYTES'),
    INGEST_MAX_ROWS: readNumber('INGEST_MAX_ROWS'),
    INGEST_USER_AGENT: readString('INGEST_USER_AGENT'),
    STORAGE_DIR: readString('STORAGE_DIR'),
    DEFAULT_LIMIT: readNumber('DEFAULT_LIMIT'),
    MAX_LIMIT: readNumber('MAX_LIMIT'),
    PREVIEW_ROWS: readNumber('PREVIEW_ROWS'),
  };
}
