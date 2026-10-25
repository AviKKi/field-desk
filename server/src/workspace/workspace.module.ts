import { Controller, Get, Module } from '@nestjs/common';
import type { WorkspaceResponse, User } from '@crm/shared';
import { CurrentUser, Roles } from '../auth/auth.decorators.js';

@Controller('workspace')
class WorkspaceController {
  @Get('sales')
  @Roles('SALES', 'ADMIN')
  sales(@CurrentUser() user: User): WorkspaceResponse {
    return {
      title: 'Sales workspace',
      description:
        'Your workspace for sales operations. Business modules can be added here.',
      role: user.role,
    };
  }

  @Get('accounts')
  @Roles('KAM', 'ADMIN')
  accounts(@CurrentUser() user: User): WorkspaceResponse {
    return {
      title: 'Key accounts',
      description:
        'Your workspace for key account operations. Business modules can be added here.',
      role: user.role,
    };
  }
}

@Module({ controllers: [WorkspaceController] })
export class WorkspaceModule {}
