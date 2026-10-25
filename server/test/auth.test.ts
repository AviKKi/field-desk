import 'reflect-metadata';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { eq } from 'drizzle-orm';
import type { AuthResponse, User, UsersResponse } from '@crm/shared';
import { DatabaseService } from '../src/database/database.service.js';
import { sessions, users } from '../src/database/schema.js';
import { UsersService } from '../src/users/users.service.js';
import { configureApp } from '../src/configure-app.js';
import { validateEnvironment } from '../src/config/environment.js';

const directory = mkdtempSync(join(tmpdir(), 'crm-workspace-api-'));
process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = join(directory, 'test.db');
process.env.JWT_SECRET = 'test-secret-only-'.repeat(4);
process.env.CLIENT_ORIGIN = 'http://localhost:5173';

describe(
  'Authentication and role enforcement (real SQLite + HTTP)',
  { concurrency: false },
  () => {
    let app: INestApplication;
    let database: DatabaseService;
    let service: UsersService;
    let admin: User;
    let sales: User;
    let kam: User;
    let adminCookie: string;
    let salesCookie: string;
    let kamCookie: string;
    const password = 'a-long-test-passphrase';

    function cookie(headers: Record<string, unknown>) {
      const header = headers['set-cookie'];
      assert.ok(Array.isArray(header) && typeof header[0] === 'string');
      return header[0].split(';')[0] as string;
    }
    const http = () => request(app.getHttpServer());

    before(async () => {
      const { AppModule } = await import('../src/app.module.js');
      const module = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();
      app = module.createNestApplication({ logger: false });
      configureApp(app);
      database = app.get(DatabaseService);
      migrate(database.db, { migrationsFolder: resolve('drizzle') });
      // Re-applying committed migrations must be safe.
      migrate(database.db, { migrationsFolder: resolve('drizzle') });
      service = app.get(UsersService);
      admin = await service.create({
        name: 'Admin User',
        email: 'admin@example.test',
        password,
        role: 'ADMIN',
      });
      sales = await service.create({
        name: 'Sales User',
        email: 'sales@example.test',
        password,
        role: 'SALES',
      });
      kam = await service.create({
        name: 'KAM User',
        email: 'kam@example.test',
        password,
        role: 'KAM',
      });
      await app.init();
      adminCookie = cookie(
        (
          await http()
            .post('/api/auth/login')
            .send({ email: admin.email, password })
            .expect(200)
        ).headers,
      );
      salesCookie = cookie(
        (
          await http()
            .post('/api/auth/login')
            .send({ email: sales.email, password })
            .expect(200)
        ).headers,
      );
      kamCookie = cookie(
        (
          await http()
            .post('/api/auth/login')
            .send({ email: kam.email, password })
            .expect(200)
        ).headers,
      );
    });

    after(async () => {
      if (app) await app.close();
      rmSync(directory, { recursive: true, force: true });
    });

    it('validates secrets and production origins at startup', () => {
      assert.throws(() => validateEnvironment({ JWT_SECRET: 'short' }));
      assert.throws(() =>
        validateEnvironment({
          JWT_SECRET: 'replace-with-a-random-secret-of-at-least-32-characters',
        }),
      );
      assert.throws(() =>
        validateEnvironment({
          JWT_SECRET: 'x'.repeat(40),
          NODE_ENV: 'production',
          CLIENT_ORIGIN: 'http://example.com',
        }),
      );
    });

    it('requires authentication by default', async () => {
      await http().get('/api/health').expect(200);
      for (const path of [
        '/api/auth/me',
        '/api/users',
        '/api/workspace/sales',
        '/api/workspace/accounts',
      ])
        await http().get(path).expect(401);
    });

    it('registers normalized emails as Sales and protects password storage', async () => {
      const response = await http()
        .post('/api/auth/register')
        .send({ name: 'New Member', email: ' NEW@EXAMPLE.TEST ', password })
        .expect(201);
      const body = response.body as AuthResponse;
      assert.equal(body.user.email, 'new@example.test');
      assert.equal(body.user.role, 'SALES');
      assert.ok(!('passwordHash' in body.user));
      assert.ok(!('token' in response.body));
      const stored = database.db
        .select()
        .from(users)
        .where(eq(users.id, body.user.id))
        .get();
      assert.ok(stored);
      assert.ok(stored.passwordHash.startsWith('scrypt$'));
      assert.ok(!stored.passwordHash.includes(password));
      const setCookie = response.headers['set-cookie'] as unknown as string[];
      assert.match(setCookie[0] ?? '', /HttpOnly/);
      assert.match(setCookie[0] ?? '', /SameSite=Strict/);
      assert.match(setCookie[0] ?? '', /Path=\/api/);
      await http()
        .get('/api/auth/me')
        .set('Cookie', cookie(response.headers))
        .expect(200);
      await http()
        .post('/api/auth/register')
        .send({ name: 'Duplicate', email: 'NEW@example.test', password })
        .expect(409);
    });

    it('rejects privilege injection, unknown fields and short passwords', async () => {
      await http()
        .post('/api/auth/register')
        .send({
          name: 'Hacker',
          email: 'evil@example.test',
          password,
          role: 'ADMIN',
        })
        .expect(400);
      await http()
        .post('/api/auth/register')
        .send({ name: 'Short', email: 'short@example.test', password: 'short' })
        .expect(400);
      await http()
        .post('/api/auth/login')
        .send({ email: sales.email, password, extra: true })
        .expect(400);
    });

    it('returns the same error for unknown accounts and incorrect passwords', async () => {
      const badPassword = await http()
        .post('/api/auth/login')
        .send({ email: sales.email, password: 'incorrect' })
        .expect(401);
      const unknown = await http()
        .post('/api/auth/login')
        .send({ email: 'missing@example.test', password })
        .expect(401);
      assert.equal(badPassword.body.message, unknown.body.message);
      await http()
        .get('/api/auth/me')
        .set('Cookie', 'crm_session=tampered.token.signature')
        .expect(401);
    });

    it('enforces Sales, KAM and Admin access on the server', async () => {
      await http()
        .get('/api/workspace/sales')
        .set('Cookie', salesCookie)
        .expect(200);
      await http()
        .get('/api/workspace/accounts')
        .set('Cookie', salesCookie)
        .expect(403);
      await http().get('/api/users').set('Cookie', salesCookie).expect(403);
      await http()
        .post('/api/users')
        .set('Cookie', salesCookie)
        .send({
          name: 'New User',
          email: 'no@example.test',
          password,
          role: 'ADMIN',
        })
        .expect(403);
      await http()
        .patch(`/api/users/${kam.id}`)
        .set('Cookie', salesCookie)
        .send({ role: 'ADMIN' })
        .expect(403);
      await http()
        .get('/api/workspace/accounts')
        .set('Cookie', kamCookie)
        .expect(200);
      await http()
        .get('/api/workspace/sales')
        .set('Cookie', kamCookie)
        .expect(403);
      await http().get('/api/users').set('Cookie', kamCookie).expect(403);
      for (const path of [
        '/api/workspace/sales',
        '/api/workspace/accounts',
        '/api/users',
      ])
        await http().get(path).set('Cookie', adminCookie).expect(200);
    });

    it('validates admin changes and returns only public user fields', async () => {
      const response = await http()
        .get('/api/users?search=KAM&pageSize=1')
        .set('Cookie', adminCookie)
        .expect(200);
      const body = response.body as UsersResponse;
      assert.equal(body.total, 1);
      assert.equal(body.users[0]?.id, kam.id);
      assert.ok(!JSON.stringify(body).includes('password'));
      await http()
        .get('/api/users?search=%25')
        .set('Cookie', adminCookie)
        .expect(200)
        .expect(({ body: value }: { body: UsersResponse }) =>
          assert.equal(value.total, 0),
        );
      await http()
        .get('/api/users?pageSize=1000')
        .set('Cookie', adminCookie)
        .expect(400);
      await http()
        .patch(`/api/users/${admin.id}`)
        .set('Cookie', adminCookie)
        .send({ active: false })
        .expect(400);
      await http()
        .patch(`/api/users/${kam.id}`)
        .set('Cookie', adminCookie)
        .send({ role: 'OWNER' })
        .expect(400);
      await http()
        .patch(`/api/users/${kam.id}`)
        .set('Cookie', adminCookie)
        .send({ passwordHash: 'oops' })
        .expect(400);
      await http()
        .patch('/api/users/not-a-uuid')
        .set('Cookie', adminCookie)
        .send({ role: 'SALES' })
        .expect(400);
    });

    it('allows admin creation and revokes sessions when a role changes', async () => {
      const created = await http()
        .post('/api/users')
        .set('Cookie', adminCookie)
        .send({
          name: 'Managed Member',
          email: 'managed@example.test',
          password,
          role: 'KAM',
        })
        .expect(201);
      assert.equal((created.body as AuthResponse).user.role, 'KAM');
      await http()
        .patch(`/api/users/${sales.id}`)
        .set('Cookie', adminCookie)
        .send({ role: 'KAM' })
        .expect(200);
      await http().get('/api/auth/me').set('Cookie', salesCookie).expect(401);
      const response = await http()
        .post('/api/auth/login')
        .send({ email: sales.email, password })
        .expect(200);
      salesCookie = cookie(response.headers);
      await http()
        .get('/api/workspace/accounts')
        .set('Cookie', salesCookie)
        .expect(200);
      await http()
        .get('/api/workspace/sales')
        .set('Cookie', salesCookie)
        .expect(403);
    });

    it('deactivates accounts immediately and rejects future sign-ins', async () => {
      await http()
        .patch(`/api/users/${kam.id}`)
        .set('Cookie', adminCookie)
        .send({ active: false })
        .expect(200);
      await http().get('/api/auth/me').set('Cookie', kamCookie).expect(401);
      await http()
        .post('/api/auth/login')
        .send({ email: kam.email, password })
        .expect(401);
      await http()
        .patch(`/api/users/${kam.id}`)
        .set('Cookie', adminCookie)
        .send({ active: true })
        .expect(200);
      await http().get('/api/auth/me').set('Cookie', kamCookie).expect(401);
    });

    it('rejects cross-origin writes, including login CSRF', async () => {
      await http()
        .post('/api/auth/login')
        .set('Origin', 'https://untrusted.test')
        .send({ email: admin.email, password })
        .expect(403);
      await http()
        .post('/api/auth/logout')
        .set('Cookie', adminCookie)
        .set('Sec-Fetch-Site', 'cross-site')
        .expect(403);
      await http()
        .post('/api/users')
        .set('Cookie', adminCookie)
        .type('form')
        .send({ name: 'Bad' })
        .expect(415);
      await http().get('/api/auth/me').set('Cookie', adminCookie).expect(200);
    });

    it('invalidates JWTs at logout and after database session expiry', async () => {
      await http()
        .post('/api/auth/logout')
        .set('Cookie', salesCookie)
        .set('Origin', 'http://localhost:5173')
        .expect(204);
      await http().get('/api/auth/me').set('Cookie', salesCookie).expect(401);
      database.db
        .update(sessions)
        .set({ expiresAt: 0 })
        .where(eq(sessions.userId, admin.id))
        .run();
      await http().get('/api/auth/me').set('Cookie', adminCookie).expect(401);
    });

    it('rate limits credential guessing', async () => {
      let limited = false;
      for (let attempt = 0; attempt < 11; attempt++) {
        const response = await http()
          .post('/api/auth/login')
          .send({ email: 'missing@example.test', password });
        if (response.status === 429) {
          limited = true;
          break;
        }
        assert.equal(response.status, 401);
      }
      assert.ok(limited);
    });
  },
);
