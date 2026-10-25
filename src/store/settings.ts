import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Quality } from '../yt/api';

export interface Settings {
  crossfade: number;
  quality: Quality;
  normalize: boolean;
  /** Fetch more songs like the last one when the queue runs out. */
  autoplay: boolean;
  theme: 'system' | 'dark' | 'light';
  set(p: Partial<Omit<Settings, 'set'>>): void;
}

export const useSettings = create<Settings>()(
  persist(
    (set) => ({
      crossfade: 6,
      quality: 'high',
      normalize: true,
      autoplay: true,
      theme: 'system',
      set: (p) => set(p),
    }),
    { name: 'cadence.settings' },
  ),
);
