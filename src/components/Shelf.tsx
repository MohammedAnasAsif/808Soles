import { ChevronRight, Play } from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import type { Card, Shelf as ShelfT } from '../yt/types';
import { Artwork } from './Artwork';
import { hrefFor } from '../lib/nav';
import { usePlayer } from '../store/player';
import { openMenu } from './menu';
import { TrackRow } from './TrackRow';

export function useOpenCard() {
  const navigate = useNavigate();
  const playRadio = usePlayer((s) => s.playRadio);
  return (c: Card) => {
    if ((c.kind === 'song' || c.kind === 'video') && c.track) return playRadio(c.track);
    const href = hrefFor(c);
    if (href) navigate(href);
  };
}

export function CardTile({ card, size = 'md' }: { card: Card; size?: 'md' | 'lg' }) {
  const open = useOpenCard();
  const round = card.kind === 'artist';
  const w = size === 'lg' ? 'w-[200px] md:w-[220px]' : 'w-[152px] md:w-[176px]';
  return (
    <button
      type="button"
      onClick={() => open(card)}
      onContextMenu={(e) => openMenu(e, { card, track: card.track })}
      className={`pressable group shrink-0 text-left ${w}`}
    >
      <div className="relative">
        <Artwork src={card.thumb} round={round} alt={card.title} />
        {!round && (
          <span className="absolute bottom-2 right-2 hidden h-8 w-8 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur group-hover:flex">
            <Play className="h-4 w-4 translate-x-[1px] fill-current" />
          </span>
        )}
      </div>
      <div className={`mt-2 ${round ? 'text-center' : ''}`}>
        <div className="line-clamp-1 text-[13px] font-medium leading-[18px] text-label">{card.title}</div>
        {card.subtitle && <div className="line-clamp-1 text-[13px] leading-[18px] text-label2">{card.subtitle}</div>}
      </div>
    </button>
  );
}

export function MoodChip({ card }: { card: Card }) {
  const href = hrefFor(card)!;
  return (
    <Link
      to={href}
      className="pressable relative flex h-[68px] shrink-0 items-end overflow-hidden rounded-xl p-3 text-[15px] font-semibold text-white"
      style={{ background: `linear-gradient(135deg, ${card.color ?? '#555'} 0%, color-mix(in srgb, ${card.color ?? '#555'} 55%, black) 100%)` }}
    >
      <span className="line-clamp-2 leading-tight drop-shadow">{card.title}</span>
    </Link>
  );
}

export function ShelfHeader({ title, strapline, to }: { title: string; strapline?: string; to?: string }) {
  return (
    <div className="px-gutter mb-3">
      {strapline && <div className="text-[12px] font-semibold uppercase tracking-wide text-label2">{strapline}</div>}
      {to ? (
        <Link to={to} className="inline-flex items-center gap-0.5">
          <h2 className="section-title">{title}</h2>
          <ChevronRight className="mt-0.5 h-5 w-5 text-label3" strokeWidth={2.6} />
        </Link>
      ) : (
        <h2 className="section-title">{title}</h2>
      )}
    </div>
  );
}

export function ShelfView({ shelf }: { shelf: ShelfT }) {
  const more = shelf.more ? hrefFor({ kind: shelf.more.id.startsWith('VL') ? 'playlist' : 'mood', id: shelf.more.id, params: shelf.more.params }) : null;
  if (shelf.layout === 'chips') {
    return (
      <section className="mb-9">
        <ShelfHeader title={shelf.title} strapline={shelf.strapline} />
        <div className="px-gutter grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {shelf.items.slice(0, 20).map((c) => (
            <MoodChip key={c.id + (c.params ?? '') + c.title} card={c} />
          ))}
        </div>
      </section>
    );
  }
  if (shelf.layout === 'list') {
    const tracks = shelf.items.filter((c) => c.track).map((c) => c.track!);
    if (tracks.length === shelf.items.length) {
      return (
        <section className="mb-9">
          <ShelfHeader title={shelf.title} strapline={shelf.strapline} to={more ?? undefined} />
          <SongGrid tracks={tracks} label={shelf.title} />
        </section>
      );
    }
  }
  return (
    <section className="mb-9">
      <ShelfHeader title={shelf.title} strapline={shelf.strapline} to={more ?? undefined} />
      <div className="hscroll px-gutter flex gap-4">
        {shelf.items.map((c, i) => (
          <CardTile key={c.kind + c.id + i} card={c} />
        ))}
        <div className="w-1 shrink-0" />
      </div>
    </section>
  );
}

/** Apple Music's paged song columns: 4 rows per column, scrolling sideways. */
export function SongGrid({ tracks, label }: { tracks: import('../yt/types').Track[]; label: string }) {
  const playTracks = usePlayer((s) => s.playTracks);
  const cols: (typeof tracks)[] = [];
  for (let i = 0; i < tracks.length; i += 4) cols.push(tracks.slice(i, i + 4));
  return (
    <div className="hscroll px-gutter flex gap-4">
      {cols.map((col, ci) => (
        <div key={ci} className="w-[calc(100vw-56px)] max-w-[380px] shrink-0">
          {col.map((t, ri) => (
            <TrackRow
              key={t.id}
              track={t}
              compact
              onPlay={() => playTracks(tracks, ci * 4 + ri, { label, radio: true })}
            />
          ))}
        </div>
      ))}
      <div className="w-1 shrink-0" />
    </div>
  );
}
