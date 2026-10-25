import { Search as SearchIcon, X, Clock } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { getExplore, search, suggestions } from '../yt/api';
import { useAsync, useDebounced } from '../lib/hooks';
import { ErrorView, Loading } from '../components/Page';
import { CardTile, MoodChip, ShelfHeader, useOpenCard } from '../components/Shelf';
import { TrackRow } from '../components/TrackRow';
import { Artwork } from '../components/Artwork';
import { usePlayer } from '../store/player';
import { useLibrary } from '../store/library';
import type { Card, SearchResults, Track } from '../yt/types';

type Filter = 'all' | 'song' | 'album' | 'artist' | 'playlist' | 'video';
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'Top Results' },
  { id: 'song', label: 'Songs' },
  { id: 'album', label: 'Albums' },
  { id: 'artist', label: 'Artists' },
  { id: 'playlist', label: 'Playlists' },
  { id: 'video', label: 'Videos' },
];

export default function Search() {
  const [sp, setSp] = useSearchParams();
  const q = sp.get('q') ?? '';
  const filter = (sp.get('f') as Filter) || 'all';
  const [input, setInput] = useState(q);
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const addSearch = useLibrary((s) => s.addSearch);

  useEffect(() => setInput(q), [q]);

  const submit = (value: string) => {
    const v = value.trim();
    if (!v) return;
    addSearch(v);
    setSp({ q: v, ...(filter !== 'all' ? { f: filter } : {}) });
    inputRef.current?.blur();
    setFocused(false);
  };

  const typing = focused && input.trim() !== '' && input !== q;

  return (
    <div className="pb-8">
      <div className="glass sticky top-0 z-20 px-gutter pb-2" style={{ paddingTop: 'calc(var(--sat) + 12px)' }}>
        <h1 className="large-title mb-2 md:hidden">Search</h1>
        <form
          className="flex items-center gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit(input);
          }}
        >
          <label className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-[10px] bg-fill px-2.5">
            <SearchIcon className="h-[17px] w-[17px] shrink-0 text-label2" />
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onFocus={() => setFocused(true)}
              onBlur={() => setTimeout(() => setFocused(false), 150)}
              placeholder="Artists, Songs, Lyrics, and More"
              enterKeyHint="search"
              autoCorrect="off"
              autoCapitalize="off"
              className="min-w-0 flex-1 bg-transparent text-[17px] outline-none placeholder:text-label2"
            />
            {input && (
              <button type="button" aria-label="Clear" onClick={() => (setInput(''), inputRef.current?.focus())} className="rounded-full bg-label3 p-0.5 text-bg">
                <X className="h-3 w-3" strokeWidth={3} />
              </button>
            )}
          </label>
          {(focused || q) && (
            <button
              type="button"
              className="shrink-0 text-[17px] text-accent"
              onClick={() => {
                setInput('');
                setSp({});
                inputRef.current?.blur();
              }}
            >
              Cancel
            </button>
          )}
        </form>
        {q && !typing && (
          <div className="hscroll -mx-[var(--gutter)] mt-3 flex gap-2 px-gutter">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setSp({ q, ...(f.id !== 'all' ? { f: f.id } : {}) })}
                className={`shrink-0 rounded-full px-3.5 py-1.5 text-[14px] font-medium ${filter === f.id ? 'bg-accent text-white' : 'bg-fill text-label'}`}
              >
                {f.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {typing ? <Suggestions input={input} onPick={submit} /> : q ? <Results q={q} filter={filter} /> : <Landing onPick={submit} />}
    </div>
  );
}

function Suggestions({ input, onPick }: { input: string; onPick(q: string): void }) {
  const d = useDebounced(input, 180);
  const { data } = useAsync(() => suggestions(d), [d]);
  const playRadio = usePlayer((s) => s.playRadio);
  return (
    <div className="px-gutter pt-1">
      {data?.queries.map((s) => (
        <button key={s} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => onPick(s)} className="flex w-full items-center gap-3 border-b border-sep py-3 text-left text-[17px]">
          <SearchIcon className="h-4 w-4 text-label2" />
          {s}
        </button>
      ))}
      {data?.tracks.map((t) => <TrackRow key={t.id} track={t} onPlay={() => playRadio(t)} />)}
    </div>
  );
}

function Landing({ onPick }: { onPick(q: string): void }) {
  const recent = useLibrary((s) => s.recentSearches);
  const clear = useLibrary((s) => s.clearSearches);
  const { data } = useAsync(getExplore, []);
  const moods = data?.find((s) => s.layout === 'chips');
  return (
    <div className="pt-3">
      {recent.length > 0 && (
        <section className="px-gutter mb-8">
          <div className="mb-1 flex items-baseline justify-between">
            <h2 className="section-title">Recently Searched</h2>
            <button type="button" onClick={clear} className="text-[15px] text-accent">
              Clear
            </button>
          </div>
          {recent.map((r) => (
            <button key={r} type="button" onClick={() => onPick(r)} className="flex w-full items-center gap-3 border-b border-sep py-3 text-left text-[17px]">
              <Clock className="h-4 w-4 text-label2" />
              {r}
            </button>
          ))}
        </section>
      )}
      {moods && (
        <section>
          <ShelfHeader title="Browse Categories" />
          <div className="px-gutter grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {moods.items.map((c) => (
              <MoodChip key={c.id + c.title} card={c} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function TopResult({ card }: { card: Card }) {
  const open = useOpenCard();
  return (
    <button type="button" onClick={() => open(card)} className="pressable flex w-full items-center gap-4 rounded-xl bg-elev p-4 text-left md:max-w-[460px]">
      <Artwork src={card.thumb} round={card.kind === 'artist'} className="w-20 shrink-0" />
      <div className="min-w-0">
        <div className="truncate text-[20px] font-bold">{card.title}</div>
        <div className="truncate text-[14px] text-label2">{card.subtitle ?? card.kind[0].toUpperCase() + card.kind.slice(1)}</div>
      </div>
    </button>
  );
}

function CardRow({ title, cards }: { title: string; cards: Card[] }) {
  if (!cards.length) return null;
  return (
    <section className="mb-8">
      <ShelfHeader title={title} />
      <div className="hscroll px-gutter flex gap-4">
        {cards.map((c) => (
          <CardTile key={c.id} card={c} />
        ))}
        <div className="w-1 shrink-0" />
      </div>
    </section>
  );
}

function SongList({ title, tracks, limit }: { title?: string; tracks: Track[]; limit?: number }) {
  const playTracks = usePlayer((s) => s.playTracks);
  const playRadio = usePlayer((s) => s.playRadio);
  if (!tracks.length) return null;
  const shown = limit ? tracks.slice(0, limit) : tracks;
  return (
    <section className="mb-8">
      {title && <ShelfHeader title={title} />}
      <div className="px-gutter md:grid md:grid-cols-2 md:gap-x-6">
        {shown.map((t, i) => (
          <TrackRow key={t.id} track={t} onPlay={() => (limit ? playRadio(t) : playTracks(tracks, i, { label: 'Search', radio: true }))} />
        ))}
      </div>
    </section>
  );
}

function Results({ q, filter }: { q: string; filter: Filter }) {
  const { data, error, loading, reload } = useAsync<SearchResults>(() => search(q, filter), [q, filter]);
  if (loading && !data) return <Loading rows={2} />;
  if (error && !data) return <ErrorView error={error} retry={reload} />;
  if (!data) return null;
  const nothing = !data.top && !data.songs.length && !data.albums.length && !data.artists.length && !data.playlists.length && !data.videos.length;
  if (nothing) return <div className="px-gutter py-16 text-center text-[17px] text-label2">No results for “{q}”.</div>;

  if (filter === 'song') return <div className="pt-3"><SongList tracks={data.songs} /></div>;
  if (filter === 'video') return <div className="pt-3"><SongList tracks={data.videos} /></div>;
  const grid = (cards: Card[]) => (
    <div className="px-gutter grid grid-cols-2 gap-x-4 gap-y-6 pt-3 sm:grid-cols-3 lg:grid-cols-5">
      {cards.map((c) => (
        <div key={c.id} className="[&>button]:w-full">
          <CardTile card={c} />
        </div>
      ))}
    </div>
  );
  if (filter === 'album') return grid(data.albums);
  if (filter === 'artist') return grid(data.artists);
  if (filter === 'playlist') return grid(data.playlists);

  return (
    <div className="pt-4">
      {data.top && (
        <section className="px-gutter mb-8">
          <h2 className="section-title mb-3">Top Result</h2>
          <TopResult card={data.top} />
        </section>
      )}
      <SongList title="Songs" tracks={data.songs.filter((t) => t.id !== data.top?.id)} limit={8} />
      <CardRow title="Artists" cards={data.artists} />
      <CardRow title="Albums" cards={data.albums} />
      <CardRow title="Playlists" cards={data.playlists} />
      <SongList title="Videos" tracks={data.videos} limit={6} />
    </div>
  );
}
