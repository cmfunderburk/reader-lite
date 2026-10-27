import { useState } from 'react';
import { Library } from './library/Library';
import { ReaderView } from './reader/ReaderView';
import { useRoute } from './route';
import { SettingsProvider } from './settings';
import { useUpdateReady } from './sw/register';

function UpdateBanner() {
  const ready = useUpdateReady();
  const [dismissed, setDismissed] = useState(false);
  if (!ready || dismissed) return null;
  return (
    <div className="update-banner" role="status">
      <span>A new version is ready</span>
      <button className="button primary" onClick={() => location.reload()}>
        Reload
      </button>
      <button className="button subtle" onClick={() => setDismissed(true)} aria-label="Not now">
        ×
      </button>
    </div>
  );
}

export function App() {
  const route = useRoute();
  return (
    <SettingsProvider>
      {route.screen === 'book' ? <ReaderView key={route.bookId} bookId={route.bookId} /> : <Library />}
      <UpdateBanner />
    </SettingsProvider>
  );
}
