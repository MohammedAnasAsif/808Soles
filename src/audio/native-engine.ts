import { NativeCadence } from '../platform';
import type { Engine, EngineEvents, Source } from './engine';

const noop: EngineEvents = {
  state() {},
  advanced() {},
  ended() {},
  error() {},
  remote() {},
};

/**
 * Android: playback runs in a native foreground service (ExoPlayer + media
 * session). The service performs crossfades and track changes itself, so they
 * still happen when the app is in the background.
 */
export class NativeEngine implements Engine {
  private events: EngineEvents = noop;

  constructor() {
    void NativeCadence.addListener('state', (s) =>
      this.events.state({
        playing: s.playing,
        buffering: s.buffering,
        position: s.positionMs / 1000,
        duration: s.durationMs / 1000,
      }),
    );
    void NativeCadence.addListener('advanced', () => this.events.advanced());
    void NativeCadence.addListener('ended', () => this.events.ended());
    void NativeCadence.addListener('error', (e) =>
      this.events.error(e.message, e.httpStatus === 403 || e.httpStatus === 410 || e.httpStatus === 401),
    );
    void NativeCadence.addListener('remote', (e) => this.events.remote(e.action));
    void NativeCadence.requestNotificationPermission().catch(() => {});
  }

  setEvents(e: EngineEvents) {
    this.events = e;
  }

  async load(src: Source, startAt: number, autoplay: boolean) {
    await NativeCadence.load({ ...src, startMs: Math.round(startAt * 1000), autoplay });
  }

  prepareNext(src: Source | null) {
    if (src) void NativeCadence.prepareNext(src);
    else void NativeCadence.clearNext();
  }

  play() {
    void NativeCadence.play();
  }
  pause() {
    void NativeCadence.pause();
  }
  seek(seconds: number) {
    void NativeCadence.seek({ positionMs: Math.round(seconds * 1000) });
  }
  setCrossfade(seconds: number) {
    void NativeCadence.setCrossfade({ ms: Math.round(seconds * 1000) });
  }
  setVolume(v: number) {
    void NativeCadence.setVolume({ volume: v });
  }
  stop() {
    void NativeCadence.stop();
  }
}
