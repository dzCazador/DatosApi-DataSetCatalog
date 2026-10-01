import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { HealthIndicatorService } from '@nestjs/terminus';
import { Connection } from 'mongoose';

export const DATABASE_HEALTH_KEY = 'database';

const NOT_CONNECTED_MESSAGE = 'MongoDB no conectado';
const PING_FAILED_MESSAGE = 'Ping a MongoDB falló';

export type DatabaseStatus =
  { status: 'up'; ping: number } | { status: 'down'; ping: null; message: string };

export type DatabaseHealthCheckResult = Record<'database', DatabaseStatus>;

/**
 * El ping usa `admin().ping()` y no sólo `readyState` para que `ping` sea una latencia real
 * de ida y vuelta: con `readyState` un Mongo caído pero aún conectado reportaría `up`.
 */
@Injectable()
export class DatabaseHealthIndicator {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    private readonly healthIndicatorService: HealthIndicatorService,
  ) {}

  async checkDatabase(): Promise<DatabaseHealthCheckResult> {
    const check = this.healthIndicatorService.check(DATABASE_HEALTH_KEY);
    const database = this.connection.db;

    if (database === undefined) {
      return check.down({ ping: null, message: NOT_CONNECTED_MESSAGE });
    }

    const startedAt = process.hrtime.bigint();

    try {
      await database.admin().ping();
    } catch (error) {
      const message = error instanceof Error ? error.message : PING_FAILED_MESSAGE;

      return check.down({ ping: null, message });
    }

    return check.up({ ping: elapsedMs(startedAt) });
  }
}

function elapsedMs(startedAt: bigint): number {
  const nanos = Number(process.hrtime.bigint() - startedAt);

  return Math.round((nanos / 1_000_000) * 100) / 100;
}
