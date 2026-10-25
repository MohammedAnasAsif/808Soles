import { platform } from '../platform';
import type { NativeSource } from '../platform';
import { WebEngine } from './web-engine';
import { NativeEngine } from './native-engine';

export type Source = NativeSource;

export interface EngineState {
  playing: boolean;
  buffering: boolean;
  /** Seconds. */
  position: number;
  duration: number;
}

export interface EngineEvents {
  state(s: EngineState): void;
  /** The prepared next source has taken over (crossfade began or gapless switch). */
  advanced(): void;
  /** The current source finished and nothing was prepared. */
  ended(): void;
  /** Playback failed; `refused` means the URL was rejected (expired or blocked). */
  error(message: string, refused: boolean): void;
  /** Lock screen / notification / media keys. */
  remote(action: 'next' | 'previous' | 'play' | 'pause' | 'seek', position?: number): void;
}

/**
 * Two decks, so the next track can be preloaded and crossfaded in.
 * Web (Electron) runs in JS; Android runs natively.
 */
export interface Engine {
  load(src: Source, startAt: number, autoplay: boolean): Promise<void>;
  prepareNext(src: Source | null): void;
  play(): void;
  pause(): void;
  seek(seconds: number): void;
  setCrossfade(seconds: number): void;
  setVolume(v: number): void;
  stop(): void;
  setEvents(e: EngineEvents): void;
}

export function createEngine(): Engine {
  return platform === 'android' ? new NativeEngine() : new WebEngine();
}

export { fadeCurve, normalizationGain } from './curves';
