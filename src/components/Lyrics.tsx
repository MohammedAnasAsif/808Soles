import { useEffect, useMemo, useRef, useState } from 'react';
import { usePlayer } from '../store/player';
import { getLyrics } from '../yt/lyrics';
import type { Lyrics as LyricsT, Track } from '../yt/types';

export function LyricsView({ track }: { track: Track }) {
  const duration = usePlayer((s) => s.duration);
  const position = usePlayer((s) => s.position);
  const seek = usePlayer((s) => s.seek);
  const [lyrics, setLyrics] = useState<LyricsT | null | undefined>(undefined);
  const box = useRef<HTMLDivElement>(null);
  const userScrolledAt = useRef(0);

  useEffect(() => {
    let alive = true;
    setLyrics(undefined);
    getLyrics(track, duration || undefined).then((l) => alive && setLyrics(l));
    return () => {
      alive = false;
    };
    // duration only matters for the first lookup
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track.id]);

  const active = useMemo(() => {
    if (!lyrics?.synced) return -1;
    const t = position + 0.35;
    let i = -1;
    for (let j = 0; j < lyrics.lines.length; j++) {
      if (lyrics.lines[j].time <= t) i = j;
      else break;
    }
    return i;
  }, [lyrics, position]);

  useEffect(() => {
    if (active < 0 || !box.current) return;
    if (Date.now() - userScrolledAt.current < 3500) return;
    const el = box.current.querySelector<HTMLElement>(`[data-line="${active}"]`);
    if (!el) return;
    const top = el.offsetTop - box.current.clientHeight * 0.28;
    box.current.scrollTo({ top, behavior: 'smooth' });
  }, [active]);

  if (lyrics === undefined) {
    return (
      <div className="flex h-full flex-col gap-5 px-6 pt-10">
        {[70, 55, 80, 45, 65].map((w, i) => (
          <div key={i} className="h-7 rounded-md bg-white/10" style={{ width: `${w}%` }} />
        ))}
      </div>
    );
  }
  if (!lyrics) {
    return <div className="flex h-full items-center justify-center px-8 text-center text-[17px] font-semibold text-white/50">No lyrics for this song yet.</div>;
  }

  return (
    <div
      ref={box}
      className="scroll relative h-full px-6 md:px-10"
      style={{ maskImage: 'linear-gradient(to bottom, transparent 0, black 8%, black 80%, transparent 100%)' }}
      onWheel={() => (userScrolledAt.current = Date.now())}
      onTouchMove={() => (userScrolledAt.current = Date.now())}
    >
      <div className="h-[22vh]" />
      {lyrics.lines.map((l, i) => {
        const isActive = !lyrics.synced || i === active;
        const past = lyrics.synced && i < active;
        const dist = Math.abs(i - active);
        if (!l.text && lyrics.synced) {
          return (
            <div key={i} data-line={i} className="py-3">
              {i === active && <span className="text-[28px] font-bold text-white/80">• • •</span>}
            </div>
          );
        }
        return (
          <button
            key={i}
            type="button"
            data-line={i}
            onClick={() => lyrics.synced && seek(l.time)}
            className="lyric-line block w-full py-2.5 text-left text-[26px] font-bold leading-[1.22] tracking-[-0.01em] text-white md:text-[34px]"
            style={{
              opacity: isActive ? 1 : past ? 0.32 : 0.4,
              filter: lyrics.synced && !isActive ? `blur(${Math.min(2, dist * 0.5)}px)` : undefined,
              transform: isActive && lyrics.synced ? 'scale(1.02)' : 'scale(1)',
            }}
          >
            {l.text}
          </button>
        );
      })}
      <div className="pb-[40vh] pt-8 text-[12px] font-medium text-white/40">Lyrics from {lyrics.source}</div>
    </div>
  );
}
