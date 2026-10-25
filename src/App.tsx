import { useEffect, useRef } from 'react';
import { HashRouter, Route, Routes, useLocation } from 'react-router';
import { useWide } from './lib/hooks';
import { MiniPlayer, PlayerBar, Sidebar, TabBar, Toasts } from './components/Chrome';
import { NowPlaying } from './components/NowPlaying';
import { MenuHost } from './components/MenuHost';
import { usePlayer } from './store/player';
import { useSettings } from './store/settings';
import Home from './pages/Home';
import Browse, { Mood } from './pages/Browse';
import Search from './pages/Search';
import Library, { LibrarySection } from './pages/Library';
import { Album, MyPlaylist, Playlist } from './pages/Collections';
import Artist from './pages/Artist';
import Settings from './pages/Settings';

function Pages() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/browse" element={<Browse />} />
      <Route path="/search" element={<Search />} />
      <Route path="/library" element={<Library />} />
      <Route path="/library/:section" element={<LibrarySection />} />
      <Route path="/album/:id" element={<Album />} />
      <Route path="/playlist/:id" element={<Playlist />} />
      <Route path="/mine/:id" element={<MyPlaylist />} />
      <Route path="/artist/:id" element={<Artist />} />
      <Route path="/mood/:id" element={<Mood />} />
      <Route path="/settings" element={<Settings />} />
      <Route path="*" element={<Home />} />
    </Routes>
  );
}

function Main({ bottomPad }: { bottomPad: string }) {
  const ref = useRef<HTMLElement>(null);
  const { pathname, search } = useLocation();
  useEffect(() => {
    ref.current?.scrollTo({ top: 0 });
  }, [pathname, search]);
  return (
    <main ref={ref} className="scroll relative h-full min-w-0 flex-1" style={{ paddingBottom: bottomPad }}>
      <Pages />
    </main>
  );
}

function useTheme() {
  const theme = useSettings((s) => s.theme);
  useEffect(() => {
    const el = document.documentElement;
    if (theme === 'system') el.removeAttribute('data-theme');
    else el.setAttribute('data-theme', theme);
  }, [theme]);
}

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) return;
      const p = usePlayer.getState();
      if (e.code === 'Space') {
        e.preventDefault();
        p.toggle();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'ArrowRight') p.next();
      else if ((e.ctrlKey || e.metaKey) && e.key === 'ArrowLeft') p.previous();
      else if ((e.ctrlKey || e.metaKey) && e.key === 'ArrowUp') p.setVolume(Math.min(1, p.volume + 0.1));
      else if ((e.ctrlKey || e.metaKey) && e.key === 'ArrowDown') p.setVolume(Math.max(0, p.volume - 0.1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

function Shell() {
  const wide = useWide();
  const hasTrack = usePlayer((s) => s.index >= 0);
  useTheme();
  useShortcuts();
  if (wide) {
    return (
      <div className="flex h-full">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <PlayerBar />
          <Main bottomPad="0px" />
        </div>
        <NowPlaying />
        <MenuHost />
        <Toasts />
      </div>
    );
  }
  return (
    <div className="h-full">
      <Main bottomPad={`calc(var(--sab) + ${hasTrack ? 126 : 60}px)`} />
      <MiniPlayer />
      <TabBar />
      <NowPlaying />
      <MenuHost />
      <Toasts />
    </div>
  );
}

export default function App() {
  return (
    <HashRouter>
      <Shell />
    </HashRouter>
  );
}
