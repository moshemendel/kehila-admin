import { useMemo, useRef } from 'react';
import { deleteImageByUrl } from './uploadImage';

export interface ImageTracker {
  onUploaded: (url: string) => void;
  onRemoved: (url: string) => void;
  /** Forget everything; call when a form opens. */
  reset: () => void;
  /** After a successful save: delete every tracked file that the saved document no longer references. */
  commit: (finalUrls: string[]) => void;
  /** Form abandoned: delete what was uploaded in this session; removed files stay (the document still uses them). */
  discard: () => void;
}

/**
 * Bookkeeping for a form with image uploads. Files are only deleted once the outcome is known,
 * so cancelling an edit never leaves a document pointing at a file the user "removed", and
 * backing out of a new record never leaves uploads behind.
 */
export function useImageTracker(): ImageTracker {
  const state = useRef({ uploaded: new Set<string>(), removed: new Set<string>() });
  return useMemo<ImageTracker>(() => {
    const s = state.current;
    const reset = () => { s.uploaded.clear(); s.removed.clear(); };
    return {
      onUploaded: u => { s.uploaded.add(u); },
      onRemoved: u => { s.removed.add(u); },
      reset,
      commit: finalUrls => {
        const keep = new Set(finalUrls.filter(Boolean));
        for (const u of new Set([...s.uploaded, ...s.removed])) if (!keep.has(u)) void deleteImageByUrl(u);
        reset();
      },
      discard: () => {
        for (const u of s.uploaded) void deleteImageByUrl(u);
        reset();
      },
    };
  }, []);
}
