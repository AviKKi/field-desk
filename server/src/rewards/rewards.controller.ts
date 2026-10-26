import { Controller, Get, Param } from '@nestjs/common';
import { RewardsService } from './rewards.service.js';
@Controller('crm/customers/:customerId/rewards')
export class RewardsController {
  constructor(private readonly service: RewardsService) {}
  @Get() list(@Param('customerId') id: string) {
    return this.service.forCustomer(id);
  }
}
