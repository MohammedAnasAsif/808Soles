import { ArrowDownCircle, ChevronRight, Clock, Disc3, Heart, ListMusic, Mic2, Plus, Trash2 } from 'lucide-react';
import { useDownloads } from '../store/downloads';
import { formatBytes } from '../components/DownloadBadge';
import { downloadsSupported } from '../platform/download';
import { Link, useNavigate, useParams } from 'react-router';
import type { ReactNode } from 'react';
import { Empty, Page } from '../components/Page';
import { CardTile } from '../components/Shelf';
import { TrackRow } from '../components/TrackRow';
import { CollectionHeader } from '../components/Collection';
import { Artwork } from '../components/Artwork';
import { useLibrary } from '../store/library';
import { usePlayer } from '../store/player';
import type { Card } from '../yt/types';

const ic = 'h-[22px] w-[22px] text-accent';

function Row({ to, icon, label }: { to: string; icon: ReactNode; label: string }) {
  return (
    <Link to={to} className="flex items-center gap-4 border-b border-sep py-3 pr-1 active:opacity-60">
      {icon}
      <span className="flex-1 text-[20px] leading-6">{label}</span>
      <ChevronRight className="h-5 w-5 text-label3" />
    </Link>
  );
}

function Grid({ cards }: { cards: Card[] }) {
  return (
    <div className="px-gutter grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-5">
      {cards.map((c) => (
        <div key={c.kind + c.id} className="[&>button]:w-full">
          <CardTile card={c} />
        </div>
      ))}
    </div>
  );
}

export default function Library() {
  const albums = useLibrary((s) => s.albums);
  const playlists = useLibrary((s) => s.playlists);
  const added = [...albums, ...playlists].slice(0, 12);
  return (
    <Page title="Library">
      <div className="px-gutter mb-8">
        <Row to="/library/playlists" icon={<ListMusic className={ic} />} label="Playlists" />
        <Row to="/library/artists" icon={<Mic2 className={ic} />} label="Artists" />
        <Row to="/library/albums" icon={<Disc3 className={ic} />} label="Albums" />
        <Row to="/library/songs" icon={<Heart className={ic} />} label="Loved Songs" />
        {downloadsSupported && <Row to="/library/downloaded" icon={<ArrowDownCircle className={ic} />} label="Downloaded" />}
        <Row to="/library/recent" icon={<Clock className={ic} />} label="Recently Played" />
      </div>
      {added.length > 0 && (
        <>
          <h2 className="section-title px-gutter mb-3">Recently Added</h2>
          <Grid cards={added} />
        </>
      )}
      {!added.length && (
        <Empty
          icon={<Disc3 className="h-12 w-12" />}
          title="Add music to your library"
          text="Tap + on an album or playlist, love songs, or follow artists. It all stays on this device."
        />
      )}
    </Page>
  );
}

export function LibrarySection() {
  const { section = '' } = useParams();
  const lib = useLibrary();
  const playTracks = usePlayer((s) => s.playTracks);
  const navigate = useNavigate();

  if (section === 'downloaded') return <DownloadedPage />;

  if (section === 'songs' || section === 'recent') {
    const tracks = section === 'songs' ? lib.liked : lib.recent;
    const title = section === 'songs' ? 'Loved Songs' : 'Recently Played';
    if (!tracks.length) {
      return (
        <Page title={title} back>
          <Empty icon={section === 'songs' ? <Heart className="h-12 w-12" /> : <Clock className="h-12 w-12" />} title={section === 'songs' ? 'No loved songs' : 'Nothing played yet'} text={section === 'songs' ? 'Tap the heart in Now Playing to love a song.' : 'Songs you play show up here.'} />
        </Page>
      );
    }
    return (
      <div className="pb-8">
        <CollectionHeader thumb={tracks[0]?.thumb} title={title} byline="Library" tracks={tracks} label={title} />
        <div className="px-gutter mt-6">
          {tracks.map((t, i) => (
            <TrackRow key={t.id} track={t} showAlbum onPlay={() => playTracks(tracks, i, { label: title })} />
          ))}
        </div>
      </div>
    );
  }

  if (section === 'playlists') {
    return (
      <Page title="Playlists" back>
        <div className="px-gutter mb-6">
          <button
            type="button"
            onClick={() => navigate(`/mine/${lib.createPlaylist('New Playlist')}`)}
            className="flex w-full items-center gap-4 border-b border-sep py-2 text-left"
          >
            <div className="flex aspect-square w-14 items-center justify-center rounded-md bg-fill">
              <Plus className="h-6 w-6 text-accent" />
            </div>
            <span className="text-[17px] text-accent">New Playlist…</span>
          </button>
          {lib.mine.map((p) => (
            <Link key={p.id} to={`/mine/${p.id}`} className="flex items-center gap-4 border-b border-sep py-2">
              <Artwork src={p.tracks[0]?.thumb} className="w-14" radius={6} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[17px]">{p.name}</div>
                <div className="text-[13px] text-label2">{p.tracks.length} songs</div>
              </div>
              <ChevronRight className="h-5 w-5 text-label3" />
            </Link>
          ))}
        </div>
        {lib.playlists.length > 0 && (
          <>
            <h2 className="section-title px-gutter mb-3">Saved</h2>
            <Grid cards={lib.playlists} />
          </>
        )}
      </Page>
    );
  }

  const map: Record<string, { title: string; cards: Card[]; empty: string }> = {
    albums: { title: 'Albums', cards: lib.albums, empty: 'Tap + on any album to add it here.' },
    artists: { title: 'Artists', cards: lib.artists, empty: 'Follow artists to keep them here.' },
  };
  const m = map[section];
  if (!m) return <Page title="Library" back>{null}</Page>;
  return (
    <Page title={m.title} back>
      {m.cards.length ? <Grid cards={m.cards} /> : <Empty icon={<Disc3 className="h-12 w-12" />} title={`No ${m.title.toLowerCase()} yet`} text={m.empty} />}
    </Page>
  );
}

function DownloadedPage() {
  const done = useDownloads((s) => s.done);
  const pending = useDownloads((s) => s.pending);
  const removeAll = useDownloads((s) => s.removeAll);
  const playTracks = usePlayer((s) => s.playTracks);
  const items = Object.values(done).sort((a, b) => b.at - a.at);
  const tracks = items.map((d) => d.track);
  const waiting = Object.values(pending);
  const bytes = items.reduce((a, d) => a + d.size, 0);
  if (!items.length && !waiting.length) {
    return (
      <Page title="Downloaded" back>
        <Empty
          icon={<ArrowDownCircle className="h-12 w-12" />}
          title="No downloads yet"
          text="Tap ••• on a song and choose Download, or tap the ↓ button on an album or playlist. Downloaded songs play without internet."
        />
      </Page>
    );
  }
  return (
    <div className="pb-8">
      <CollectionHeader thumb={tracks[0]?.thumb} title="Downloaded" byline="On this device" meta={`${items.length} songs · ${formatBytes(bytes)}`} tracks={tracks} label="Downloaded" />
      {waiting.length > 0 && (
        <div className="px-gutter mt-6">
          <h2 className="section-title mb-1">Downloading</h2>
          {waiting.map((p) => (
            <TrackRow key={p.track.id} track={p.track} onPlay={() => playTracks([p.track], 0)} />
          ))}
        </div>
      )}
      <div className="px-gutter mt-6">
        {tracks.map((t, i) => (
          <TrackRow key={t.id} track={t} showAlbum onPlay={() => playTracks(tracks, i, { label: 'Downloaded' })} />
        ))}
      </div>
      {items.length > 0 && (
        <div className="px-gutter mt-6">
          <button
            type="button"
            onClick={() => {
              if (window.confirm(`Remove all ${items.length} downloaded songs from this device?`)) removeAll();
            }}
            className="flex items-center gap-2 text-[15px] text-accent"
          >
            <Trash2 className="h-4 w-4" /> Remove All Downloads
          </button>
        </div>
      )}
    </div>
  );
}
