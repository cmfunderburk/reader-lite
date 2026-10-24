import { BookPreview } from './library/BookPreview';
import { Library } from './library/Library';
import { useRoute } from './route';

export function App() {
  const route = useRoute();
  return route.screen === 'book' ? (
    <BookPreview key={route.bookId} bookId={route.bookId} chapter={route.chapter} />
  ) : (
    <Library />
  );
}
