import { describe, it, expect, vi } from 'vitest';
import type { Track } from '../src/yt/types';

const mem = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
};
// zustand's persist reads window.localStorage.
(globalThis as Record<string, unknown>).window ??= globalThis;

const deleted: string[] = [];
let failFirst = new Set<string>();
const refused: string[] = [];

vi.mock('../src/platform/download', () => ({
  downloadsSupported: true,
  downloadFile: vi.fn(async (job: { id: string; ext: string }, onProgress: (r: number, t: number) => void) => {
    if (failFirst.has(job.id)) {
      failFirst.delete(job.id);
      throw new Error('HTTP 403');
    }
    onProgress(50, 100);
    onProgress(100, 100);
    return { path: `/dl/${job.id}.${job.ext}`, url: `file:///dl/${job.id}.${job.ext}`, size: 100 };
  }),
  deleteFile: vi.fn(async (p: string) => void deleted.push(p)),
}));

vi.mock('../src/yt/api', () => ({
  getStream: vi.fn(async (id: string) => ({
    url: `https://r1.googlevideo.com/videoplayback?id=${id}&c=VISIONOS`,
    headers: {},
    mimeType: 'audio/webm; codecs="opus"',
    bitrate: 1,
    client: 'VISIONOS',
    expiresAt: Date.now() + 3.6e6,
    loudnessDb: 3,
  })),
  reportRefused: (id: string) => void refused.push(id),
}));

const { useDownloads, localCopy } = await import('../src/store/downloads');

const t = (id: string): Track => ({ id, title: id, artists: [{ name: 'A' }] });
const settle = () => new Promise((r) => setTimeout(r, 20));

describe('downloads', () => {
  it('downloads songs and records them', async () => {
    useDownloads.getState().download([t('aaaaaaaaaaa'), t('bbbbbbbbbbb'), t('ccccccccccc')]);
    expect(Object.keys(useDownloads.getState().pending)).toHaveLength(3);
    await settle();
    const s = useDownloads.getState();
    expect(Object.keys(s.pending)).toHaveLength(0);
    expect(Object.keys(s.done).sort()).toEqual(['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc']);
    expect(localCopy('aaaaaaaaaaa')).toMatchObject({ url: 'file:///dl/aaaaaaaaaaa.webm', loudnessDb: 3 });
  });

  it('retries once through another client after a refusal', async () => {
    failFirst = new Set(['ddddddddddd']);
    useDownloads.getState().download([t('ddddddddddd')]);
    await settle();
    expect(refused).toContain('ddddddddddd');
    expect(localCopy('ddddddddddd')).toBeTruthy();
  });

  it('does not download twice, and removes files', async () => {
    useDownloads.getState().download([t('aaaaaaaaaaa')]);
    expect(useDownloads.getState().pending.aaaaaaaaaaa).toBeUndefined();
    useDownloads.getState().remove('aaaaaaaaaaa');
    expect(localCopy('aaaaaaaaaaa')).toBeUndefined();
    expect(deleted).toContain('/dl/aaaaaaaaaaa.webm');
    useDownloads.getState().removeAll();
    expect(Object.keys(useDownloads.getState().done)).toHaveLength(0);
  });

  it('persists finished downloads only', () => {
    const saved = JSON.parse(mem.get('808soles.downloads') ?? '{}');
    expect(saved.state).toHaveProperty('done');
    expect(saved.state).not.toHaveProperty('pending');
  });
});
