package app.soles808.player;

import android.content.ComponentName;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;

import androidx.annotation.OptIn;
import androidx.core.content.ContextCompat;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.session.MediaController;
import androidx.media3.session.SessionToken;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.common.util.concurrent.ListenableFuture;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * The bridge between the web app and Android:
 *  - http(): network requests without CORS limits (for YouTube's API and lyrics)
 *  - load()/play()/…: drive PlaybackService, which owns the actual audio
 */
@OptIn(markerClass = UnstableApi.class)
@CapacitorPlugin(name = "Cadence")
public class CadencePlugin extends Plugin {

    private final ExecutorService net = Executors.newFixedThreadPool(6);
    private final Handler main = new Handler(Looper.getMainLooper());
    private ListenableFuture<MediaController> controller;
    private final List<Runnable> pending = new ArrayList<>();

    private androidx.activity.OnBackPressedCallback backCallback;

    @Override
    public void load() {
        // Hand the system Back gesture/button to the web app, which closes
        // sheets and goes back through its pages before leaving the app.
        getActivity().runOnUiThread(() -> {
            backCallback = new androidx.activity.OnBackPressedCallback(true) {
                @Override
                public void handleOnBackPressed() {
                    notifyListeners("backButton", new JSObject());
                }
            };
            getActivity().getOnBackPressedDispatcher().addCallback(getActivity(), backCallback);
        });
        PlaybackService.events = new PlaybackService.Events() {
            @Override
            public void onState(boolean playing, boolean buffering, long positionMs, long durationMs) {
                JSObject o = new JSObject();
                o.put("playing", playing);
                o.put("buffering", buffering);
                o.put("positionMs", positionMs);
                o.put("durationMs", durationMs);
                notifyListeners("state", o);
            }

            @Override
            public void onAdvanced() {
                notifyListeners("advanced", new JSObject());
            }

            @Override
            public void onEnded() {
                notifyListeners("ended", new JSObject());
            }

            @Override
            public void onError(String message, int httpStatus) {
                JSObject o = new JSObject();
                o.put("message", message);
                if (httpStatus > 0) o.put("httpStatus", httpStatus);
                notifyListeners("error", o);
            }

            @Override
            public void onRemote(String action) {
                JSObject o = new JSObject();
                o.put("action", action);
                notifyListeners("remote", o);
            }
        };
    }

    @Override
    protected void handleOnDestroy() {
        net.shutdownNow();
        if (controller != null) MediaController.releaseFuture(controller);
    }

    /**
     * Reads a number argument of any numeric type. PluginCall.getLong only
     * accepts values that arrived as a Long, and JSON numbers that fit in an
     * int arrive as Integer, so getLong("positionMs") returned the default (0)
     * for any seek under ~24 days: every seek restarted the song.
     */
    private static long num(PluginCall call, String name, long def) {
        Object v = call.getData().opt(name);
        if (v instanceof Number) return ((Number) v).longValue();
        if (v instanceof String) {
            try {
                return (long) Double.parseDouble((String) v);
            } catch (NumberFormatException ignored) {
            }
        }
        return def;
    }

    /** Back on the home screen: leave the app like Home does, music keeps playing. */
    @PluginMethod
    public void minimize(final PluginCall call) {
        getActivity().runOnUiThread(() -> {
            getActivity().moveTaskToBack(true);
            call.resolve();
        });
    }

    /* ------------------------------- HTTP -------------------------------- */

    @PluginMethod
    public void http(final PluginCall call) {
        final String url = call.getString("url");
        final String method = call.getString("method", "GET");
        final JSObject headers = call.getObject("headers", new JSObject());
        final String bodyB64 = call.getString("bodyBase64");
        net.execute(() -> {
            HttpURLConnection c = null;
            try {
                c = (HttpURLConnection) new URL(url).openConnection();
                c.setRequestMethod(method);
                c.setConnectTimeout(15000);
                c.setReadTimeout(25000);
                c.setInstanceFollowRedirects(true);
                Iterator<String> keys = headers.keys();
                while (keys.hasNext()) {
                    String k = keys.next();
                    // Let HttpURLConnection handle compression so bodies arrive decoded.
                    if (k.equalsIgnoreCase("accept-encoding") || k.equalsIgnoreCase("content-length")) continue;
                    c.setRequestProperty(k, headers.getString(k));
                }
                if (bodyB64 != null && !method.equals("GET") && !method.equals("HEAD")) {
                    byte[] body = Base64.decode(bodyB64, Base64.DEFAULT);
                    c.setDoOutput(true);
                    c.setFixedLengthStreamingMode(body.length);
                    try (OutputStream os = c.getOutputStream()) {
                        os.write(body);
                    }
                }
                int status = c.getResponseCode();
                InputStream in = status >= 400 ? c.getErrorStream() : c.getInputStream();
                byte[] data = in == null ? new byte[0] : readAll(in);
                JSObject resHeaders = new JSObject();
                for (Map.Entry<String, List<String>> e : c.getHeaderFields().entrySet()) {
                    if (e.getKey() == null) continue;
                    String k = e.getKey().toLowerCase();
                    if (k.equals("content-encoding") || k.equals("content-length") || k.equals("transfer-encoding")) continue;
                    resHeaders.put(k, String.join(", ", e.getValue()));
                }
                JSObject ret = new JSObject();
                ret.put("status", status);
                ret.put("headers", resHeaders);
                ret.put("bodyBase64", Base64.encodeToString(data, Base64.NO_WRAP));
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("Network error: " + e.getMessage(), e);
            } finally {
                if (c != null) c.disconnect();
            }
        });
    }

    private static byte[] readAll(InputStream in) throws java.io.IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[16384];
        int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        in.close();
        return out.toByteArray();
    }

    /* ------------------------------ Downloads ---------------------------- */

    private static final int CHUNK = 4 * 1024 * 1024;

    private java.io.File downloadsDir() {
        java.io.File d = new java.io.File(getContext().getFilesDir(), "downloads");
        if (!d.exists()) d.mkdirs();
        return d;
    }

    /** Saves a YouTube audio stream to the app's private storage, in ranged chunks. */
    @PluginMethod
    public void download(final PluginCall call) {
        final String id = call.getString("id", "");
        final String ext = call.getString("ext", "audio");
        final String url = call.getString("url", "");
        final JSObject headers = call.getObject("headers", new JSObject());
        final long sizeHint = num(call, "size", 0L);
        if (!id.matches("[\\w-]{6,20}") || !ext.matches("[a-z0-9]{2,5}") || !url.matches("https://[^/]+\\.googlevideo\\.com/.*")) {
            call.reject("Bad download request");
            return;
        }
        net.execute(() -> {
            java.io.File dir = downloadsDir();
            java.io.File fin = new java.io.File(dir, id + "." + ext);
            java.io.File part = new java.io.File(dir, id + "." + ext + ".part");
            long received = 0;
            long total = sizeHint;
            try (java.io.FileOutputStream out = new java.io.FileOutputStream(part)) {
                while (true) {
                    long end = received + CHUNK - 1;
                    if (total > 0) end = Math.min(end, total - 1);
                    HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
                    c.setConnectTimeout(15000);
                    c.setReadTimeout(30000);
                    Iterator<String> keys = headers.keys();
                    while (keys.hasNext()) {
                        String k = keys.next();
                        c.setRequestProperty(k, headers.getString(k));
                    }
                    c.setRequestProperty("Range", "bytes=" + received + "-" + end);
                    int status = c.getResponseCode();
                    if (status != 200 && status != 206) {
                        c.disconnect();
                        throw new java.io.IOException("HTTP " + status);
                    }
                    String cr = c.getHeaderField("Content-Range");
                    if (cr != null && cr.contains("/")) {
                        try {
                            total = Long.parseLong(cr.substring(cr.lastIndexOf('/') + 1).trim());
                        } catch (NumberFormatException ignored) {
                        }
                    }
                    long got = 0;
                    try (InputStream in = c.getInputStream()) {
                        byte[] buf = new byte[65536];
                        int n;
                        while ((n = in.read(buf)) > 0) {
                            out.write(buf, 0, n);
                            got += n;
                        }
                    } finally {
                        c.disconnect();
                    }
                    received += got;
                    JSObject p = new JSObject();
                    p.put("id", id);
                    p.put("received", received);
                    p.put("total", total);
                    notifyListeners("downloadProgress", p);
                    if (got == 0 || status == 200 || (total > 0 && received >= total)) break;
                }
            } catch (Exception e) {
                part.delete();
                call.reject("Download failed: " + e.getMessage(), e);
                return;
            }
            if (fin.exists()) fin.delete();
            if (!part.renameTo(fin)) {
                part.delete();
                call.reject("Couldn't save the file");
                return;
            }
            JSObject ret = new JSObject();
            ret.put("path", fin.getAbsolutePath());
            ret.put("url", android.net.Uri.fromFile(fin).toString());
            ret.put("size", received);
            call.resolve(ret);
        });
    }

    @PluginMethod
    public void deleteDownload(final PluginCall call) {
        String p = call.getString("path", "");
        try {
            java.io.File f = new java.io.File(p).getCanonicalFile();
            if (!f.getParentFile().equals(downloadsDir().getCanonicalFile())) {
                call.reject("Not a download");
                return;
            }
            f.delete();
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    /* ------------------------------ Playback ----------------------------- */

    /** Runs `r` on the main thread once the playback service is up. */
    private void withService(Runnable r) {
        main.post(() -> {
            if (PlaybackService.instance != null) {
                r.run();
                return;
            }
            pending.add(r);
            if (controller == null) {
                SessionToken token = new SessionToken(getContext(), new ComponentName(getContext(), PlaybackService.class));
                controller = new MediaController.Builder(getContext(), token).buildAsync();
                controller.addListener(this::flush, ContextCompat.getMainExecutor(getContext()));
            }
        });
    }

    private void flush() {
        if (PlaybackService.instance == null) {
            // The controller connected but the service isn't ready yet; try shortly.
            main.postDelayed(this::flush, 50);
            return;
        }
        List<Runnable> run = new ArrayList<>(pending);
        pending.clear();
        for (Runnable r : run) r.run();
    }

    private static PlaybackService.Source sourceFrom(PluginCall call) {
        PlaybackService.Source s = new PlaybackService.Source();
        s.url = call.getString("url");
        Double g = call.getDouble("gain");
        s.gain = g == null ? 1f : g.floatValue();
        JSObject h = call.getObject("headers", new JSObject());
        Iterator<String> keys = h.keys();
        while (keys.hasNext()) {
            String k = keys.next();
            s.headers.put(k, h.optString(k));
        }
        JSObject m = call.getObject("meta", new JSObject());
        s.title = m.optString("title", "");
        s.artist = m.optString("artist", "");
        s.album = m.optString("album", "");
        String art = m.optString("artworkUrl", "");
        s.artworkUrl = art.isEmpty() ? null : art;
        JSObject ix = call.getObject("index", null);
        if (ix != null) {
            s.mimeType = ix.optString("mimeType", null);
            s.codecs = ix.optString("codecs", "");
            s.bitrate = ix.optLong("bitrate", 128000);
            s.initStart = ix.optLong("initStart", -1);
            s.initEnd = ix.optLong("initEnd", -1);
            s.indexStart = ix.optLong("indexStart", -1);
            s.indexEnd = ix.optLong("indexEnd", -1);
            s.durationMs = ix.optLong("durationMs", 0);
        }
        return s;
    }

    @PluginMethod
    public void load(final PluginCall call) {
        final PlaybackService.Source s = sourceFrom(call);
        final long start = num(call, "startMs", 0L);
        final boolean autoplay = call.getBoolean("autoplay", true);
        withService(() -> {
            PlaybackService.instance.load(s, start, autoplay);
            call.resolve();
        });
    }

    @PluginMethod
    public void prepareNext(final PluginCall call) {
        final PlaybackService.Source s = sourceFrom(call);
        withService(() -> {
            PlaybackService.instance.prepareNext(s);
            call.resolve();
        });
    }

    @PluginMethod
    public void clearNext(final PluginCall call) {
        withService(() -> {
            PlaybackService.instance.clearNext();
            call.resolve();
        });
    }

    @PluginMethod
    public void play(final PluginCall call) {
        withService(() -> {
            PlaybackService.instance.play();
            call.resolve();
        });
    }

    @PluginMethod
    public void pause(final PluginCall call) {
        withService(() -> {
            PlaybackService.instance.pause();
            call.resolve();
        });
    }

    @PluginMethod
    public void seek(final PluginCall call) {
        final long ms = num(call, "positionMs", 0L);
        withService(() -> {
            PlaybackService.instance.seek(ms);
            call.resolve();
        });
    }

    @PluginMethod
    public void setCrossfade(final PluginCall call) {
        final long ms = num(call, "ms", 0L);
        withService(() -> {
            PlaybackService.instance.setCrossfade(ms);
            call.resolve();
        });
    }

    @PluginMethod
    public void setVolume(final PluginCall call) {
        Double v = call.getDouble("volume");
        final float vol = v == null ? 1f : v.floatValue();
        withService(() -> {
            PlaybackService.instance.setVolume(vol);
            call.resolve();
        });
    }

    @PluginMethod
    public void stop(final PluginCall call) {
        withService(() -> {
            PlaybackService.instance.stopAll();
            call.resolve();
        });
    }

    @PluginMethod
    public void getState(final PluginCall call) {
        call.resolve(new JSObject());
    }

    /** Media-session notifications don't need the notification permission; kept for API symmetry. */
    @PluginMethod
    public void requestNotificationPermission(final PluginCall call) {
        call.resolve();
    }
}
