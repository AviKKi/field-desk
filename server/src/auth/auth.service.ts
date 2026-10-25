import { randomUUID } from 'node:crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { and, eq, gt, lte } from 'drizzle-orm';
import type { LoginInput, RegisterInput, User } from '@crm/shared';
import type { Environment } from '../config/environment.js';
import { DatabaseService } from '../database/database.service.js';
import { sessions } from '../database/schema.js';
import { UsersService } from '../users/users.service.js';
import { PasswordService } from '../users/password.service.js';

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly passwords: PasswordService,
    private readonly database: DatabaseService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Environment, true>,
  ) {}

  async login(input: LoginInput) {
    const user = this.users.findForLogin(input.email);
    const matches = await this.passwords.verify(
      input.password,
      user?.passwordHash,
    );
    if (!user || !matches || !user.active)
      throw new UnauthorizedException('Invalid email or password');
    const publicUser = this.users.findById(user.id);
    if (!publicUser)
      throw new UnauthorizedException('Invalid email or password');
    return this.createSession(publicUser);
  }

  async register(input: RegisterInput) {
    const user = await this.users.create({ ...input, role: 'SALES' });
    return this.createSession(user);
  }

  private async createSession(user: User) {
    const sessionId = randomUUID();
    const ttl = this.config.get('SESSION_TTL_SECONDS', { infer: true });
    const token = await this.jwt.signAsync(
      {},
      { subject: user.id, jwtid: sessionId, expiresIn: ttl },
    );
    const now = Math.floor(Date.now() / 1000);
    this.database.db.transaction((tx) => {
      tx.delete(sessions).where(lte(sessions.expiresAt, now)).run();
      tx.insert(sessions)
        .values({ id: sessionId, userId: user.id, expiresAt: now + ttl })
        .run();
    });
    return { token, user };
  }

  async authenticate(
    token: string,
  ): Promise<{ user: User; sessionId: string }> {
    let payload: { sub?: unknown; jti?: unknown };
    try {
      payload = await this.jwt.verifyAsync(token);
    } catch {
      throw new UnauthorizedException(
        'Your session has expired. Sign in again.',
      );
    }
    if (typeof payload.sub !== 'string' || typeof payload.jti !== 'string')
      throw new UnauthorizedException('Invalid session');
    const session = this.database.db
      .select()
      .from(sessions)
      .where(
        and(
          eq(sessions.id, payload.jti),
          eq(sessions.userId, payload.sub),
          gt(sessions.expiresAt, Math.floor(Date.now() / 1000)),
        ),
      )
      .get();
    const user = session ? this.users.findById(session.userId) : undefined;
    if (!session || !user?.active)
      throw new UnauthorizedException(
        'Your session has expired. Sign in again.',
      );
    return { user, sessionId: session.id };
  }

  logout(sessionId: string) {
    this.database.db.delete(sessions).where(eq(sessions.id, sessionId)).run();
  }
}
