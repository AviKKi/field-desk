import { Controller, Get, Param } from '@nestjs/common';
import type { User } from '@crm/shared';
import { CurrentUser } from '../auth/auth.decorators.js';
import { CrmService } from './crm.service.js';
@Controller('crm')
export class CrmController {
  constructor(private readonly crm: CrmService) {}
  @Get('bootstrap') bootstrap(@CurrentUser() user: User) {
    return this.crm.bootstrap(user);
  }
  @Get('customers/:id/snapshot') snapshot(@Param('id') id: string) {
    return this.crm.snapshot(id);
  }
}
