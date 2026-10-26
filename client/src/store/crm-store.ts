import { create } from 'zustand';
interface CrmSelection {
  actorId: string;
  selectActor: (actorId: string) => void;
}
export const useCrmStore = create<CrmSelection>()((set) => ({
  actorId: '',
  selectActor: (actorId) => set({ actorId }),
}));
