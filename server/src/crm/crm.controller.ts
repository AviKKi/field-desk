import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { actionEnvelopeSchema } from '@crm/shared/crm';
import type { ActionEnvelope } from '@crm/shared/crm';
import type { User } from '@crm/shared';
import { CurrentUser } from '../auth/auth.decorators.js';
import { ZodValidationPipe } from '../common/validation.pipe.js';
import { CrmService } from './crm.service.js';

const customerSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    code: z.string().trim().min(2).max(40),
  })
  .strict();
@Controller('crm')
export class CrmController {
  constructor(private readonly crm: CrmService) {}
  @Get('bootstrap')
  bootstrap(@CurrentUser() user: User) {
    return this.crm.bootstrap(user);
  }
  @Get('accounts')
  accounts() {
    return this.crm.accounts();
  }
  @Post('actions')
  actions(
    @Body(new ZodValidationPipe(actionEnvelopeSchema)) input: ActionEnvelope,
    @CurrentUser() user: User,
  ) {
    return this.crm.execute(input, user);
  }
  @Get('orders/:id')
  order(@Param('id') id: string) {
    return this.crm.detail(id);
  }
  @Get('orders/:id/timeline')
  timeline(@Param('id') id: string) {
    return this.crm.detail(id).timeline;
  }
  @Get('customers/:id/summary')
  summary(@Param('id') id: string) {
    return this.crm.summary(id);
  }
  @Get('customers/:id/ledger')
  ledger(@Param('id') id: string) {
    return this.crm.ledger(id);
  }
  @Get('customers/:id/review')
  review(@Param('id') id: string) {
    return this.crm.review(id);
  }
  @Get('customers/:id/snapshot')
  snapshot(@Param('id') id: string) {
    return this.crm.snapshot(id);
  }
  @Get('customers/:id/timeline')
  customerTimeline(@Param('id') id: string) {
    return this.crm.customerTimeline(id);
  }
  @Post('customers')
  customer(
    @Body(new ZodValidationPipe(customerSchema))
    input: z.infer<typeof customerSchema>,
    @CurrentUser() user: User,
  ) {
    return this.crm.createCustomer(user, input);
  }
  @Get('actions/:id/trace')
  trace(@Param('id') id: string, @CurrentUser() user: User) {
    return this.crm.trace(id, user);
  }
}
