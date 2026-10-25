import { create } from 'zustand';
import type {
  AuthResponse,
  LoginInput,
  RegisterInput,
  User,
} from '@crm/shared';
import { api, ApiError } from '@/lib/api';

interface AuthState {
  user: User | null;
  status: 'loading' | 'authenticated' | 'anonymous' | 'error';
  initialize: () => Promise<void>;
  login: (input: LoginInput) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
  logout: () => Promise<void>;
  clear: () => void;
}

let initialization: Promise<void> | undefined;
export const useAuthStore = create<AuthState>()((set) => ({
  user: null,
  status: 'loading',
  initialize: () => {
    initialization ??= api<AuthResponse>('/auth/me')
      .then(
        ({ user }) => {
          set({ user, status: 'authenticated' });
        },
        (error: unknown) => {
          set({
            user: null,
            status:
              error instanceof ApiError && error.status === 401
                ? 'anonymous'
                : 'error',
          });
        },
      )
      .finally(() => {
        initialization = undefined;
      });
    return initialization;
  },
  login: async (input) => {
    const { user } = await api<AuthResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    set({ user, status: 'authenticated' });
  },
  register: async (input) => {
    const { user } = await api<AuthResponse>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    set({ user, status: 'authenticated' });
  },
  logout: async () => {
    try {
      await api<void>('/auth/logout', { method: 'POST' });
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 401)) throw error;
    }
    set({ user: null, status: 'anonymous' });
  },
  clear: () => {
    set({ user: null, status: 'anonymous' });
  },
}));
