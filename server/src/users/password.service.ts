import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';

const parameters = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, parameters, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}

@Injectable()
export class PasswordService {
  private readonly dummyHash = this.hash(randomBytes(32).toString('hex'));

  async hash(password: string): Promise<string> {
    const salt = randomBytes(16);
    const key = await derive(password, salt);
    return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
  }

  async verify(password: string, hash?: string): Promise<boolean> {
    // Unknown accounts perform the same expensive password verification.
    const [, saltHex, keyHex] = (hash ?? (await this.dummyHash)).split('$');
    if (!saltHex || !keyHex) return false;
    const key = await derive(password, Buffer.from(saltHex, 'hex'));
    const expected = Buffer.from(keyHex, 'hex');
    return (
      expected.length === key.length &&
      timingSafeEqual(expected, key) &&
      hash !== undefined
    );
  }
}
