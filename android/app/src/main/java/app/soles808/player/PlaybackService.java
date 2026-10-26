package app.soles808.player;

import android.content.Intent;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.annotation.OptIn;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.ForwardingPlayer;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MediaMetadata;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.datasource.HttpDataSource;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.MediaSource;
import androidx.media3.exoplayer.source.ProgressiveMediaSource;
import androidx.media3.session.MediaSession;
import androidx.media3.session.MediaSessionService;

import java.util.HashMap;
import java.util.Map;

/**
 * Plays audio in the background. Two ExoPlayers ("decks") so the next song can
 * be preloaded and crossfaded in; one media session that always points at the
 * deck currently playing, which gives the notification and lock-screen
 * controls. Crossfades and track changes happen here, so they keep working
 * while the app's web view is paused in the background.
 */
@OptIn(markerClass = UnstableApi.class)
public class PlaybackService extends MediaSessionService {

    /** Events for the JavaScript side (CadencePlugin forwards them). */
    public interface Events {
        void onState(boolean playing, boolean buffering, long positionMs, long durationMs);
        void onAdvanced();
        void onEnded();
        void onError(String message, int httpStatus);
        void onRemote(String action);
    }

    public static class Source {
        public String url;
        public Map<String, String> headers = new HashMap<>();
        public String title = "";
        public String artist = "";
        public String album = "";
        public String artworkUrl;
        public float gain = 1f;
    }

    @Nullable public static PlaybackService instance;
    @Nullable public static Events events;

    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExoPlayer[] decks = new ExoPlayer[2];
    private final float[] gains = {1f, 1f};
    private final float[] fades = {1f, 1f};
    private int active = 0;
    private boolean nextReady = false;
    private long crossfadeMs = 6000;
    private float master = 1f;
    /** Crossfade in progress: start time (uptime ms), or -1. */
    private long fadeStart = -1;
    private long fadeLength = 0;
    private MediaSession session;
    private boolean wantPlaying = false;

    private final AudioAttributes attrs = new AudioAttributes.Builder()
            .setUsage(C.USAGE_MEDIA)
            .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
            .build();

    private final Runnable ticker = new Runnable() {
        @Override
        public void run() {
            tick();
            main.postDelayed(this, 100);
        }
    };

    private int lastStateHash = 0;

    @Override
    public void onCreate() {
        super.onCreate();
        for (int i = 0; i < 2; i++) {
            final int deck = i;
            ExoPlayer p = new ExoPlayer.Builder(this)
                    .setAudioAttributes(attrs, i == 0)
                    .setHandleAudioBecomingNoisy(i == 0)
                    .setWakeMode(C.WAKE_MODE_NETWORK)
                    .build();
            p.addListener(new Player.Listener() {
                @Override
                public void onPlaybackStateChanged(int state) {
                    if (state == Player.STATE_ENDED) onDeckEnded(deck);
                    emitState(true);
                }

                @Override
                public void onIsPlayingChanged(boolean isPlaying) {
                    emitState(true);
                }

                @Override
                public void onPlayerError(@NonNull PlaybackException error) {
                    onDeckError(deck, error);
                }
            });
            decks[i] = p;
        }
        session = new MediaSession.Builder(this, wrap(decks[active])).build();
        instance = this;
        main.post(ticker);
    }

    @Nullable
    @Override
    public MediaSession onGetSession(@NonNull MediaSession.ControllerInfo controllerInfo) {
        return session;
    }

    @Override
    public void onTaskRemoved(@Nullable Intent rootIntent) {
        Player p = session.getPlayer();
        if (!p.getPlayWhenReady() || p.getMediaItemCount() == 0) {
            stopSelf();
        }
    }

    @Override
    public void onDestroy() {
        main.removeCallbacks(ticker);
        instance = null;
        session.release();
        for (ExoPlayer p : decks) p.release();
        super.onDestroy();
    }

    /* ------------------------------------------------------------------ */
    /* Session player: next/previous go to JavaScript, which owns the queue */
    /* ------------------------------------------------------------------ */

    private Player wrap(ExoPlayer p) {
        return new ForwardingPlayer(p) {
            @Override
            public Commands getAvailableCommands() {
                return super.getAvailableCommands().buildUpon()
                        .add(COMMAND_SEEK_TO_NEXT)
                        .add(COMMAND_SEEK_TO_NEXT_MEDIA_ITEM)
                        .add(COMMAND_SEEK_TO_PREVIOUS)
                        .add(COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM)
                        .build();
            }

            @Override
            public boolean isCommandAvailable(int command) {
                if (command == COMMAND_SEEK_TO_NEXT || command == COMMAND_SEEK_TO_NEXT_MEDIA_ITEM
                        || command == COMMAND_SEEK_TO_PREVIOUS || command == COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM) {
                    return true;
                }
                return super.isCommandAvailable(command);
            }

            @Override
            public void seekToNext() {
                remote("next");
            }

            @Override
            public void seekToNextMediaItem() {
                remote("next");
            }

            @Override
            public void seekToPrevious() {
                remote("previous");
            }

            @Override
            public void seekToPreviousMediaItem() {
                remote("previous");
            }

            @Override
            public void play() {
                PlaybackService.this.play();
            }

            @Override
            public void pause() {
                PlaybackService.this.pause();
            }

            @Override
            public void setPlayWhenReady(boolean playWhenReady) {
                if (playWhenReady) PlaybackService.this.play();
                else PlaybackService.this.pause();
            }
        };
    }

    private void remote(String action) {
        if (events != null) events.onRemote(action);
    }

    /* ------------------------------------------------------------------ */
    /* Commands (always called on the main thread)                          */
    /* ------------------------------------------------------------------ */

    private MediaSource sourceFor(Source s) {
        DefaultHttpDataSource.Factory http = new DefaultHttpDataSource.Factory()
                .setAllowCrossProtocolRedirects(true)
                .setConnectTimeoutMs(15000)
                .setReadTimeoutMs(20000);
        Map<String, String> props = new HashMap<>();
        for (Map.Entry<String, String> e : s.headers.entrySet()) {
            if (e.getKey().equalsIgnoreCase("user-agent")) http.setUserAgent(e.getValue());
            else props.put(e.getKey(), e.getValue());
        }
        http.setDefaultRequestProperties(props);
        MediaMetadata.Builder meta = new MediaMetadata.Builder()
                .setTitle(s.title)
                .setArtist(s.artist)
                .setAlbumTitle(s.album);
        if (s.artworkUrl != null && !s.artworkUrl.isEmpty()) meta.setArtworkUri(Uri.parse(s.artworkUrl));
        MediaItem item = new MediaItem.Builder()
                .setUri(s.url)
                .setMediaId(s.url)
                .setMediaMetadata(meta.build())
                .build();
        return new ProgressiveMediaSource.Factory(http).createMediaSource(item);
    }

    private void applyVolume(int deck) {
        float v = master * gains[deck] * fades[deck];
        decks[deck].setVolume(Math.max(0f, Math.min(1f, v)));
    }

    private void setActive(int deck) {
        active = deck;
        int other = 1 - deck;
        decks[other].setAudioAttributes(attrs, false);
        decks[other].setHandleAudioBecomingNoisy(false);
        decks[deck].setAudioAttributes(attrs, true);
        decks[deck].setHandleAudioBecomingNoisy(true);
        session.setPlayer(wrap(decks[deck]));
    }

    public void load(Source s, long startMs, boolean autoplay) {
        finishFade();
        int other = 1 - active;
        decks[other].stop();
        decks[other].clearMediaItems();
        nextReady = false;
        ExoPlayer p = decks[active];
        gains[active] = s.gain;
        fades[active] = 1f;
        applyVolume(active);
        p.setMediaSource(sourceFor(s), startMs);
        p.prepare();
        wantPlaying = autoplay;
        p.setPlayWhenReady(autoplay);
        emitState(true);
    }

    public void prepareNext(Source s) {
        if (fadeStart >= 0) finishFade();
        int other = 1 - active;
        ExoPlayer p = decks[other];
        p.stop();
        gains[other] = s.gain;
        fades[other] = 1f;
        applyVolume(other);
        p.setPlayWhenReady(false);
        p.setMediaSource(sourceFor(s));
        p.prepare();
        nextReady = true;
    }

    public void clearNext() {
        if (fadeStart >= 0) return;
        int other = 1 - active;
        decks[other].stop();
        decks[other].clearMediaItems();
        nextReady = false;
    }

    public void play() {
        wantPlaying = true;
        decks[active].setPlayWhenReady(true);
        if (fadeStart >= 0) decks[1 - active].setPlayWhenReady(true);
        emitState(true);
    }

    public void pause() {
        wantPlaying = false;
        decks[active].setPlayWhenReady(false);
        if (fadeStart >= 0) decks[1 - active].setPlayWhenReady(false);
        emitState(true);
    }

    public void seek(long ms) {
        if (fadeStart >= 0) finishFade();
        decks[active].seekTo(ms);
        emitState(true);
    }

    public void setCrossfade(long ms) {
        crossfadeMs = Math.max(0, ms);
    }

    public void setVolume(float v) {
        master = v;
        applyVolume(0);
        applyVolume(1);
    }

    public void stopAll() {
        wantPlaying = false;
        fadeStart = -1;
        for (ExoPlayer p : decks) {
            p.stop();
            p.clearMediaItems();
        }
        nextReady = false;
        emitState(true);
    }

    /* ------------------------------------------------------------------ */
    /* Transitions                                                          */
    /* ------------------------------------------------------------------ */

    /** The prepared deck becomes the active one. */
    private void advance(boolean fade) {
        int next = 1 - active;
        nextReady = false;
        if (fade) {
            fades[next] = 0f;
            applyVolume(next);
            fadeStart = android.os.SystemClock.uptimeMillis();
            long dur = decks[active].getDuration();
            fadeLength = dur > 0 ? Math.min(crossfadeMs, dur / 3) : crossfadeMs;
        } else {
            fades[next] = 1f;
            applyVolume(next);
            decks[active].setPlayWhenReady(false);
        }
        decks[next].setPlayWhenReady(true);
        setActive(next);
        if (events != null) events.onAdvanced();
        emitState(true);
    }

    private void finishFade() {
        if (fadeStart < 0) return;
        fadeStart = -1;
        int old = 1 - active;
        decks[old].stop();
        decks[old].clearMediaItems();
        fades[old] = 1f;
        fades[active] = 1f;
        applyVolume(old);
        applyVolume(active);
    }

    private void tick() {
        if (fadeStart >= 0) {
            float t = (android.os.SystemClock.uptimeMillis() - fadeStart) / (float) Math.max(1, fadeLength);
            float x = Math.max(0f, Math.min(1f, t));
            fades[1 - active] = (float) Math.cos(x * Math.PI / 2);
            fades[active] = (float) Math.sin(x * Math.PI / 2);
            applyVolume(0);
            applyVolume(1);
            if (t >= 1f) finishFade();
        } else if (nextReady && wantPlaying && crossfadeMs > 0) {
            ExoPlayer p = decks[active];
            long dur = p.getDuration();
            if (p.isPlaying() && dur != C.TIME_UNSET && dur > 0) {
                long remaining = dur - p.getCurrentPosition();
                long lead = Math.min(crossfadeMs, dur / 3);
                if (remaining <= lead) advance(true);
            }
        }
        emitState(false);
    }

    private void onDeckEnded(int deck) {
        if (deck != active) return;
        if (nextReady) {
            advance(false);
        } else {
            wantPlaying = false;
            if (events != null) events.onEnded();
        }
    }

    private void onDeckError(int deck, PlaybackException error) {
        if (deck != active) {
            nextReady = false;
            return;
        }
        int status = 0;
        Throwable c = error.getCause();
        while (c != null) {
            if (c instanceof HttpDataSource.InvalidResponseCodeException) {
                status = ((HttpDataSource.InvalidResponseCodeException) c).responseCode;
                break;
            }
            c = c.getCause();
        }
        if (events != null) events.onError(error.getErrorCodeName(), status);
    }

    private void emitState(boolean force) {
        if (events == null) return;
        ExoPlayer p = decks[active];
        boolean playing = p.getPlayWhenReady() && p.getPlaybackState() != Player.STATE_ENDED && p.getPlaybackState() != Player.STATE_IDLE;
        boolean buffering = p.getPlaybackState() == Player.STATE_BUFFERING;
        long pos = p.getCurrentPosition();
        long dur = p.getDuration() == C.TIME_UNSET ? 0 : p.getDuration();
        int hash = (playing ? 1 : 0) + (buffering ? 2 : 0) + (int) (pos / 250) * 4 + (int) (dur / 1000) * 31;
        if (!force && hash == lastStateHash) return;
        lastStateHash = hash;
        events.onState(playing, buffering, pos, dur);
    }
}
