import { create } from 'zustand';

interface Toast {
  id: number;
  text: string;
}

interface ToastStore {
  toasts: Toast[];
  show(text: string): void;
}

let n = 0;

export const useToast = create<ToastStore>((set) => ({
  toasts: [],
  show: (text) => {
    const id = ++n;
    set((s) => ({ toasts: [...s.toasts.slice(-2), { id, text }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 3200);
  },
}));

export const toast = (text: string) => useToast.getState().show(text);
