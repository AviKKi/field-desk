import { Injectable } from '@nestjs/common';
import { HealthRepository } from './health.repository.js';
import type { HealthStatus } from './health.model.js';
@Injectable()
export class HealthService {
  constructor(private readonly repository: HealthRepository) {}
  status(): HealthStatus {
    this.repository.checkConnection();
    return { status: 'ok' };
  }
}
