/**
 * Development only. In the browser the app can't call YouTube directly
 * (CORS, forbidden headers), so `platformFetch` sends `/__relay/<url>` to the
 * Vite dev server, which makes the real request from Node.
 *
 * With `fixtures: true` it answers from captured InnerTube responses instead,
 * so the interface can be developed and tested offline. Set FIXTURES_DIR to a
 * folder containing `innertube/*.json` and `lyrics/*.json`.
 */
import type { Plugin } from 'vite';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export function fixtureFor(dir: string, url: URL, body: string): string | null {
  const inner = (name: string) => join(dir, 'innertube', `${name}.json`);
  const lyr = (name: string) => join(dir, 'lyrics', `${name}.json`);
  let json: Record<string, unknown> = {};
  try {
    json = body ? JSON.parse(body) : {};
  } catch {
    /* not JSON */
  }
  const path = url.pathname;
  if (url.hostname === 'lrclib.net') {
    return path.includes('/search') ? lyr('lrclib-search') : lyr('lrclib-get');
  }
  if (path.endsWith('/browse')) {
    const id = String(json.browseId ?? '');
    if (id === 'FEmusic_home') return inner('browse-home');
    if (id === 'FEmusic_explore') return inner('browse-explore');
    if (id === 'FEmusic_new_releases') return inner('browse-new-releases');
    if (id === 'FEmusic_moods_and_genres') return inner('browse-moods-and-genres');
    if (id.startsWith('MPREb_')) return inner('browse-album');
    if (id.startsWith('UC')) return inner('browse-artist');
    if (id.startsWith('VL') || id.startsWith('PL') || id.startsWith('RD') || id.startsWith('OLAK'))
      return inner('browse-playlist');
    return null;
  }
  if (path.endsWith('/music/get_search_suggestions')) return inner('search-suggestions');
  if (path.endsWith('/search')) {
    const params = String(json.params ?? '');
    if (!params) return inner('search-all');
    // Filter params start "EgWKAQIYA" for albums and "EgWKAQIIA" for songs.
    if (params.startsWith('EgWKAQIYA')) return inner('search-albums');
    if (params.startsWith('EgWKAQIIA')) return inner('search-songs');
    return inner('search-all');
  }
  if (path.endsWith('/next')) return inner('next-radio');
  if (path.endsWith('/player')) return inner('player-web-remix-no-potoken');
  return null;
}

export function devRelayPlugin(opts: { fixtures: boolean }): Plugin {
  const dir = process.env.FIXTURES_DIR ?? '';
  return {
    name: 'cadence-dev-relay',
    configureServer(server) {
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next) => {
        if (!req.url?.startsWith('/__relay/')) return next();
        const target = new URL(req.url.slice('/__relay/'.length));
        const body = await readBody(req);
        if (opts.fixtures) {
          const file = fixtureFor(dir, target, body.toString('utf8'));
          if (file && existsSync(file)) {
            res.setHeader('content-type', 'application/json');
            res.end(readFileSync(file));
          } else {
            res.statusCode = 404;
            res.end('{}');
          }
          return;
        }
        const headers: Record<string, string> = {};
        for (const [k, v] of Object.entries(req.headers)) {
          if (k.startsWith('x-relay-') && typeof v === 'string') headers[k.slice(8)] = v;
        }
        try {
          const upstream = await fetch(target, {
            method: req.method,
            headers,
            body: req.method === 'GET' || req.method === 'HEAD' ? undefined : new Uint8Array(body),
          });
          res.statusCode = upstream.status;
          upstream.headers.forEach((v, k) => {
            if (!['content-encoding', 'content-length', 'transfer-encoding'].includes(k))
              res.setHeader(k, v);
          });
          res.end(Buffer.from(await upstream.arrayBuffer()));
        } catch (e) {
          res.statusCode = 502;
          res.end(String(e));
        }
      });
    },
  };
}
