/**
 * Runs the few lines of YouTube's player script that YouTube.js extracts to
 * decipher stream URLs.
 *
 * That code comes from YouTube's servers, so it runs here, in a worker: it
 * can't touch the page, the app's storage, or the native bridge (which only
 * exists on the page). Before any of it runs, the worker also removes its own
 * network, storage and code-loading APIs, so the code can only compute. (On
 * Windows the worker's CSP blocks the network as well; Android's WebView
 * can't attach a CSP to the worker, so this is what blocks it there.)
 */

const REMOVE = [
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'WebSocketStream',
  'WebTransport',
  'EventSource',
  'importScripts',
  'Worker',
  'SharedWorker',
  'BroadcastChannel',
  'indexedDB',
  'caches',
  'cookieStore',
  'navigator',
  'Request',
  'Response',
];

function lockDown() {
  const scope = self as unknown as Record<string, unknown>;
  // Walk the global object and its prototype chain (fetch etc. live on
  // WorkerGlobalScope.prototype), deleting or, failing that, shadowing them.
  let target: object | null = scope;
  while (target && target !== Object.prototype) {
    for (const name of REMOVE) {
      if (Object.prototype.hasOwnProperty.call(target, name)) {
        try {
          delete (target as Record<string, unknown>)[name];
        } catch {
          /* non-configurable; shadowed below */
        }
      }
    }
    target = Object.getPrototypeOf(target);
  }
  for (const name of REMOVE) {
    if (name in scope) {
      try {
        Object.defineProperty(scope, name, { value: undefined, configurable: false, writable: false });
      } catch {
        /* best effort */
      }
    }
  }
}

// Keep a private reference before locking down; the evaluated code can't reach it.
const reply = self.postMessage.bind(self);
lockDown();

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
    reply({ id, result: out });
  } catch (err) {
    reply({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
