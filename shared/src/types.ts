import type { Role } from './roles.js';

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  createdAt: string;
}
export interface AuthResponse {
  user: User;
}
export interface UsersResponse {
  users: User[];
  total: number;
  page: number;
  pageSize: number;
}
export interface WorkspaceResponse {
  title: string;
  description: string;
  role: Role;
}
export interface ApiError {
  message: string;
  issues?: Array<{ path: string; message: string }>;
}
