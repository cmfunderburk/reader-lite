import { expect, test } from 'bun:test';
import { parseRoute, routeHash } from './route';

test('book routes round-trip through the hash', () => {
  const route = { screen: 'book', bookId: 'ab12' } as const;
  expect(parseRoute(routeHash(route))).toEqual(route);
});

test('anything else is the library', () => {
  expect(parseRoute('')).toEqual({ screen: 'library' });
  expect(parseRoute('#/nonsense')).toEqual({ screen: 'library' });
  expect(parseRoute('#/book/ab12/3')).toEqual({ screen: 'library' });
});
