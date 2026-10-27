// Storage durability. Home-screen apps get their own storage that Safari
// doesn't evict on its usual schedule, but asking for persistence makes it
// explicit, and the estimate tells the reader how much the library takes.

/** Ask the browser not to evict our storage; returns whether it's persisted. */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (!navigator.storage?.persisted) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    // Not fatal: storage just stays best-effort.
    return false;
  }
}

export interface StorageStatus {
  /** null when the browser can't say. */
  persisted: boolean | null;
  usageBytes?: number;
}

export async function storageStatus(): Promise<StorageStatus> {
  try {
    const persisted = navigator.storage?.persisted ? await navigator.storage.persisted() : null;
    const estimate = navigator.storage?.estimate ? await navigator.storage.estimate() : undefined;
    return { persisted, usageBytes: estimate?.usage };
  } catch {
    return { persisted: null };
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
