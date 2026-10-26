/**
 * A small in-memory log of what playback did, shown in Settings → Diagnostics
 * so it can be copied into a bug report.
 */
const lines: string[] = [];
const listeners = new Set<() => void>();

export function diag(msg: string) {
  const t = new Date().toISOString().slice(11, 19);
  lines.push(`${t} ${msg}`);
  if (lines.length > 300) lines.splice(0, lines.length - 300);
  listeners.forEach((l) => l());
  if (import.meta.env.DEV) console.debug('[diag]', msg);
}

export function diagLines(): string[] {
  return [...lines];
}

export function onDiag(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
