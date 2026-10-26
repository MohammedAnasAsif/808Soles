/**
 * Runs the few lines of YouTube's player script that YouTube.js extracts to
 * decipher stream URLs.
 *
 * That code comes from YouTube's servers, so it runs here, in a worker: it
 * can't touch the page, the app's storage, or the native bridge (which only
 * exists on the page). On Windows the worker is also served with a CSP that
 * blocks all network access.
 */
self.onmessage = (e: MessageEvent<{ id: number; code: string }>) => {
  const { id, code } = e.data;
  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const result = new Function(code)();
    // Only plain strings go back.
    const out: Record<string, string | undefined> = {};
    if (result && typeof result === 'object') {
      for (const k of ['n', 'sig']) {
        const v = (result as Record<string, unknown>)[k];
        if (typeof v === 'string') out[k] = v;
      }
    }
    self.postMessage({ id, result: out });
  } catch (err) {
    self.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
