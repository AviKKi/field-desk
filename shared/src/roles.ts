export const ROLES = [
  'SALES',
  'KAM',
  'WAREHOUSE',
  'ACCOUNTS',
  'ADMIN',
] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  SALES: 'Sales',
  KAM: 'Key Account Manager',
  ADMIN: 'Admin',
  WAREHOUSE: 'Warehouse Manager',
  ACCOUNTS: 'Accounts',
};

export function canAccess(
  role: Role,
  area: 'users' | 'sales' | 'accounts',
): boolean {
  return (
    role === 'ADMIN' ||
    (area === 'sales' && role === 'SALES') ||
    (area === 'accounts' && role === 'KAM')
  );
}
