import type { CookieOptions } from 'express';
import type { ConfigService } from '@nestjs/config';
import type { Environment } from '../config/environment.js';

export const SESSION_COOKIE = 'crm_session';
export function cookieOptions(
  config: ConfigService<Environment, true>,
): CookieOptions {
  return {
    httpOnly: true,
    secure: config.get('NODE_ENV', { infer: true }) === 'production',
    sameSite: 'strict',
    path: '/api',
  };
}
