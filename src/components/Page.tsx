import { ChevronLeft, RefreshCw, WifiOff } from 'lucide-react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { useWide } from '../lib/hooks';

export function BackButton({ overlay }: { overlay?: boolean }) {
  const navigate = useNavigate();
  const wide = useWide();
  return (
    <button
      type="button"
      onClick={() => navigate(-1)}
      aria-label="Back"
      className={`no-drag pressable flex items-center ${
        overlay ? 'h-9 w-9 justify-center rounded-full bg-black/35 text-white backdrop-blur' : `-ml-2 text-[17px] text-accent ${wide ? 'hidden' : ''}`
      }`}
    >
      <ChevronLeft className={overlay ? 'h-6 w-6' : 'h-7 w-7'} strokeWidth={2.4} />
      {!overlay && <span className="-ml-1">Back</span>}
    </button>
  );
}

/** A page with an iOS-style large title. */
export function Page({ title, back, actions, children }: { title?: string; back?: boolean; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="pb-8">
      <div className="px-gutter pt-3" style={{ paddingTop: 'calc(var(--sat) + 12px)' }}>
        <div className="flex h-9 items-center justify-between">
          {back ? <BackButton /> : <span />}
          <div className="flex items-center gap-2">{actions}</div>
        </div>
        {title && <h1 className="large-title mb-4 mt-1">{title}</h1>}
      </div>
      {children}
    </div>
  );
}

export function Loading({ rows = 3 }: { rows?: number }) {
  return (
    <div className="px-gutter space-y-9 pt-2" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i}>
          <div className="skeleton mb-3 h-6 w-48 rounded-md" />
          <div className="flex gap-4 overflow-hidden">
            {Array.from({ length: 6 }).map((_, j) => (
              <div key={j} className="w-[152px] shrink-0 md:w-[176px]">
                <div className="skeleton aspect-square rounded-lg" />
                <div className="skeleton mt-2 h-3.5 w-3/4 rounded" />
                <div className="skeleton mt-1.5 h-3.5 w-1/2 rounded" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function ErrorView({ error, retry }: { error?: Error; retry(): void }) {
  return (
    <div className="flex flex-col items-center px-8 py-16 text-center">
      <WifiOff className="mb-3 h-10 w-10 text-label3" />
      <div className="text-[17px] font-semibold">Couldn’t load this page</div>
      <div className="mt-1 max-w-[340px] text-[14px] text-label2">{error?.message?.slice(0, 160) || 'Check your connection and try again.'}</div>
      <button type="button" onClick={retry} className="pressable mt-5 flex items-center gap-2 rounded-full bg-fill px-5 py-2 text-[15px] font-semibold text-accent">
        <RefreshCw className="h-4 w-4" /> Try Again
      </button>
    </div>
  );
}

export function Empty({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <div className="flex flex-col items-center px-8 py-16 text-center">
      <div className="mb-3 text-label3">{icon}</div>
      <div className="text-[20px] font-bold">{title}</div>
      <div className="mt-1 max-w-[320px] text-[15px] text-label2">{text}</div>
    </div>
  );
}
