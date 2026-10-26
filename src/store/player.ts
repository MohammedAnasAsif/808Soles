import { create } from 'zustand';
import { createEngine, normalizationGain, type Engine, type Source } from '../audio/engine';
import { getRadio, getStream, reportRefused, StreamError } from '../yt/api';
import type { StreamInfo, Track } from '../yt/types';
import { useSettings } from './settings';
import { useLibrary } from './library';
import { toast } from './toast';
import { diag } from '../lib/diag';

export type Repeat = 'off' | 'all' | 'one';

export interface QueueSource {
  label: string;
  /** Keep the queue topped up with similar songs. */
  radio: boolean;
}

interface PlayerState {
  queue: Track[];
  index: number;
  /** Order before shuffling, to restore. */
  unshuffled: Track[] | null;
  shuffle: boolean;
  repeat: Repeat;
  source: QueueSource | null;

  playing: boolean;
  buffering: boolean;
  loading: boolean;
  position: number;
  duration: number;
  volume: number;

  nowPlayingOpen: boolean;
  panel: 'none' | 'lyrics' | 'queue';

  current(): Track | undefined;
  playTracks(tracks: Track[], start?: number, source?: Partial<QueueSource>): void;
  /** One song, followed by its radio. */
  playRadio(track: Track): void;
  playNext(tracks: Track[]): void;
  addToQueue(tracks: Track[]): void;
  jumpTo(i: number): void;
  removeAt(i: number): void;
  move(from: number, to: number): void;
  clearUpcoming(): void;
  next(): void;
  previous(): void;
  toggle(): void;
  play(): void;
  pause(): void;
  seek(sec: number): void;
  setVolume(v: number): void;
  toggleShuffle(): void;
  cycleRepeat(): void;
  openNowPlaying(open: boolean): void;
  setPanel(p: PlayerState['panel']): void;
}

/* --------------------------- stream resolution --------------------------- */

const streamCache = new Map<string, StreamInfo>();

async function resolve(track: Track, fresh = false): Promise<StreamInfo> {
  const hit = streamCache.get(track.id);
  if (!fresh && hit && hit.expiresAt - Date.now() > 10 * 60 * 1000) return hit;
  const s = await getStream(track.id, useSettings.getState().quality);
  streamCache.set(track.id, s);
  if (streamCache.size > 50) streamCache.delete(streamCache.keys().next().value!);
  return s;
}

function toSource(track: Track, s: StreamInfo): Source {
  return {
    url: s.url,
    headers: s.headers,
    gain: useSettings.getState().normalize ? normalizationGain(s.loudnessDb) : 1,
    meta: {
      title: track.title,
      artist: track.artists.map((a) => a.name).join(', '),
      album: track.album?.name,
      artworkUrl: track.thumb,
    },
  };
}

function shuffled<T>(list: T[]): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* -------------------------------- store --------------------------------- */

let engine: Engine | null = null;
/** Increments on every load so late async results from an older load are ignored. */
let generation = 0;
/** Index of the track the engine has preloaded as "next", or -1. */
let preparedIndex = -1;
let retries = 0;
let fetchingMore = false;

export const usePlayer = create<PlayerState>((set, get) => {
  function eng(): Engine {
    if (engine) return engine;
    engine = createEngine();
    engine.setCrossfade(useSettings.getState().crossfade);
    engine.setVolume(get().volume);
    engine.setEvents({
      state: (s) => set({ playing: s.playing, buffering: s.buffering, position: s.position, duration: s.duration || get().duration }),
      advanced: () => onAdvanced(),
      ended: () => onEnded(),
      error: (msg, refused) => void onError(msg, refused),
      remote: (a, pos) => {
        if (a === 'next') get().next();
        else if (a === 'previous') get().previous();
        else if (a === 'play') get().play();
        else if (a === 'pause') get().pause();
        else if (a === 'seek' && pos != null) get().seek(pos);
      },
    });
    useSettings.subscribe((s, prev) => {
      if (s.crossfade !== prev.crossfade) engine?.setCrossfade(s.crossfade);
    });
    return engine;
  }

  function nextIndex(from = get().index): number {
    const { queue, repeat } = get();
    if (from + 1 < queue.length) return from + 1;
    if (repeat === 'all' && queue.length) return 0;
    return -1;
  }

  async function load(i: number, startAt = 0, autoplay = true) {
    const { queue } = get();
    const track = queue[i];
    if (!track) return;
    const gen = ++generation;
    preparedIndex = -1;
    set({ index: i, loading: true, position: startAt, duration: track.duration ?? 0 });
    useLibrary.getState().addRecent(track);
    try {
      const s = await resolve(track, retries > 0);
      if (gen !== generation) return;
      if (!track.duration && s.duration) set({ duration: s.duration });
      await eng().load(toSource(track, s), startAt, autoplay);
      if (gen !== generation) return;
      set({ loading: false });
      retries = 0;
      schedulePrepare(gen);
      void topUp();
    } catch (e) {
      if (gen !== generation) return;
      set({ loading: false });
      const msg = e instanceof StreamError ? e.message : 'Couldn’t play this song.';
      diag(`${track.id} "${track.title}": could not start: ${e instanceof Error ? e.message : String(e)}`);
      toast(`${track.title}: ${msg}`);
      // Skip what can't be played, unless it's the only thing left.
      const n = nextIndex(i);
      if (n >= 0 && n !== i) setTimeout(() => gen === generation && load(n), 600);
    }
  }

  /** Preload the following track a few seconds after this one starts. */
  function schedulePrepare(gen: number) {
    setTimeout(async () => {
      if (gen !== generation) return;
      const { repeat, queue, index } = get();
      if (repeat === 'one') {
        eng().prepareNext(null);
        preparedIndex = -1;
        return;
      }
      const n = nextIndex(index);
      if (n < 0) {
        eng().prepareNext(null);
        preparedIndex = -1;
        return;
      }
      const t = queue[n];
      try {
        const s = await resolve(t);
        if (gen !== generation || get().queue[n]?.id !== t.id) return;
        eng().prepareNext(toSource(t, s));
        preparedIndex = n;
      } catch {
        preparedIndex = -1; // it will be retried (and skipped if needed) at the switch
      }
    }, 3000);
  }

  /** When the queue is nearly done and it's a radio, add more like the last song. */
  async function topUp() {
    const { queue, index, source } = get();
    if (fetchingMore || !useSettings.getState().autoplay) return;
    if (queue.length - index > 3) return;
    if (source && !source.radio && get().repeat !== 'off') return;
    const seed = queue[queue.length - 1];
    if (!seed) return;
    fetchingMore = true;
    try {
      const more = await getRadio(seed.id);
      const have = new Set(get().queue.map((t) => t.id));
      const add = more.filter((t) => !have.has(t.id)).slice(0, 25);
      if (add.length) {
        set((s) => ({ queue: [...s.queue, ...add], source: s.source ? { ...s.source, radio: true } : { label: 'Autoplay', radio: true } }));
        if (preparedIndex < 0) schedulePrepare(generation);
      }
    } catch {
      /* offline or refused; try again next track */
    } finally {
      fetchingMore = false;
    }
  }

  function onAdvanced() {
    const n = preparedIndex >= 0 ? preparedIndex : nextIndex();
    preparedIndex = -1;
    if (n < 0) return;
    const track = get().queue[n];
    const gen = ++generation;
    set({ index: n, position: 0, duration: track?.duration ?? 0, loading: false });
    if (track) useLibrary.getState().addRecent(track);
    schedulePrepare(gen);
    void topUp();
  }

  function onEnded() {
    const { repeat, index } = get();
    if (repeat === 'one') {
      eng().seek(0);
      eng().play();
      return;
    }
    const n = nextIndex(index);
    if (n >= 0) void load(n);
    else set({ playing: false, position: 0 });
  }

  async function onError(msg: string, refused: boolean) {
    const t = get().current();
    if (!t) return;
    const s = streamCache.get(t.id);
    if (s) reportRefused(t.id, s.client);
    streamCache.delete(t.id);
    if (retries < 2) {
      retries++;
      void load(get().index, get().position, true);
    } else {
      retries = 0;
      toast(`${t.title}: ${refused ? 'YouTube refused the stream.' : msg}`);
      const n = nextIndex();
      if (n >= 0) void load(n);
    }
  }

  return {
    queue: [],
    index: -1,
    unshuffled: null,
    shuffle: false,
    repeat: 'off',
    source: null,
    playing: false,
    buffering: false,
    loading: false,
    position: 0,
    duration: 0,
    volume: 1,
    nowPlayingOpen: false,
    panel: 'none',

    current: () => get().queue[get().index],

    playTracks: (tracks, start = 0, source) => {
      if (!tracks.length) return;
      let queue = tracks;
      let index = start;
      if (get().shuffle) {
        const first = tracks[start];
        queue = [first, ...shuffled(tracks.filter((_, i) => i !== start))];
        index = 0;
      }
      set({
        queue,
        index,
        unshuffled: get().shuffle ? tracks : null,
        source: { label: source?.label ?? '', radio: source?.radio ?? false },
      });
      void load(index);
    },

    playRadio: (track) => {
      set({ queue: [track], index: 0, unshuffled: null, source: { label: `${track.title} Radio`, radio: true } });
      void load(0);
      getRadio(track.id)
        .then((list) => {
          if (get().queue[0]?.id !== track.id) return;
          const rest = list.filter((t) => t.id !== track.id);
          set((s) => ({ queue: [...s.queue, ...rest] }));
          if (preparedIndex < 0) schedulePrepare(generation);
        })
        .catch(() => {});
    },

    playNext: (tracks) => {
      if (get().index < 0) return get().playTracks(tracks);
      set((s) => {
        const q = [...s.queue];
        q.splice(s.index + 1, 0, ...tracks);
        return { queue: q };
      });
      schedulePrepare(generation);
      toast(tracks.length === 1 ? `“${tracks[0].title}” will play next` : `${tracks.length} songs will play next`);
    },

    addToQueue: (tracks) => {
      if (get().index < 0) return get().playTracks(tracks);
      set((s) => ({ queue: [...s.queue, ...tracks] }));
      if (preparedIndex < 0) schedulePrepare(generation);
      toast(tracks.length === 1 ? `Added “${tracks[0].title}” to the queue` : `Added ${tracks.length} songs to the queue`);
    },

    jumpTo: (i) => void load(i),

    removeAt: (i) => {
      const { index } = get();
      if (i === index) return;
      set((s) => ({ queue: s.queue.filter((_, j) => j !== i), index: i < index ? index - 1 : index }));
      schedulePrepare(generation);
    },

    move: (from, to) => {
      const { index } = get();
      if (from === index || to <= index) return;
      set((s) => {
        const q = [...s.queue];
        const [t] = q.splice(from, 1);
        q.splice(to, 0, t);
        return { queue: q };
      });
      schedulePrepare(generation);
    },

    clearUpcoming: () => {
      set((s) => ({ queue: s.queue.slice(0, s.index + 1) }));
      eng().prepareNext(null);
      preparedIndex = -1;
    },

    next: () => {
      const n = nextIndex();
      if (n >= 0) void load(n);
      else if (get().source?.radio) {
        void topUp().then(() => {
          const m = nextIndex();
          if (m >= 0) void load(m);
        });
      }
    },

    previous: () => {
      const { position, index, queue, repeat } = get();
      if (position > 3 || (index === 0 && repeat !== 'all')) {
        get().seek(0);
        return;
      }
      void load(index > 0 ? index - 1 : queue.length - 1);
    },

    toggle: () => (get().playing ? get().pause() : get().play()),
    play: () => {
      if (get().index < 0) return;
      if (!engine) return void load(get().index, get().position);
      eng().play();
    },
    pause: () => engine?.pause(),
    seek: (sec) => {
      set({ position: sec });
      engine?.seek(sec);
    },
    setVolume: (v) => {
      set({ volume: v });
      engine?.setVolume(v);
    },

    toggleShuffle: () => {
      const { shuffle, queue, index, unshuffled } = get();
      const cur = queue[index];
      if (!shuffle) {
        const upcoming = shuffled(queue.slice(index + 1));
        set({ shuffle: true, unshuffled: queue, queue: [...queue.slice(0, index + 1), ...upcoming] });
      } else {
        const base = unshuffled ?? queue;
        const i = cur ? base.findIndex((t) => t.id === cur.id) : -1;
        set({ shuffle: false, unshuffled: null, queue: i >= 0 ? base : queue, index: i >= 0 ? i : index });
      }
      if (get().index >= 0) schedulePrepare(generation);
    },

    cycleRepeat: () => {
      const r = get().repeat;
      set({ repeat: r === 'off' ? 'all' : r === 'all' ? 'one' : 'off' });
      if (get().index >= 0) schedulePrepare(generation);
    },

    openNowPlaying: (open) => set({ nowPlayingOpen: open, panel: open ? get().panel : 'none' }),
    setPanel: (p) => set({ panel: get().panel === p ? 'none' : p }),
  };
});
