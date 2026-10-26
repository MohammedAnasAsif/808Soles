import { Ellipsis } from 'lucide-react';
import type { Track } from '../yt/types';
import { Artwork } from './Artwork';
import { usePlayer } from '../store/player';
import { openMenu, type MenuTarget } from './menu';
import { artistNames, formatTime } from '../lib/hooks';
import { DownloadBadge } from './DownloadBadge';

export function Explicit() {
  return (
    <span className="ml-1 inline-flex h-[14px] w-[14px] shrink-0 items-center justify-center rounded-[3px] bg-label3 text-[9px] font-bold leading-none text-bg">
      E
    </span>
  );
}

export function Eq({ paused }: { paused?: boolean }) {
  return (
    <span className={`eq inline-flex h-[14px] items-end ${paused ? 'paused' : ''}`} aria-label="Now playing">
      <span />
      <span />
      <span />
    </span>
  );
}

interface Props {
  track: Track;
  onPlay(): void;
  /** Show a track number instead of artwork (album pages). */
  number?: number;
  compact?: boolean;
  showAlbum?: boolean;
  menu?: Omit<MenuTarget, 'track'>;
  /** Hide the artist line (album pages where every track is by the album artist). */
  hideArtist?: boolean;
}

export function TrackRow({ track, onPlay, number, compact, showAlbum, menu, hideArtist }: Props) {
  const isCurrent = usePlayer((s) => s.queue[s.index]?.id === track.id);
  const playing = usePlayer((s) => s.playing);
  const sub = [hideArtist ? '' : artistNames(track.artists), showAlbum ? track.album?.name : ''].filter(Boolean).join(' · ');
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onPlay}
      onKeyDown={(e) => e.key === 'Enter' && onPlay()}
      onContextMenu={(e) => openMenu(e, { ...menu, track })}
      className={`group flex items-center gap-3 rounded-lg ${number != null ? 'py-0' : compact ? 'py-1.5' : 'py-2'} pr-1 outline-none hover:bg-fill/60 focus-visible:bg-fill active:bg-fill`}
    >
      {number != null ? (
        <div className="flex w-7 shrink-0 justify-center text-[15px] tabular-nums text-label2">
          {isCurrent ? <Eq paused={!playing} /> : number}
        </div>
      ) : (
        <div className="relative w-12 shrink-0">
          <Artwork src={track.thumb} radius={5} shadow={false} />
          {isCurrent && (
            <div className="absolute inset-0 flex items-center justify-center rounded-[5px] bg-black/45">
              <Eq paused={!playing} />
            </div>
          )}
        </div>
      )}
      <div className={`min-w-0 flex-1 ${number != null ? 'border-b border-sep py-2.5' : ''}`}>
        <div className={`flex items-center text-[15px] leading-5 ${isCurrent ? 'text-accent' : 'text-label'}`}>
          <span className="truncate">{track.title}</span>
          {track.explicit && <Explicit />}
          <span className="ml-1.5 inline-flex">
            <DownloadBadge id={track.id} />
          </span>
        </div>
        {sub && <div className="truncate text-[13px] leading-[18px] text-label2">{sub}</div>}
      </div>
      {!compact && track.duration ? (
        <div className="hidden shrink-0 text-[13px] tabular-nums text-label2 sm:block">{formatTime(track.duration)}</div>
      ) : null}
      <button
        type="button"
        aria-label="More"
        onClick={(e) => openMenu(e, { ...menu, track })}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-label2 hover:bg-fill"
      >
        <Ellipsis className="h-5 w-5" />
      </button>
    </div>
  );
}
