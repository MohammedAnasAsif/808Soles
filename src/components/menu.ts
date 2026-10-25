import { create } from 'zustand';
import type { Card, Track } from '../yt/types';

export interface MenuTarget {
  track?: Track;
  card?: Card;
  /** When the menu is for a row in one of the user's playlists. */
  playlist?: { id: string; index: number };
  /** Screen point the menu was opened from (desktop popover). */
  at?: { x: number; y: number };
}

interface MenuStore {
  target: MenuTarget | null;
  /** "Add to playlist" picker. */
  picker: Track[] | null;
  open(t: MenuTarget): void;
  close(): void;
  pick(tracks: Track[] | null): void;
}

export const useMenu = create<MenuStore>((set) => ({
  target: null,
  picker: null,
  open: (target) => set({ target }),
  close: () => set({ target: null }),
  pick: (picker) => set({ picker, target: null }),
}));

export function openMenu(e: { clientX?: number; clientY?: number; preventDefault?(): void; stopPropagation?(): void } | null, t: MenuTarget) {
  e?.preventDefault?.();
  e?.stopPropagation?.();
  useMenu.getState().open({ ...t, at: e?.clientX != null ? { x: e.clientX, y: e.clientY ?? 0 } : undefined });
}
