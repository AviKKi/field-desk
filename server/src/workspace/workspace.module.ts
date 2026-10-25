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
        'Create orders, submit commercial changes, and follow fulfillment at the operations desk.',
      role: user.role,
    };
  }

  @Get('accounts')
  @Roles('KAM', 'ADMIN')
  accounts(@CurrentUser() user: User): WorkspaceResponse {
    return {
      title: 'Key accounts',
      description:
        'Review commercial revisions and authorized shipment corrections at the operations desk.',
      role: user.role,
    };
  }
}

@Module({ controllers: [WorkspaceController] })
export class WorkspaceModule {}
