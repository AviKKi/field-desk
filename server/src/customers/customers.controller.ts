import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CustomersService } from './customers.service.js';
import { CurrentUser } from '../auth/auth.decorators.js';
import type { User } from '@crm/shared';
import { ZodValidationPipe } from '../common/validation.pipe.js';
import { z } from 'zod';
const customerSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    code: z.string().trim().min(2).max(40),
  })
  .strict();
@Controller('crm/customers')
export class CustomersController {
  constructor(private readonly service: CustomersService) {}
  @Post() create(
    @Body(new ZodValidationPipe(customerSchema))
    input: { name: string; code: string },
    @CurrentUser() user: User,
  ) {
    return this.service.createCustomer(user, input);
  }
  @Get(':id') find(@Param('id') id: string) {
    return this.service.findById(id);
  }
}
