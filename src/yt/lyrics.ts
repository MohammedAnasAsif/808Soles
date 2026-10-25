import { getYouTubeLyrics, http } from './api';
import type { LyricLine, Lyrics, Track } from './types';

const UA = 'Cadence/0.1 (open-source music player)';

/** Parses "[mm:ss.xx] line" LRC text. Lines with several stamps repeat. */
export function parseLrc(lrc: string): LyricLine[] {
  const out: LyricLine[] = [];
  for (const raw of lrc.split(/\r?\n/)) {
    const stamps = [...raw.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    if (!stamps.length) continue;
    const text = raw.replace(/\[[^\]]*\]/g, '').trim();
    for (const s of stamps) out.push({ time: Number(s[1]) * 60 + Number(s[2]), text });
  }
  return out.sort((a, b) => a.time - b.time);
}

/** Drops "(Official Video)", "[Lyrics]" and the like, which LRCLIB doesn't know. */
export function cleanTitle(t: string): string {
  return t
    .replace(/\s*[([](official|lyric|lyrics|audio|video|visualizer|hd|4k|remaster(ed)?|mv)[^)\]]*[)\]]/gi, '')
    .replace(/\s+-\s+topic$/i, '')
    .trim();
}

interface LrclibRecord {
  syncedLyrics?: string | null;
  plainLyrics?: string | null;
  duration?: number;
  instrumental?: boolean;
}

async function lrclib(path: string): Promise<LrclibRecord | LrclibRecord[] | null> {
  const res = await http(`https://lrclib.net/api/${path}`, { headers: { 'User-Agent': UA } });
  if (!res.ok) return null;
  return res.json();
}

function fromRecord(r: LrclibRecord | null | undefined): Lyrics | null {
  if (!r) return null;
  if (r.syncedLyrics) {
    const lines = parseLrc(r.syncedLyrics);
    if (lines.length) return { synced: true, lines, source: 'LRCLIB' };
  }
  if (r.plainLyrics) {
    return {
      synced: false,
      lines: r.plainLyrics.split(/\r?\n/).map((text) => ({ time: -1, text })),
      source: 'LRCLIB',
    };
  }
  return null;
}

const memo = new Map<string, Promise<Lyrics | null>>();

export function getLyrics(track: Track, duration?: number): Promise<Lyrics | null> {
  const hit = memo.get(track.id);
  if (hit) return hit;
  const p = load(track, duration).catch(() => null);
  memo.set(track.id, p);
  if (memo.size > 100) memo.delete(memo.keys().next().value!);
  return p;
}

async function load(track: Track, duration?: number): Promise<Lyrics | null> {
  const title = cleanTitle(track.title);
  const artist = track.artists[0]?.name ?? '';
  const dur = Math.round(duration ?? track.duration ?? 0);
  const q = new URLSearchParams({ track_name: title, artist_name: artist });
  if (track.album?.name) q.set('album_name', track.album.name);
  if (dur) q.set('duration', String(dur));

  try {
    const exact = fromRecord((await lrclib(`get?${q}`)) as LrclibRecord | null);
    if (exact?.synced) return exact;
    const list = (await lrclib(`search?${new URLSearchParams({ track_name: title, artist_name: artist })}`)) as
      | LrclibRecord[]
      | null;
    if (Array.isArray(list) && list.length) {
      const close = list
        .filter((r) => !dur || !r.duration || Math.abs(r.duration - dur) <= 4)
        .sort((a, b) => Number(!!b.syncedLyrics) - Number(!!a.syncedLyrics));
      const best = fromRecord(close[0]);
      if (best) return best;
    }
    if (exact) return exact;
  } catch {
    /* fall through to YouTube's own lyrics */
  }

  const plain = await getYouTubeLyrics(track.id);
  if (plain) {
    return { synced: false, lines: plain.split(/\r?\n/).map((text) => ({ time: -1, text })), source: 'YouTube Music' };
  }
  return null;
}
