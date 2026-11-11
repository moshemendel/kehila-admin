import { useRef, useState } from 'react';
import { ImagePlus, Star, X } from 'lucide-react';
import ImageCropModal from './ImageCropModal';
import { IMAGE_ACCEPT, validateImageFile, uploadImage } from '../utils/uploadImage';
import type { ImageTracker } from '../utils/useImageTracker';

interface Props {
  /** Storage folder the files go to, e.g. `synagogues/<id>/gallery`. Falsy disables uploading. */
  dir: string;
  /** Ordered URLs. In gallery mode [0] is the primary ("mood") image; in single mode there is at most one. */
  images: string[];
  onChange: (images: string[]) => void;
  /** One picture only: adding replaces (and deletes) the current one. */
  single?: boolean;
  /** Label for the primary image in gallery mode. */
  primaryLabel?: string;
  /** Section title. */
  title?: string;
  /** Records uploads and removals; the page deletes the files once it knows whether the form was saved. */
  tracker: ImageTracker;
}

/**
 * Upload UI shared by synagogues, mikvaot, events and kosher certificates. Mirrors the
 * businesses gallery: pick files, crop queue, upload, ordered list; removing is reported to the tracker.
 */
export default function ImageUploadField({
  dir, images, onChange, single = false, primaryLabel = 'תמונת מצב', title = 'תמונות', tracker,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Uploads finish one after another; read the newest list, not the one captured at render time.
  const latest = useRef(images);
  latest.current = images;

  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [queue, setQueue] = useState<File[]>([]);
  const [current, setCurrent] = useState<File | null>(null);
  const [total, setTotal] = useState(0);

  // An upload outlives the render that started it; call the newest onChange, not a stale closure.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const emit = (next: string[]) => { latest.current = next; onChangeRef.current(next); };

  const reset = () => {
    setCurrent(null); setQueue([]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const onSelect = (files: FileList) => {
    setError('');
    const picked = Array.from(files).slice(0, single ? 1 : files.length);
    for (const f of picked) {
      const msg = validateImageFile(f);
      if (msg) { setError(msg); reset(); return; }
    }
    if (!picked.length) return;
    setTotal(picked.length);
    setCurrent(picked[0]);
    setQueue(picked.slice(1));
  };

  const advance = (remaining: File[]) => {
    if (!remaining.length) { reset(); return; }
    setCurrent(remaining[0]);
    setQueue(remaining.slice(1));
  };

  const doUpload = async (input: File | Blob, cropped: boolean) => {
    const rest = queue;
    setCurrent(null);
    setUploading(true);
    try {
      const url = await uploadImage(dir, input, { cropped });
      tracker.onUploaded(url);
      if (single) {
        const old = latest.current[0];
        emit([url]);
        if (old) tracker.onRemoved(old);
      } else {
        emit([...latest.current, url]);
      }
    } catch (err) {
      console.error('Image upload failed:', err);
      const code = (err as { code?: string })?.code ?? '';
      setError(code === 'storage/unauthorized'
        ? 'אין הרשאה להעלות תמונה כאן.'
        : 'העלאת התמונה נכשלה. נסו שוב.');
    } finally {
      setUploading(false);
    }
    advance(rest);
  };

  const remove = (url: string) => {
    emit(latest.current.filter(u => u !== url));
    tracker.onRemoved(url);
  };

  const setPrimary = (url: string) => emit([url, ...latest.current.filter(u => u !== url)]);

  const disabled = uploading || !dir;
  const addLabel = uploading ? 'מעלה...'
    : single ? (images.length ? 'החלפת תמונה' : 'הוספת תמונה')
    : 'הוספת תמונות';

  const removeBtn = 'absolute rounded-lg bg-black/40 text-white hover:bg-red-500/80 transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100';

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-semibold text-slate-700">{title}</span>
        <label className={`flex items-center gap-1.5 text-xs font-medium cursor-pointer transition-colors ${disabled ? 'text-slate-400 pointer-events-none' : 'text-blue-600 hover:text-blue-800'}`}>
          <ImagePlus size={13} />
          {addLabel}
          <input
            ref={fileInputRef}
            type="file"
            accept={IMAGE_ACCEPT}
            multiple={!single}
            className="hidden"
            disabled={disabled}
            onChange={e => e.target.files && onSelect(e.target.files)}
          />
        </label>
      </div>

      {error && <p className="text-xs text-red-600 mb-2">{error}</p>}

      {images.length === 0 ? (
        <p className="text-xs text-slate-400 text-center py-5 border border-dashed border-slate-200 rounded-xl">
          {single ? 'אין תמונה' : 'אין תמונות — לחצו על "הוספת תמונות" להוספה'}
        </p>
      ) : single ? (
        <div className="relative rounded-xl overflow-hidden border border-slate-200 bg-slate-100 h-40 group">
          <img src={images[0]} alt="" className="w-full h-full object-contain" />
          <button type="button" onClick={() => remove(images[0])} title="הסרת התמונה" className={`${removeBtn} top-2 left-2 p-1.5`}>
            <X size={13} />
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <div>
            <div className="flex items-center gap-1 mb-1.5">
              <Star size={11} className="fill-amber-400 text-amber-400" />
              <span className="text-[11px] font-semibold text-amber-600 tracking-wide">{primaryLabel}</span>
            </div>
            <div className="relative rounded-xl overflow-hidden border-2 border-amber-300 bg-slate-100 h-40 group">
              <img src={images[0]} alt="" className="w-full h-full object-contain" />
              <button type="button" onClick={() => remove(images[0])} title="הסרת התמונה" className={`${removeBtn} top-2 left-2 p-1.5`}>
                <X size={13} />
              </button>
            </div>
          </div>
          {images.length > 1 && (
            <div>
              <p className="text-[11px] font-semibold text-slate-400 tracking-wide mb-1.5">תמונות נוספות</p>
              <div className="flex flex-wrap gap-3">
                {images.slice(1).map(url => (
                  <div key={url} className="flex flex-col gap-1 items-center">
                    <div className="relative rounded-xl overflow-hidden border border-slate-200 bg-slate-100 w-20 h-20 group flex-shrink-0">
                      <img src={url} alt="" className="w-full h-full object-contain" />
                      <button type="button" onClick={() => remove(url)} title="הסרת התמונה" className={`${removeBtn} top-1 left-1 p-1`}>
                        <X size={11} />
                      </button>
                    </div>
                    <button type="button" onClick={() => setPrimary(url)}
                      className="flex items-center gap-0.5 text-[10px] font-medium text-amber-600 hover:text-amber-800 transition-colors">
                      <Star size={9} />
                      הגדר כ{primaryLabel}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <ImageCropModal
        file={current}
        fileIndex={Math.max(0, total - queue.length - 1)}
        fileCount={total}
        onConfirm={blob => doUpload(blob, true)}
        onSkip={file => doUpload(file, false)}
        onCancel={reset}
      />
    </div>
  );
}
