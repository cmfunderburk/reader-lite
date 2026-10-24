import { useEffect, useState } from 'react';

// Hash routes, so a reload (or reopening the home-screen app) lands on the same
// screen. The reader restores its own position, so a book route is just the id.
export type Route = { screen: 'library' } | { screen: 'book'; bookId: string };

export function parseRoute(hash: string): Route {
  const match = hash.match(/^#\/book\/([0-9a-f]+)$/);
  if (match) return { screen: 'book', bookId: match[1]! };
  return { screen: 'library' };
}

export function routeHash(route: Route): string {
  return route.screen === 'book' ? `#/book/${route.bookId}` : '#/';
}

export function navigate(route: Route): void {
  location.hash = routeHash(route);
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
