import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const target = new URL('../server/.env', import.meta.url);
if (!existsSync(target)) {
  const example = readFileSync(
    new URL('../server/.env.example', import.meta.url),
    'utf8',
  );
  writeFileSync(
    target,
    example.replace(
      'replace-with-a-random-secret-of-at-least-32-characters',
      randomBytes(48).toString('hex'),
    ),
    { mode: 0o600 },
  );
  console.log('Created server/.env with a random JWT secret.');
} else {
  console.log('Keeping existing server/.env.');
}
console.log('Next: pnpm db:migrate, pnpm admin:create, then pnpm dev.');
