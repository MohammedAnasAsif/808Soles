import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { EngineEvents, Source } from '../src/audio/engine';
import type { Track } from '../src/yt/types';

// localStorage for zustand persist
const mem = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
};

const calls: { op: string; arg?: unknown }[] = [];
let events: EngineEvents;
const engine = {
  load: vi.fn(async (src: Source, startAt: number) => void calls.push({ op: 'load', arg: [src.meta.title, startAt] })),
  prepareNext: vi.fn((src: Source | null) => void calls.push({ op: 'next', arg: src?.meta.title ?? null })),
  play: vi.fn(),
  pause: vi.fn(),
  seek: vi.fn((s: number) => void calls.push({ op: 'seek', arg: s })),
  setCrossfade: vi.fn(),
  setVolume: vi.fn(),
  stop: vi.fn(),
  setEvents: (e: EngineEvents) => (events = e),
};

vi.mock('../src/audio/engine', () => ({
  createEngine: () => engine,
  normalizationGain: () => 1,
}));

const refused: string[] = [];
let failIds = new Set<string>();
vi.mock('../src/yt/api', () => ({
  getStream: vi.fn(async (id: string) => {
    if (failIds.has(id)) throw new Error('nope');
    return { url: `https://x/${id}?c=VISIONOS`, headers: {}, mimeType: 'audio/webm', bitrate: 1, client: 'VISIONOS', expiresAt: Date.now() + 3.6e6 };
  }),
  getRadio: vi.fn(async () => [t('r1'), t('r2'), t('r3'), t('r4'), t('r5')]),
  reportRefused: (id: string) => void refused.push(id),
  StreamError: class extends Error {},
}));

function t(id: string): Track {
  return { id, title: id.toUpperCase(), artists: [{ name: 'A' }], duration: 200 };
}

const { usePlayer } = await import('../src/store/player');
const { useSettings } = await import('../src/store/settings');

const flush = () => vi.advanceTimersByTimeAsync(1);

describe('player queue', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    calls.length = 0;
    failIds = new Set();
    useSettings.setState({ autoplay: false });
    usePlayer.setState({ queue: [], index: -1, shuffle: false, repeat: 'off', unshuffled: null, position: 0 });
  });

  async function settle(ms = 3100) {
    await vi.advanceTimersByTimeAsync(ms);
  }

  it('plays, preloads the next track, and advances', async () => {
    usePlayer.getState().playTracks([t('a'), t('b'), t('c')], 0, { label: 'X' });
    await settle();
    expect(calls).toEqual([
      { op: 'load', arg: ['A', 0] },
      { op: 'next', arg: 'B' },
    ]);
    events.advanced();
    expect(usePlayer.getState().index).toBe(1);
    await settle();
    expect(calls.at(-1)).toEqual({ op: 'next', arg: 'C' });
    events.advanced();
    await settle();
    expect(usePlayer.getState().index).toBe(2);
    expect(calls.at(-1)).toEqual({ op: 'next', arg: null });
  });

  it('ended without a preload loads the next one', async () => {
    usePlayer.getState().playTracks([t('a'), t('b')], 0);
    await flush();
    events.ended();
    await settle(10);
    expect(usePlayer.getState().index).toBe(1);
    expect(calls.filter((c) => c.op === 'load').at(-1)).toEqual({ op: 'load', arg: ['B', 0] });
  });

  it('repeat one replays', async () => {
    usePlayer.getState().playTracks([t('a'), t('b')], 0);
    usePlayer.getState().cycleRepeat();
    usePlayer.getState().cycleRepeat();
    expect(usePlayer.getState().repeat).toBe('one');
    await settle();
    expect(calls.at(-1)).toEqual({ op: 'next', arg: null });
    events.ended();
    expect(calls.at(-1)).toEqual({ op: 'seek', arg: 0 });
  });

  it('repeat all wraps around', async () => {
    usePlayer.getState().playTracks([t('a'), t('b')], 1);
    usePlayer.getState().cycleRepeat();
    await settle();
    expect(calls.at(-1)).toEqual({ op: 'next', arg: 'A' });
  });

  it('skips a track it cannot resolve', async () => {
    // Fresh ids: streams for a/b are cached by earlier tests.
    failIds = new Set(['bad']);
    usePlayer.getState().playTracks([t('bad'), t('good')], 0);
    await settle(700);
    expect(usePlayer.getState().index).toBe(1);
    expect(calls.find((c) => c.op === 'load')).toEqual({ op: 'load', arg: ['GOOD', 0] });
  });

  it('a refused stream is re-resolved at the same position', async () => {
    usePlayer.getState().playTracks([t('a'), t('b')], 0);
    await flush();
    usePlayer.setState({ position: 42 });
    events.error('403', true);
    await flush();
    expect(refused).toContain('a');
    expect(calls.filter((c) => c.op === 'load').at(-1)).toEqual({ op: 'load', arg: ['A', 42] });
  });

  it('previous restarts after 3 seconds, else goes back', async () => {
    usePlayer.getState().playTracks([t('a'), t('b')], 1);
    await flush();
    usePlayer.setState({ position: 10 });
    usePlayer.getState().previous();
    expect(calls.at(-1)).toEqual({ op: 'seek', arg: 0 });
    usePlayer.setState({ position: 1 });
    usePlayer.getState().previous();
    await flush();
    expect(usePlayer.getState().index).toBe(0);
  });

  it('play next inserts after the current track', async () => {
    usePlayer.getState().playTracks([t('a'), t('b')], 0);
    usePlayer.getState().playNext([t('z')]);
    expect(usePlayer.getState().queue.map((x) => x.id)).toEqual(['a', 'z', 'b']);
  });

  it('shuffle keeps the current track and restores order', async () => {
    const list = 'abcdefgh'.split('').map(t);
    usePlayer.getState().playTracks(list, 2);
    usePlayer.getState().toggleShuffle();
    const s = usePlayer.getState();
    expect(s.queue[s.index].id).toBe('c');
    expect(new Set(s.queue.map((x) => x.id)).size).toBe(8);
    usePlayer.getState().toggleShuffle();
    expect(usePlayer.getState().queue.map((x) => x.id).join('')).toBe('abcdefgh');
    expect(usePlayer.getState().index).toBe(2);
  });

  it('radio tops up the queue near the end', async () => {
    useSettings.setState({ autoplay: true });
    usePlayer.getState().playTracks([t('a'), t('b')], 0, { radio: true });
    await settle();
    expect(usePlayer.getState().queue.length).toBe(7);
  });
});
