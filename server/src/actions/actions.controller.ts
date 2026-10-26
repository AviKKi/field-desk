import { Body, Controller, Post } from '@nestjs/common';
import { ActionsService } from './actions.service.js';
import { CurrentUser } from '../auth/auth.decorators.js';
import type { User } from '@crm/shared';
import { ZodValidationPipe } from '../common/validation.pipe.js';
import { actionEnvelopeSchema } from '@crm/shared/crm';
import type { ActionEnvelope } from '@crm/shared/crm';
@Controller('crm/actions')
export class ActionsController {
  constructor(private readonly service: ActionsService) {}
  @Post() execute(
    @Body(new ZodValidationPipe(actionEnvelopeSchema)) input: ActionEnvelope,
    @CurrentUser() user: User,
  ) {
    return this.service.execute(input, user);
  }
}
