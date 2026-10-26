/**
 * The app's YouTube Music API. All network goes through `platformFetch`, so
 * requests are made natively (Electron main process / Android plugin) and are
 * not limited by CORS.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Innertube, Platform, YTNodes, Constants, UniversalCache } from 'youtubei.js';
import type { Types } from 'youtubei.js';
import { platformFetch } from '../platform';
import { diag } from '../lib/diag';
import {
  albumFrom,
  artistFrom,
  playlistFrom,
  searchFrom,
  shelvesFrom,
  trackFromPanel,
  trackFromListItem,
} from './normalize';
import type { AlbumPage, ArtistPage, PlaylistPage, SearchResults, SeekIndex, Shelf, StreamInfo, Track } from './types';

/*
 * Our requests are made natively (Electron's main process, Android's HTTP
 * stack), not by a browser, so YouTube.js should behave as it does on a
 * server: set User-Agent and Origin itself instead of leaving them to the
 * browser.
 */
Platform.shim.server = true;

/* YouTube.js runs a few lines of the YouTube player to decipher stream URLs.
   The script it builds ends with its own `return process(...)`. */
Platform.shim.eval = (data: { output: string }) => {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return new Function(data.output)();
};

let client: Promise<Innertube> | null = null;

const baseOptions = {
  fetch: platformFetch,
  lang: (typeof navigator !== 'undefined' && navigator.language?.split('-')[0]) || 'en',
  location: undefined as string | undefined,
  /** Tests use a locally generated session; the app asks YouTube for a real one. */
  localSession: false,
};

/** The fetch everything uses (swappable for tests). */
export function http(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return baseOptions.fetch(input, init);
}

/** Lets tests and settings swap the fetch or region. */
export function configureClient(opts: { fetch?: typeof fetch; location?: string; localSession?: boolean }) {
  if (opts.fetch) baseOptions.fetch = opts.fetch;
  if (opts.location !== undefined) baseOptions.location = opts.location || undefined;
  if (opts.localSession !== undefined) baseOptions.localSession = opts.localSession;
  client = null;
  browseOnly = null;
  cache.clear();
}

function hasIndexedDb(): boolean {
  try {
    return typeof indexedDB !== 'undefined';
  } catch {
    return false;
  }
}

/**
 * One YouTube session for browsing and streams. It is fetched from YouTube
 * (not generated locally: YouTube treats made-up sessions as bots, asks them
 * to "sign in to confirm you're not a bot" and refuses their stream URLs),
 * and it includes the YouTube player, which deciphering stream URLs needs.
 * The session is cached on the device between launches.
 */
async function createClient(withPlayer: boolean): Promise<Innertube> {
  const started = Date.now();
  const created = await Innertube.create({
    fetch: baseOptions.fetch,
    lang: baseOptions.lang,
    location: baseOptions.location,
    generate_session_locally: baseOptions.localSession,
    retrieve_player: withPlayer && !baseOptions.localSession,
    cache: !baseOptions.localSession && hasIndexedDb() ? new UniversalCache(true) : undefined,
  });
  const c = created.session.context.client;
  diag(
    `session ready in ${Date.now() - started}ms: ${c.clientName} ${c.clientVersion}, visitor ${c.visitorData ? 'yes' : 'NO'}, ` +
      `player ${created.session.player?.player_id ?? 'none'}, sts ${created.session.player?.signature_timestamp ?? '-'}`,
  );
  return created;
}

function yt(): Promise<Innertube> {
  client ??= createClient(true).catch((e) => {
    diag(`session with player failed: ${e instanceof Error ? e.message : String(e)}`);
    client = null;
    throw e;
  });
  return client;
}

let browseOnly: Promise<Innertube> | null = null;

/** Browsing doesn't need the YouTube player; if fetching it fails, browse without it. */
async function browse(): Promise<Innertube> {
  try {
    return await yt();
  } catch {
    browseOnly ??= createClient(false).catch((e) => {
      browseOnly = null;
      throw e;
    });
    return browseOnly;
  }
}

const streams = yt;

/** Start the session early so the first play doesn't wait for it. */
export function warmUp() {
  void yt().catch(() => {});
}

/* ------------------------------- caching ------------------------------ */

const cache = new Map<string, { at: number; value: Promise<unknown> }>();
const TTL = 10 * 60 * 1000;

function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.value as Promise<T>;
  const value = load().catch((e) => {
    cache.delete(key);
    throw e;
  });
  cache.set(key, { at: Date.now(), value });
  if (cache.size > 200) cache.delete(cache.keys().next().value!);
  return value;
}

/* -------------------------------- pages ------------------------------- */

export function getHome(): Promise<Shelf[]> {
  return cached('home', async () => {
    const yt = await browse();
    let feed = await yt.music.getHomeFeed();
    const shelves = shelvesFrom(feed.sections as any);
    // The first page is short; pull a couple more pages.
    for (let i = 0; i < 2 && feed.has_continuation; i++) {
      try {
        feed = await feed.getContinuation();
        shelves.push(...shelvesFrom(feed.sections as any));
      } catch {
        break;
      }
    }
    return shelves;
  });
}

export function getExplore(): Promise<Shelf[]> {
  return cached('explore', async () => {
    const yt = await browse();
    const e: any = await yt.music.getExplore();
    return shelvesFrom(e.sections);
  });
}

/** Any browse page made of shelves: mood categories, "More" pages. */
export function getBrowse(browseId: string, params?: string): Promise<{ title: string; shelves: Shelf[] }> {
  return cached(`browse:${browseId}:${params ?? ''}`, async () => {
    const yt = await browse();
    const res: any = await yt.actions.execute('/browse', {
      browseId,
      params,
      client: 'YTMUSIC',
      parse: true,
    } as any);
    const memo = res.contents_memo;
    const nodes: any[] = [
      ...(memo?.getType(YTNodes.MusicCarouselShelf) ?? []),
      ...(memo?.getType(YTNodes.MusicShelf) ?? []),
      ...(memo?.getType(YTNodes.Grid) ?? []),
    ];
    const header: any =
      memo?.getType(YTNodes.MusicHeader)?.[0] ?? memo?.getType(YTNodes.MusicResponsiveHeader)?.[0];
    return { title: header?.title?.text ?? '', shelves: shelvesFrom(nodes) };
  });
}

export function search(query: string, type: 'all' | 'song' | 'album' | 'artist' | 'playlist' | 'video' = 'all'): Promise<SearchResults> {
  return cached(`search:${type}:${query}`, async () => {
    const yt = await browse();
    const s = await yt.music.search(query, type === 'all' ? {} : { type });
    return searchFrom(s);
  });
}

export async function suggestions(input: string): Promise<{ queries: string[]; tracks: Track[] }> {
  if (!input.trim()) return { queries: [], tracks: [] };
  const yt = await browse();
  const sections: any[] = await yt.music.getSearchSuggestions(input);
  const queries: string[] = [];
  const tracks: Track[] = [];
  for (const sec of sections) {
    for (const c of sec.contents ?? []) {
      if (c.type === 'SearchSuggestion') {
        const q = c.suggestion?.text;
        if (q) queries.push(q);
      } else if (c.type === 'MusicResponsiveListItem' && c.item_type === 'song') {
        const t = trackFromListItem(c);
        if (t) tracks.push(t);
      }
    }
  }
  return { queries: queries.slice(0, 8), tracks: tracks.slice(0, 4) };
}

export function getAlbum(id: string): Promise<AlbumPage> {
  return cached(`album:${id}`, async () => {
    const yt = await browse();
    return albumFrom(id, await yt.music.getAlbum(id));
  });
}

export function getPlaylist(id: string): Promise<PlaylistPage> {
  return cached(`playlist:${id}`, async () => {
    const yt = await browse();
    const p: any = await yt.music.getPlaylist(id.startsWith('VL') ? id.slice(2) : id);
    const page = playlistFrom(id, p);
    // Long playlists come in pages of 100.
    let cur = p;
    for (let i = 0; i < 4 && cur.has_continuation; i++) {
      try {
        cur = await cur.getContinuation();
        page.tracks.push(...playlistFrom(id, cur).tracks);
      } catch {
        break;
      }
    }
    return page;
  });
}

export function getArtist(id: string): Promise<ArtistPage> {
  return cached(`artist:${id}`, async () => {
    const yt = await browse();
    return artistFrom(id, await yt.music.getArtist(id));
  });
}

/** "Up next" for a song: YouTube Music's radio. */
export async function getRadio(videoId: string): Promise<Track[]> {
  const yt = await browse();
  const panel: any = await yt.music.getUpNext(videoId, true);
  return (panel?.contents ?? []).map(trackFromPanel).filter(Boolean) as Track[];
}

/** Tracks of a "watch playlist" (album shuffle, artist mix). */
export async function getWatchPlaylist(playlistId: string, videoId?: string): Promise<Track[]> {
  const yt = await browse();
  const res: any = await yt.actions.execute('/next', {
    playlistId,
    videoId,
    isAudioOnly: true,
    client: 'YTMUSIC',
    parse: true,
  } as any);
  const panel: any = res.contents_memo?.getType(YTNodes.PlaylistPanel)?.[0];
  return (panel?.contents ?? []).map(trackFromPanel).filter(Boolean) as Track[];
}

/* ------------------------------- streams ------------------------------ */

/**
 * Clients tried in order. VISIONOS returns direct audio URLs without a PO
 * token; the others are fallbacks for tracks it refuses.
 */
const STREAM_CLIENTS: Types.InnerTubeClient[] = ['VISIONOS', 'ANDROID_VR', 'IOS', 'TV'];

const refusedUntil = new Map<string, number>();

export class StreamError extends Error {
  constructor(
    message: string,
    public reason: 'age' | 'unavailable' | 'network',
  ) {
    super(message);
  }
}

export type Quality = 'high' | 'normal' | 'low';

function pickFormat(formats: any[], quality: Quality): any | undefined {
  const audio = formats.filter((f) => f.has_audio && !f.has_video && (f.url || f.signature_cipher || f.cipher));
  if (!audio.length) return undefined;
  // Opus (itag 251/250/249) sounds better per bit; AAC (140/139) is the fallback.
  const score = (f: any) => {
    const opus = String(f.mime_type).includes('opus') ? 1 : 0;
    return f.bitrate + opus * 20000;
  };
  audio.sort((a, b) => score(b) - score(a));
  if (quality === 'high') return audio[0];
  if (quality === 'low') return audio[audio.length - 1];
  return audio.find((f) => f.bitrate <= 140_000) ?? audio[audio.length - 1];
}

function clientHeaders(client: string): Record<string, string> {
  const c = (Constants as any).CLIENTS?.[client];
  // VISIONOS media requests go out without Origin/Referer; a Safari UA is fine.
  const ua = c?.USER_AGENT as string | undefined;
  return ua ? { 'User-Agent': ua } : {};
}

export function seekIndexOf(f: any, durationSec: number | undefined): SeekIndex | undefined {
  const init = f.init_range;
  const index = f.index_range;
  const durationMs = Number(f.approx_duration_ms) || (durationSec ? durationSec * 1000 : 0);
  if (!init || !index || !durationMs) return undefined;
  const [mimeType, rest = ''] = String(f.mime_type ?? '').split(';');
  const codecs = /codecs="([^"]+)"/.exec(rest)?.[1] ?? '';
  return {
    mimeType: mimeType.trim(),
    codecs,
    bitrate: Number(f.bitrate) || 128000,
    initStart: Number(init.start),
    initEnd: Number(init.end),
    indexStart: Number(index.start),
    indexEnd: Number(index.end),
    durationMs,
  };
}

export async function getStream(videoId: string, quality: Quality = 'high'): Promise<StreamInfo> {
  const yt = await streams();
  let lastReason: string | undefined;
  let age = false;
  for (const client of STREAM_CLIENTS) {
    const key = `${client}:${videoId}`;
    if ((refusedUntil.get(key) ?? 0) > Date.now()) continue;
    const started = Date.now();
    try {
      const info: any = await yt.getBasicInfo(videoId, { client });
      const status = info.playability_status?.status;
      if (status && status !== 'OK') {
        lastReason = info.playability_status?.reason ?? status;
        diag(`${videoId} ${client}: ${status} "${lastReason}" (${Date.now() - started}ms)`);
        if (status === 'LOGIN_REQUIRED' && /age/i.test(String(lastReason))) age = true;
        refusedUntil.set(key, Date.now() + 10 * 60 * 1000);
        continue;
      }
      const formats: any[] = info.streaming_data?.adaptive_formats ?? [];
      const f = pickFormat(formats, quality);
      if (!f) {
        lastReason = 'No audio formats';
        diag(`${videoId} ${client}: OK but no direct audio URLs (sabr=${!!info.streaming_data?.server_abr_streaming_url})`);
        refusedUntil.set(key, Date.now() + 10 * 60 * 1000);
        continue;
      }
      let url: string = await f.decipher(yt.session.player);
      if (!url) url = f.url;
      if (!url) {
        diag(`${videoId} ${client}: could not build a stream URL`);
        continue;
      }
      diag(`${videoId} ${client}: OK itag ${f.itag} ${String(f.mime_type).split(';')[0]} ${Math.round((f.bitrate ?? 0) / 1000)}kbps (${Date.now() - started}ms)`);
      const expire = Number(new URL(url).searchParams.get('expire') ?? 0) * 1000;
      return {
        url,
        headers: clientHeaders(client),
        mimeType: String(f.mime_type ?? ''),
        bitrate: f.bitrate ?? 0,
        duration: Number(info.basic_info?.duration) || (f.approx_duration_ms ? f.approx_duration_ms / 1000 : undefined),
        client,
        loudnessDb: info.player_config?.audio_config?.loudness_db,
        expiresAt: expire || Date.now() + 5 * 60 * 60 * 1000,
        size: Number(f.content_length) || undefined,
        index: seekIndexOf(f, Number(info.basic_info?.duration) || undefined),
      };
    } catch (e) {
      lastReason = e instanceof Error ? e.message : String(e);
      diag(`${videoId} ${client}: error ${lastReason}`);
    }
  }
  if (age) throw new StreamError('This track is age-restricted on YouTube.', 'age');
  throw new StreamError(lastReason ?? 'This track is unavailable.', 'unavailable');
}

/** Mark a client's URL as refused mid-playback (HTTP 403), so the next resolve skips it. */
export function reportRefused(videoId: string, client: string) {
  diag(`${videoId} ${client}: stream URL refused during playback; trying another client`);
  refusedUntil.set(`${client}:${videoId}`, Date.now() + 10 * 60 * 1000);
}

export async function getYouTubeLyrics(videoId: string): Promise<string | undefined> {
  try {
    const yt = await browse();
    const shelf: any = await yt.music.getLyrics(videoId);
    return shelf?.description?.text;
  } catch {
    return undefined;
  }
}
