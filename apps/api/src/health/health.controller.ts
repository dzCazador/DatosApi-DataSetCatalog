import {
  Controller,
  Get,
  HttpStatus,
  Logger,
  Res,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { HealthCheckService } from '@nestjs/terminus';
import { DatabaseHealthIndicator } from './database-health.indicator';
import type { DatabaseStatus } from './database-health.indicator';
import type { DatabaseHealthDto } from './dto/health-status.dto';
import { HealthStatusDto } from './dto/health-status.dto';

const MISSING_INDICATOR_MESSAGE = 'Indicador de base de datos ausente';

interface HealthCheckPayload {
  info?: { database?: DatabaseStatus };
  error?: { database?: DatabaseStatus };
}

@ApiTags('health')
@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(
    private readonly healthCheckService: HealthCheckService,
    private readonly databaseHealthIndicator: DatabaseHealthIndicator,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Estado de la API y de la conexión a MongoDB' })
  @ApiOkResponse({ type: HealthStatusDto })
  @ApiServiceUnavailableResponse({
    type: HealthStatusDto,
    description: 'MongoDB no responde',
  })
  // El contrato pide el cuerpo de salud también en el 503, así que el status se fija acá en
  // lugar de dejar que la excepción de terminus atraviese el filtro global de errores.
  async check(@Res({ passthrough: true }) response: Response): Promise<HealthStatusDto> {
    const payload = await this.collect();
    const result = toHealthStatusDto(payload, Math.round(process.uptime()));

    if (result.status === 'error') {
      this.logger.warn('GET /health: MongoDB no responde');
      response.status(HttpStatus.SERVICE_UNAVAILABLE);
    }

    return result;
  }

  private async collect(): Promise<HealthCheckPayload> {
    try {
      return await this.healthCheckService.check([
        () => this.databaseHealthIndicator.checkDatabase(),
      ]);
    } catch (error) {
      if (!(error instanceof ServiceUnavailableException)) {
        throw error;
      }

      return error.getResponse() as HealthCheckPayload;
    }
  }
}

function toHealthStatusDto(result: HealthCheckPayload, uptime: number): HealthStatusDto {
  const database = toDatabaseHealthDto(result.info?.database ?? result.error?.database);

  return {
    status: database.status === 'up' ? 'ok' : 'error',
    uptime,
    database,
  };
}

function toDatabaseHealthDto(status: DatabaseStatus | undefined): DatabaseHealthDto {
  if (status === undefined) {
    return { status: 'down', ping: null, message: MISSING_INDICATOR_MESSAGE };
  }

  if (status.status === 'down') {
    return { status: 'down', ping: status.ping, message: status.message };
  }

  return { status: 'up', ping: status.ping };
}
