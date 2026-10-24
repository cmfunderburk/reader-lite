// Page side of the service worker: register it, and ask whether a newer
// version of the app is cached (at launch and whenever the app comes back to
// the foreground). The answer drives the "Update ready" prompt.

import { useSyncExternalStore } from 'react';
import type { PageMessage, WorkerMessage } from './shell';

let updateReady = false;
const listeners = new Set<() => void>();

function setUpdateReady(): void {
  updateReady = true;
  for (const listener of listeners) listener();
}

/** The path of the script this page is running (a content-hashed chunk). */
function runningScriptPath(): string | null {
  const script = document.querySelector<HTMLScriptElement>('script[type="module"][src]');
  return script ? new URL(script.src).pathname : null;
}

export function registerServiceWorker(): void {
  // Development serves a worker that only removes itself (see server.ts).
  if (process.env.NODE_ENV !== 'production') return;
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  navigator.serviceWorker.addEventListener('message', (event) => {
    if ((event.data as PageMessage)?.type === 'update-ready') setUpdateReady();
  });
  const check = () => {
    const scriptPath = runningScriptPath();
    const worker = navigator.serviceWorker.controller;
    if (scriptPath && worker) worker.postMessage({ type: 'check-update', scriptPath } satisfies WorkerMessage);
  };
  navigator.serviceWorker
    .register('/sw.js')
    .then(() => navigator.serviceWorker.ready)
    .then(check)
    .catch(() => undefined); // offline use just isn't available
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check();
  });
}

export function useUpdateReady(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => updateReady,
  );
}
