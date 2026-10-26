import { Controller, Get, Param } from '@nestjs/common';
import { AuditService } from './audit.service.js';
import { CurrentUser } from '../auth/auth.decorators.js';
import type { User } from '@crm/shared';
@Controller('crm')
export class AuditController {
  constructor(private readonly service: AuditService) {}
  @Get('orders/:id/timeline') orderTimeline(@Param('id') id: string) {
    return this.service.orderTimeline(id);
  }
  @Get('customers/:id/timeline') customerTimeline(@Param('id') id: string) {
    return this.service.customerTimeline(id);
  }
  @Get('customers/:id/review') review(@Param('id') id: string) {
    return this.service.review(id);
  }
  @Get('actions/:id/trace') trace(
    @Param('id') id: string,
    @CurrentUser() user: User,
  ) {
    return this.service.trace(id, user);
  }
}
