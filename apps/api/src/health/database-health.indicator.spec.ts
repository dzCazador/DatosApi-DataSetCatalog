import { HealthIndicatorService } from '@nestjs/terminus';
import type { Connection } from 'mongoose';
import { DATABASE_HEALTH_KEY, DatabaseHealthIndicator } from './database-health.indicator';

function createIndicator(ping: () => Promise<unknown>): DatabaseHealthIndicator {
  const connection = {
    db: { admin: () => ({ ping }) },
  } as unknown as Connection;

  return new DatabaseHealthIndicator(connection, new HealthIndicatorService());
}

describe('DatabaseHealthIndicator', () => {
  it('informa up con la latencia del ping', async () => {
    const indicator = createIndicator(() => Promise.resolve({ ok: 1 }));

    const result = await indicator.checkDatabase();

    expect(result[DATABASE_HEALTH_KEY].status).toBe('up');
    expect(typeof result[DATABASE_HEALTH_KEY].ping).toBe('number');
  });

  it('informa down con el mensaje del driver si el ping falla', async () => {
    const indicator = createIndicator(() =>
      Promise.reject(new Error('connection <monitor> to localhost:27017 closed')),
    );

    const result = await indicator.checkDatabase();

    expect(result[DATABASE_HEALTH_KEY]).toEqual({
      status: 'down',
      ping: null,
      message: 'connection <monitor> to localhost:27017 closed',
    });
  });

  it('informa down si la conexión todavía no está establecida', async () => {
    const connection = { db: undefined } as unknown as Connection;
    const indicator = new DatabaseHealthIndicator(connection, new HealthIndicatorService());

    const result = await indicator.checkDatabase();

    expect(result[DATABASE_HEALTH_KEY]).toEqual({
      status: 'down',
      ping: null,
      message: 'MongoDB no conectado',
    });
  });
});
