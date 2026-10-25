import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import type { NextFunction, Request, Response } from 'express';
import type { Environment } from './config/environment.js';

export function configureApp(app: INestApplication): void {
  const config = app.get<ConfigService<Environment, true>>(ConfigService);
  const origin = config.get('CLIENT_ORIGIN', { infer: true });
  app.setGlobalPrefix('api');
  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({
    origin,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
  });
  app.use((request: Request, response: Response, next: NextFunction) => {
    response.setHeader('Cache-Control', 'no-store');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      // Origin validation also covers login CSRF. CLI clients without Origin remain supported.
      if (
        (request.headers.origin && request.headers.origin !== origin) ||
        request.headers['sec-fetch-site'] === 'cross-site'
      ) {
        response.status(403).json({ message: 'Request origin is not allowed' });
        return;
      }
      if (
        !request.is('application/json') &&
        request.headers['content-length'] !== '0' &&
        request.path !== '/api/auth/logout'
      ) {
        response
          .status(415)
          .json({ message: 'Use application/json for request bodies' });
        return;
      }
    }
    next();
  });
  app.enableShutdownHooks();
}
