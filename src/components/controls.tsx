import { FastForward, Pause, Play, Repeat, Repeat1, Rewind, Shuffle, Volume1, Volume2, VolumeX } from 'lucide-react';
import { useEffect, useState } from 'react';
import { usePlayer } from '../store/player';
import { formatTime } from '../lib/hooks';

export function PlayButton({ size = 28, className = '' }: { size?: number; className?: string }) {
  const playing = usePlayer((s) => s.playing);
  const loading = usePlayer((s) => s.loading);
  const toggle = usePlayer((s) => s.toggle);
  const Icon = playing ? Pause : Play;
  return (
    <button
      type="button"
      aria-label={playing ? 'Pause' : 'Play'}
      onClick={(e) => {
        e.stopPropagation();
        toggle();
      }}
      className={`pressable flex items-center justify-center ${loading ? 'opacity-50' : ''} ${className}`}
    >
      <Icon style={{ width: size, height: size }} className="fill-current" strokeWidth={0} />
    </button>
  );
}

export function NextButton({ size = 26, className = '' }: { size?: number; className?: string }) {
  const next = usePlayer((s) => s.next);
  return (
    <button
      type="button"
      aria-label="Next"
      onClick={(e) => {
        e.stopPropagation();
        next();
      }}
      className={`pressable flex items-center justify-center ${className}`}
    >
      <FastForward style={{ width: size, height: size }} className="fill-current" strokeWidth={0} />
    </button>
  );
}

export function PrevButton({ size = 26, className = '' }: { size?: number; className?: string }) {
  const previous = usePlayer((s) => s.previous);
  return (
    <button
      type="button"
      aria-label="Previous"
      onClick={(e) => {
        e.stopPropagation();
        previous();
      }}
      className={`pressable flex items-center justify-center ${className}`}
    >
      <Rewind style={{ width: size, height: size }} className="fill-current" strokeWidth={0} />
    </button>
  );
}

export function ShuffleButton({ size = 18, onDark }: { size?: number; onDark?: boolean }) {
  const shuffle = usePlayer((s) => s.shuffle);
  const toggle = usePlayer((s) => s.toggleShuffle);
  return (
    <button
      type="button"
      aria-label="Shuffle"
      aria-pressed={shuffle}
      onClick={toggle}
      className={`pressable flex h-8 w-8 items-center justify-center rounded-md ${
        shuffle ? (onDark ? 'bg-white/90 text-black/80' : 'text-accent') : onDark ? 'text-white/70' : 'text-label2'
      }`}
    >
      <Shuffle style={{ width: size, height: size }} strokeWidth={2.4} />
    </button>
  );
}

export function RepeatButton({ size = 18, onDark }: { size?: number; onDark?: boolean }) {
  const repeat = usePlayer((s) => s.repeat);
  const cycle = usePlayer((s) => s.cycleRepeat);
  const Icon = repeat === 'one' ? Repeat1 : Repeat;
  const on = repeat !== 'off';
  return (
    <button
      type="button"
      aria-label={`Repeat ${repeat}`}
      onClick={cycle}
      className={`pressable flex h-8 w-8 items-center justify-center rounded-md ${
        on ? (onDark ? 'bg-white/90 text-black/80' : 'text-accent') : onDark ? 'text-white/70' : 'text-label2'
      }`}
    >
      <Icon style={{ width: size, height: size }} strokeWidth={2.4} />
    </button>
  );
}

/** Progress bar you can drag; shows elapsed and remaining time. */
export function Scrubber({ onDark = true, small, showTimes = true }: { onDark?: boolean; small?: boolean; showTimes?: boolean }) {
  const position = usePlayer((s) => s.position);
  const duration = usePlayer((s) => s.duration);
  const seek = usePlayer((s) => s.seek);
  const [drag, setDrag] = useState<number | null>(null);
  const shown = drag ?? position;
  const pct = duration > 0 ? Math.min(100, (shown / duration) * 100) : 0;
  return (
    <div className="w-full">
      <input
        type="range"
        min={0}
        max={duration || 1}
        step={0.1}
        value={Math.min(shown, duration || 1)}
        aria-label="Seek"
        onChange={(e) => setDrag(Number(e.target.value))}
        onPointerUp={() => {
          if (drag != null) seek(drag);
          setDrag(null);
        }}
        onKeyUp={() => {
          if (drag != null) seek(drag);
          setDrag(null);
        }}
        className={`scrubber ${onDark ? '' : 'dark-on-light'} ${small ? 'small' : ''}`}
        style={{ ['--pct' as string]: `${pct}%` }}
      />
      {showTimes && (
        <div className={`-mt-0.5 flex justify-between text-[11px] font-medium tabular-nums ${onDark ? 'text-white/55' : 'text-label2'}`}>
          <span>{formatTime(shown)}</span>
          <span>-{formatTime(Math.max(0, duration - shown))}</span>
        </div>
      )}
    </div>
  );
}

export function VolumeSlider({ onDark = true }: { onDark?: boolean }) {
  const volume = usePlayer((s) => s.volume);
  const setVolume = usePlayer((s) => s.setVolume);
  const [before, setBefore] = useState(1);
  useEffect(() => {
    if (volume > 0) setBefore(volume);
  }, [volume]);
  const Icon = volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;
  return (
    <div className={`flex w-full items-center gap-2 ${onDark ? 'text-white/60' : 'text-label2'}`}>
      <button type="button" aria-label="Mute" onClick={() => setVolume(volume ? 0 : before)} className="shrink-0">
        <Icon className="h-4 w-4" />
      </button>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={volume}
        aria-label="Volume"
        onChange={(e) => setVolume(Number(e.target.value))}
        className={`scrubber small ${onDark ? '' : 'dark-on-light'}`}
        style={{ ['--pct' as string]: `${volume * 100}%` }}
      />
    </div>
  );
}
