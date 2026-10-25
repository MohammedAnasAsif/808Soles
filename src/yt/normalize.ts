/**
 * Turns YouTube.js parser nodes into the app's shapes (types.ts).
 *
 * YouTube changes its responses often, so everything here is duck-typed and
 * defensive: a missing field gives a missing value, never a crash.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { AlbumPage, ArtistPage, ArtistRef, Card, CardKind, PlaylistPage, SearchResults, Shelf, Track } from './types';

type Node = any;

export function text(x: Node): string | undefined {
  if (x == null) return undefined;
  if (typeof x === 'string') return x;
  if (typeof x.text === 'string') return x.text;
  if (typeof x.toString === 'function' && x.runs) return String(x);
  return undefined;
}

function runs(x: Node): Node[] {
  return Array.isArray(x?.runs) ? x.runs : [];
}

function payload(ep: Node): Record<string, any> {
  return ep?.payload ?? {};
}

function pageType(ep: Node): string | undefined {
  return payload(ep).browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType;
}

/* ------------------------------ artwork ------------------------------ */

/** Ask Google's image servers for a bigger version of the same picture. */
export function upscale(url: string | undefined, size = 544): string | undefined {
  if (!url) return undefined;
  if (url.startsWith('//')) url = `https:${url}`;
  if (/googleusercontent\.com|ggpht\.com/.test(url)) {
    if (/=w\d+-h\d+/.test(url)) return url.replace(/=w\d+-h\d+[^/?#]*/, `=w${size}-h${size}-l90-rj`);
    if (/=s\d+/.test(url)) return url.replace(/=s\d+[^/?#]*/, `=s${size}`);
    if (!url.includes('=')) return `${url}=w${size}-h${size}-l90-rj`;
    return url;
  }
  const vid = url.match(/i\.ytimg\.com\/vi(?:_webp)?\/([^/]+)\//);
  if (vid) return `https://i.ytimg.com/vi/${vid[1]}/hqdefault.jpg`;
  return url;
}

export function thumbOf(node: Node, size = 544): string | undefined {
  const t = node?.thumbnail ?? node?.thumbnails ?? node;
  const list: Node[] = Array.isArray(t)
    ? t
    : Array.isArray(t?.contents)
      ? t.contents
      : Array.isArray(t?.thumbnails)
        ? t.thumbnails
        : [];
  if (!list.length) return undefined;
  const best = [...list].sort((a, b) => (b?.width ?? 0) - (a?.width ?? 0))[0];
  return upscale(best?.url, size);
}

/* ------------------------------- helpers ------------------------------ */

const SEP = /^\s*[•·]\s*$/;
const DURATION = /^(\d+:)?\d{1,2}:\d{2}$/;
const TYPE_WORDS = new Set(['Song', 'Video', 'Album', 'Single', 'EP', 'Playlist', 'Artist', 'Episode', 'Podcast', 'Profile']);

export function parseDuration(s: string | undefined): number | undefined {
  if (!s || !DURATION.test(s.trim())) return undefined;
  return s
    .trim()
    .split(':')
    .map(Number)
    .reduce((acc, n) => acc * 60 + n, 0);
}

function refsFrom(list: Node): ArtistRef[] {
  if (!Array.isArray(list)) return [];
  return list
    .filter((a) => a && (a.name || text(a)))
    .map((a) => ({ name: a.name ?? text(a) ?? '', id: a.channel_id ?? payload(a.endpoint).browseId }))
    .filter((a) => a.name);
}

/** Reads "Song • Radiohead • OK Computer • 4:59" style runs. */
function parseSubtitleRuns(r: Node[]): { artists: ArtistRef[]; album?: { name: string; id?: string }; duration?: number; year?: string } {
  const artists: ArtistRef[] = [];
  let album: { name: string; id?: string } | undefined;
  let duration: number | undefined;
  let year: string | undefined;
  for (const run of r) {
    const t: string = (run?.text ?? '').trim();
    if (!t || SEP.test(t) || t === ',' || t === '&') continue;
    const id: string | undefined = payload(run.endpoint).browseId;
    if (id?.startsWith('MPRE')) album = { name: t, id };
    else if (id?.startsWith('UC') || id?.startsWith('FEmusic_library_privately_owned_artist')) artists.push({ name: t, id });
    else if (DURATION.test(t)) duration = parseDuration(t);
    else if (/^\d{4}$/.test(t)) year = t;
  }
  return { artists, album, duration, year };
}

function cleanSubtitle(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const parts = s.split(' • ').filter((p) => !TYPE_WORDS.has(p.trim()));
  return parts.join(' • ') || undefined;
}

function isExplicit(node: Node): boolean {
  const b = node?.badges ?? node?.subtitle_badges ?? [];
  return Array.isArray(b) && b.some((x: Node) => String(x?.icon_type ?? '').includes('EXPLICIT'));
}

/* -------------------------------- tracks ------------------------------ */

export function trackFromListItem(it: Node, fallback?: Partial<Track>): Track | null {
  if (!it) return null;
  const id: string | undefined =
    (it.item_type === 'song' || it.item_type === 'video' || it.item_type === 'non_music_track' ? it.id : undefined) ??
    payload(it.overlay?.content?.endpoint).videoId ??
    payload(it.endpoint).videoId ??
    it.video_id;
  if (!id) return null;
  const cols: Node[] = Array.isArray(it.flex_columns) ? it.flex_columns : [];
  const title = text(it.title) ?? text(cols[0]?.title) ?? '';
  let artists = refsFrom(it.artists);
  if (!artists.length) artists = refsFrom(it.authors);
  if (!artists.length && it.author) artists = refsFrom([it.author]);
  const sub = parseSubtitleRuns([...runs(cols[1]?.title), ...runs(cols[2]?.title)]);
  if (!artists.length) artists = sub.artists;
  if (!artists.length && fallback?.artists) artists = fallback.artists;
  const albumNode = it.album;
  const album =
    albumNode?.name ? { name: albumNode.name, id: albumNode.id } : (sub.album ?? fallback?.album);
  const fixed = Array.isArray(it.fixed_columns) ? text(it.fixed_columns[0]?.title) : undefined;
  const duration = it.duration?.seconds || sub.duration || parseDuration(fixed) || fallback?.duration;
  return {
    id,
    title,
    artists,
    album,
    duration: duration || undefined,
    thumb: thumbOf(it) ?? fallback?.thumb,
    explicit: isExplicit(it),
    isVideo: it.item_type === 'video',
  };
}

export function trackFromPanel(v: Node): Track | null {
  const node = v?.type === 'PlaylistPanelVideoWrapper' ? v.primary : v;
  if (!node?.video_id) return null;
  let artists = refsFrom(node.artists);
  if (!artists.length && node.author) artists = [{ name: String(node.author) }];
  return {
    id: node.video_id,
    title: text(node.title) ?? '',
    artists,
    album: node.album?.name ? { name: node.album.name, id: node.album.id } : undefined,
    duration: node.duration?.seconds || undefined,
    thumb: thumbOf(node),
    explicit: isExplicit(node),
  };
}

/* -------------------------------- cards ------------------------------- */

function kindOf(itemType: string | undefined, id: string | undefined, ep?: Node): CardKind | null {
  const pt = pageType(ep);
  if (pt === 'MUSIC_PAGE_TYPE_ARTIST' || pt === 'MUSIC_PAGE_TYPE_USER_CHANNEL') return 'artist';
  if (pt === 'MUSIC_PAGE_TYPE_ALBUM' || pt === 'MUSIC_PAGE_TYPE_AUDIOBOOK') return 'album';
  if (pt === 'MUSIC_PAGE_TYPE_PLAYLIST') return 'playlist';
  switch (itemType) {
    case 'album':
      return 'album';
    case 'playlist':
      return 'playlist';
    case 'artist':
    case 'library_artist':
      return 'artist';
    case 'song':
      return 'song';
    case 'video':
    case 'non_music_track':
      return 'video';
  }
  if (id?.startsWith('MPRE')) return 'album';
  if (id?.startsWith('VL') || id?.startsWith('PL') || id?.startsWith('RD')) return 'playlist';
  if (id?.startsWith('UC')) return 'artist';
  return null;
}

function argbToCss(n: unknown): string | undefined {
  if (typeof n !== 'number') return undefined;
  const v = n >>> 0;
  return `rgb(${(v >> 16) & 255}, ${(v >> 8) & 255}, ${v & 255})`;
}

export function cardFrom(it: Node): Card | null {
  if (!it) return null;
  switch (it.type) {
    case 'MusicNavigationButton': {
      const p = payload(it.endpoint);
      if (!p.browseId) return null;
      return {
        kind: 'mood',
        id: p.browseId,
        params: p.params,
        title: it.button_text ?? '',
        color: argbToCss(it.color),
      };
    }
    case 'MusicTwoRowItem': {
      const kind = kindOf(it.item_type, it.id, it.endpoint);
      if (!kind) return null;
      const title = text(it.title) ?? '';
      const subtitle = cleanSubtitle(text(it.subtitle));
      const thumb = thumbOf(it);
      if (kind === 'song' || kind === 'video') {
        const videoId = payload(it.endpoint).videoId ?? it.id;
        if (!videoId) return null;
        let artists = refsFrom(it.artists);
        if (!artists.length && it.author) artists = refsFrom([it.author]);
        if (!artists.length) artists = parseSubtitleRuns(runs(it.subtitle)).artists;
        const track: Track = { id: videoId, title, artists, thumb, isVideo: kind === 'video', explicit: isExplicit(it) };
        return { kind, id: videoId, title, subtitle, thumb, track };
      }
      const id = it.id ?? payload(it.endpoint).browseId;
      if (!id) return null;
      return { kind, id, title, subtitle, thumb, playlistId: payload(it.endpoint).playlistId };
    }
    case 'MusicResponsiveListItem': {
      const kind = kindOf(it.item_type, it.id, it.endpoint);
      if (!kind) return null;
      if (kind === 'song' || kind === 'video') {
        const track = trackFromListItem(it);
        if (!track) return null;
        return {
          kind,
          id: track.id,
          title: track.title,
          subtitle: track.artists.map((a) => a.name).join(', '),
          thumb: track.thumb,
          track,
        };
      }
      const cols: Node[] = Array.isArray(it.flex_columns) ? it.flex_columns : [];
      const id = it.id ?? payload(it.endpoint).browseId;
      if (!id) return null;
      return {
        kind,
        id,
        title: text(it.title) ?? it.name ?? text(cols[0]?.title) ?? '',
        subtitle: cleanSubtitle(text(cols[1]?.title) ?? text(it.subtitle)),
        thumb: thumbOf(it),
      };
    }
    default:
      return null;
  }
}

function compact<T>(list: (T | null | undefined)[]): T[] {
  return list.filter((x): x is T => x != null);
}

export function shelfFrom(s: Node): Shelf | null {
  if (!s) return null;
  if (s.type === 'MusicCarouselShelf' || s.type === 'MusicShelf' || s.type === 'Grid' || s.type === 'GridRenderer') {
    const contents: Node[] = s.contents ?? s.items ?? [];
    const items = compact(contents.map(cardFrom));
    if (!items.length) return null;
    const title = text(s.header?.title) ?? text(s.title) ?? text(s.header?.text) ?? '';
    const isList = contents[0]?.type === 'MusicResponsiveListItem';
    const isChips = items.every((c) => c.kind === 'mood');
    const moreEp = s.header?.more_content?.endpoint ?? s.bottom_endpoint ?? s.endpoint;
    const moreId = payload(moreEp).browseId;
    return {
      title,
      strapline: text(s.header?.strapline),
      items,
      layout: isChips ? 'chips' : isList ? 'list' : 'carousel',
      more: moreId ? { id: moreId, params: payload(moreEp).params } : undefined,
    };
  }
  return null;
}

export function shelvesFrom(sections: Node[] | undefined): Shelf[] {
  return compact((sections ?? []).map(shelfFrom));
}

/* -------------------------------- pages ------------------------------- */

export function searchFrom(s: Node): SearchResults {
  const out: SearchResults = { songs: [], albums: [], artists: [], playlists: [], videos: [] };
  const seen = new Set<string>();
  const add = (it: Node, fallbackArtists?: ArtistRef[]) => {
    const card = cardFrom(it);
    if (card?.track && !card.track.artists.length && fallbackArtists?.length) {
      card.track.artists = fallbackArtists;
      card.subtitle = fallbackArtists.map((a) => a.name).join(', ');
    }
    if (!card || seen.has(card.kind + card.id)) return;
    seen.add(card.kind + card.id);
    if (card.kind === 'song' && card.track) out.songs.push(card.track);
    else if (card.kind === 'video' && card.track) out.videos.push(card.track);
    else if (card.kind === 'album') out.albums.push(card);
    else if (card.kind === 'artist') out.artists.push(card);
    else if (card.kind === 'playlist') out.playlists.push(card);
  };
  for (const c of s?.contents ?? []) {
    if (c?.type === 'MusicCardShelf') {
      const ep = c.on_tap ?? c.title?.endpoint;
      const p = payload(ep);
      const kind = kindOf(undefined, p.browseId, ep) ?? (p.videoId ? 'song' : null);
      const title = text(c.title) ?? '';
      if (kind && (p.browseId || p.videoId)) {
        const id = p.browseId ?? p.videoId;
        const sub = parseSubtitleRuns(runs(c.subtitle));
        out.top = {
          kind,
          id,
          title,
          subtitle: text(c.subtitle),
          thumb: thumbOf(c),
          track: p.videoId
            ? { id: p.videoId, title, artists: sub.artists, album: sub.album, duration: sub.duration, thumb: thumbOf(c) }
            : undefined,
        };
        seen.add(kind + id);
        if (out.top.track) out.songs.push(out.top.track);
      }
      const fallback = out.top?.kind === 'artist' ? [{ name: out.top.title, id: out.top.id }] : undefined;
      for (const it of c.contents ?? []) add(it, fallback);
    } else if (Array.isArray(c?.contents)) {
      for (const it of c.contents) add(it);
    }
  }
  return out;
}

function headerArtists(h: Node): ArtistRef[] {
  const fromStrap = runs(h?.strapline_text_one)
    .filter((r: Node) => payload(r.endpoint).browseId || (r.text && !SEP.test(r.text) && r.text.trim() !== '&' && r.text.trim() !== ','))
    .map((r: Node) => ({ name: String(r.text).trim(), id: payload(r.endpoint).browseId }))
    .filter((a: ArtistRef) => a.name && a.name !== '•');
  if (fromStrap.length) return fromStrap;
  if (h?.author?.name) return [{ name: h.author.name, id: h.author.channel_id }];
  return parseSubtitleRuns(runs(h?.subtitle)).artists;
}

function headerPlaylistId(h: Node): string | undefined {
  for (const b of h?.buttons ?? []) {
    const id = payload(b?.endpoint).playlistId;
    if (id) return id;
  }
  return undefined;
}

export function albumFrom(id: string, a: Node): AlbumPage {
  const h = a?.header;
  const subtitle = text(h?.subtitle) ?? '';
  const [type, ...rest] = subtitle.split(' • ');
  const year = rest.find((p) => /^\d{4}$/.test(p.trim())) ?? h?.year;
  const artists = headerArtists(h);
  const thumb = thumbOf(h) ?? thumbOf(a?.background);
  const title = text(h?.title) ?? '';
  const tracks = compact<Track>(
    (a?.contents ?? []).map((it: Node) =>
      trackFromListItem(it, { artists, album: { name: title, id }, thumb }),
    ),
  ).map((t) => ({ ...t, thumb, album: t.album ?? { name: title, id } }));
  return {
    id,
    title,
    type: type?.trim() || undefined,
    year: year?.trim(),
    artists,
    thumb,
    description: text(h?.description?.description) ?? text(h?.description),
    summary: text(h?.second_subtitle),
    tracks,
    playlistId: headerPlaylistId(h),
    more: shelvesFrom(a?.sections),
  };
}

export function playlistFrom(id: string, p: Node): PlaylistPage {
  const h = p?.header;
  const items: Node[] = p?.items ?? p?.contents ?? [];
  return {
    id,
    title: text(h?.title) ?? '',
    author: text(h?.strapline_text_one) || text(h?.author) || cleanSubtitle(text(h?.subtitle)),
    thumb: thumbOf(h) ?? thumbOf(p?.background),
    summary: text(h?.second_subtitle) ?? text(h?.second_subtitle),
    description: text(h?.description?.description) ?? text(h?.description),
    tracks: compact(items.map((it) => trackFromListItem(it))),
  };
}

export function artistFrom(id: string, a: Node): ArtistPage {
  const h = a?.header;
  const sections: Node[] = a?.sections ?? [];
  let topSongs: Track[] = [];
  let topSongsPlaylist: string | undefined;
  const shelves: Shelf[] = [];
  for (const s of sections) {
    const isSongs = s?.type === 'MusicShelf' && (s.contents?.[0]?.item_type === 'song' || s.contents?.[0]?.item_type === 'video');
    if (isSongs && !topSongs.length) {
      topSongs = compact((s.contents ?? []).map((it: Node) => trackFromListItem(it)));
      const ep = s.title?.endpoint ?? runs(s.title)[0]?.endpoint ?? s.bottom_endpoint;
      topSongsPlaylist = payload(ep).browseId;
      continue;
    }
    const shelf = shelfFrom(s);
    if (shelf) shelves.push(shelf);
  }
  return {
    id,
    name: text(h?.title) ?? '',
    thumb: thumbOf(h, 1200),
    description: text(h?.description),
    shuffleId: payload(h?.play_button?.endpoint).playlistId,
    radioId: payload(h?.start_radio_button?.endpoint).playlistId,
    topSongs,
    topSongsPlaylist,
    shelves,
  };
}
