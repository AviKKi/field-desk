import 'reflect-metadata';
import { stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { NestFactory } from '@nestjs/core';
import { registerSchema } from '@crm/shared/schemas';
import { AppModule } from '../app.module.js';
import { UsersService } from '../users/users.service.js';

async function prompt(label: string, hidden = false): Promise<string> {
  let muted = false;
  const output = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      if (!muted) stdout.write(chunk);
      callback();
    },
  });
  const reader = createInterface({
    input: stdin,
    output,
    terminal: Boolean(stdin.isTTY),
  });
  const answer = reader.question(label);
  muted = hidden;
  try {
    return await answer;
  } finally {
    reader.close();
    if (hidden) stdout.write('\n');
  }
}

const app = await NestFactory.createApplicationContext(AppModule, {
  logger: ['error', 'warn'],
});
try {
  const name = process.env.ADMIN_NAME ?? (await prompt('Admin name: '));
  const email = process.env.ADMIN_EMAIL ?? (await prompt('Admin email: '));
  const password =
    process.env.ADMIN_PASSWORD ??
    (await prompt('Password (at least 12 characters, hidden): ', true));
  const input = registerSchema.parse({ name, email, password });
  const service = app.get(UsersService);
  if (service.findForLogin(input.email))
    throw new Error(
      'Email already exists. Existing accounts are never promoted by this command.',
    );
  const user = await service.create({ ...input, role: 'ADMIN' });
  console.log(`Created admin ${user.email}.`);
} catch (error) {
  console.error(
    error instanceof Error ? error.message : 'Could not create admin',
  );
  process.exitCode = 1;
} finally {
  await app.close();
}
