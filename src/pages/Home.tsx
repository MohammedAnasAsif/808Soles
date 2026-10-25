import { Settings } from 'lucide-react';
import { Link } from 'react-router';
import { getHome } from '../yt/api';
import { useAsync, useWide } from '../lib/hooks';
import { ErrorView, Loading, Page } from '../components/Page';
import { ShelfView } from '../components/Shelf';
import { useLibrary } from '../store/library';
import type { Shelf } from '../yt/types';

export default function Home() {
  const { data, error, loading, reload } = useAsync(getHome, []);
  const recent = useLibrary((s) => s.recent);
  const wide = useWide();
  const recentShelf: Shelf | null = recent.length
    ? {
        title: 'Recently Played',
        layout: 'carousel',
        items: recent.slice(0, 20).map((t) => ({
          kind: 'song' as const,
          id: t.id,
          title: t.title,
          subtitle: t.artists.map((a) => a.name).join(', '),
          thumb: t.thumb,
          track: t,
        })),
      }
    : null;
  return (
    <Page
      title="Home"
      actions={
        !wide && (
          <Link to="/settings" aria-label="Settings" className="flex h-9 w-9 items-center justify-center rounded-full text-accent">
            <Settings className="h-[22px] w-[22px]" />
          </Link>
        )
      }
    >
      {recentShelf && <ShelfView shelf={recentShelf} />}
      {loading && !data && <Loading />}
      {error && !data && <ErrorView error={error} retry={reload} />}
      {data?.map((s, i) => <ShelfView key={s.title + i} shelf={s} />)}
    </Page>
  );
}
