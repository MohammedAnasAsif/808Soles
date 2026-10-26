import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import {
  Disc3,
  Heart,
  HeartOff,
  ListEnd,
  ListPlus,
  ListStart,
  MicVocal,
  Plus,
  Radio,
  Share,
  Trash2,
  UserRound,
  BookmarkPlus,
  BookmarkMinus,
  ArrowDownCircle,
  CircleX,
} from 'lucide-react';
import { useDownloads } from '../store/downloads';
import { downloadsSupported } from '../platform/download';
import { useMenu } from './menu';
import { usePlayer } from '../store/player';
import { useLibrary } from '../store/library';
import { useWide, artistNames } from '../lib/hooks';
import { Artwork } from './Artwork';
import { hrefFor } from '../lib/nav';
import { getAlbum, getPlaylist } from '../yt/api';
import { toast } from '../store/toast';
import type { Track } from '../yt/types';

interface Item {
  label: string;
  icon: ReactNode;
  run(): void;
  danger?: boolean;
}

const ic = 'h-[18px] w-[18px]';

async function tracksOf(kind: string, id: string): Promise<Track[]> {
  if (kind === 'album') return (await getAlbum(id)).tracks;
  if (kind === 'playlist') return (await getPlaylist(id)).tracks;
  return [];
}

export function MenuHost() {
  const target = useMenu((s) => s.target);
  const close = useMenu((s) => s.close);
  const pick = useMenu((s) => s.pick);
  const wide = useWide();
  const navigate = useNavigate();
  const player = usePlayer.getState;
  const lib = useLibrary();
  const dl = useDownloads();

  useEffect(() => {
    if (!target) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [target, close]);

  if (!target) return <PlaylistPicker />;

  const { track, card, playlist } = target;
  const items: Item[] = [];
  const go = (path: string) => {
    usePlayer.getState().openNowPlaying(false);
    navigate(path);
  };

  if (track) {
    items.push(
      { label: 'Play Next', icon: <ListStart className={ic} />, run: () => player().playNext([track]) },
      { label: 'Play Last', icon: <ListEnd className={ic} />, run: () => player().addToQueue([track]) },
      { label: 'Add to a Playlist…', icon: <ListPlus className={ic} />, run: () => pick([track]) },
      lib.isLiked(track.id)
        ? { label: 'Unlove', icon: <HeartOff className={ic} />, run: () => lib.toggleLike(track) }
        : { label: 'Love', icon: <Heart className={ic} />, run: () => lib.toggleLike(track) },
      { label: 'Start Station', icon: <Radio className={ic} />, run: () => player().playRadio(track) },
    );
    if (downloadsSupported) {
      if (dl.done[track.id]) items.push({ label: 'Remove Download', icon: <Trash2 className={ic} />, run: () => dl.remove(track.id) });
      else if (dl.pending[track.id]) items.push({ label: 'Cancel Download', icon: <CircleX className={ic} />, run: () => dl.cancel(track.id) });
      else items.push({ label: 'Download', icon: <ArrowDownCircle className={ic} />, run: () => dl.download([track]) });
    }
    if (track.album?.id) items.push({ label: 'Go to Album', icon: <Disc3 className={ic} />, run: () => go(`/album/${track.album!.id}`) });
    const artist = track.artists.find((a) => a.id?.startsWith('UC'));
    if (artist) items.push({ label: 'Go to Artist', icon: <UserRound className={ic} />, run: () => go(`/artist/${artist.id}`) });
    items.push({
      label: 'Copy Link',
      icon: <Share className={ic} />,
      run: () => {
        void navigator.clipboard?.writeText(`https://music.youtube.com/watch?v=${track.id}`);
        toast('Link copied');
      },
    });
    if (playlist) {
      items.push({
        label: 'Remove from Playlist',
        icon: <Trash2 className={ic} />,
        danger: true,
        run: () => lib.removeFromPlaylist(playlist.id, playlist.index),
      });
    }
  } else if (card && (card.kind === 'album' || card.kind === 'playlist' || card.kind === 'artist')) {
    const withTracks = (fn: (t: Track[]) => void) => () =>
      void tracksOf(card.kind, card.id)
        .then((t) => (t.length ? fn(t) : toast('Nothing to play')))
        .catch(() => toast('Couldn’t load it. Check your connection.'));
    if (card.kind !== 'artist') {
      items.push(
        { label: 'Play Next', icon: <ListStart className={ic} />, run: withTracks((t) => player().playNext(t)) },
        { label: 'Play Last', icon: <ListEnd className={ic} />, run: withTracks((t) => player().addToQueue(t)) },
        { label: 'Add to a Playlist…', icon: <ListPlus className={ic} />, run: withTracks((t) => pick(t)) },
      );
      if (downloadsSupported) items.push({ label: 'Download', icon: <ArrowDownCircle className={ic} />, run: withTracks((t) => dl.download(t)) });
    }
    items.push(
      lib.isSaved(card)
        ? { label: card.kind === 'artist' ? 'Unfollow' : 'Remove from Library', icon: <BookmarkMinus className={ic} />, run: () => lib.toggleSave(card) }
        : { label: card.kind === 'artist' ? 'Follow' : 'Add to Library', icon: <BookmarkPlus className={ic} />, run: () => lib.toggleSave(card) },
    );
    const href = hrefFor(card);
    if (href) items.push({ label: `Go to ${card.kind[0].toUpperCase()}${card.kind.slice(1)}`, icon: <MicVocal className={ic} />, run: () => go(href) });
  }

  const title = track?.title ?? card?.title ?? '';
  const subtitle = track ? artistNames(track.artists) : card?.subtitle;
  const thumb = track?.thumb ?? card?.thumb;

  const list = (
    <div className="py-1">
      {items.map((it) => (
        <button
          key={it.label}
          type="button"
          onClick={() => {
            close();
            it.run();
          }}
          className={`flex w-full items-center justify-between gap-6 px-4 py-2.5 text-left text-[15px] hover:bg-fill active:bg-fill ${it.danger ? 'text-accent' : 'text-label'}`}
        >
          <span>{it.label}</span>
          <span className={it.danger ? 'text-accent' : 'text-label2'}>{it.icon}</span>
        </button>
      ))}
    </div>
  );

  if (wide && target.at) {
    const w = 260;
    const h = items.length * 42 + 8;
    const x = Math.min(target.at.x, window.innerWidth - w - 8);
    const y = Math.min(target.at.y, window.innerHeight - h - 8);
    return (
      <div className="fixed inset-0 z-[80]" onClick={close} onContextMenu={(e) => (e.preventDefault(), close())}>
        <div
          className="glass anim-pop absolute overflow-hidden rounded-xl border border-sep"
          style={{ left: x, top: y, width: w, boxShadow: 'var(--shadow)' }}
          onClick={(e) => e.stopPropagation()}
        >
          {list}
        </div>
      </div>
    );
  }

  return (
    <Sheet onClose={close}>
      <div className="flex items-center gap-3 border-b border-sep px-4 pb-3 pt-1">
        <Artwork src={thumb} className="w-12" radius={6} round={card?.kind === 'artist'} />
        <div className="min-w-0">
          <div className="truncate text-[15px] font-semibold">{title}</div>
          {subtitle && <div className="truncate text-[13px] text-label2">{subtitle}</div>}
        </div>
      </div>
      {list}
    </Sheet>
  );
}

export function Sheet({ onClose, children }: { onClose(): void; children: ReactNode }) {
  return (
    <div className="anim-fade fixed inset-0 z-[80] flex flex-col justify-end bg-black/40" onClick={onClose}>
      <div
        className="anim-sheet mx-auto w-full max-w-[560px] rounded-t-[14px] bg-elev2 pt-2"
        style={{ paddingBottom: 'calc(var(--sab) + 12px)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-2 h-[5px] w-9 rounded-full bg-fill2" />
        {children}
      </div>
    </div>
  );
}

function PlaylistPicker() {
  const tracks = useMenu((s) => s.picker);
  const pick = useMenu((s) => s.pick);
  const mine = useLibrary((s) => s.mine);
  const create = useLibrary((s) => s.createPlaylist);
  const add = useLibrary((s) => s.addToPlaylist);
  const [name, setName] = useState('');
  if (!tracks) return null;
  const done = (label: string) => {
    pick(null);
    setName('');
    toast(`Added to “${label}”`);
  };
  return (
    <Sheet onClose={() => pick(null)}>
      <div className="px-4 pb-2 text-center text-[17px] font-semibold">Add to Playlist</div>
      <form
        className="flex gap-2 px-4 py-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          create(name, tracks);
          done(name.trim());
        }}
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New playlist name"
          className="min-w-0 flex-1 rounded-lg bg-fill px-3 py-2 text-[15px] outline-none placeholder:text-label3"
        />
        <button type="submit" className="flex items-center gap-1 rounded-lg bg-accent px-3 text-[15px] font-semibold text-white disabled:opacity-40" disabled={!name.trim()}>
          <Plus className="h-4 w-4" /> New
        </button>
      </form>
      <div className="scroll max-h-[50vh]">
        {mine.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => {
              add(p.id, tracks);
              done(p.name);
            }}
            className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-fill"
          >
            <Artwork src={p.tracks[0]?.thumb} className="w-11" radius={6} />
            <div className="min-w-0">
              <div className="truncate text-[15px]">{p.name}</div>
              <div className="text-[13px] text-label2">{p.tracks.length} songs</div>
            </div>
          </button>
        ))}
        {!mine.length && <div className="px-4 py-6 text-center text-[14px] text-label2">No playlists yet. Name one above.</div>}
      </div>
    </Sheet>
  );
}
