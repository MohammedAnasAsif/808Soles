import { useEffect, useState, type ReactNode } from 'react';
import { diagLines, onDiag } from '../lib/diag';
import { toast } from '../store/toast';
import { Page } from '../components/Page';
import { useSettings } from '../store/settings';
import type { Quality } from '../yt/api';

function Group({ title, footer, children }: { title?: string; footer?: string; children: ReactNode }) {
  return (
    <section className="px-gutter mb-7">
      {title && <div className="mb-1.5 px-4 text-[13px] uppercase tracking-wide text-label2">{title}</div>}
      <div className="overflow-hidden rounded-[10px] bg-elev">{children}</div>
      {footer && <div className="mt-1.5 px-4 text-[13px] leading-[18px] text-label2">{footer}</div>}
    </section>
  );
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange(v: boolean): void }) {
  return (
    <label className="flex items-center justify-between border-b border-sep px-4 py-2.5 last:border-0">
      <span className="text-[17px]">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        onClick={() => onChange(!value)}
        className={`relative h-[31px] w-[51px] rounded-full transition-colors ${value ? 'bg-[#34c759]' : 'bg-fill2'}`}
      >
        <span className={`absolute top-[2px] h-[27px] w-[27px] rounded-full bg-white shadow transition-transform ${value ? 'translate-x-[22px]' : 'translate-x-[2px]'}`} />
      </button>
    </label>
  );
}

function Choice<T extends string>({ value, options, onChange }: { value: T; options: { id: T; label: string }[]; onChange(v: T): void }) {
  return (
    <>
      {options.map((o) => (
        <button key={o.id} type="button" onClick={() => onChange(o.id)} className="flex w-full items-center justify-between border-b border-sep px-4 py-2.5 text-left text-[17px] last:border-0">
          {o.label}
          {value === o.id && <span className="text-accent">✓</span>}
        </button>
      ))}
    </>
  );
}

function Diagnostics() {
  const [lines, setLines] = useState(diagLines());
  const [media, setMedia] = useState<string[]>([]);
  useEffect(() => onDiag(() => setLines(diagLines())), []);
  useEffect(() => {
    const load = () => window.cadence?.mediaLog?.().then(setMedia).catch(() => {});
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, []);
  const all = [...lines, ...(media.length ? ['--- audio stream requests ---', ...media] : [])];
  const text = [`808Soles ${__APP_VERSION__} on ${navigator.userAgent}`, ...all].join('\n');
  return (
    <Group title="Diagnostics" footer="If songs won't play, copy this and send it to whoever maintains the app. It contains no personal data, only what playback tried.">
      <div className="px-4 py-3">
        <pre className="scroll max-h-[260px] whitespace-pre-wrap break-all font-mono text-[11px] leading-4 text-label2 select-text">{all.length ? all.slice(-80).join('\n') : 'Nothing yet. Play a song first.'}</pre>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(text).then(
              () => toast('Diagnostics copied'),
              () => toast('Couldn’t copy. Select the text instead.'),
            );
          }}
          className="mt-3 rounded-lg bg-fill px-4 py-2 text-[15px] font-semibold text-accent"
        >
          Copy Diagnostics
        </button>
      </div>
    </Group>
  );
}

export default function Settings() {
  const s = useSettings();
  return (
    <Page title="Settings" back>
      <Group title="Playback" footer="Crossfade blends the end of one song into the next.">
        <div className="border-b border-sep px-4 py-3">
          <div className="mb-1 flex justify-between text-[17px]">
            <span>Crossfade</span>
            <span className="tabular-nums text-label2">{s.crossfade ? `${s.crossfade} s` : 'Off'}</span>
          </div>
          <input
            type="range"
            min={0}
            max={12}
            step={1}
            value={s.crossfade}
            onChange={(e) => s.set({ crossfade: Number(e.target.value) })}
            aria-label="Crossfade seconds"
            className="scrubber dark-on-light"
            style={{ ['--pct' as string]: `${(s.crossfade / 12) * 100}%` }}
          />
        </div>
        <Toggle label="Sound Check" value={s.normalize} onChange={(v) => s.set({ normalize: v })} />
        <Toggle label="Autoplay" value={s.autoplay} onChange={(v) => s.set({ autoplay: v })} />
      </Group>

      <Group title="Audio Quality" footer="High streams the best version YouTube offers (usually Opus around 160 kbps). Lower settings use less data.">
        <Choice<Quality>
          value={s.quality}
          onChange={(q) => s.set({ quality: q })}
          options={[
            { id: 'high', label: 'High' },
            { id: 'normal', label: 'Normal' },
            { id: 'low', label: 'Data Saver' },
          ]}
        />
      </Group>

      <Group title="Appearance">
        <Choice
          value={s.theme}
          onChange={(t) => s.set({ theme: t })}
          options={[
            { id: 'system', label: 'Match System' },
            { id: 'dark', label: 'Dark' },
            { id: 'light', label: 'Light' },
          ]}
        />
      </Group>

      <Diagnostics />

      <Group title="About" footer="808Soles is free and open source (GPL-3.0). It is not affiliated with YouTube or Google. Your library is stored only on this device.">
        <div className="flex justify-between px-4 py-2.5 text-[17px]">
          <span>Version</span>
          <span className="text-label2">{__APP_VERSION__}</span>
        </div>
      </Group>
    </Page>
  );
}
