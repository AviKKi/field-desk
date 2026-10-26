import { Controller, Get, Param } from '@nestjs/common';
import type { User } from '@crm/shared';
import { CurrentUser } from '../auth/auth.decorators.js';
import { CrmQueriesService } from './crm-queries.service.js';

@Controller('crm')
export class CrmQueriesController {
  constructor(private readonly queries: CrmQueriesService) {}

  @Get('bootstrap')
  bootstrap(@CurrentUser() user: User) {
    return this.queries.bootstrap(user);
  }

  @Get('customers/:id/snapshot')
  snapshot(@Param('id') id: string) {
    return this.queries.snapshot(id);
  }
}
