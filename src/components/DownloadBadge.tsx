import { ArrowDown, ArrowDownCircle, CheckCircle2 } from 'lucide-react';
import { useDownloads } from '../store/downloads';
import type { Track } from '../yt/types';
import { downloadsSupported } from '../platform/download';
import { toast } from '../store/toast';

/** A small progress ring, Apple-style. */
export function ProgressRing({ value, size = 16 }: { value: number; size?: number }) {
  const r = (size - 3) / 2;
  const c = 2 * Math.PI * r;
  const waiting = value < 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className={`shrink-0 ${waiting ? 'animate-spin' : ''}`} aria-label={waiting ? 'Waiting to download' : `Downloading ${Math.round(value * 100)}%`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--fill-2)" strokeWidth={2} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="var(--accent)"
        strokeWidth={2}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={waiting ? c * 0.75 : c * (1 - Math.max(0.03, value))}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </svg>
  );
}

/** Shows next to a song: downloaded (arrow) or downloading (ring). */
export function DownloadBadge({ id }: { id: string }) {
  const done = useDownloads((s) => !!s.done[id]);
  const pending = useDownloads((s) => s.pending[id]?.progress);
  if (pending !== undefined) return <ProgressRing value={pending} size={14} />;
  if (done) return <ArrowDownCircle className="h-[14px] w-[14px] shrink-0 text-label2" strokeWidth={2.4} aria-label="Downloaded" />;
  return null;
}

/** Download button for an album, playlist or list of songs. */
export function DownloadAllButton({ tracks, className = '' }: { tracks: Track[]; className?: string }) {
  const download = useDownloads((s) => s.download);
  // Select the stable maps, then derive (a selector returning a new array each time would loop).
  const doneMap = useDownloads((s) => s.done);
  const pendingMap = useDownloads((s) => s.pending);
  const doneCount = tracks.filter((t) => doneMap[t.id]).length;
  const pending = tracks.filter((t) => pendingMap[t.id]).map((t) => pendingMap[t.id].progress);
  if (!downloadsSupported || !tracks.length) return null;
  const all = doneCount === tracks.length;
  const busy = pending.length > 0;
  const overall = busy ? (doneCount + pending.reduce((a, p) => a + Math.max(0, p), 0)) / tracks.length : 0;
  return (
    <button
      type="button"
      aria-label={all ? 'Downloaded' : busy ? 'Downloading' : 'Download'}
      title={all ? 'Downloaded' : busy ? `Downloading ${Math.round(overall * 100)}%` : 'Download'}
      onClick={() => (all ? toast('Already downloaded. Remove it from Library → Downloaded.') : download(tracks))}
      className={`pressable flex h-8 w-8 items-center justify-center rounded-full bg-fill text-accent ${className}`}
    >
      {busy ? <ProgressRing value={overall} size={18} /> : all ? <CheckCircle2 className="h-[18px] w-[18px]" strokeWidth={2.4} /> : <ArrowDown className="h-[18px] w-[18px]" strokeWidth={2.6} />}
    </button>
  );
}

export function formatBytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
