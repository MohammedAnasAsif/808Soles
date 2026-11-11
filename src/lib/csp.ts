/**
 * Content-Security-Policy for the Android app.
 *
 * The Windows app gets its CSP as an HTTP header from its app:// protocol
 * (electron/main.cjs). Android's WebView serves files without headers, so the
 * policy is added here as a <meta> tag as soon as the app starts. It's added
 * at runtime, not in index.html, so it can't block the bridge script that
 * Capacitor injects into the page on old WebViews; from then on, no inline,
 * injected or remote script, eval, plug-in, frame or outside connection is
 * allowed.
 */
export const ANDROID_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "worker-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' https: data: blob:",
  "media-src 'self' https: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

export function applyRuntimeCsp(policy: string = ANDROID_CSP) {
  if (document.querySelector('meta[http-equiv="Content-Security-Policy"]')) return;
  const meta = document.createElement('meta');
  meta.httpEquiv = 'Content-Security-Policy';
  meta.content = policy;
  document.head.prepend(meta);
}
