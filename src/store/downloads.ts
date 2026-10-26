import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { SeekIndex, Track } from '../yt/types';
import { getStream, reportRefused } from '../yt/api';
import { deleteFile, downloadFile, downloadsSupported } from '../platform/download';
import { platform } from '../platform';
import { diag } from '../lib/diag';
import { toast } from './toast';

export interface Downloaded {
  track: Track;
  path: string;
  url: string;
  size: number;
  /** YouTube's loudness figure, kept for Sound Check offline. */
  loudnessDb?: number;
  /** For seeking on Android. */
  index?: SeekIndex;
  at: number;
}

export interface Pending {
  track: Track;
  /** 0..1, or -1 while waiting in the queue. */
  progress: number;
}

interface DownloadsStore {
  done: Record<string, Downloaded>;
  pending: Record<string, Pending>;
  download(tracks: Track[]): void;
  remove(id: string): void;
  removeAll(): void;
  cancel(id: string): void;
}

const CONCURRENCY = 2;

/** Failures close together become one message instead of one per song. */
let failed: string[] = [];
let failTimer: ReturnType<typeof setTimeout> | null = null;
function reportFailure(title: string) {
  failed.push(title);
  if (failTimer) clearTimeout(failTimer);
  failTimer = setTimeout(() => {
    toast(failed.length === 1 ? `Couldn’t download “${failed[0]}”` : `Couldn’t download ${failed.length} songs. See Settings → Diagnostics.`);
    failed = [];
    failTimer = null;
  }, 1500);
}
const queue: Track[] = [];
let active = 0;

function extFor(mime: string): string {
  if (mime.includes('webm')) return 'webm';
  if (mime.includes('mp4')) return 'm4a';
  return 'audio';
}

export const useDownloads = create<DownloadsStore>()(
  persist(
    (set, get) => {
      function pump() {
        while (active < CONCURRENCY && queue.length) {
          const t = queue.shift()!;
          if (!get().pending[t.id]) continue; // cancelled
          active++;
          void run(t).finally(() => {
            active--;
            pump();
          });
        }
      }

      async function run(t: Track) {
        const setProgress = (p: number) =>
          set((s) => (s.pending[t.id] ? { pending: { ...s.pending, [t.id]: { track: t, progress: p } } } : s));
        setProgress(0);
        // Two attempts: a URL YouTube refuses gets re-resolved through another client.
        for (let attempt = 0; attempt < 2; attempt++) {
          let stream;
          try {
            stream = await getStream(t.id, 'high');
            const file = await downloadFile(
              { id: t.id, url: stream.url, headers: stream.headers, ext: extFor(stream.mimeType), size: stream.size },
              (received, total) => setProgress(total ? received / total : 0),
            );
            if (!get().pending[t.id]) {
              // Cancelled while downloading.
              void deleteFile(file.path).catch(() => {});
              return;
            }
            set((s) => {
              const pending = { ...s.pending };
              delete pending[t.id];
              return {
                pending,
                done: {
                  ...s.done,
                  [t.id]: { track: t, path: file.path, url: file.url, size: file.size, loudnessDb: stream!.loudnessDb, index: stream!.index, at: Date.now() },
                },
              };
            });
            diag(`${t.id} downloaded (${Math.round(file.size / 1024)} KB)`);
            return;
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            diag(`${t.id} download failed (attempt ${attempt + 1}): ${msg}`);
            if (stream) reportRefused(t.id, stream.client);
            if (attempt === 1) {
              set((s) => {
                const pending = { ...s.pending };
                delete pending[t.id];
                return { pending };
              });
              reportFailure(t.title);
            }
          }
        }
      }

      return {
        done: {},
        pending: {},

        download: (tracks) => {
          if (!downloadsSupported) {
            toast('Downloads work in the Windows and Android apps.');
            return;
          }
          const fresh = tracks.filter((t) => !get().done[t.id] && !get().pending[t.id]);
          if (!fresh.length) {
            toast(tracks.length === 1 ? 'Already downloaded' : 'All of these are already downloaded');
            return;
          }
          set((s) => {
            const pending = { ...s.pending };
            for (const t of fresh) pending[t.id] = { track: t, progress: -1 };
            return { pending };
          });
          queue.push(...fresh);
          toast(fresh.length === 1 ? `Downloading “${fresh[0].title}”` : `Downloading ${fresh.length} songs`);
          pump();
        },

        remove: (id) => {
          const d = get().done[id];
          if (!d) return;
          void deleteFile(d.path).catch(() => {});
          set((s) => {
            const done = { ...s.done };
            delete done[id];
            return { done };
          });
        },

        removeAll: () => {
          for (const d of Object.values(get().done)) void deleteFile(d.path).catch(() => {});
          set({ done: {} });
        },

        cancel: (id) =>
          set((s) => {
            const pending = { ...s.pending };
            delete pending[id];
            return { pending };
          }),
      };
    },
    {
      name: '808soles.downloads',
      partialize: (s) => ({ done: s.done }),
    },
  ),
);

/** A downloaded copy of this track, if there is one. */
export function localCopy(id: string): Downloaded | undefined {
  const d = useDownloads.getState().done[id];
  if (!d) return undefined;
  // Windows builds before the app:// scheme stored file:// URLs; the page can
  // no longer load those, so serve the same file through app://media.
  if (platform === 'electron' && d.url.startsWith('file:')) {
    const name = d.url.split('/').pop() ?? '';
    return { ...d, url: `app://media/${name}` };
  }
  return d;
}

/** The file failed to play (deleted outside the app, say): forget it. */
export function forgetLocal(id: string) {
  useDownloads.setState((s) => {
    if (!s.done[id]) return s;
    const done = { ...s.done };
    delete done[id];
    return { done };
  });
}
