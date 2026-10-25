import { create } from 'zustand';
import type { CommandType } from '@crm/shared/crm';
interface CrmSelection {
  customerId: string;
  orderId: string;
  actorId: string;
  operation: CommandType;
  selectCustomer: (customerId: string) => void;
  selectOrder: (orderId: string) => void;
  selectActor: (actorId: string) => void;
  selectOperation: (operation: CommandType) => void;
}
export const useCrmStore = create<CrmSelection>()((set) => ({
  customerId: '',
  orderId: '',
  actorId: '',
  operation: 'PUNCH_ORDER',
  selectCustomer: (customerId) => set({ customerId, orderId: '' }),
  selectOrder: (orderId) => set({ orderId }),
  selectActor: (actorId) => set({ actorId }),
  selectOperation: (operation) => set({ operation }),
}));
