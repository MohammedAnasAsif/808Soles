import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';

/** Where the app is running. */
export type PlatformKind = 'electron' | 'android' | 'web';

export interface WireRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: Uint8Array;
}

export interface WireResponse {
  status: number;
  headers: Record<string, string>;
  body: Uint8Array;
}

/** What the Electron preload script exposes on `window.cadence`. */
export interface ElectronBridge {
  netFetch(req: WireRequest): Promise<WireResponse>;
  /** Headers the main process adds to this media URL's requests. */
  registerMedia(url: string, headers: Record<string, string>): void;
  windowControl(action: 'minimize' | 'maximize' | 'close'): void;
  /** Recent googlevideo HTTP results from the main process. */
  mediaLog(): Promise<string[]>;
  download(job: { id: string; url: string; headers: Record<string, string>; ext: string; size?: number }): Promise<{
    path: string;
    url: string;
    size: number;
  }>;
  deleteDownload(path: string): Promise<void>;
  onDownloadProgress(cb: (e: { id: string; received: number; total: number }) => void): void;
  platform: string;
}

declare global {
  interface Window {
    cadence?: ElectronBridge;
  }
}

/* ------------------------------------------------------------------ */
/* The Android plugin (android/app/src/main/java/app/cadence/player)   */
/* ------------------------------------------------------------------ */

export interface NativeTrackMeta {
  title: string;
  artist: string;
  album?: string;
  artworkUrl?: string;
}

export interface NativeState {
  playing: boolean;
  buffering: boolean;
  positionMs: number;
  durationMs: number;
}

export interface NativeSource {
  url: string;
  headers: Record<string, string>;
  meta: NativeTrackMeta;
  /** Loudness normalisation, 0..1. */
  gain: number;
  /** Lets Android seek in WebM/MP4 (played as DASH). */
  index?: import('../yt/types').SeekIndex;
}

/**
 * Native playback on Android: two ExoPlayers behind one media session, so
 * playback, crossfades and track changes keep going with the screen off.
 */
export interface CadencePlugin {
  http(opts: {
    url: string;
    method: string;
    headers: Record<string, string>;
    bodyBase64?: string;
  }): Promise<{ status: number; headers: Record<string, string>; bodyBase64: string }>;
  load(opts: NativeSource & { startMs: number; autoplay: boolean }): Promise<void>;
  prepareNext(opts: NativeSource): Promise<void>;
  clearNext(): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  seek(opts: { positionMs: number }): Promise<void>;
  setCrossfade(opts: { ms: number }): Promise<void>;
  setVolume(opts: { volume: number }): Promise<void>;
  stop(): Promise<void>;
  getState(): Promise<NativeState>;
  requestNotificationPermission(): Promise<void>;
  download(opts: { id: string; url: string; headers: Record<string, string>; ext: string; size?: number }): Promise<{
    path: string;
    url: string;
    size: number;
  }>;
  deleteDownload(opts: { path: string }): Promise<void>;
  addListener(
    event: 'downloadProgress',
    cb: (e: { id: string; received: number; total: number }) => void,
  ): Promise<PluginListenerHandle>;
  addListener(event: 'state', cb: (s: NativeState) => void): Promise<PluginListenerHandle>;
  addListener(event: 'advanced', cb: () => void): Promise<PluginListenerHandle>;
  addListener(event: 'ended', cb: () => void): Promise<PluginListenerHandle>;
  addListener(event: 'error', cb: (e: { message: string; httpStatus?: number }) => void): Promise<PluginListenerHandle>;
  addListener(event: 'remote', cb: (e: { action: 'next' | 'previous' }) => void): Promise<PluginListenerHandle>;
}

export const NativeCadence = registerPlugin<CadencePlugin>('Cadence');

export const platform: PlatformKind = (() => {
  if (typeof window !== 'undefined' && window.cadence) return 'electron';
  if (Capacitor.isNativePlatform()) return 'android';
  return 'web';
})();

export const isDesktop = platform === 'electron';

/* ------------------------------------------------------------------ */
/* fetch for YouTube.js and lyric lookups                               */
/* ------------------------------------------------------------------ */

function headersToRecord(h: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!h) return out;
  new Headers(h).forEach((v, k) => {
    out[k] = v;
  });
  return out;
}

async function toWire(input: RequestInfo | URL, init?: RequestInit): Promise<WireRequest> {
  if (input instanceof Request) {
    const req = init ? new Request(input, init) : input;
    const buf = req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.arrayBuffer();
    return {
      url: req.url,
      method: req.method,
      headers: headersToRecord(req.headers),
      body: buf && buf.byteLength ? new Uint8Array(buf) : undefined,
    };
  }
  const url = input instanceof URL ? input.toString() : String(input);
  const method = (init?.method ?? 'GET').toUpperCase();
  let body: Uint8Array | undefined;
  if (init?.body != null && method !== 'GET' && method !== 'HEAD') {
    const buf = await new Response(init.body).arrayBuffer();
    body = new Uint8Array(buf);
  }
  return { url, method, headers: headersToRecord(init?.headers), body };
}

function fromWire(res: WireResponse, url: string): Response {
  // Response() rejects bodies for these statuses.
  const nullBody = res.status === 204 || res.status === 205 || res.status === 304;
  const r = new Response(nullBody ? null : (res.body as BodyInit), {
    status: res.status,
    headers: res.headers,
  });
  Object.defineProperty(r, 'url', { value: url });
  return r;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(s);
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * A fetch that is not subject to CORS and can set any header.
 * Electron: the main process's network stack. Android: the native plugin.
 * Browser dev mode: the Vite dev server relays `/__relay/<url>`.
 */
export const platformFetch: typeof fetch = async (input, init) => {
  const req = await toWire(input, init);
  if (platform === 'electron') {
    const res = await window.cadence!.netFetch(req);
    return fromWire(res, req.url);
  }
  if (platform === 'android') {
    const res = await NativeCadence.http({
      url: req.url,
      method: req.method,
      headers: req.headers,
      bodyBase64: req.body ? bytesToBase64(req.body) : undefined,
    });
    return fromWire(
      { status: res.status, headers: res.headers, body: base64ToBytes(res.bodyBase64) },
      req.url,
    );
  }
  // Browser (development only).
  const relayed = `/__relay/${req.url}`;
  return fetch(relayed, {
    method: req.method,
    headers: Object.fromEntries(
      Object.entries(req.headers).map(([k, v]) => [`x-relay-${k}`, v]),
    ),
    body: req.body as BodyInit | undefined,
  }).then((r) => {
    Object.defineProperty(r, 'url', { value: req.url });
    return r;
  });
};
