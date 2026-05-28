import { useEffect, useState } from 'react';

/**
 * Tiny path-based router. Avoids the full TanStack Router setup for now while
 * Phase 1's surface is small. The hook returns `[path, search, navigate]` and
 * re-renders on pushState / popstate.
 */
export type NavigateFn = (path: string) => void;

export interface Location {
  path: string;
  search: URLSearchParams;
}

export function navigate(path: string): void {
  window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function useLocation(): Location {
  const get = () => ({
    path: window.location.pathname,
    search: new URLSearchParams(window.location.search),
  });
  const [loc, setLoc] = useState<Location>(get);
  useEffect(() => {
    const onPop = () => setLoc(get());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  return loc;
}
