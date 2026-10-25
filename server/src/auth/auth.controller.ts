import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { loginSchema, registerSchema } from '@crm/shared/schemas';
import type { LoginInput, RegisterInput, User } from '@crm/shared';
import { ZodValidationPipe } from '../common/validation.pipe.js';
import type { Environment } from '../config/environment.js';
import { AuthService } from './auth.service.js';
import { CurrentUser, Public } from './auth.decorators.js';
import type { AuthenticatedRequest } from './auth.decorators.js';
import { cookieOptions, SESSION_COOKIE } from './session-cookie.js';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService<Environment, true>,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async login(
    @Body(new ZodValidationPipe(loginSchema)) input: LoginInput,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.setSession(await this.auth.login(input), response);
  }

  @Public()
  @Post('register')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async register(
    @Body(new ZodValidationPipe(registerSchema)) input: RegisterInput,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.setSession(await this.auth.register(input), response);
  }

  @Get('me')
  me(@CurrentUser() user: User) {
    return { user };
  }

  @Post('logout')
  @HttpCode(204)
  logout(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.auth.logout(request.sessionId);
    response.clearCookie(SESSION_COOKIE, cookieOptions(this.config));
  }

  private setSession(
    session: { token: string; user: User },
    response: Response,
  ) {
    response.cookie(SESSION_COOKIE, session.token, {
      ...cookieOptions(this.config),
      maxAge: this.config.get('SESSION_TTL_SECONDS', { infer: true }) * 1000,
    });
    return { user: session.user };
  }
}
