import { Play, Plus, Check, Radio } from 'lucide-react';
import { useParams } from 'react-router';
import { useState } from 'react';
import { getArtist, getWatchPlaylist } from '../yt/api';
import { useAsync } from '../lib/hooks';
import { ErrorView, Loading, BackButton } from '../components/Page';
import { ShelfView, ShelfHeader, SongGrid } from '../components/Shelf';
import { usePlayer } from '../store/player';
import { useLibrary } from '../store/library';
import { toast } from '../store/toast';

export default function Artist() {
  const { id = '' } = useParams();
  const { data, error, loading, reload } = useAsync(() => getArtist(id), [id]);
  const playTracks = usePlayer((s) => s.playTracks);
  const saved = useLibrary((s) => s.isSaved({ kind: 'artist', id }));
  const toggleSave = useLibrary((s) => s.toggleSave);
  const [starting, setStarting] = useState(false);

  if (loading && !data) return <div className="pt-16"><Loading /></div>;
  if (error || !data) return <div className="pt-16"><ErrorView error={error} retry={reload} /></div>;

  const start = async (playlistId: string | undefined, label: string) => {
    if (!playlistId) {
      if (data.topSongs.length) playTracks(data.topSongs, 0, { label, radio: true });
      return;
    }
    setStarting(true);
    try {
      const tracks = await getWatchPlaylist(playlistId);
      if (tracks.length) playTracks(tracks, 0, { label, radio: true });
      else if (data.topSongs.length) playTracks(data.topSongs, 0, { label, radio: true });
    } catch {
      toast('Couldn’t start playback.');
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="pb-8">
      <div className="relative">
        <div className="relative aspect-square max-h-[62vh] w-full overflow-hidden bg-fill md:aspect-[3/1] md:max-h-none">
          {data.thumb && <img src={data.thumb} alt="" referrerPolicy="no-referrer" className="absolute inset-0 h-full w-full object-cover object-[50%_25%]" />}
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
        </div>
        <div className="absolute left-4 top-0" style={{ paddingTop: 'calc(var(--sat) + 10px)' }}>
          <BackButton overlay />
        </div>
        <div className="px-gutter absolute inset-x-0 bottom-0 flex items-end justify-between gap-4 pb-5">
          <h1 className="text-[34px] font-extrabold leading-[1.05] tracking-[-0.02em] text-white drop-shadow md:text-[52px]">{data.name}</h1>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              aria-label={saved ? 'Unfollow' : 'Follow'}
              onClick={() => toggleSave({ kind: 'artist', id, title: data.name, thumb: data.thumb })}
              className="pressable flex h-10 w-10 items-center justify-center rounded-full bg-white/20 text-white backdrop-blur"
            >
              {saved ? <Check className="h-5 w-5" strokeWidth={2.6} /> : <Plus className="h-5 w-5" strokeWidth={2.6} />}
            </button>
            <button
              type="button"
              aria-label="Station"
              onClick={() => start(data.radioId, `${data.name} Station`)}
              className="pressable flex h-10 w-10 items-center justify-center rounded-full bg-white/20 text-white backdrop-blur"
            >
              <Radio className="h-5 w-5" strokeWidth={2.4} />
            </button>
            <button
              type="button"
              aria-label="Play"
              disabled={starting}
              onClick={() => start(data.shuffleId, data.name)}
              className="pressable flex h-12 w-12 items-center justify-center rounded-full bg-accent text-white disabled:opacity-60"
            >
              <Play className="h-6 w-6 translate-x-[1px] fill-current" strokeWidth={0} />
            </button>
          </div>
        </div>
      </div>

      {data.topSongs.length > 0 && (
        <section className="mb-9 mt-6">
          <ShelfHeader title="Top Songs" to={data.topSongsPlaylist ? `/playlist/${data.topSongsPlaylist}` : undefined} />
          <SongGrid tracks={data.topSongs} label={`${data.name} Top Songs`} />
        </section>
      )}

      {data.shelves.map((s, i) => (
        <ShelfView key={s.title + i} shelf={s} />
      ))}

      {data.description && (
        <section className="px-gutter mb-8">
          <h2 className="section-title mb-2">About {data.name}</h2>
          <p className="max-w-[720px] whitespace-pre-line text-[15px] leading-6 text-label2">{data.description}</p>
        </section>
      )}
    </div>
  );
}
