// 808Soles for Windows: the Electron main process.
//
// It opens the window, makes YouTube requests on the page's behalf (no CORS,
// any header), adds the right headers to audio stream requests, and saves
// downloads.
//
// Security model (see SECURITY.md):
// - The page is served from a private `app://` scheme, never file://, with a
//   strict Content-Security-Policy. It runs sandboxed with context isolation;
//   the only native API it sees is the small bridge in preload.cjs.
// - Every bridge call checks it comes from our own page, and validates its
//   arguments. Network requests are https-only and limited to the YouTube,
//   googlevideo and LRCLIB hosts, so the bridge can't be used to reach local
//   files, the home network or arbitrary servers.
// - Navigation away from the app, new windows, and every permission request
//   (camera, microphone, notifications, …) are refused.
const { app, BrowserWindow, ipcMain, nativeTheme, session, shell, Menu, protocol } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { Readable } = require('node:stream');

const isDev = !app.isPackaged && !!process.env.CADENCE_DEV_URL;
/** Test-only: send API requests to the fixture relay of `npm run dev:fixtures`. Ignored in packaged builds. */
const fixtureRelay = !app.isPackaged ? process.env.CADENCE_FIXTURE_RELAY : undefined;

const SCHEME = 'app';
const APP_ORIGIN = `${SCHEME}://bundle`;
const MEDIA_ORIGIN = `${SCHEME}://media`;
const DIST = path.join(__dirname, '..', 'dist');

protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true } },
]);

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

// Keep media keys and the Windows media overlay working through the page's
// Media Session.
app.commandLine.appendSwitch('enable-features', 'HardwareMediaKeyHandling,MediaSessionService');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

/* ------------------------------------------------------------------------ */
/* Policy                                                                   */
/* ------------------------------------------------------------------------ */

/** Hosts the app may contact (https only), as exact names or `.suffix`. */
const ALLOWED_HOSTS = ['youtube.com', '.youtube.com', 'youtubei.googleapis.com', '.googlevideo.com', 'lrclib.net'];

function allowedUrl(raw) {
  let u;
  try {
    u = new URL(String(raw));
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) return null;
  const host = u.hostname.toLowerCase();
  const ok = ALLOWED_HOSTS.some((h) => (h.startsWith('.') ? host.endsWith(h) : host === h));
  return ok ? u : null;
}

function isMediaUrl(raw) {
  const u = allowedUrl(raw);
  return !!u && u.hostname.endsWith('.googlevideo.com');
}

/** Headers the page may not set on our native requests. */
const BLOCKED_HEADERS = new Set(['host', 'cookie', 'cookie2', 'proxy-authorization', 'authorization', 'connection', 'content-length', 'transfer-encoding']);

function cleanHeaders(h) {
  const out = {};
  if (!h || typeof h !== 'object') return out;
  for (const [k, v] of Object.entries(h)) {
    const key = String(k).toLowerCase();
    if (BLOCKED_HEADERS.has(key) || /[\r\n]/.test(String(v)) || !/^[a-z0-9-]+$/.test(key)) continue;
    out[key] = String(v).slice(0, 4096);
  }
  return out;
}

const MAX_RESPONSE = 32 * 1024 * 1024; // API responses
const MAX_DOWNLOAD = 400 * 1024 * 1024; // one song

const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "worker-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' https: data: blob:",
  `media-src 'self' https://*.googlevideo.com ${MEDIA_ORIGIN} blob:`,
  "font-src 'self' data:",
  "connect-src 'self'",
  "manifest-src 'self'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

/** Only our own top-level page may use the bridge. */
function fromApp(event) {
  const url = event.senderFrame?.url ?? '';
  if (isDev) return url.startsWith(process.env.CADENCE_DEV_URL);
  return url.startsWith(`${APP_ORIGIN}/`) && event.senderFrame === event.sender.mainFrame;
}

function handle(channel, fn) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!fromApp(event)) throw new Error('Not allowed');
    return fn(event, ...args);
  });
}

function on(channel, fn) {
  ipcMain.on(channel, (event, ...args) => {
    if (!fromApp(event)) return;
    fn(event, ...args);
  });
}

/* ------------------------------------------------------------------------ */
/* State                                                                    */
/* ------------------------------------------------------------------------ */

/** client name (the `c` URL parameter) -> headers for googlevideo requests */
const mediaHeaders = new Map();

/** Recent audio-stream responses, for Settings → Diagnostics. */
const mediaLog = [];
function logMedia(line) {
  mediaLog.push(`${new Date().toISOString().slice(11, 19)} ${line}`);
  if (mediaLog.length > 60) mediaLog.shift();
}
function mediaLabel(url) {
  try {
    const u = new URL(url);
    return `c=${u.searchParams.get('c')} itag=${u.searchParams.get('itag')} host=${u.hostname.split('.')[0]}`;
  } catch {
    return 'bad url';
  }
}

let win = null;

function overlayColors() {
  const dark = nativeTheme.shouldUseDarkColors;
  return { color: dark ? '#00000000' : '#ffffff00', symbolColor: dark ? '#ffffff' : '#000000', height: 44 };
}

/* ------------------------------------------------------------------------ */
/* app:// — the bundle and downloaded songs                                  */
/* ------------------------------------------------------------------------ */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.webm': 'audio/webm',
  '.m4a': 'audio/mp4',
  '.audio': 'application/octet-stream',
};

/** Resolves `rel` inside `root`, or null if it would escape it. */
function inside(root, rel) {
  const target = path.resolve(root, rel);
  return target === root || target.startsWith(root + path.sep) ? target : null;
}

function notFound() {
  return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } });
}

/** Serves a file, honouring Range so audio can seek. */
function serveFile(file, request, extraHeaders = {}) {
  let st;
  try {
    st = fs.statSync(file);
    if (!st.isFile()) return notFound();
  } catch {
    return notFound();
  }
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const headers = { 'content-type': type, 'accept-ranges': 'bytes', 'x-content-type-options': 'nosniff', ...extraHeaders };
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range') || '');
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : Math.max(0, st.size - Number(range[2]));
    let end = range[1] && range[2] ? Number(range[2]) : st.size - 1;
    end = Math.min(end, st.size - 1);
    if (start > end || start >= st.size) {
      return new Response(null, { status: 416, headers: { 'content-range': `bytes */${st.size}` } });
    }
    const body = Readable.toWeb(fs.createReadStream(file, { start, end }));
    return new Response(body, {
      status: 206,
      headers: { ...headers, 'content-range': `bytes ${start}-${end}/${st.size}`, 'content-length': String(end - start + 1) },
    });
  }
  return new Response(Readable.toWeb(fs.createReadStream(file)), { status: 200, headers: { ...headers, 'content-length': String(st.size) } });
}

function registerAppProtocol(downloadsDir) {
  protocol.handle(SCHEME, (request) => {
    let u;
    try {
      u = new URL(request.url);
    } catch {
      return notFound();
    }
    if (u.host === 'bundle') {
      const rel = decodeURIComponent(u.pathname).replace(/^\/+/, '') || 'index.html';
      const file = inside(DIST, rel);
      if (!file) return notFound();
      // The page gets the app CSP. The YouTube decipher worker needs
      // `new Function`, so it gets its own policy: eval allowed, but no
      // network, no imports from elsewhere, and (being a worker) no bridge.
      const base = path.basename(file);
      const headers = file.endsWith('.html')
        ? { 'content-security-policy': CSP }
        : /^decipher-worker[-.]/.test(base)
          ? { 'content-security-policy': "default-src 'none'; script-src 'self' 'unsafe-eval'" }
          : {};
      return serveFile(file, request, headers);
    }
    if (u.host === 'media') {
      const name = decodeURIComponent(u.pathname).replace(/^\/+/, '');
      if (!/^[\w-]{6,20}\.[a-z0-9]{2,5}$/.test(name)) return notFound();
      const file = inside(downloadsDir, name);
      return file ? serveFile(file, request) : notFound();
    }
    return notFound();
  });
}

/* ------------------------------------------------------------------------ */
/* Window                                                                   */
/* ------------------------------------------------------------------------ */

function createWindow() {
  win = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 380,
    minHeight: 560,
    title: '808Soles',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#000000' : '#ffffff',
    titleBarStyle: 'hidden',
    titleBarOverlay: overlayColors(),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      navigateOnDragDrop: false,
      backgroundThrottling: false,
      spellcheck: false,
    },
  });

  win.once('ready-to-show', () => win.show());

  const appUrl = isDev ? process.env.CADENCE_DEV_URL : `${APP_ORIGIN}/index.html`;
  const isAppUrl = (url) => (isDev ? url.startsWith(process.env.CADENCE_DEV_URL) : url.startsWith(`${APP_ORIGIN}/`));
  const openOutside = (url) => {
    // Only https links, opened in the user's browser.
    if (/^https:\/\//i.test(url)) void shell.openExternal(url);
  };

  win.webContents.setWindowOpenHandler(({ url }) => {
    openOutside(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!isAppUrl(url)) {
      e.preventDefault();
      openOutside(url);
    }
  });
  win.webContents.on('will-redirect', (e, url) => {
    if (!isAppUrl(url)) e.preventDefault();
  });
  win.webContents.on('will-attach-webview', (e) => e.preventDefault());

  void win.loadURL(appUrl);

  nativeTheme.on('updated', () => {
    try {
      win?.setTitleBarOverlay(overlayColors());
    } catch {
      /* not supported on this platform */
    }
  });
}

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

// No other windows or web contents of any kind.
app.on('web-contents-created', (_e, contents) => {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
});

// A plain Chrome user agent: no "Electron/…" or app name, which YouTube may treat as a bot.
app.userAgentFallback = app.userAgentFallback.replace(/\s(Electron|808soles|808Soles)\/\S+/g, '');

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);

  const downloadsDir = path.join(app.getPath('userData'), 'downloads');
  registerAppProtocol(downloadsDir);

  // No camera, microphone, location, notifications, USB, … ever.
  for (const ses of [session.defaultSession, session.fromPartition('cadence-api')]) {
    ses.setPermissionRequestHandler((_wc, _permission, cb) => cb(false));
    ses.setPermissionCheckHandler(() => false);
    ses.setDevicePermissionHandler(() => false);
  }

  // A separate session for YouTube API calls, so nothing the page does leaks into them.
  const api = session.fromPartition('cadence-api');

  /** fetch for the bridge: allowed hosts only, no cookies, bounded size. */
  async function bridgeFetch(rawUrl, init) {
    const u = allowedUrl(rawUrl);
    if (!u) throw new Error('Blocked: only YouTube and LRCLIB can be contacted');
    let target = u.href;
    if (fixtureRelay && !u.hostname.endsWith('.googlevideo.com')) target = `${fixtureRelay}/__relay/${u.href}`;
    const res = await api.fetch(target, { ...init, credentials: 'omit', redirect: 'follow', bypassCustomProtocolHandlers: true });
    // Redirects must stay on allowed hosts too.
    if (res.url && !fixtureRelay && !allowedUrl(res.url)) throw new Error('Blocked redirect');
    return res;
  }

  async function readCapped(res, cap) {
    const len = Number(res.headers.get('content-length') || 0);
    if (len > cap) throw new Error('Response too large');
    const reader = res.body?.getReader();
    if (!reader) return Buffer.alloc(0);
    const parts = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > cap) {
        await reader.cancel();
        throw new Error('Response too large');
      }
      parts.push(value);
    }
    return Buffer.concat(parts);
  }

  handle('net-fetch', async (_e, req) => {
    const method = String(req?.method || 'GET').toUpperCase();
    if (!['GET', 'POST', 'HEAD'].includes(method)) throw new Error('Method not allowed');
    const body = req?.body && method === 'POST' ? Buffer.from(req.body) : undefined;
    if (body && body.length > 1024 * 1024) throw new Error('Request too large');
    const res = await bridgeFetch(req?.url, { method, headers: cleanHeaders(req?.headers), body });
    const headers = {};
    res.headers.forEach((v, k) => {
      if (k !== 'set-cookie') headers[k] = v;
    });
    const data = await readCapped(res, MAX_RESPONSE);
    return { status: res.status, headers, body: new Uint8Array(data) };
  });

  on('register-media', (_e, url, headers) => {
    if (!isMediaUrl(url)) return;
    const c = new URL(url).searchParams.get('c') || '*';
    if (mediaHeaders.size > 32 && !mediaHeaders.has(c)) return;
    mediaHeaders.set(c, cleanHeaders(headers));
  });

  handle('media-log', () => [...mediaLog]);

  // ---- Offline downloads: saved under the app's data folder. ----
  const CHUNK = 4 * 1024 * 1024;

  handle('download', async (e, job) => {
    const id = String(job?.id ?? '');
    const ext = String(job?.ext ?? '');
    if (!/^[\w-]{6,20}$/.test(id) || !/^[a-z0-9]{2,5}$/.test(ext)) throw new Error('Bad download request');
    if (!isMediaUrl(job?.url)) throw new Error('Only YouTube audio streams can be downloaded');
    const headers = cleanHeaders(job.headers);
    fs.mkdirSync(downloadsDir, { recursive: true });
    const final = inside(downloadsDir, `${id}.${ext}`);
    if (!final) throw new Error('Bad download request');
    const part = `${final}.part`;
    const out = fs.openSync(part, 'w');
    let received = 0;
    let total = Math.max(0, Math.min(Number(job.size) || 0, MAX_DOWNLOAD));
    const report = () => {
      if (!e.sender.isDestroyed()) e.sender.send('download-progress', { id, received, total });
    };
    try {
      // Ranged requests: googlevideo throttles or cuts off long single requests.
      for (;;) {
        const end = received + CHUNK - 1;
        const res = await bridgeFetch(job.url, {
          headers: { ...headers, range: `bytes=${received}-${total ? Math.min(end, total - 1) : end}` },
        });
        if (res.status !== 206 && res.status !== 200) throw new Error(`HTTP ${res.status}`);
        const cr = res.headers.get('content-range');
        const m = cr && /\/(\d+)$/.exec(cr);
        if (m) total = Number(m[1]);
        if (total > MAX_DOWNLOAD) throw new Error('File too large');
        const buf = await readCapped(res, CHUNK + 1024);
        if (!buf.length) break;
        fs.writeSync(out, buf);
        received += buf.length;
        if (received > MAX_DOWNLOAD) throw new Error('File too large');
        report();
        if (res.status === 200 || (total && received >= total)) break;
      }
      fs.closeSync(out);
      fs.renameSync(part, final);
      return { path: final, url: `${MEDIA_ORIGIN}/${id}.${ext}`, size: received };
    } catch (err) {
      try {
        fs.closeSync(out);
      } catch {
        /* already closed */
      }
      fs.rmSync(part, { force: true });
      throw err;
    }
  });

  handle('delete-download', (_e, file) => {
    // Accepts the stored path; only files directly in the downloads folder.
    const resolved = path.resolve(String(file));
    if (path.dirname(resolved) !== downloadsDir || !/^[\w-]{6,20}\.[a-z0-9]{2,5}$/.test(path.basename(resolved))) {
      throw new Error('Not a download');
    }
    fs.rmSync(resolved, { force: true });
  });

  on('window-control', (_e, action) => {
    if (!win) return;
    if (action === 'minimize') win.minimize();
    else if (action === 'maximize') (win.isMaximized() ? win.unmaximize() : win.maximize());
    else if (action === 'close') win.close();
  });

  // Audio streams: send the headers the minting client expects, and no
  // Origin/Referer (googlevideo refuses some clients' URLs with them).
  session.defaultSession.webRequest.onBeforeSendHeaders({ urls: ['https://*.googlevideo.com/*'] }, (details, cb) => {
    const h = { ...details.requestHeaders };
    delete h.Origin;
    delete h.Referer;
    delete h.origin;
    delete h.referer;
    let c = '*';
    try {
      c = new URL(details.url).searchParams.get('c') || '*';
    } catch {
      /* ignore */
    }
    const extra = mediaHeaders.get(c) || mediaHeaders.get('*') || {};
    for (const [k, v] of Object.entries(extra)) h[k] = v;
    cb({ requestHeaders: h });
  });
  session.defaultSession.webRequest.onCompleted({ urls: ['https://*.googlevideo.com/*'] }, (d) => {
    if (d.statusCode >= 400 || mediaLog.length < 5) logMedia(`HTTP ${d.statusCode} ${mediaLabel(d.url)}`);
  });
  session.defaultSession.webRequest.onErrorOccurred({ urls: ['https://*.googlevideo.com/*'] }, (d) => {
    logMedia(`network error ${d.error} ${mediaLabel(d.url)}`);
  });

  createWindow();
});

app.on('window-all-closed', () => app.quit());
