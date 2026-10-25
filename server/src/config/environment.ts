import { z } from 'zod';

const environmentSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    CLIENT_ORIGIN: z
      .url()
      .refine((value) => {
        const url = new URL(value);
        return (
          ['http:', 'https:'].includes(url.protocol) && url.origin === value
        );
      }, 'Use a single HTTP(S) origin without a trailing slash')
      .default('http://localhost:5173'),
    DATABASE_PATH: z.string().min(1).default('./data/crm-workspace.db'),
    JWT_SECRET: z
      .string()
      .min(32)
      .refine(
        (value) => !value.startsWith('replace-with-'),
        'Generate a secret with pnpm env:setup',
      ),
    SESSION_TTL_SECONDS: z.coerce
      .number()
      .int()
      .min(60)
      .max(86400)
      .default(28800),
  })
  .refine(
    (value) =>
      value.NODE_ENV !== 'production' ||
      value.CLIENT_ORIGIN.startsWith('https://'),
    {
      message: 'Production requires an HTTPS client origin',
      path: ['CLIENT_ORIGIN'],
    },
  );

export type Environment = z.infer<typeof environmentSchema>;
export function validateEnvironment(
  input: Record<string, unknown>,
): Environment {
  return environmentSchema.parse(input);
}
