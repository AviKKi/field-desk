import { Controller, Get, Param } from '@nestjs/common';
import { CreditsService } from './credits.service.js';
@Controller('crm/customers/:customerId/credits')
export class CreditsController {
  constructor(private readonly service: CreditsService) {}
  @Get() list(@Param('customerId') id: string) {
    return this.service.forCustomer(id);
  }
}
