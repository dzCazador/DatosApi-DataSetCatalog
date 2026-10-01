import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TerminusModule } from '@nestjs/terminus';
import { DatabaseHealthIndicator } from './database-health.indicator';
import { HealthController } from './health.controller';

@Module({
  imports: [MongooseModule, TerminusModule.forRoot()],
  controllers: [HealthController],
  providers: [DatabaseHealthIndicator],
})
export class HealthModule {}
