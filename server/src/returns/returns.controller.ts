import { Controller, Get, Param } from '@nestjs/common';
import { ReturnsService } from './returns.service.js';
@Controller('crm/customers/:customerId/returns')
export class ReturnsController {
  constructor(private readonly service: ReturnsService) {}
  @Get() list(@Param('customerId') id: string) {
    return this.service.forCustomer(id);
  }
}
