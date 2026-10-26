import { Ellipsis, Play, Shuffle, Plus, Check } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Artwork } from './Artwork';
import { BackButton } from './Page';
import { usePlayer } from '../store/player';
import type { ArtistRef, Card, Track } from '../yt/types';
import { useLibrary } from '../store/library';
import { openMenu } from './menu';
import { DownloadAllButton } from './DownloadBadge';

interface Props {
  thumb?: string;
  title: string;
  artists?: ArtistRef[];
  byline?: string;
  meta?: string;
  description?: string;
  tracks: Track[];
  label: string;
  /** For the library toggle and the menu. */
  card?: Card;
  extraActions?: ReactNode;
}

export function CollectionHeader({ thumb, title, artists, byline, meta, description, tracks, label, card, extraActions }: Props) {
  const playTracks = usePlayer((s) => s.playTracks);
  const [expanded, setExpanded] = useState(false);
  const saved = useLibrary((s) => (card ? s.isSaved(card) : false));
  const toggleSave = useLibrary((s) => s.toggleSave);

  const play = (shuffle: boolean) => {
    if (!tracks.length) return;
    const p = usePlayer.getState();
    if (shuffle !== p.shuffle) p.toggleShuffle();
    const start = shuffle ? Math.floor(Math.random() * tracks.length) : 0;
    playTracks(tracks, start, { label, radio: false });
  };

  return (
    <div className="px-gutter" style={{ paddingTop: 'calc(var(--sat) + 12px)' }}>
      <div className="flex h-9 items-center justify-between">
        <BackButton />
        <div className="ml-auto flex items-center gap-1">
          {extraActions}
          <DownloadAllButton tracks={tracks} />
          {card && (
            <button
              type="button"
              aria-label={saved ? 'Remove from Library' : 'Add to Library'}
              onClick={() => toggleSave(card)}
              className="pressable flex h-8 w-8 items-center justify-center rounded-full bg-fill text-accent"
            >
              {saved ? <Check className="h-[18px] w-[18px]" strokeWidth={2.6} /> : <Plus className="h-[18px] w-[18px]" strokeWidth={2.6} />}
            </button>
          )}
          {card && (
            <button type="button" aria-label="More" onClick={(e) => openMenu(e, { card })} className="pressable flex h-8 w-8 items-center justify-center rounded-full bg-fill text-accent">
              <Ellipsis className="h-[18px] w-[18px]" strokeWidth={2.6} />
            </button>
          )}
        </div>
      </div>

      <div className="mt-2 flex flex-col items-center gap-5 md:flex-row md:items-end md:gap-8">
        <Artwork src={thumb} eager radius={10} className="w-[min(68vw,270px)] shrink-0 md:w-[240px]" />
        <div className="flex w-full min-w-0 flex-col items-center text-center md:items-start md:text-left">
          <h1 className="text-[22px] font-bold leading-7 tracking-[-0.01em] md:text-[28px] md:leading-9">{title}</h1>
          {artists?.length ? (
            <div className="mt-0.5 text-[20px] leading-6 text-accent md:text-[22px]">
              {artists.map((a, i) => (
                <span key={a.name + i}>
                  {i > 0 && ', '}
                  {a.id?.startsWith('UC') ? (
                    <Link to={`/artist/${a.id}`} className="hover:underline">
                      {a.name}
                    </Link>
                  ) : (
                    a.name
                  )}
                </span>
              ))}
            </div>
          ) : byline ? (
            <div className="mt-0.5 text-[20px] leading-6 text-accent">{byline}</div>
          ) : null}
          {meta && <div className="mt-1 text-[12px] font-semibold uppercase tracking-wide text-label2">{meta}</div>}

          <div className="mt-4 grid w-full max-w-[420px] grid-cols-2 gap-3 md:w-auto md:grid-cols-[150px_150px]">
            <button type="button" onClick={() => play(false)} disabled={!tracks.length} className="pressable flex h-11 items-center justify-center gap-1.5 rounded-[10px] bg-fill text-[16px] font-semibold text-accent disabled:opacity-40">
              <Play className="h-[17px] w-[17px] fill-current" strokeWidth={0} /> Play
            </button>
            <button type="button" onClick={() => play(true)} disabled={!tracks.length} className="pressable flex h-11 items-center justify-center gap-1.5 rounded-[10px] bg-fill text-[16px] font-semibold text-accent disabled:opacity-40">
              <Shuffle className="h-[17px] w-[17px]" strokeWidth={2.6} /> Shuffle
            </button>
          </div>

          {description && (
            <button type="button" onClick={() => setExpanded(!expanded)} className="mt-4 max-w-[640px] text-left text-[14px] leading-5 text-label2">
              <span className={expanded ? '' : 'line-clamp-3'}>{description}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
