import type { Engine, EngineEvents, Source } from './engine';
import { fadeCurve } from './curves';
import { diag } from '../lib/diag';

interface Deck {
  el: HTMLAudioElement;
  src: Source | null;
  /** Crossfade position multiplier, 0..1. */
  fade: number;
}

const noop: EngineEvents = {
  state() {},
  advanced() {},
  ended() {},
  error() {},
  remote() {},
};

function makeDeck(): Deck {
  const el = new Audio();
  el.preload = 'auto';
  el.crossOrigin = null;
  return { el, src: null, fade: 1 };
}

/** HTMLAudioElement-based engine for Electron (and the browser in development). */
export class WebEngine implements Engine {
  private decks: [Deck, Deck] = [makeDeck(), makeDeck()];
  private active = 0;
  private nextReady = false;
  private crossfade = 0;
  private master = 1;
  private fading: { start: number; length: number } | null = null;
  private events: EngineEvents = noop;
  private timer: ReturnType<typeof setInterval>;
  private wantPlaying = false;
  /** A prepareNext() that arrived mid-crossfade, applied when the fade ends. */
  private pendingNext: Source | null | undefined = undefined;

  constructor() {
    for (const [i, d] of this.decks.entries()) {
      d.el.addEventListener('ended', () => this.onEnded(i));
      d.el.addEventListener('error', () => this.onError(i));
      d.el.addEventListener('waiting', () => this.emit());
      d.el.addEventListener('playing', () => this.emit());
      d.el.addEventListener('pause', () => this.emit());
      d.el.addEventListener('durationchange', () => this.emit());
    }
    this.timer = setInterval(() => this.tick(), 100);
    this.setupMediaSession();
  }

  private get cur() {
    return this.decks[this.active];
  }
  private get other() {
    return this.decks[1 - this.active];
  }

  setEvents(e: EngineEvents) {
    this.events = e;
  }

  private applyVolume(d: Deck) {
    d.el.volume = Math.min(1, Math.max(0, this.master * (d.src?.gain ?? 1) * d.fade));
  }

  private register(src: Source) {
    window.cadence?.registerMedia(src.url, src.headers);
  }

  async load(src: Source, startAt: number, autoplay: boolean) {
    if (this.fading) this.finishFade();
    this.pendingNext = undefined;
    this.other.el.pause();
    const d = this.cur;
    d.src = src;
    d.fade = 1;
    this.register(src);
    d.el.src = src.url;
    this.applyVolume(d);
    if (startAt > 0) {
      await new Promise<void>((resolve) => {
        const on = () => {
          d.el.removeEventListener('loadedmetadata', on);
          resolve();
        };
        d.el.addEventListener('loadedmetadata', on);
        setTimeout(resolve, 8000);
      });
      d.el.currentTime = startAt;
    }
    this.wantPlaying = autoplay;
    if (autoplay) await d.el.play().catch((e) => this.playRejected(e));
    this.updateMetadata();
    this.emit();
  }

  prepareNext(src: Source | null) {
    const d = this.other;
    if (this.fading) {
      // Mid-crossfade the other deck is still fading out; apply afterwards.
      this.pendingNext = src;
      return;
    }
    d.el.pause();
    d.src = src;
    this.nextReady = !!src;
    if (src) {
      this.register(src);
      d.el.src = src.url;
      d.el.load();
    } else {
      d.el.removeAttribute('src');
    }
  }

  play() {
    this.wantPlaying = true;
    this.cur.el.play().catch((e) => this.playRejected(e));
    if (this.fading) this.other.el.play().catch(() => {});
  }

  pause() {
    this.wantPlaying = false;
    this.cur.el.pause();
    if (this.fading) this.other.el.pause();
    this.emit();
  }

  seek(seconds: number) {
    if (this.fading) this.finishFade();
    this.cur.el.currentTime = seconds;
    this.emit();
  }

  setCrossfade(seconds: number) {
    this.crossfade = seconds;
  }

  setVolume(v: number) {
    this.master = v;
    this.decks.forEach((d) => this.applyVolume(d));
  }

  stop() {
    this.wantPlaying = false;
    for (const d of this.decks) {
      d.el.pause();
      d.el.removeAttribute('src');
      d.src = null;
    }
    this.nextReady = false;
    this.fading = null;
    this.emit();
  }

  private advance() {
    // Swap decks: the prepared one becomes current.
    this.active = 1 - this.active;
    this.nextReady = false;
    this.updateMetadata();
    this.events.advanced();
  }

  private startFade() {
    const next = this.other;
    next.fade = 0;
    this.applyVolume(next);
    next.el.play().catch((e) => this.playRejected(e));
    this.fading = { start: performance.now(), length: this.crossfade * 1000 };
    this.advance();
  }

  private finishFade() {
    this.fading = null;
    const old = this.other;
    old.el.pause();
    old.fade = 1;
    old.src = null;
    old.el.removeAttribute('src');
    this.cur.fade = 1;
    this.applyVolume(this.cur);
    if (this.pendingNext !== undefined) {
      const p = this.pendingNext;
      this.pendingNext = undefined;
      this.prepareNext(p);
    }
  }

  private tick() {
    if (this.fading) {
      const t = (performance.now() - this.fading.start) / this.fading.length;
      const [out, inn] = fadeCurve(t);
      this.other.fade = out;
      this.cur.fade = inn;
      this.applyVolume(this.other);
      this.applyVolume(this.cur);
      if (t >= 1) this.finishFade();
    } else if (this.nextReady && this.wantPlaying && !this.cur.el.paused) {
      const { currentTime, duration } = this.cur.el;
      if (Number.isFinite(duration) && duration > 0) {
        const remaining = duration - currentTime;
        const lead = this.crossfade > 0 ? Math.min(this.crossfade, duration / 3) : 0.06;
        if (remaining <= lead) {
          if (this.crossfade > 0) this.startFade();
          else {
            this.other.fade = 1;
            this.applyVolume(this.other);
            this.other.el.play().catch(() => {});
            this.cur.el.pause();
            this.advance();
          }
        }
      }
    }
    this.emit();
  }

  private onEnded(i: number) {
    if (i !== this.active) return;
    if (this.nextReady) {
      this.other.fade = 1;
      this.applyVolume(this.other);
      this.other.el.play().catch(() => {});
      this.advance();
    } else {
      this.wantPlaying = false;
      this.events.ended();
    }
  }

  /** play() rejects when loading fails too; the 'error' event handles that case. */
  private playRejected(e: unknown) {
    const name = e instanceof DOMException ? e.name : '';
    diag(`play() rejected: ${name} ${e instanceof Error ? e.message : String(e)}`);
    if (name === 'NotAllowedError') this.events.error('Playback was blocked by the system.', false);
  }

  private onError(i: number) {
    const d = this.decks[i];
    if (!d.src) return;
    const err = d.el.error;
    diag(`audio element error on ${i === this.active ? 'current' : 'next'} deck: code ${err?.code} ${err?.message ?? ''} c=${(() => {
      try {
        return new URL(d.src!.url).searchParams.get('c');
      } catch {
        return '?';
      }
    })()}`);
    const refused = !!err && (err.code === MediaError.MEDIA_ERR_NETWORK || err.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED);
    if (i === this.active) this.events.error(err?.message || 'Playback failed', refused);
    else this.nextReady = false; // next will be resolved again when needed
  }

  private lastEmit = '';
  private emit() {
    const el = this.cur.el;
    const s = {
      playing: !el.paused,
      buffering: el.readyState < 3 && !el.paused,
      position: el.currentTime || 0,
      duration: Number.isFinite(el.duration) ? el.duration : 0,
    };
    const key = `${s.playing}${s.buffering}${s.position.toFixed(1)}${s.duration.toFixed(0)}`;
    if (key === this.lastEmit) return;
    this.lastEmit = key;
    this.events.state(s);
    if ('mediaSession' in navigator && s.duration > 0) {
      try {
        navigator.mediaSession.setPositionState({ duration: s.duration, position: Math.min(s.position, s.duration), playbackRate: 1 });
        navigator.mediaSession.playbackState = s.playing ? 'playing' : 'paused';
      } catch {
        /* older runtimes */
      }
    }
  }

  private updateMetadata() {
    const m = this.cur.src?.meta;
    if (!m || !('mediaSession' in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: m.title,
      artist: m.artist,
      album: m.album ?? '',
      artwork: m.artworkUrl ? [{ src: m.artworkUrl, sizes: '544x544', type: 'image/jpeg' }] : [],
    });
  }

  private setupMediaSession() {
    if (!('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    const set = (a: MediaSessionAction, h: MediaSessionActionHandler) => {
      try {
        ms.setActionHandler(a, h);
      } catch {
        /* unsupported action */
      }
    };
    set('play', () => this.events.remote('play'));
    set('pause', () => this.events.remote('pause'));
    set('nexttrack', () => this.events.remote('next'));
    set('previoustrack', () => this.events.remote('previous'));
    set('seekto', (d) => this.events.remote('seek', d.seekTime ?? 0));
  }

  dispose() {
    clearInterval(this.timer);
    this.stop();
  }
}
