import { ApiProperty } from '@nestjs/swagger';

export type HealthStatus = 'up' | 'down';
export type HealthOverallStatus = 'ok' | 'error';

export class DatabaseHealthDto {
  @ApiProperty({ enum: ['up', 'down'], example: 'up' })
  status: HealthStatus;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Latencia del ping a MongoDB en milisegundos; null si no respondió.',
    example: 3,
  })
  ping: number | null;

  @ApiProperty({ required: false, example: 'connection <monitor> to localhost:27017 closed' })
  message?: string;
}

export class HealthStatusDto {
  @ApiProperty({ enum: ['ok', 'error'], example: 'ok' })
  status: HealthOverallStatus;

  @ApiProperty({ description: 'Segundos desde el arranque del proceso.', example: 1234 })
  uptime: number;

  @ApiProperty({ type: DatabaseHealthDto })
  database: DatabaseHealthDto;
}
