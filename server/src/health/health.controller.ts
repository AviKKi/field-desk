import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/auth.decorators.js';
import { HealthService } from './health.service.js';
@Controller('health')
export class HealthController {
  constructor(private readonly service: HealthService) {}
  @Public() @Get() status() {
    return this.service.status();
  }
}
