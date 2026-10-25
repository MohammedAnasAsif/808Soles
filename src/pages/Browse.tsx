import { useParams, useSearchParams } from 'react-router';
import { getBrowse, getExplore } from '../yt/api';
import { useAsync } from '../lib/hooks';
import { Empty, ErrorView, Loading, Page } from '../components/Page';
import { ShelfView } from '../components/Shelf';
import { LayoutGrid } from 'lucide-react';

export default function Browse() {
  const { data, error, loading, reload } = useAsync(getExplore, []);
  return (
    <Page title="New">
      {loading && !data && <Loading />}
      {error && !data && <ErrorView error={error} retry={reload} />}
      {data?.map((s, i) => <ShelfView key={s.title + i} shelf={s} />)}
    </Page>
  );
}

/** Mood & genre categories and "See All" pages. */
export function Mood() {
  const { id = '' } = useParams();
  const [sp] = useSearchParams();
  const params = sp.get('p') ?? undefined;
  const { data, error, loading, reload } = useAsync(() => getBrowse(id, params), [id, params]);
  return (
    <Page title={data?.title || undefined} back>
      {loading && !data && <Loading />}
      {error && !data && <ErrorView error={error} retry={reload} />}
      {data && !data.shelves.length && <Empty icon={<LayoutGrid className="h-10 w-10" />} title="Nothing here" text="YouTube Music returned an empty page." />}
      {data?.shelves.map((s, i) => <ShelfView key={s.title + i} shelf={s} />)}
    </Page>
  );
}
