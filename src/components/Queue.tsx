import { Infinity as InfinityIcon, X } from 'lucide-react';
import { usePlayer } from '../store/player';
import { useSettings } from '../store/settings';
import { Artwork } from './Artwork';
import { RepeatButton, ShuffleButton } from './controls';
import { artistNames } from '../lib/hooks';

export function QueueView() {
  const queue = usePlayer((s) => s.queue);
  const index = usePlayer((s) => s.index);
  const source = usePlayer((s) => s.source);
  const jumpTo = usePlayer((s) => s.jumpTo);
  const removeAt = usePlayer((s) => s.removeAt);
  const clearUpcoming = usePlayer((s) => s.clearUpcoming);
  const autoplay = useSettings((s) => s.autoplay);
  const set = useSettings((s) => s.set);
  const upcoming = queue.slice(index + 1);

  return (
    <div className="flex h-full flex-col text-white">
      <div className="flex items-center justify-between px-6 pb-2 pt-1 md:px-8">
        <div>
          <div className="text-[17px] font-bold">Playing Next</div>
          {source?.label && <div className="text-[13px] text-white/55">From {source.label}</div>}
        </div>
        <div className="flex items-center gap-1">
          <ShuffleButton onDark />
          <RepeatButton onDark />
          <button
            type="button"
            aria-label="Autoplay"
            aria-pressed={autoplay}
            onClick={() => set({ autoplay: !autoplay })}
            className={`pressable flex h-8 w-8 items-center justify-center rounded-md ${autoplay ? 'bg-white/90 text-black/80' : 'text-white/70'}`}
          >
            <InfinityIcon className="h-[18px] w-[18px]" strokeWidth={2.4} />
          </button>
        </div>
      </div>
      <div className="scroll min-h-0 flex-1 px-4 md:px-6" style={{ maskImage: 'linear-gradient(to bottom, black 92%, transparent)' }}>
        {upcoming.map((t, k) => {
          const i = index + 1 + k;
          return (
            <div
              key={`${t.id}-${i}`}
              role="button"
              tabIndex={0}
              onClick={() => jumpTo(i)}
              className="group flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-white/10"
            >
              <Artwork src={t.thumb} className="w-11 shrink-0" radius={5} shadow={false} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[15px]">{t.title}</div>
                <div className="truncate text-[13px] text-white/55">{artistNames(t.artists)}</div>
              </div>
              <button
                type="button"
                aria-label="Remove from queue"
                onClick={(e) => {
                  e.stopPropagation();
                  removeAt(i);
                }}
                className="flex h-8 w-8 items-center justify-center rounded-full text-white/50 hover:bg-white/10 md:opacity-0 md:group-hover:opacity-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          );
        })}
        {!upcoming.length && (
          <div className="px-2 py-8 text-center text-[14px] text-white/55">
            {autoplay ? 'Similar songs will be added when this one ends.' : 'Nothing queued.'}
          </div>
        )}
        {upcoming.length > 0 && (
          <button type="button" onClick={clearUpcoming} className="mx-2 my-4 text-[14px] font-medium text-white/60 hover:text-white">
            Clear
          </button>
        )}
        <div className="h-10" />
      </div>
    </div>
  );
}
