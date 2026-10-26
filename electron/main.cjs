// 808Soles for Windows: the Electron main process.
// It opens the window, makes YouTube requests on the page's behalf (no CORS,
// any header), and adds the right headers to audio stream requests.
const { app, BrowserWindow, ipcMain, nativeTheme, session, shell, Menu } = require('electron');
const path = require('node:path');

const isDev = !app.isPackaged && process.env.CADENCE_DEV_URL;

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

// Keep media keys and the Windows media overlay working through the page's
// Media Session.
app.commandLine.appendSwitch('enable-features', 'HardwareMediaKeyHandling,MediaSessionService');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

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
    return url.slice(0, 60);
  }
}

let win = null;

function overlayColors() {
  const dark = nativeTheme.shouldUseDarkColors;
  return { color: dark ? '#00000000' : '#ffffff00', symbolColor: dark ? '#ffffff' : '#000000', height: 44 };
}

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
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      spellcheck: false,
    },
  });

  win.once('ready-to-show', () => win.show());

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file:') && !(isDev && url.startsWith(process.env.CADENCE_DEV_URL))) {
      e.preventDefault();
      if (/^https?:/.test(url)) void shell.openExternal(url);
    }
  });

  if (isDev) void win.loadURL(process.env.CADENCE_DEV_URL);
  else void win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));

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

// A plain Chrome user agent: no "Electron/…" or app name, which YouTube may treat as a bot.
app.userAgentFallback = app.userAgentFallback.replace(/\s(Electron|808soles|808Soles)\/\S+/g, '');

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);

  // A separate session for YouTube API calls, so nothing the page does leaks into them.
  const api = session.fromPartition('cadence-api');

  ipcMain.handle('net-fetch', async (_e, req) => {
    const res = await api.fetch(req.url, {
      method: req.method,
      headers: req.headers,
      body: req.body ? Buffer.from(req.body) : undefined,
      credentials: 'omit',
      bypassCustomProtocolHandlers: true,
    });
    const headers = {};
    res.headers.forEach((v, k) => {
      headers[k] = v;
    });
    const body = new Uint8Array(await res.arrayBuffer());
    return { status: res.status, headers, body };
  });

  ipcMain.on('register-media', (_e, url, headers) => {
    try {
      const c = new URL(url).searchParams.get('c') || '*';
      mediaHeaders.set(c, headers || {});
    } catch {
      /* ignore bad URLs */
    }
  });

  ipcMain.handle('media-log', () => [...mediaLog]);

  ipcMain.on('window-control', (_e, action) => {
    if (!win) return;
    if (action === 'minimize') win.minimize();
    else if (action === 'maximize') (win.isMaximized() ? win.unmaximize() : win.maximize());
    else if (action === 'close') win.close();
  });

  // Audio streams: send the headers the minting client expects, and no
  // Origin/Referer (googlevideo refuses some clients' URLs with them).
  session.defaultSession.webRequest.onBeforeSendHeaders({ urls: ['*://*.googlevideo.com/*'] }, (details, cb) => {
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
  session.defaultSession.webRequest.onCompleted({ urls: ['*://*.googlevideo.com/*'] }, (d) => {
    if (d.statusCode >= 400 || mediaLog.length < 5) logMedia(`HTTP ${d.statusCode} ${mediaLabel(d.url)}`);
  });
  session.defaultSession.webRequest.onErrorOccurred({ urls: ['*://*.googlevideo.com/*'] }, (d) => {
    logMedia(`network error ${d.error} ${mediaLabel(d.url)}`);
  });

  createWindow();
});

app.on('window-all-closed', () => app.quit());
