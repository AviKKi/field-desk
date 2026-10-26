import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { HealthController } from './health.controller.js';
import { HealthRepository } from './health.repository.js';
import { HealthService } from './health.service.js';
@Module({
  imports: [DatabaseModule],
  controllers: [HealthController],
  providers: [HealthRepository, HealthService],
})
export class HealthModule {}
