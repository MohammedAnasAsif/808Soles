import { Music2, User } from 'lucide-react';
import { useState } from 'react';

interface Props {
  src?: string;
  alt?: string;
  className?: string;
  round?: boolean;
  /** Corner radius in px (ignored when round). */
  radius?: number;
  shadow?: boolean;
  /** Center-crop to square (YouTube video thumbnails are 16:9). */
  square?: boolean;
  eager?: boolean;
}

export function Artwork({ src, alt = '', className = '', round, radius = 8, shadow = true, square = true, eager }: Props) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const style = {
    borderRadius: round ? '9999px' : `${radius}px`,
    boxShadow: shadow ? 'var(--art-shadow)' : undefined,
  };
  return (
    <div className={`relative overflow-hidden bg-fill ${square ? 'aspect-square' : ''} ${className}`} style={style}>
      {src && !failed ? (
        <img
          src={src}
          alt={alt}
          draggable={false}
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          referrerPolicy="no-referrer"
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className="absolute inset-0 h-full w-full object-cover transition-opacity duration-300"
          style={{ opacity: loaded ? 1 : 0 }}
        />
      ) : null}
      {(!src || failed) && (
        <div
          className="absolute inset-0 flex items-center justify-center"
          style={{ background: 'linear-gradient(145deg, var(--fill-2), var(--fill))' }}
        >
          {round ? <User className="h-1/3 w-1/3 text-label3" /> : <Music2 className="h-1/3 w-1/3 text-label3" />}
        </div>
      )}
      {!round && (
        <div className="pointer-events-none absolute inset-0 rounded-[inherit]" style={{ boxShadow: 'inset 0 0 0 0.5px var(--sep)' }} />
      )}
    </div>
  );
}
