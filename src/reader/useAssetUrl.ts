import { useEffect, useState } from 'react';
import { ASSET_SCHEME } from '../epub/content';
import { getAsset } from '../store/db';

/** Resolve a figure src (`asset:<path>` or a URL) to something an <img> can load. */
export function useAssetUrl(bookId: string, src: string | undefined): string | undefined {
  const isAsset = !!src?.startsWith(ASSET_SCHEME);
  const [url, setUrl] = useState<string>();

  useEffect(() => {
    if (!src || !isAsset) return;
    let objectUrl: string | undefined;
    let cancelled = false;
    void getAsset(bookId, src.slice(ASSET_SCHEME.length)).then((asset) => {
      if (!asset || cancelled) return;
      objectUrl = URL.createObjectURL(new Blob([asset.data], { type: asset.mediaType }));
      setUrl(objectUrl);
    });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setUrl(undefined);
    };
  }, [bookId, src, isAsset]);

  return isAsset ? url : src;
}
