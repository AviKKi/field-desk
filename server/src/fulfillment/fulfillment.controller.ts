import { Controller, Get, Param } from '@nestjs/common';
import { FulfillmentService } from './fulfillment.service.js';
@Controller('crm/orders/:orderId/shipments')
export class FulfillmentController {
  constructor(private readonly service: FulfillmentService) {}
  @Get() list(@Param('orderId') orderId: string) {
    return this.service.forOrder(orderId);
  }
}
