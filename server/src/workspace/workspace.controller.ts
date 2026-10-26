import { Controller, Get } from '@nestjs/common';
import type { User } from '@crm/shared';
import { CurrentUser, Roles } from '../auth/auth.decorators.js';
import { WorkspaceService } from './workspace.service.js';
@Controller('workspace')
export class WorkspaceController {
  constructor(private readonly service: WorkspaceService) {}
  @Get('sales') @Roles('SALES', 'ADMIN') sales(@CurrentUser() user: User) {
    return this.service.describe('sales', user);
  }
  @Get('accounts') @Roles('KAM', 'ADMIN') accounts(@CurrentUser() user: User) {
    return this.service.describe('accounts', user);
  }
}
