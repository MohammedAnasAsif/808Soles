import { NavLink, useLocation, useNavigate } from 'react-router';
import { Heart, House, LayoutGrid, Library, ListMusic, MessageSquareQuote, Mic2, Clock, Disc3, Search, Settings, Music, ListPlus } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { usePlayer } from '../store/player';
import { useLibrary } from '../store/library';
import { useToast } from '../store/toast';
import { Artwork } from './Artwork';
import { NextButton, PlayButton, PrevButton, RepeatButton, Scrubber, ShuffleButton, VolumeSlider } from './controls';
import { artistNames } from '../lib/hooks';
import { isDesktop } from '../platform';

/* ------------------------------ mobile ------------------------------ */

export function MiniPlayer() {
  const track = usePlayer((s) => s.queue[s.index]);
  const position = usePlayer((s) => s.position);
  const duration = usePlayer((s) => s.duration);
  const open = usePlayer((s) => s.openNowPlaying);
  if (!track) return null;
  const pct = duration ? (position / duration) * 100 : 0;
  return (
    <div className="fixed inset-x-2 z-40" style={{ bottom: 'calc(var(--sab) + 58px)' }}>
      <div
        role="button"
        tabIndex={0}
        onClick={() => open(true)}
        className="glass relative flex h-14 items-center gap-3 overflow-hidden rounded-[14px] pl-2 pr-3"
        style={{ boxShadow: 'var(--shadow)' }}
      >
        <Artwork src={track.thumb} radius={6} className="w-10 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-medium leading-5">{track.title}</div>
          <div className="truncate text-[13px] leading-4 text-label2">{artistNames(track.artists)}</div>
        </div>
        <PlayButton size={24} className="h-10 w-10 text-label" />
        <NextButton size={24} className="h-10 w-10 text-label" />
        <div className="absolute inset-x-0 bottom-0 h-[2px] bg-fill">
          <div className="h-full bg-label2" style={{ width: `${pct}%` }} />
        </div>
      </div>
    </div>
  );
}

const tabs = [
  { to: '/', label: 'Home', icon: House, end: true },
  { to: '/browse', label: 'New', icon: LayoutGrid },
  { to: '/library', label: 'Library', icon: Library },
  { to: '/search', label: 'Search', icon: Search },
];

export function TabBar() {
  return (
    <nav className="glass fixed inset-x-0 bottom-0 z-40 border-t border-sep" style={{ paddingBottom: 'var(--sab)' }}>
      <div className="mx-auto flex h-[52px] max-w-[600px]">
        {tabs.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) => `flex flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-medium ${isActive ? 'text-accent' : 'text-label2'}`}
          >
            <Icon className="h-[22px] w-[22px]" strokeWidth={2} />
            {label}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}

/* ------------------------------ desktop ----------------------------- */

function SideLink({ to, icon, children, end }: { to: string; icon: ReactNode; children: ReactNode; end?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `no-drag flex items-center gap-2.5 rounded-md px-2.5 py-[6px] text-[14px] ${isActive ? 'bg-fill2 font-medium text-label' : 'text-label hover:bg-fill'}`
      }
    >
      {({ isActive }) => (
        <>
          <span className={isActive ? 'text-accent' : 'text-accent/90'}>{icon}</span>
          <span className="truncate">{children}</span>
        </>
      )}
    </NavLink>
  );
}

export function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const mine = useLibrary((s) => s.mine);
  const [q, setQ] = useState('');
  const ic = 'h-[18px] w-[18px]';
  return (
    <aside className="flex h-full w-[248px] shrink-0 flex-col border-r border-sep bg-sidebar">
      <div className="drag h-11 shrink-0" />
      <form
        className="px-3 pb-3"
        onSubmit={(e) => {
          e.preventDefault();
          navigate(`/search?q=${encodeURIComponent(q)}`);
        }}
      >
        <label className="no-drag flex items-center gap-2 rounded-lg bg-fill px-2.5 py-1.5">
          <Search className="h-4 w-4 text-label2" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onFocus={() => location.pathname !== '/search' && navigate('/search')}
            placeholder="Search"
            className="min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-label2"
          />
        </label>
      </form>
      <nav className="scroll flex-1 space-y-0.5 px-3 pb-4">
        <SideLink to="/" end icon={<House className={ic} />}>
          Home
        </SideLink>
        <SideLink to="/browse" icon={<LayoutGrid className={ic} />}>
          New
        </SideLink>
        <div className="px-2.5 pb-1 pt-5 text-[11px] font-semibold text-label2">Library</div>
        <SideLink to="/library/recent" icon={<Clock className={ic} />}>
          Recently Played
        </SideLink>
        <SideLink to="/library/artists" icon={<Mic2 className={ic} />}>
          Artists
        </SideLink>
        <SideLink to="/library/albums" icon={<Disc3 className={ic} />}>
          Albums
        </SideLink>
        <SideLink to="/library/songs" icon={<Heart className={ic} />}>
          Loved Songs
        </SideLink>
        <SideLink to="/library/playlists" icon={<ListMusic className={ic} />}>
          Playlists
        </SideLink>
        <div className="flex items-center justify-between px-2.5 pb-1 pt-5 text-[11px] font-semibold text-label2">
          <span>My Playlists</span>
          <button
            type="button"
            aria-label="New playlist"
            onClick={() => {
              const id = useLibrary.getState().createPlaylist('New Playlist');
              navigate(`/mine/${id}`);
            }}
            className="no-drag rounded p-0.5 hover:bg-fill"
          >
            <ListPlus className="h-4 w-4" />
          </button>
        </div>
        {mine.map((p) => (
          <SideLink key={p.id} to={`/mine/${p.id}`} icon={<Music className={ic} />}>
            {p.name}
          </SideLink>
        ))}
      </nav>
      <div className="border-t border-sep px-3 py-2">
        <SideLink to="/settings" icon={<Settings className={ic} />}>
          Settings
        </SideLink>
      </div>
    </aside>
  );
}

/** Desktop player across the top, like Apple Music on Windows and macOS. */
export function PlayerBar() {
  const track = usePlayer((s) => s.queue[s.index]);
  const open = usePlayer((s) => s.openNowPlaying);
  const panel = usePlayer((s) => s.panel);
  const setPanel = usePlayer((s) => s.setPanel);
  const showPanel = (p: 'lyrics' | 'queue') => {
    open(true);
    if (panel !== p) setPanel(p);
  };
  return (
    <header className="drag flex h-[64px] shrink-0 items-center gap-4 border-b border-sep bg-bg px-4" style={{ paddingRight: isDesktop ? 150 : 16 }}>
      <div className="no-drag flex items-center gap-2 text-label">
        <ShuffleButton />
        <PrevButton size={22} className="h-9 w-9" />
        <PlayButton size={28} className="h-10 w-10" />
        <NextButton size={22} className="h-9 w-9" />
        <RepeatButton />
      </div>
      <div className="no-drag mx-auto flex h-[48px] w-full max-w-[560px] items-center gap-3 overflow-hidden rounded-lg border border-sep bg-elev px-0 pr-3">
        {track ? (
          <>
            <button type="button" onClick={() => open(true)} className="h-12 w-12 shrink-0" aria-label="Open Now Playing">
              <Artwork src={track.thumb} radius={0} shadow={false} className="h-12 w-12" />
            </button>
            <div className="min-w-0 flex-1 pt-1">
              <div className="truncate text-center text-[13px] font-medium leading-4">{track.title}</div>
              <div className="truncate text-center text-[12px] leading-4 text-label2">
                {artistNames(track.artists)}
                {track.album?.name ? ` — ${track.album.name}` : ''}
              </div>
              <div className="-mt-1">
                <Scrubber onDark={false} small showTimes={false} />
              </div>
            </div>
          </>
        ) : (
          <div className="flex w-full items-center justify-center text-label3">
            <Music className="h-6 w-6" />
          </div>
        )}
      </div>
      <div className="no-drag flex w-[220px] shrink-0 items-center gap-2">
        <VolumeSlider onDark={false} />
        <button type="button" aria-label="Lyrics" onClick={() => showPanel('lyrics')} className="rounded-md p-1.5 text-label2 hover:bg-fill">
          <MessageSquareQuote className="h-[18px] w-[18px]" />
        </button>
        <button type="button" aria-label="Queue" onClick={() => showPanel('queue')} className="rounded-md p-1.5 text-label2 hover:bg-fill">
          <ListMusic className="h-[18px] w-[18px]" />
        </button>
      </div>
    </header>
  );
}

export function Toasts() {
  const toasts = useToast((s) => s.toasts);
  return (
    <div className="pointer-events-none fixed inset-x-0 z-[90] flex flex-col items-center gap-2 px-4" style={{ top: 'calc(var(--sat) + 12px)' }}>
      {toasts.map((t) => (
        <div key={t.id} className="glass anim-pop max-w-[420px] rounded-full border border-sep px-4 py-2 text-center text-[13px] font-medium" style={{ boxShadow: 'var(--shadow)' }}>
          {t.text}
        </div>
      ))}
    </div>
  );
}
