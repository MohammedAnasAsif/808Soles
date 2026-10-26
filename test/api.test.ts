/**
 * Runs the real YouTube.js client against captured InnerTube responses.
 * Set FIXTURES_DIR to a folder with innertube/*.json and lyrics/*.json.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fixtureFor } from '../scripts/dev-relay';
import { configureClient, getAlbum, getArtist, getExplore, getHome, getPlaylist, getRadio, search, suggestions } from '../src/yt/api';
import { getLyrics, parseLrc, cleanTitle } from '../src/yt/lyrics';
import { upscale } from '../src/yt/normalize';

const dir = process.env.FIXTURES_DIR ?? '';
const have = !!dir && existsSync(`${dir}/innertube/browse-home.json`);

const fixtureFetch: typeof fetch = async (input, init) => {
  const req = input instanceof Request ? input : new Request(input, init);
  const body = req.method === 'POST' ? await req.text() : '';
  const file = fixtureFor(dir, new URL(req.url), body);
  if (!file || !existsSync(file)) return new Response('{}', { status: 404 });
  return new Response(readFileSync(file), { status: 200, headers: { 'content-type': 'application/json' } });
};

describe('helpers', () => {
  it('parses LRC', () => {
    const l = parseLrc('[00:12.50]Hello\n[01:02.00][01:30.00]Again\nnot a line');
    expect(l).toEqual([
      { time: 12.5, text: 'Hello' },
      { time: 62, text: 'Again' },
      { time: 90, text: 'Again' },
    ]);
  });
  it('cleans titles', () => {
    expect(cleanTitle('Creep (Official Music Video)')).toBe('Creep');
    expect(cleanTitle('Let Down [Remastered 2017]')).toBe('Let Down');
  });
  it('upscales artwork', () => {
    expect(upscale('https://lh3.googleusercontent.com/abc=w60-h60-l90-rj')).toBe(
      'https://lh3.googleusercontent.com/abc=w544-h544-l90-rj',
    );
    expect(upscale('https://i.ytimg.com/vi/XYZ/sddefault.jpg?sqp=1')).toBe('https://i.ytimg.com/vi/XYZ/hqdefault.jpg');
  });
});

describe.skipIf(!have)('YouTube Music pages from fixtures', () => {
  beforeAll(() => configureClient({ fetch: fixtureFetch, localSession: true }));

  it('home has shelves of cards', async () => {
    const shelves = await getHome();
    expect(shelves.length).toBeGreaterThan(0);
    const first = shelves[0];
    expect(first.title).toBeTruthy();
    expect(first.items[0].title).toBeTruthy();
    expect(first.items[0].thumb).toMatch(/^https:/);
  });

  it('explore has new releases and moods', async () => {
    const shelves = await getExplore();
    expect(shelves.some((s) => s.items[0]?.kind === 'album')).toBe(true);
    const moods = shelves.find((s) => s.layout === 'chips');
    expect(moods?.items[0].params).toBeTruthy();
  });

  it('search finds songs, albums and a top result', async () => {
    const r = await search('radiohead');
    expect(r.top?.kind).toBe('artist');
    expect(r.top?.title).toBe('Radiohead');
    expect(r.songs.length).toBeGreaterThan(3);
    expect(r.songs[0].artists[0]?.name).toBeTruthy();
    expect(r.albums.length).toBeGreaterThan(0);
    expect(r.albums[0].id).toMatch(/^MPRE/);
  });

  it('song search carries album and duration', async () => {
    const r = await search('radiohead let down', 'song');
    const s = r.songs.find((t) => t.title === 'Let Down');
    expect(s?.album?.name).toMatch(/OK Computer/);
    expect(s?.duration).toBe(300);
  });

  it('suggestions', async () => {
    const s = await suggestions('radioh');
    expect(s.queries[0]).toBe('radiohead');
  });

  it('album page', async () => {
    const a = await getAlbum('MPREb_test');
    expect(a.title).toBe('OK Computer');
    expect(a.year).toBe('1997');
    expect(a.type).toBe('Album');
    expect(a.artists[0].name).toBe('Radiohead');
    expect(a.tracks).toHaveLength(12);
    expect(a.tracks[0]).toMatchObject({ title: 'Airbag', duration: 288 });
    expect(a.tracks[0].artists[0].name).toBe('Radiohead');
    expect(a.tracks[0].thumb).toBe(a.thumb);
    expect(a.playlistId).toMatch(/^OLAK/);
  });

  it('artist page', async () => {
    const a = await getArtist('UCtest');
    expect(a.name).toBe('Radiohead');
    expect(a.topSongs.length).toBe(5);
    expect(a.shelves.find((s) => s.title === 'Albums')?.items[0].kind).toBe('album');
    expect(a.shuffleId).toBeTruthy();
  });

  it('playlist page', async () => {
    const p = await getPlaylist('VLPLtest');
    expect(p.title).toBe('radiohead 432hz');
    expect(p.tracks.length).toBeGreaterThan(10);
    expect(p.tracks[0].duration).toBe(268);
  });

  it('radio', async () => {
    const r = await getRadio('QQnc-hM80UQ');
    expect(r.length).toBeGreaterThan(10);
    expect(r[0]).toMatchObject({ id: 'QQnc-hM80UQ', title: 'You And Whose Army?' });
    expect(r[0].album?.name).toBe('Amnesiac');
  });

  it('lyrics from LRCLIB', async () => {
    const l = await getLyrics({ id: 'ZVgHPSyEIqk', title: 'Let Down', artists: [{ name: 'Radiohead' }], duration: 300 });
    expect(l).not.toBeNull();
    expect(l!.lines.length).toBeGreaterThan(10);
  });
});
