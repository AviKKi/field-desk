import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Role } from '@crm/shared';
import { AuthService } from './auth.service.js';
import { ALLOWED_ROLES, PUBLIC_ROUTE } from './auth.decorators.js';
import type { AuthenticatedRequest } from './auth.decorators.js';
import { SESSION_COOKIE } from './session-cookie.js';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (
      this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [
        context.getHandler(),
        context.getClass(),
      ])
    )
      return true;
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const cookies: Record<string, unknown> = request.cookies as Record<
      string,
      unknown
    >;
    const token = cookies?.[SESSION_COOKIE];
    if (typeof token !== 'string')
      throw new UnauthorizedException('Sign in to continue');
    const session = await this.auth.authenticate(token);
    request.user = session.user;
    request.sessionId = session.sessionId;
    return true;
  }
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}
  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<Role[]>(ALLOWED_ROLES, [
      context.getHandler(),
      context.getClass(),
    ]);
    return (
      !roles ||
      roles.includes(
        context.switchToHttp().getRequest<AuthenticatedRequest>().user.role,
      )
    );
  }
}
