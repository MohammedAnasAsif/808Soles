import { ChevronDown, Ellipsis, Heart, ListMusic, MessageSquareQuote } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { usePlayer } from '../store/player';
import { useLibrary } from '../store/library';
import { useWide } from '../lib/hooks';
import { Artwork } from './Artwork';
import { NextButton, PlayButton, PrevButton, Scrubber, VolumeSlider } from './controls';
import { LyricsView } from './Lyrics';
import { QueueView } from './Queue';
import { openMenu } from './menu';
import { Explicit } from './TrackRow';
import type { Track } from '../yt/types';

function LikeButton({ track }: { track: Track }) {
  const liked = useLibrary((s) => s.liked.some((t) => t.id === track.id));
  const toggle = useLibrary((s) => s.toggleLike);
  return (
    <button
      type="button"
      aria-label={liked ? 'Unlove' : 'Love'}
      aria-pressed={liked}
      onClick={() => toggle(track)}
      className="pressable flex h-8 w-8 items-center justify-center rounded-full bg-white/15 text-white"
    >
      <Heart className={`h-[17px] w-[17px] ${liked ? 'fill-current' : ''}`} strokeWidth={2.4} />
    </button>
  );
}

function MoreButton({ track }: { track: Track }) {
  return (
    <button
      type="button"
      aria-label="More"
      onClick={(e) => openMenu(e, { track })}
      className="pressable flex h-8 w-8 items-center justify-center rounded-full bg-white/15 text-white"
    >
      <Ellipsis className="h-[18px] w-[18px]" strokeWidth={2.6} />
    </button>
  );
}

function TitleBlock({ track, onNavigate }: { track: Track; onNavigate(): void }) {
  const artist = track.artists.find((a) => a.id?.startsWith('UC'));
  return (
    <div className="flex items-center gap-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center text-[20px] font-semibold leading-6 text-white">
          <span className="truncate">{track.title}</span>
          {track.explicit && <Explicit />}
        </div>
        {artist ? (
          <Link to={`/artist/${artist.id}`} onClick={onNavigate} className="block truncate text-[19px] leading-6 text-white/60 hover:underline">
            {track.artists.map((a) => a.name).join(', ')}
          </Link>
        ) : (
          <div className="truncate text-[19px] leading-6 text-white/60">{track.artists.map((a) => a.name).join(', ')}</div>
        )}
      </div>
      <LikeButton track={track} />
      <MoreButton track={track} />
    </div>
  );
}

function Transport({ big }: { big?: boolean }) {
  return (
    <div className="flex items-center justify-center gap-10 text-white md:gap-12">
      <PrevButton size={big ? 36 : 30} />
      <PlayButton size={big ? 50 : 44} />
      <NextButton size={big ? 36 : 30} />
    </div>
  );
}

function PanelButtons() {
  const panel = usePlayer((s) => s.panel);
  const setPanel = usePlayer((s) => s.setPanel);
  const btn = (on: boolean) =>
    `pressable flex h-9 w-9 items-center justify-center rounded-lg ${on ? 'bg-white/90 text-black/80' : 'text-white/70'}`;
  return (
    <div className="flex items-center justify-around px-8">
      <button type="button" aria-label="Lyrics" aria-pressed={panel === 'lyrics'} onClick={() => setPanel('lyrics')} className={btn(panel === 'lyrics')}>
        <MessageSquareQuote className="h-5 w-5" strokeWidth={2.2} />
      </button>
      <button type="button" aria-label="Queue" aria-pressed={panel === 'queue'} onClick={() => setPanel('queue')} className={btn(panel === 'queue')}>
        <ListMusic className="h-5 w-5" strokeWidth={2.2} />
      </button>
    </div>
  );
}

export function NowPlaying() {
  const open = usePlayer((s) => s.nowPlayingOpen);
  const setOpen = usePlayer((s) => s.openNowPlaying);
  const track = usePlayer((s) => s.queue[s.index]);
  const playing = usePlayer((s) => s.playing);
  const panel = usePlayer((s) => s.panel);
  const wide = useWide();
  const [dragY, setDragY] = useState(0);
  const start = useRef<number | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  if (!open || !track) return null;
  const close = () => setOpen(false);

  const drag = {
    onTouchStart: (e: React.TouchEvent) => (start.current = e.touches[0].clientY),
    onTouchMove: (e: React.TouchEvent) => {
      if (start.current == null) return;
      setDragY(Math.max(0, e.touches[0].clientY - start.current));
    },
    onTouchEnd: () => {
      if (dragY > 110) close();
      setDragY(0);
      start.current = null;
    },
  };

  const bg = (
    <div className="absolute inset-0 overflow-hidden bg-neutral-900">
      {track.thumb && <div className="np-bg" style={{ backgroundImage: `url("${track.thumb}")` }} />}
      <div className="absolute inset-0 bg-black/25" />
    </div>
  );

  if (wide) {
    return (
      <div className="anim-sheet fixed inset-0 z-[60] text-white">
        {bg}
        <div className="relative flex h-full flex-col">
          <div className="drag flex h-12 shrink-0 items-center px-4">
            <button type="button" aria-label="Close" onClick={close} className="no-drag pressable flex h-9 w-9 items-center justify-center rounded-full bg-white/15">
              <ChevronDown className="h-5 w-5" />
            </button>
          </div>
          <div className={`grid min-h-0 flex-1 gap-10 px-12 pb-10 ${panel === 'none' ? 'grid-cols-1 place-items-center' : 'grid-cols-[minmax(320px,440px)_1fr]'}`}>
            <div className="flex w-full max-w-[min(440px,54vh)] flex-col justify-center gap-5 self-center">
              <div className="transition-transform duration-500 ease-out" style={{ transform: playing ? 'scale(1)' : 'scale(0.88)' }}>
                <Artwork src={track.thumb} radius={12} eager className="w-full" />
              </div>
              <TitleBlock track={track} onNavigate={close} />
              <Scrubber />
              <Transport big />
              <VolumeSlider />
              <PanelButtons />
            </div>
            {panel !== 'none' && <div className="min-h-0 self-stretch">{panel === 'lyrics' ? <LyricsView track={track} /> : <QueueView />}</div>}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="anim-sheet fixed inset-0 z-[60] overflow-hidden rounded-t-[14px] text-white"
      style={{ transform: dragY ? `translateY(${dragY}px)` : undefined, transition: dragY ? 'none' : 'transform 250ms ease' }}
    >
      {bg}
      <div className="relative flex h-full flex-col" style={{ paddingTop: 'calc(var(--sat) + 8px)', paddingBottom: 'calc(var(--sab) + 18px)' }}>
        <div {...drag} className="flex shrink-0 justify-center pb-3 pt-1" onClick={close}>
          <div className="h-[5px] w-10 rounded-full bg-white/40" />
        </div>

        {panel === 'none' ? (
          <div {...drag} className="flex min-h-0 flex-1 items-center justify-center px-7">
            <div className="w-full max-w-[420px] transition-transform duration-500 ease-out" style={{ transform: playing ? 'scale(1)' : 'scale(0.84)' }}>
              <Artwork src={track.thumb} radius={10} eager className="w-full" />
            </div>
          </div>
        ) : (
          <>
            <div className="flex shrink-0 items-center gap-3 px-6 pb-3">
              <Artwork src={track.thumb} radius={6} className="w-14 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[16px] font-semibold">{track.title}</div>
                <div className="truncate text-[15px] text-white/60">{track.artists.map((a) => a.name).join(', ')}</div>
              </div>
              <LikeButton track={track} />
              <MoreButton track={track} />
            </div>
            <div className="min-h-0 flex-1">{panel === 'lyrics' ? <LyricsView track={track} /> : <QueueView />}</div>
          </>
        )}

        <div className="shrink-0 space-y-5 px-7 pt-4">
          {panel === 'none' && <TitleBlock track={track} onNavigate={close} />}
          <Scrubber />
          <Transport />
          <VolumeSlider />
          <PanelButtons />
        </div>
      </div>
    </div>
  );
}
