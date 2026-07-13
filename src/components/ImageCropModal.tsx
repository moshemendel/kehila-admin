import { useEffect, useRef, useState } from 'react';
import ReactCrop, {
  type Crop, type PixelCrop,
  centerCrop, makeAspectCrop, convertToPixelCrop,
} from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';
import Modal from './Modal';

// ─── Canvas crop helper ───────────────────────────────────────────────────────

async function getCroppedBlob(img: HTMLImageElement, px: PixelCrop, maxDim = 1800): Promise<Blob> {
  const sx = img.naturalWidth  / img.width;
  const sy = img.naturalHeight / img.height;

  let outW = Math.round(px.width  * sx);
  let outH = Math.round(px.height * sy);

  if (outW > maxDim || outH > maxDim) {
    const r = Math.min(maxDim / outW, maxDim / outH);
    outW = Math.round(outW * r);
    outH = Math.round(outH * r);
  }

  const canvas = document.createElement('canvas');
  canvas.width  = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(
    img,
    Math.round(px.x * sx), Math.round(px.y * sy),
    Math.round(px.width * sx), Math.round(px.height * sy),
    0, 0, outW, outH,
  );

  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('canvas empty'))), 'image/jpeg', 0.92)
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  file:       File | null;
  fileIndex:  number;
  fileCount:  number;
  onConfirm:  (blob: Blob, filename: string) => void;
  onSkip:     (file: File)  => void;   // upload as-is
  onCancel:   ()            => void;   // discard remaining queue
}

const ASPECTS = [
  { label: 'חופשי', value: undefined  as number | undefined },
  { label: '1:1',   value: 1          as number | undefined },
  { label: '4:3',   value: 4/3        as number | undefined },
  { label: '16:9',  value: 16/9       as number | undefined },
];

export default function ImageCropModal({ file, fileIndex, fileCount, onConfirm, onSkip, onCancel }: Props) {
  const imgRef              = useRef<HTMLImageElement>(null);
  const [src,  setSrc]      = useState('');
  const [crop, setCrop]     = useState<Crop>();
  const [px,   setPx]       = useState<PixelCrop>();
  const [aspect, setAspect] = useState<number | undefined>(undefined);

  useEffect(() => {
    if (!file) { setSrc(''); return; }
    setAspect(undefined);
    setCrop(undefined);
    const reader = new FileReader();
    reader.onload = () => setSrc(reader.result as string);
    reader.readAsDataURL(file);
  }, [file]);

  const onLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const { width, height } = e.currentTarget;
    const c = centerCrop(
      makeAspectCrop({ unit: '%', width: 100 }, width / height, width, height),
      width, height,
    );
    setCrop(c);
    setPx(convertToPixelCrop(c, width, height));
  };

  const applyAspect = (a: number | undefined) => {
    setAspect(a);
    if (!imgRef.current) return;
    const { width, height } = imgRef.current;
    const base = a !== undefined ? a : width / height;
    const c = centerCrop(makeAspectCrop({ unit: '%', width: 100 }, base, width, height), width, height);
    setCrop(c);
    setPx(convertToPixelCrop(c, width, height));
  };

  const handleConfirm = async () => {
    if (!px || !imgRef.current || !file) return;
    const blob = await getCroppedBlob(imgRef.current, px);
    onConfirm(blob, file.name);
  };

  const title = fileCount > 1
    ? `התאמת תמונה ${fileIndex + 1} מתוך ${fileCount}`
    : 'התאמת תמונה';

  return (
    <Modal open={!!file} title={title} onClose={onCancel} size="lg">
      <div className="space-y-3" dir="rtl">

        {/* Aspect ratio chips */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-slate-400 ml-1">יחס גובה-רוחב:</span>
          {ASPECTS.map(a => (
            <button
              key={String(a.value)}
              type="button"
              onClick={() => applyAspect(a.value)}
              className={`px-2.5 py-1 text-xs rounded-lg font-medium transition-colors ${
                aspect === a.value
                  ? 'bg-[#1B3A6B] text-white'
                  : 'border border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              {a.label}
            </button>
          ))}
        </div>

        {/* Crop surface */}
        <div className="flex justify-center items-center bg-slate-900 rounded-xl overflow-hidden min-h-48">
          {src ? (
            <ReactCrop
              crop={crop}
              aspect={aspect}
              onChange={(_, pct) => setCrop(pct)}
              onComplete={c => setPx(c)}
              style={{ maxHeight: 420 }}
            >
              <img
                ref={imgRef}
                src={src}
                onLoad={onLoad}
                style={{ maxHeight: 420, maxWidth: '100%', display: 'block' }}
                alt=""
              />
            </ReactCrop>
          ) : (
            <div className="text-slate-500 text-sm py-16">טוען תמונה...</div>
          )}
        </div>

        <p className="text-[11px] text-slate-400">גרור את המסגרת לשינוי גודל ומיקום</p>

        {/* Actions */}
        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!px}
            className="flex-1 bg-[#1B3A6B] text-white py-2.5 rounded-xl font-semibold text-sm hover:bg-[#15306a] disabled:opacity-50"
          >
            {fileCount > 1 ? 'אשר ועבור לבאה' : 'אשר והעלה'}
          </button>
          <button
            type="button"
            onClick={() => file && onSkip(file)}
            className="px-4 py-2.5 border border-slate-200 rounded-xl text-sm hover:bg-slate-50 text-slate-600"
          >
            ללא חיתוך
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2.5 border border-slate-200 rounded-xl text-sm hover:bg-slate-50 text-slate-500"
          >
            ביטול
          </button>
        </div>
      </div>
    </Modal>
  );
}
