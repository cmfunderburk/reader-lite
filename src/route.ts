import { useEffect, useState } from 'react';

// Hash routes, so a reload (or reopening the home-screen app) lands on the same screen.
// A book route without a chapter resumes from the saved position.
export type Route = { screen: 'library' } | { screen: 'book'; bookId: string; chapter?: number };

export function parseRoute(hash: string): Route {
  const match = hash.match(/^#\/book\/([0-9a-f]+)(?:\/(\d+))?$/);
  if (match) return { screen: 'book', bookId: match[1]!, chapter: match[2] === undefined ? undefined : Number(match[2]) };
  return { screen: 'library' };
}

export function routeHash(route: Route): string {
  if (route.screen === 'library') return '#/';
  return route.chapter === undefined ? `#/book/${route.bookId}` : `#/book/${route.bookId}/${route.chapter}`;
}

export function navigate(route: Route, { replace = false } = {}): void {
  const hash = routeHash(route);
  if (replace) history.replaceState(null, '', hash);
  else location.hash = hash;
  if (replace) window.dispatchEvent(new HashChangeEvent('hashchange'));
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseRoute(location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}
