import { envValidationSchema } from './env.validation';

const VALID_ENV = {
  MONGODB_URI: 'mongodb://datosapi:change_me@localhost:27017/datosapi?authSource=admin',
};

describe('envValidationSchema', () => {
  it('acepta un .env mínimo con defaults', () => {
    const { error, value } = envValidationSchema.validate(VALID_ENV);

    expect(error).toBeUndefined();
    expect(value).toMatchObject({
      NODE_ENV: 'development',
      API_PORT: 3001,
      API_PREFIX: '/api/v1',
      CORS_ORIGINS: '*',
      INGEST_MAX_ROWS: 50_000,
      DEFAULT_LIMIT: 50,
      MAX_LIMIT: 500,
      PREVIEW_ROWS: 20,
    });
  });

  it('convierte los puertos numéricos a number', () => {
    const { error, value } = envValidationSchema.validate({ ...VALID_ENV, API_PORT: '4001' });

    expect(error).toBeUndefined();
    expect(value.API_PORT).toBe(4001);
  });

  it('exige MONGODB_URI', () => {
    const { error } = envValidationSchema.validate({});

    expect(error?.message).toContain('MONGODB_URI');
  });

  it('rechaza una URI que no es mongodb', () => {
    const { error } = envValidationSchema.validate({ ...VALID_ENV, MONGODB_URI: 'postgres://x' });

    expect(error?.message).toContain('MONGODB_URI');
  });

  it('rechaza un puerto fuera de rango', () => {
    const { error } = envValidationSchema.validate({ ...VALID_ENV, API_PORT: '70000' });

    expect(error?.message).toContain('API_PORT');
  });

  it('rechaza un prefijo que no arranca con /', () => {
    const { error } = envValidationSchema.validate({ ...VALID_ENV, API_PREFIX: 'api/v1' });

    expect(error?.message).toContain('API_PREFIX');
  });

  it('rechaza INGEST_MAX_ROWS no positivo', () => {
    const { error } = envValidationSchema.validate({ ...VALID_ENV, INGEST_MAX_ROWS: '0' });

    expect(error?.message).toContain('INGEST_MAX_ROWS');
  });

  it('rechaza DEFAULT_LIMIT mayor que MAX_LIMIT', () => {
    const { error } = envValidationSchema.validate({
      ...VALID_ENV,
      DEFAULT_LIMIT: '100',
      MAX_LIMIT: '50',
    });

    expect(error?.message).toContain('DEFAULT_LIMIT');
  });

  it('rechaza PREVIEW_ROWS mayor que MAX_LIMIT', () => {
    const { error } = envValidationSchema.validate({
      ...VALID_ENV,
      PREVIEW_ROWS: '600',
      MAX_LIMIT: '500',
    });

    expect(error?.message).toContain('PREVIEW_ROWS');
  });

  it('ignora variables que no pertenece a la API', () => {
    const { error } = envValidationSchema.validate({
      ...VALID_ENV,
      MONGO_ROOT_USER: 'datosapi',
      NODE_OPTIONS: '--max-old-space-size=4096',
    });

    expect(error).toBeUndefined();
  });
});
