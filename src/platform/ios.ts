/**
 * The iPhone/iPad bridge (ios/Sources/Soles808/Bridge.swift).
 *
 * The iOS app is a native Swift shell around a WKWebView, without Capacitor.
 * It exposes one message handler, `webkit.messageHandlers.cadence`, whose
 * postMessage() returns a promise with the native reply. This file turns that
 * into the same `CadencePlugin` interface the Android plugin has, so the rest
 * of the app treats both the same way.
 *
 * Native events (playback state, track changes, download progress) arrive
 * through `window.__cadenceNative.emit(event, data)`.
 */
import type { PluginListenerHandle } from '@capacitor/core';
import type { CadencePlugin } from './index';

interface ReplyHandler {
  postMessage(message: unknown): Promise<unknown>;
}

declare global {
  interface Window {
    webkit?: { messageHandlers?: Record<string, ReplyHandler | undefined> };
  }
}

/** The native message handler, when running inside the iOS app. */
export function iosHandler(): ReplyHandler | undefined {
  try {
    return typeof window !== 'undefined' ? window.webkit?.messageHandlers?.cadence : undefined;
  } catch {
    return undefined;
  }
}

type Listener = (data: never) => void;

const METHODS = [
  'http',
  'load',
  'prepareNext',
  'setUpcoming',
  'clearNext',
  'play',
  'pause',
  'seek',
  'setCrossfade',
  'setVolume',
  'stop',
  'getState',
  'requestNotificationPermission',
  'download',
  'deleteDownload',
  'minimize',
] as const;

export function createIosPlugin(handler: ReplyHandler): CadencePlugin {
  const listeners = new Map<string, Set<Listener>>();

  if (!('__cadenceNative' in window)) {
    Object.defineProperty(window, '__cadenceNative', {
      value: Object.freeze({
        emit(event: string, data: unknown) {
          for (const cb of listeners.get(event) ?? []) {
            try {
              (cb as (d: unknown) => void)(data ?? {});
            } catch (e) {
              console.error(e);
            }
          }
        },
      }),
      writable: false,
      configurable: false,
    });
  }

  const plugin: Record<string, unknown> = {};
  for (const method of METHODS) {
    plugin[method] = (args?: object) => handler.postMessage({ method, args: args ?? {} });
  }
  plugin.addListener = (event: string, cb: Listener): Promise<PluginListenerHandle> => {
    let set = listeners.get(event);
    if (!set) listeners.set(event, (set = new Set()));
    set.add(cb);
    return Promise.resolve({ remove: async () => void set.delete(cb) });
  };
  return plugin as unknown as CadencePlugin;
}
