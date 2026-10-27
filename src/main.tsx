import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { requestPersistence } from './store/persistence';
import { registerServiceWorker } from './sw/register';
import { todaysArticle } from './wikipedia/daily';

const root = document.getElementById('root');
if (!root) throw new Error('missing #root');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

registerServiceWorker();
void requestPersistence();
// Have today's featured article stored before it's wanted, even if the app opens straight into a book.
void todaysArticle().catch(() => undefined);
