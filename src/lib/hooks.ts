import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

export function formatTime(sec: number | undefined): string {
  if (sec == null || !Number.isFinite(sec) || sec < 0) return '–:––';
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
}

export function totalMinutes(sec: number): string {
  const m = Math.round(sec / 60);
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'}`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return `${h} hour${h === 1 ? '' : 's'}${r ? `, ${r} minute${r === 1 ? '' : 's'}` : ''}`;
}

export interface AsyncState<T> {
  data: T | undefined;
  error: Error | undefined;
  loading: boolean;
  reload(): void;
}

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [state, setState] = useState<{ data?: T; error?: Error; loading: boolean }>({ loading: true });
  const [tick, setTick] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    let alive = true;
    setState((s) => ({ data: s.data, loading: true }));
    fnRef
      .current()
      .then((data) => alive && setState({ data, loading: false }))
      .catch((error) => alive && setState({ error: error instanceof Error ? error : new Error(String(error)), loading: false }));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, data: state.data, reload } as AsyncState<T>;
}

function subscribeMq(q: string) {
  return (cb: () => void) => {
    const m = window.matchMedia(q);
    m.addEventListener('change', cb);
    return () => m.removeEventListener('change', cb);
  };
}

export function useMediaQuery(q: string): boolean {
  return useSyncExternalStore(subscribeMq(q), () => window.matchMedia(q).matches, () => false);
}

/** Wide layout: sidebar and top player bar. */
export function useWide(): boolean {
  return useMediaQuery('(min-width: 900px)');
}

export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function artistNames(artists: { name: string }[]): string {
  return artists.map((a) => a.name).join(', ');
}
