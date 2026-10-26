import type { Card } from '../yt/types';

export function hrefFor(c: Pick<Card, 'kind' | 'id' | 'params'>): string | null {
  switch (c.kind) {
    case 'album':
      return `/album/${encodeURIComponent(c.id)}`;
    case 'playlist':
      return `/playlist/${encodeURIComponent(c.id)}`;
    case 'artist':
      return `/artist/${encodeURIComponent(c.id)}`;
    case 'mood':
      return `/mood/${encodeURIComponent(c.id)}${c.params ? `?p=${encodeURIComponent(c.params)}` : ''}`;
    default:
      return null;
  }
}

/** Only https and inline images are shown; anything else in YouTube data is dropped. */
export function safeImage(src: string | undefined): string | undefined {
  return src && /^(https:\/\/|data:image\/)/i.test(src) ? src : undefined;
}
