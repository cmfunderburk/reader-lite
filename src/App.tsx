import { Library } from './library/Library';
import { ReaderView } from './reader/ReaderView';
import { useRoute } from './route';
import { SettingsProvider } from './settings';

export function App() {
  const route = useRoute();
  return (
    <SettingsProvider>
      {route.screen === 'book' ? <ReaderView key={route.bookId} bookId={route.bookId} /> : <Library />}
    </SettingsProvider>
  );
}
