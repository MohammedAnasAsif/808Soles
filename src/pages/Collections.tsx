import { useParams, useNavigate } from 'react-router';
import { Pencil, Trash2, ListMusic } from 'lucide-react';
import { useState } from 'react';
import { getAlbum, getPlaylist } from '../yt/api';
import { useAsync, totalMinutes } from '../lib/hooks';
import { Empty, ErrorView, Loading } from '../components/Page';
import { CollectionHeader } from '../components/Collection';
import { TrackRow } from '../components/TrackRow';
import { ShelfView } from '../components/Shelf';
import { usePlayer } from '../store/player';
import { useLibrary } from '../store/library';
import type { Track } from '../yt/types';

function Footer({ tracks, summary }: { tracks: Track[]; summary?: string }) {
  const secs = tracks.reduce((a, t) => a + (t.duration ?? 0), 0);
  const text = summary ?? `${tracks.length} song${tracks.length === 1 ? '' : 's'}${secs ? `, ${totalMinutes(secs)}` : ''}`;
  return <div className="px-gutter pb-6 pt-4 text-[13px] text-label2">{text}</div>;
}

export function Album() {
  const { id = '' } = useParams();
  const { data, error, loading, reload } = useAsync(() => getAlbum(id), [id]);
  const playTracks = usePlayer((s) => s.playTracks);
  if (loading && !data) return <div className="pt-16"><Loading rows={1} /></div>;
  if (error || !data) return <div className="pt-16"><ErrorView error={error} retry={reload} /></div>;
  const main = data.artists[0]?.name;
  return (
    <div className="pb-8">
      <CollectionHeader
        thumb={data.thumb}
        title={data.title}
        artists={data.artists}
        meta={[data.type, data.year].filter(Boolean).join(' · ')}
        description={data.description}
        tracks={data.tracks}
        label={data.title}
        card={{ kind: 'album', id, title: data.title, subtitle: data.artists.map((a) => a.name).join(', '), thumb: data.thumb }}
      />
      <div className="px-gutter mt-6">
        {data.tracks.map((t, i) => (
          <TrackRow
            key={t.id + i}
            track={t}
            number={i + 1}
            hideArtist={t.artists.length === 1 && t.artists[0].name === main}
            onPlay={() => playTracks(data.tracks, i, { label: data.title })}
          />
        ))}
      </div>
      <Footer tracks={data.tracks} summary={data.summary} />
      {data.more.map((s, i) => (
        <ShelfView key={s.title + i} shelf={s} />
      ))}
    </div>
  );
}

export function Playlist() {
  const { id = '' } = useParams();
  const { data, error, loading, reload } = useAsync(() => getPlaylist(id), [id]);
  const playTracks = usePlayer((s) => s.playTracks);
  if (loading && !data) return <div className="pt-16"><Loading rows={1} /></div>;
  if (error || !data) return <div className="pt-16"><ErrorView error={error} retry={reload} /></div>;
  return (
    <div className="pb-8">
      <CollectionHeader
        thumb={data.thumb}
        title={data.title}
        byline={data.author}
        description={data.description}
        tracks={data.tracks}
        label={data.title}
        card={{ kind: 'playlist', id, title: data.title, subtitle: data.author, thumb: data.thumb }}
      />
      <div className="px-gutter mt-6">
        {data.tracks.map((t, i) => (
          <TrackRow key={t.id + i} track={t} onPlay={() => playTracks(data.tracks, i, { label: data.title })} />
        ))}
      </div>
      <Footer tracks={data.tracks} summary={data.summary} />
    </div>
  );
}

/** One of the user's own playlists, stored on the device. */
export function MyPlaylist() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const p = useLibrary((s) => s.mine.find((x) => x.id === id));
  const rename = useLibrary((s) => s.renamePlaylist);
  const del = useLibrary((s) => s.deletePlaylist);
  const playTracks = usePlayer((s) => s.playTracks);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(p?.name ?? '');
  if (!p) return <Empty icon={<ListMusic className="h-10 w-10" />} title="Playlist not found" text="It may have been deleted." />;
  return (
    <div className="pb-8">
      <CollectionHeader
        thumb={p.tracks[0]?.thumb}
        title={p.name}
        byline="My Playlist"
        tracks={p.tracks}
        label={p.name}
        extraActions={
          <>
            <button type="button" aria-label="Rename" onClick={() => (setName(p.name), setEditing(true))} className="pressable flex h-8 w-8 items-center justify-center rounded-full bg-fill text-accent">
              <Pencil className="h-4 w-4" />
            </button>
            <button
              type="button"
              aria-label="Delete playlist"
              onClick={() => {
                del(p.id);
                navigate('/library/playlists');
              }}
              className="pressable flex h-8 w-8 items-center justify-center rounded-full bg-fill text-accent"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </>
        }
      />
      {editing && (
        <form
          className="px-gutter mt-4 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            rename(p.id, name.trim() || p.name);
            setEditing(false);
          }}
        >
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} className="min-w-0 flex-1 rounded-lg bg-fill px-3 py-2 text-[16px] outline-none" />
          <button type="submit" className="rounded-lg bg-accent px-4 text-[15px] font-semibold text-white">
            Save
          </button>
        </form>
      )}
      <div className="px-gutter mt-6">
        {p.tracks.map((t, i) => (
          <TrackRow key={t.id + i} track={t} menu={{ playlist: { id: p.id, index: i } }} onPlay={() => playTracks(p.tracks, i, { label: p.name })} />
        ))}
        {!p.tracks.length && <div className="py-10 text-center text-[15px] text-label2">Add songs from any song’s ••• menu.</div>}
      </div>
      {p.tracks.length > 0 && <Footer tracks={p.tracks} />}
    </div>
  );
}
