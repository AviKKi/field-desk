import { Controller, Get } from '@nestjs/common';
import type { User } from '@crm/shared';
import { CurrentUser, Roles } from '../auth/auth.decorators.js';
import { workspaceDescriptions } from './workspace.model.js';
@Controller('workspace')
export class WorkspaceController {
  @Get('sales') @Roles('SALES', 'ADMIN') sales(@CurrentUser() user: User) {
    return { ...workspaceDescriptions.sales, role: user.role };
  }
  @Get('accounts') @Roles('KAM', 'ADMIN') accounts(@CurrentUser() user: User) {
    return { ...workspaceDescriptions.accounts, role: user.role };
  }
}
