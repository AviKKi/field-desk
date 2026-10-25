import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { actionEnvelopeSchema, SCENARIOS } from '@crm/shared/crm';
import type { ActionEnvelope } from '@crm/shared/crm';
import type { User } from '@crm/shared';
import { CurrentUser, Roles } from '../auth/auth.decorators.js';
import { ZodValidationPipe } from '../common/validation.pipe.js';
import { CrmService } from './crm.service.js';

const customerSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    code: z.string().trim().min(2).max(40),
  })
  .strict();
const resetSchema = z
  .object({ confirmation: z.literal('RESET CRM DATA') })
  .strict();
const scenarioSchema = z.enum(SCENARIOS.map(([id]) => id));
const sampleSchema = z.object({ scenarioId: scenarioSchema }).strict();

@Controller('crm')
export class CrmController {
  constructor(private readonly crm: CrmService) {}
  @Roles('ADMIN')
  @Post('samples')
  startSample(
    @Body(new ZodValidationPipe(sampleSchema))
    input: z.infer<typeof sampleSchema>,
    @CurrentUser() user: User,
  ) {
    return this.crm.startSample(input.scenarioId, user);
  }
  @Roles('ADMIN')
  @Post('samples/:id/step')
  stepSample(@Param('id') id: string, @CurrentUser() user: User) {
    return this.crm.advanceSample(id, user);
  }
  @Roles('ADMIN')
  @Post('samples/:id/run')
  finishSample(@Param('id') id: string, @CurrentUser() user: User) {
    return this.crm.advanceSample(id, user, true);
  }
  @Get('bootstrap')
  bootstrap(@CurrentUser() user: User) {
    return this.crm.bootstrap(user);
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
  @Roles('ADMIN')
  @Post('seed')
  seed(@CurrentUser() user: User) {
    return this.crm.seed(user);
  }
  @Roles('ADMIN')
  @Post('reset')
  reset(
    @Body(new ZodValidationPipe(resetSchema))
    input: z.infer<typeof resetSchema>,
    @CurrentUser() user: User,
  ) {
    return this.crm.reset(user, input.confirmation);
  }
  @Roles('ADMIN')
  @Post('scenarios/:id/run')
  scenario(
    @Param('id', new ZodValidationPipe(scenarioSchema)) id: string,
    @CurrentUser() user: User,
  ) {
    return this.crm.scenario(id, user);
  }
}
