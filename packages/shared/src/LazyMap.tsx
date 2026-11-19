/**
 * The map, loaded on demand (Round 18): Leaflet, react-leaflet and their CSS are a separate file fetched the first time a map is
 * shown, so the app's first screen starts sooner. Same props as Map.tsx's DgMap. While it loads (or if it can't, e.g. no signal
 * on a cold start) a plain box of the same size stands in, so the screen around it doesn't jump.
 */
import { Suspense, type ComponentProps } from 'react';
import type { DgMap as RealMap } from './Map';
import { LoadBoundary, lazyWithRetry } from './lazy';

export type { MapMarker, Pt } from './Map';
export const ALICE = { lat: -23.6980, lng: 133.8807 };

const Inner = lazyWithRetry(() => import('./Map').then((m) => ({ default: m.DgMap })));

export function DgMap(props: ComponentProps<typeof RealMap>) {
  const box = (text?: string) => (
    <div className={props.className} style={{ width: '100%', height: '100%', minHeight: 120, background: 'var(--line, #E4E1DA)', display: 'grid', placeItems: 'center', ...props.style }}
      aria-busy={text ? undefined : true}>
      {text && <span style={{ color: 'var(--muted, #5D6478)', fontSize: 14 }}>{text}</span>}
    </div>
  );
  return (
    <LoadBoundary fallback={box('Map unavailable right now')}>
      <Suspense fallback={box()}><Inner {...props} /></Suspense>
    </LoadBoundary>
  );
}
