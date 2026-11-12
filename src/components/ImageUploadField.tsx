import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ImagePlus, Star, X } from 'lucide-react';
import ImageCropModal from './ImageCropModal';
import { IMAGE_ACCEPT, validateImageFile, uploadImage } from '../utils/uploadImage';
import type { ImageTracker } from '../utils/useImageTracker';
import { clampCrop, cropLayout, isDefaultCrop, MIN_ZOOM, MAX_ZOOM, type MoodCrop, type Size } from '../utils/moodCrop';

/**
 * Main picture frame the manager can pan and zoom (synagogues, mikvaot). The picture always
 * covers the frame: positions are clamped by utils/moodCrop, the same maths the app renders with.
 */
function PanZoomFrame({ url, crop, onCropChange, aspect, keepDefault, children }: {
  keepDefault?: boolean;
  url: string;
  crop: MoodCrop | undefined;
  onCropChange: (c: MoodCrop | undefined) => void;
  aspect: string;
  children: ReactNode;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState<Size | null>(null);
  const [nat, setNat] = useState<Size | null>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);

  // The natural size belongs to one picture; a different url reloads it.
  useEffect(() => { setNat(null); }, [url]);

  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const measure = () => setFrame({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // A stored crop only applies to the picture it was made for.
  const stored = crop && crop.url === url ? crop : undefined;
  const cur = frame && nat
    ? clampCrop(frame, nat, stored?.zoom ?? 1, stored?.fx ?? 0.5, stored?.fy ?? 0.5)
    : { zoom: 1, fx: 0.5, fy: 0.5 };

  const latest = useRef({ frame, nat, cur });
  latest.current = { frame, nat, cur };
  const cbRef = useRef(onCropChange);
  cbRef.current = onCropChange;

  const commit = (zoom: number, fx: number, fy: number) => {
    const { frame: f, nat: n } = latest.current;
    if (!f || !n) return;
    const c = clampCrop(f, n, zoom, fx, fy);
    cbRef.current(isDefaultCrop(c) && !keepDefault ? undefined : { url, ...c });
  };

  // Wheel zoom needs a non-passive listener to stop the page scrolling underneath.
  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const { cur: c } = latest.current;
      e.preventDefault();
      commit(c.zoom * Math.exp(-e.deltaY * 0.0015), c.fx, c.fy);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  const lay = frame && nat ? cropLayout(frame, nat, cur.zoom, cur.fx, cur.fy) : null;

  return (
    <div>
      <div
        ref={frameRef}
        className="relative mx-auto w-full max-w-[360px] rounded-xl overflow-hidden border-2 border-amber-300 bg-slate-100 group select-none touch-none cursor-grab active:cursor-grabbing"
        style={{ aspectRatio: aspect }}
        onPointerDown={e => {
          if (!lay) return;
          drag.current = { x: e.clientX, y: e.clientY };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={e => {
          const d = drag.current;
          const { cur: c } = latest.current;
          if (!d || !lay) return;
          const dx = e.clientX - d.x, dy = e.clientY - d.y;
          drag.current = { x: e.clientX, y: e.clientY };
          commit(c.zoom, c.fx - dx / lay.dw, c.fy - dy / lay.dh);
        }}
        onPointerUp={() => { drag.current = null; }}
        onPointerCancel={() => { drag.current = null; }}
      >
        <img
          src={url}
          alt=""
          draggable={false}
          onLoad={e => setNat({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
          style={lay
            ? { position: 'absolute', maxWidth: 'none', left: lay.left, top: lay.top, width: lay.dw, height: lay.dh }
            : { width: '100%', height: '100%', objectFit: 'cover' }}
        />
        {children}
      </div>
      <div className="mx-auto max-w-[360px] mt-2 flex items-center gap-3">
        <input
          type="range" min={MIN_ZOOM} max={MAX_ZOOM} step={0.05} value={cur.zoom}
          disabled={!lay}
          aria-label="הגדלה"
          onChange={e => commit(parseFloat(e.target.value), cur.fx, cur.fy)}
          className="flex-1 accent-[#1B3A6B]"
        />
        <span className="text-xs text-slate-500 w-10 text-left" dir="ltr">{cur.zoom.toFixed(1)}x</span>
        {keepDefault ? (
          <>
            <button type="button" onClick={() => cbRef.current({ url, zoom: 1, fx: 0.5, fy: 0.5 })}
              className="text-xs text-slate-600 underline">
              איפוס
            </button>
            <button type="button" onClick={() => cbRef.current(undefined)}
              className="text-xs text-slate-600 underline whitespace-nowrap">
              איפוס לתצוגה מלאה
            </button>
          </>
        ) : (
          <button type="button" onClick={() => cbRef.current(undefined)} disabled={!stored}
            className="text-xs text-slate-600 underline disabled:opacity-40 disabled:no-underline">
            איפוס
          </button>
        )}
      </div>
      <p className="mx-auto max-w-[360px] text-[11px] text-slate-400 mt-1">גררו כדי להזיז, גללו או השתמשו במחוון כדי להגדיל.</p>
    </div>
  );
}

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
  /**
   * How the main picture fills its frame. 'cover' fills it and crops the overflow, like the app's
   * synagogue/mikveh/event headers; 'contain' shows the whole picture with bars, like the app's
   * business header and the certificate viewer. Default 'cover'.
   */
  fit?: 'cover' | 'contain';
  /** CSS aspect-ratio of the main frame (phone-width). Default is the app's 360x186 header. */
  aspect?: string;
  /**
   * Gallery mode only: lets the manager pan and zoom the main picture inside its frame.
   * The value is tied to the main picture's url; it is cleared whenever the main picture changes.
   */
  crop?: {
    value: MoodCrop | undefined;
    onChange: (c: MoodCrop | undefined) => void;
    /**
     * Businesses: no crop means the picture is shown whole ('contain'); the editor is opt-in via a
     * button, and a default crop (plain cover) is kept rather than dropped.
     */
    keepDefault?: boolean;
  };
  /** Records uploads and removals; the page deletes the files once it knows whether the form was saved. */
  tracker: ImageTracker;
}

/**
 * Upload UI shared by synagogues, mikvaot, events and kosher certificates. Mirrors the
 * businesses gallery: pick files, crop queue, upload, ordered list; removing is reported to the tracker.
 */
export default function ImageUploadField({
  dir, images, onChange, single = false, primaryLabel = 'תמונת מצב', title = 'תמונות', tracker,
  fit = 'cover', aspect = '360 / 186', crop,
}: Props) {
  const fitClass = fit === 'cover' ? 'object-cover' : 'object-contain';
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
  const cropRef = useRef(crop);
  cropRef.current = crop;
  const emit = (next: string[]) => {
    // A new, removed or re-ordered main picture never inherits the old crop.
    if (next[0] !== latest.current[0]) cropRef.current?.onChange(undefined);
    latest.current = next;
    onChangeRef.current(next);
  };

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
      ) : single && crop && fit === 'cover' ? (
        <PanZoomFrame url={images[0]} crop={crop.value} onCropChange={crop.onChange} aspect={aspect}>
          <button type="button" onPointerDown={e => e.stopPropagation()} onClick={() => remove(images[0])} title="הסרת התמונה" className={`${removeBtn} top-2 left-2 p-1.5`}>
            <X size={13} />
          </button>
        </PanZoomFrame>
      ) : single ? (
        <div className="relative mx-auto w-full max-w-[360px] rounded-xl overflow-hidden border border-slate-200 bg-slate-100 group" style={{ aspectRatio: aspect }}>
          <img src={images[0]} alt="" className={`w-full h-full ${fitClass}`} />
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
            {crop && (fit === 'cover' || (crop.keepDefault && crop.value?.url === images[0])) ? (
              <PanZoomFrame url={images[0]} crop={crop.value} onCropChange={crop.onChange} aspect={crop.keepDefault ? '360 / 186' : aspect} keepDefault={crop.keepDefault}>
                <button type="button" onPointerDown={e => e.stopPropagation()} onClick={() => remove(images[0])} title="הסרת התמונה" className={`${removeBtn} top-2 left-2 p-1.5`}>
                  <X size={13} />
                </button>
              </PanZoomFrame>
            ) : (
              <div className="relative mx-auto w-full max-w-[360px] rounded-xl overflow-hidden border-2 border-amber-300 bg-slate-100 group" style={{ aspectRatio: aspect }}>
                <img src={images[0]} alt="" className={`w-full h-full ${fitClass}`} />
                <button type="button" onClick={() => remove(images[0])} title="הסרת התמונה" className={`${removeBtn} top-2 left-2 p-1.5`}>
                  <X size={13} />
                </button>
              </div>
            )}
            {crop?.keepDefault && fit === 'contain' && crop.value?.url !== images[0] && (
              <div className="mx-auto max-w-[360px] mt-2">
                <button type="button" onClick={() => crop.onChange({ url: images[0], zoom: 1, fx: 0.5, fy: 0.5 })}
                  className="text-xs text-blue-600 hover:text-blue-800 underline">
                  התאמת חיתוך
                </button>
              </div>
            )}
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
