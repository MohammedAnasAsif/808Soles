/** The app's own shapes. Everything from YouTube.js is turned into these. */

export interface ArtistRef {
  name: string;
  id?: string;
}

export interface Track {
  /** YouTube video id. */
  id: string;
  title: string;
  artists: ArtistRef[];
  album?: { name: string; id?: string };
  /** Seconds, when known. */
  duration?: number;
  /** Square artwork, upscaled. */
  thumb?: string;
  explicit?: boolean;
  /** True for music videos and uploads that aren't "songs". */
  isVideo?: boolean;
}

export type CardKind = 'album' | 'playlist' | 'artist' | 'song' | 'video' | 'mood';

export interface Card {
  kind: CardKind;
  /** browseId for album/playlist/artist/mood, videoId for song/video. */
  id: string;
  title: string;
  subtitle?: string;
  thumb?: string;
  /** For songs and videos, enough to play without another request. */
  track?: Track;
  /** Mood categories need these browse params. */
  params?: string;
  /** Some playlist cards start a "watch playlist" (radio) instead of a page. */
  playlistId?: string;
  /** Mood/genre chips carry a colour. */
  color?: string;
}

export interface Shelf {
  title: string;
  strapline?: string;
  items: Card[];
  /** "list" shelves show as rows of songs, "grid"/"carousel" as artwork. */
  layout: 'carousel' | 'list' | 'chips';
  more?: { id: string; params?: string };
}

export interface SearchResults {
  top?: Card;
  songs: Track[];
  albums: Card[];
  artists: Card[];
  playlists: Card[];
  videos: Track[];
}

export interface AlbumPage {
  id: string;
  title: string;
  /** e.g. "Album" / "Single" / "EP" */
  type?: string;
  year?: string;
  artists: ArtistRef[];
  thumb?: string;
  description?: string;
  summary?: string;
  tracks: Track[];
  playlistId?: string;
  more: Shelf[];
}

export interface PlaylistPage {
  id: string;
  title: string;
  author?: string;
  thumb?: string;
  summary?: string;
  description?: string;
  tracks: Track[];
}

export interface ArtistPage {
  id: string;
  name: string;
  thumb?: string;
  description?: string;
  shuffleId?: string;
  radioId?: string;
  topSongs: Track[];
  topSongsPlaylist?: string;
  shelves: Shelf[];
}

export interface StreamInfo {
  url: string;
  headers: Record<string, string>;
  mimeType: string;
  bitrate: number;
  /** Seconds. */
  duration?: number;
  /** Which InnerTube client minted the URL. */
  client: string;
  loudnessDb?: number;
  expiresAt: number;
  /** Bytes, when YouTube says. */
  size?: number;
}

export interface LyricLine {
  /** Seconds. */
  time: number;
  text: string;
}

export interface Lyrics {
  synced: boolean;
  lines: LyricLine[];
  source: string;
}
