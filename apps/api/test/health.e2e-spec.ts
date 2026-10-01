import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { ErrorCode } from '../src/common/errors/error-code';

// Requiere el MongoDB de `pnpm infra:up`: el health check mide un ping real, no un doble.
describe('GET /health (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('responde 200 con MongoDB up fuera del preijo global', async () => {
    const response = await request(app.getHttpServer()).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: 'ok',
      uptime: expect.any(Number),
      database: { status: 'up', ping: expect.any(Number) },
    });
  });

  it('no expone /health bajo el preijo global', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/health');

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({
      statusCode: 404,
      code: ErrorCode.ROUTE_NOT_FOUND,
      path: '/api/v1/health',
    });
  });
});
