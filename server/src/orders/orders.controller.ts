import { Controller, Get, Param } from '@nestjs/common';
import { OrdersService } from './orders.service.js';
@Controller('crm/orders')
export class OrdersController {
  constructor(private readonly service: OrdersService) {}
  @Get() list() {
    return this.service.list();
  }
  @Get(':id') detail(@Param('id') id: string) {
    return this.service.detail(id);
  }
}
