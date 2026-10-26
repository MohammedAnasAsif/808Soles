import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Card, Track } from '../yt/types';

export interface UserPlaylist {
  id: string;
  name: string;
  tracks: Track[];
  createdAt: number;
  updatedAt: number;
}

export interface Library {
  liked: Track[];
  albums: Card[];
  playlists: Card[];
  artists: Card[];
  mine: UserPlaylist[];
  recent: Track[];
  recentSearches: string[];

  isLiked(id: string): boolean;
  toggleLike(t: Track): void;
  isSaved(c: Pick<Card, 'kind' | 'id'>): boolean;
  toggleSave(c: Card): void;
  addRecent(t: Track): void;
  addSearch(q: string): void;
  clearSearches(): void;
  createPlaylist(name: string, tracks?: Track[]): string;
  renamePlaylist(id: string, name: string): void;
  deletePlaylist(id: string): void;
  addToPlaylist(id: string, tracks: Track[]): void;
  removeFromPlaylist(id: string, index: number): void;
}

function slim(t: Track): Track {
  // Keep what's needed to show and play a track; nothing else.
  return {
    id: t.id,
    title: t.title,
    artists: t.artists,
    album: t.album,
    duration: t.duration,
    thumb: t.thumb,
    explicit: t.explicit,
    isVideo: t.isVideo,
  };
}

function listFor(kind: Card['kind']): 'albums' | 'playlists' | 'artists' | null {
  if (kind === 'album') return 'albums';
  if (kind === 'playlist') return 'playlists';
  if (kind === 'artist') return 'artists';
  return null;
}

export const useLibrary = create<Library>()(
  persist(
    (set, get) => ({
      liked: [],
      albums: [],
      playlists: [],
      artists: [],
      mine: [],
      recent: [],
      recentSearches: [],

      isLiked: (id) => get().liked.some((t) => t.id === id),
      toggleLike: (t) =>
        set((s) =>
          s.liked.some((x) => x.id === t.id)
            ? { liked: s.liked.filter((x) => x.id !== t.id) }
            : { liked: [slim(t), ...s.liked] },
        ),

      isSaved: (c) => {
        const k = listFor(c.kind);
        return !!k && get()[k].some((x) => x.id === c.id);
      },
      toggleSave: (c) => {
        const k = listFor(c.kind);
        if (!k) return;
        set((s) => {
          const list = s[k];
          return {
            [k]: list.some((x) => x.id === c.id)
              ? list.filter((x) => x.id !== c.id)
              : [{ kind: c.kind, id: c.id, title: c.title, subtitle: c.subtitle, thumb: c.thumb }, ...list],
          } as Partial<Library>;
        });
      },

      addRecent: (t) => set((s) => ({ recent: [slim(t), ...s.recent.filter((x) => x.id !== t.id)].slice(0, 100) })),
      addSearch: (q) => {
        const v = q.trim();
        if (!v) return;
        set((s) => ({ recentSearches: [v, ...s.recentSearches.filter((x) => x.toLowerCase() !== v.toLowerCase())].slice(0, 12) }));
      },
      clearSearches: () => set({ recentSearches: [] }),

      createPlaylist: (name, tracks = []) => {
        const id = `local-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
        const now = Date.now();
        set((s) => ({ mine: [{ id, name: name.trim() || 'New Playlist', tracks: tracks.map(slim), createdAt: now, updatedAt: now }, ...s.mine] }));
        return id;
      },
      renamePlaylist: (id, name) =>
        set((s) => ({ mine: s.mine.map((p) => (p.id === id ? { ...p, name, updatedAt: Date.now() } : p)) })),
      deletePlaylist: (id) => set((s) => ({ mine: s.mine.filter((p) => p.id !== id) })),
      addToPlaylist: (id, tracks) =>
        set((s) => ({
          mine: s.mine.map((p) =>
            p.id === id ? { ...p, tracks: [...p.tracks, ...tracks.map(slim)], updatedAt: Date.now() } : p,
          ),
        })),
      removeFromPlaylist: (id, index) =>
        set((s) => ({
          mine: s.mine.map((p) =>
            p.id === id ? { ...p, tracks: p.tracks.filter((_, i) => i !== index), updatedAt: Date.now() } : p,
          ),
        })),
    }),
    {
      name: '808soles.library',
      partialize: (s) => ({
        liked: s.liked,
        albums: s.albums,
        playlists: s.playlists,
        artists: s.artists,
        mine: s.mine,
        recent: s.recent,
        recentSearches: s.recentSearches,
      }),
    },
  ),
);
