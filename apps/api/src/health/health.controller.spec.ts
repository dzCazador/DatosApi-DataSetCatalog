import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { TerminusModule } from '@nestjs/terminus';
import type { Response } from 'express';
import { DatabaseHealthIndicator } from './database-health.indicator';
import { HealthController } from './health.controller';

interface MockResponse {
  status: jest.Mock<Response, [number]>;
}

function createResponse(): MockResponse {
  return { status: jest.fn() };
}

async function createController(checkResult: Record<string, unknown>): Promise<HealthController> {
  const moduleRef = await Test.createTestingModule({
    imports: [TerminusModule.forRoot()],
    controllers: [HealthController],
    providers: [
      {
        provide: DatabaseHealthIndicator,
        useValue: { checkDatabase: () => Promise.resolve(checkResult) },
      },
    ],
  }).compile();

  return moduleRef.get(HealthController);
}

describe('HealthController', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('responde ok con la latencia del ping', async () => {
    const controller = await createController({ database: { status: 'up', ping: 1.25 } });
    const response = createResponse();

    const result = await controller.check(response as unknown as Response);

    expect(result).toEqual({
      status: 'ok',
      uptime: expect.any(Number),
      database: { status: 'up', ping: 1.25 },
    });
    expect(response.status).not.toHaveBeenCalled();
  });

  it('responde 503 con el cuerpo de salud cuando MongoDB no responde', async () => {
    const controller = await createController({
      database: { status: 'down', ping: null, message: 'timeout of 1000ms exceeded' },
    });
    const response = createResponse();

    const result = await controller.check(response as unknown as Response);

    expect(response.status).toHaveBeenCalledWith(503);
    expect(result).toEqual({
      status: 'error',
      uptime: expect.any(Number),
      database: { status: 'down', ping: null, message: 'timeout of 1000ms exceeded' },
    });
  });

  it('tolera un resultado de terminus sin el indicador de base de datos', async () => {
    const controller = await createController({ memory: { status: 'up' } });
    const response = createResponse();

    const result = await controller.check(response as unknown as Response);

    expect(response.status).toHaveBeenCalledWith(503);
    expect(result.database).toEqual({
      status: 'down',
      ping: null,
      message: 'Indicador de base de datos ausente',
    });
  });
});
