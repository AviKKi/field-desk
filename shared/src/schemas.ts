import { z } from 'zod';
import { ROLES } from './roles.js';

export const roleSchema = z.enum(ROLES);

const email = z.string().trim().toLowerCase().email().max(254);
const password = z.string().min(12, 'Use at least 12 characters').max(128);
export const loginSchema = z
  .object({ email, password: z.string().min(1).max(128) })
  .strict();
export const registerSchema = z
  .object({ name: z.string().trim().min(2).max(100), email, password })
  .strict();
export const createUserSchema = registerSchema.extend({ role: roleSchema });
export const updateUserSchema = z
  .object({ role: roleSchema.optional(), active: z.boolean().optional() })
  .strict()
  .refine((value) => value.role !== undefined || value.active !== undefined, {
    message: 'Provide a role or account status',
  });
export const listUsersSchema = z
  .object({
    search: z.string().trim().max(100).default(''),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type ListUsersInput = z.infer<typeof listUsersSchema>;
