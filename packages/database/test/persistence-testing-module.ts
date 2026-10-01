import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { MongooseModule, getConnectionToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import type { Connection } from 'mongoose';

import { DatasetsPersistenceModule } from '../src/modules/datasets.module';
import { EndpointsPersistenceModule } from '../src/modules/endpoints.module';
import { SourcesPersistenceModule } from '../src/modules/sources.module';

const TEST_DB_NAME = 'datosapi_test';

function readRootEnv(): Record<string, string> {
  const path = resolve(__dirname, '../../../.env');
  if (!existsSync(path)) return {};

  return Object.fromEntries(
    readFileSync(path, 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#') && line.includes('='))
      .map((line) => {
        const separator = line.indexOf('=');
        return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()];
      }),
  );
}

/** Base de datos distinta de la de desarrollo: los repositorios se limpian, no se comparten. */
export function testMongoUri(): string {
  const uri = process.env['MONGODB_URI'] ?? readRootEnv()['MONGODB_URI'] ?? '';

  if (!uri) {
    throw new Error('MONGODB_URI no está definido (process.env o .env de la raíz del monorepo)');
  }

  const [base = '', query = ''] = uri.split('?');
  const separator = base.lastIndexOf('/');
  const withoutDb = separator > 0 ? base.slice(0, separator) : base;
  const search = query.length > 0 ? `?${query}` : '';

  return `${withoutDb}/${TEST_DB_NAME}${search}`;
}

/**
 * Levanta los tres módulos de persistencia contra el Mongo real con una sola conexión, la
 * misma que usa la app. Los tests de repositorio no pueden ser unitarios: los índices
 * únicos y el CAS de `status` sólo existen contra el servidor.
 */
export async function createPersistenceTestingModule(): Promise<TestingModule> {
  const moduleRef = await Test.createTestingModule({
    imports: [
      MongooseModule.forRoot(testMongoUri()),
      SourcesPersistenceModule,
      DatasetsPersistenceModule,
      EndpointsPersistenceModule,
    ],
  }).compile();

  await moduleRef.init();
  await clearTestDatabase(moduleRef);

  return moduleRef;
}

/**
 * `dropDatabase()` se lleva también los índices, y las pruebas los necesitan (el slug único
 * es el objeto de la fase 03). Por eso se recrean con `syncIndexes()`.
 */
export async function clearTestDatabase(moduleRef: TestingModule): Promise<void> {
  const connection = moduleRef.get<Connection>(getConnectionToken());
  await connection.dropDatabase();

  await Promise.all(Object.values(connection.models).map((model) => model.syncIndexes()));
}
