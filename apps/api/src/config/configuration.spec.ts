import { configuration, isWildcardOrigin, parseCorsOrigins } from './configuration';

describe('parseCorsOrigins', () => {
  it('devuelve el comodín si no hay valor', () => {
    expect(parseCorsOrigins(undefined)).toEqual(['*']);
    expect(parseCorsOrigins('   ')).toEqual(['*']);
  });

  it('divide por comas y recorta', () => {
    expect(parseCorsOrigins('http://localhost:3000, https://panel.datosapi.dev')).toEqual([
      'http://localhost:3000',
      'https://panel.datosapi.dev',
    ]);
  });

  it('descarta entradas vacías', () => {
    expect(parseCorsOrigins('http://localhost:3000,')).toEqual(['http://localhost:3000']);
  });
});

describe('isWildcardOrigin', () => {
  it('reconoce el comodín', () => {
    expect(isWildcardOrigin(['*'])).toBe(true);
    expect(isWildcardOrigin(['http://localhost:3000'])).toBe(false);
  });
});

const COMPLETE_ENV = {
  NODE_ENV: 'test',
  API_PORT: '3001',
  API_PREFIX: '/api/v1',
  CORS_ORIGINS: 'http://localhost:3000',
  MONGODB_URI: 'mongodb://localhost:27017/datosapi',
  INGEST_TIMEOUT_MS: '30000',
  INGEST_MAX_BYTES: '10485760',
  INGEST_MAX_ROWS: '50000',
  INGEST_USER_AGENT: 'DatosApi/0.1 (+https://localhost)',
  STORAGE_DIR: './storage',
  DEFAULT_LIMIT: '50',
  MAX_LIMIT: '500',
  PREVIEW_ROWS: '20',
};

describe('configuration', () => {
  const envBackup = { ...process.env };

  afterEach(() => {
    process.env = { ...envBackup };
  });

  it('normaliza la configuración leída del entorno', () => {
    process.env = { ...COMPLETE_ENV };

    expect(configuration()).toEqual({
      NODE_ENV: 'test',
      API_PORT: 3001,
      API_PREFIX: '/api/v1',
      CORS_ORIGINS: ['http://localhost:3000'],
      MONGODB_URI: 'mongodb://localhost:27017/datosapi',
      INGEST_TIMEOUT_MS: 30_000,
      INGEST_MAX_BYTES: 10_485_760,
      INGEST_MAX_ROWS: 50_000,
      INGEST_USER_AGENT: 'DatosApi/0.1 (+https://localhost)',
      STORAGE_DIR: './storage',
      DEFAULT_LIMIT: 50,
      MAX_LIMIT: 500,
      PREVIEW_ROWS: 20,
    });
  });

  it('falla si falta una variable obligatoria', () => {
    process.env = { ...COMPLETE_ENV, MONGODB_URI: '' };

    expect(() => configuration()).toThrow('MONGODB_URI');
  });

  it('falla si un número no es numérico', () => {
    process.env = { ...COMPLETE_ENV, API_PORT: 'no-es-un-puerto' };

    expect(() => configuration()).toThrow('API_PORT');
  });
});
