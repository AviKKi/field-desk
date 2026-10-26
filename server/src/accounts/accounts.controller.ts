import { Controller, Get, Param } from '@nestjs/common';
import { AccountsService } from './accounts.service.js';
@Controller('crm')
export class AccountsController {
  constructor(private readonly service: AccountsService) {}
  @Get('accounts') accounts() {
    return this.service.accounts();
  }
  @Get('customers/:id/summary') summary(@Param('id') id: string) {
    return this.service.summary(id);
  }
  @Get('customers/:id/ledger') ledger(@Param('id') id: string) {
    return this.service.ledger(id);
  }
}
