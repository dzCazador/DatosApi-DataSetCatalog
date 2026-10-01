import Joi from 'joi';

const MONGODB_URI_SCHEMES = ['mongodb', 'mongodb+srv'];

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  API_PORT: Joi.number().port().default(3001),
  API_PREFIX: Joi.string()
    .pattern(/^\/[a-zA-Z0-9\-_/]*$/)
    .default('/api/v1'),
  CORS_ORIGINS: Joi.string().allow('').default('*'),
  MONGODB_URI: Joi.string()
    .uri({ scheme: MONGODB_URI_SCHEMES })
    .required()
    .messages({ 'string.uri': 'MONGODB_URI debe ser una URI mongodb:// o mongodb+srv://' }),
  INGEST_TIMEOUT_MS: Joi.number().integer().positive().default(30_000),
  INGEST_MAX_BYTES: Joi.number().integer().positive().default(10_485_760),
  INGEST_MAX_ROWS: Joi.number().integer().positive().default(50_000),
  INGEST_USER_AGENT: Joi.string().default('DatosApi/0.1 (+https://localhost)'),
  STORAGE_DIR: Joi.string().default('./storage'),
  DEFAULT_LIMIT: Joi.number().integer().positive().default(50),
  MAX_LIMIT: Joi.number().integer().positive().default(500),
  PREVIEW_ROWS: Joi.number().integer().positive().default(20),
})
  .custom((env, helpers) => {
    const defaultLimit = env['DEFAULT_LIMIT'];
    const maxLimit = env['MAX_LIMIT'];
    const previewRows = env['PREVIEW_ROWS'];

    if (
      typeof defaultLimit === 'number' &&
      typeof maxLimit === 'number' &&
      defaultLimit > maxLimit
    ) {
      return helpers.message({ custom: 'DEFAULT_LIMIT no puede ser mayor que MAX_LIMIT' });
    }

    if (typeof previewRows === 'number' && typeof maxLimit === 'number' && previewRows > maxLimit) {
      return helpers.message({ custom: 'PREVIEW_ROWS no puede ser mayor que MAX_LIMIT' });
    }

    return env;
  })
  .unknown();
