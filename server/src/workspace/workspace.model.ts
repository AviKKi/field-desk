import type { WorkspaceResponse } from '@crm/shared';
export type WorkspaceArea = 'sales' | 'accounts';
export const workspaceDescriptions: Record<
  WorkspaceArea,
  Omit<WorkspaceResponse, 'role'>
> = {
  sales: {
    title: 'Sales workspace',
    description:
      'Create orders, submit commercial changes, and follow fulfillment at the operations desk.',
  },
  accounts: {
    title: 'Key accounts',
    description:
      'Review commercial revisions and authorized shipment corrections at the operations desk.',
  },
};
