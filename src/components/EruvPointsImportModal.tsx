import { useRef, useState } from 'react';
import { FileSpreadsheet, AlertCircle, AlertTriangle, CheckCircle2, Download } from 'lucide-react';
import Modal from './Modal';
import { parseExcelFile } from '../utils/excel';
import {
  parseEruvRows, orderByProximity, downloadEruvTemplate, type LatLng, type ParseResult,
} from '../utils/eruvPoints';

interface Props {
  open: boolean;
  onClose: () => void;
  /** City centre, to flag points that landed in the wrong town. */
  centre?: LatLng;
  /** Whether the editor already holds points that loading will replace. */
  hasExisting: boolean;
  /** Puts the points into the editor. Saving is still the editor's own button. */
  onLoad: (polygons: LatLng[][]) => void;
}

export default function EruvPointsImportModal({ open, onClose, centre, hasExisting, onLoad }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [result, setResult] = useState<ParseResult | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [byProximity, setByProximity] = useState(false);

  function reset() {
    setFileName(null);
    setResult(null);
    setReadError(null);
    setByProximity(false);
    if (inputRef.current) inputRef.current.value = '';
  }

  function close() {
    reset();
    onClose();
  }

  async function handleFile(file: File) {
    setReadError(null);
    setFileName(file.name);
    try {
      const rows = await parseExcelFile(file);
      const parsed = parseEruvRows(rows, centre);
      setResult(parsed);
      // Off by default: whether the file is already in route order cannot be
      // told from the numbers, so the map preview decides.
      setByProximity(false);
    } catch (e) {
      setResult(null);
      setReadError(e instanceof Error ? e.message : 'לא ניתן לקרוא את הקובץ');
    }
  }

  const polygons = result
    ? (byProximity ? result.polygons.map(orderByProximity) : result.polygons)
    : [];
  const pointCount = polygons.reduce((n, p) => n + p.length, 0);

  function load() {
    if (polygons.length === 0) return;
    if (hasExisting && !window.confirm('הנקודות מהקובץ יחליפו את הגבולות שבעורך. להמשיך?')) return;
    onLoad(polygons);
    close();
  }

  return (
    <Modal open={open} title="ייבוא נקודות עירוב מקובץ" onClose={close} size="xl">
      {!result && (
        <div className="flex flex-col gap-5">
          <div
            className="border-2 border-dashed border-slate-200 rounded-xl p-10 flex flex-col items-center gap-3 cursor-pointer hover:border-blue-400 hover:bg-blue-50/40 transition-colors"
            onClick={() => inputRef.current?.click()}
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
          >
            <FileSpreadsheet size={40} className="text-slate-300" />
            <div className="text-slate-500 text-sm font-medium">גרור קובץ לכאן, או לחץ לבחירה</div>
            <div className="text-slate-400 text-xs">.csv, .xlsx, .xls</div>
          </div>
          <input ref={inputRef} type="file" accept=".csv,.xlsx,.xls" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
          {readError && <div className="text-sm text-red-600">{readError}</div>}

          <div className="bg-slate-50 rounded-xl p-4 text-xs text-slate-600 leading-relaxed space-y-2">
            <div className="font-semibold text-slate-700">מבנה הקובץ: שורה לכל עמוד או נקודה בגבול</div>
            <div className="flex flex-wrap gap-2">
              <span className="px-2 py-1 rounded-full bg-blue-100 text-blue-700">latitude *</span>
              <span className="px-2 py-1 rounded-full bg-blue-100 text-blue-700">longitude *</span>
              <span className="px-2 py-1 rounded-full bg-slate-100 text-slate-500">order</span>
              <span className="px-2 py-1 rounded-full bg-slate-100 text-slate-500">polygon</span>
            </div>
            <div>
              קואורדינטות במעלות עשרוניות (WGS84), למשל 31.9284 / 34.8662. <b>order</b> הוא המיקום לאורך הגבול;
              בלעדיו נשמר סדר השורות בקובץ. <b>polygon</b> מפריד בין אזורים שלא נוגעים זה בזה (1–5); בלעדיו הכל מצולע אחד.
              אפשר גם כותרות בעברית: קו רוחב, קו אורך, סדר, מצולע.
            </div>
            <button onClick={downloadEruvTemplate}
              className="flex items-center gap-1.5 text-blue-600 hover:text-blue-800 font-medium">
              <Download size={14} /> הורד תבנית CSV
            </button>
          </div>
        </div>
      )}

      {result && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium text-slate-700">
              {fileName}: {polygons.length} מצולעים, {pointCount} נקודות
            </div>
            <button onClick={reset} className="text-xs text-blue-600 hover:underline">← קובץ אחר</button>
          </div>

          {result.errors.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex flex-col gap-1">
              <div className="flex items-center gap-2 text-red-700 font-semibold text-sm mb-1">
                <AlertCircle size={15} /> {result.errors.length} שורות לא נטענו
              </div>
              {result.errors.slice(0, 6).map((e, i) => <div key={i} className="text-xs text-red-600">{e}</div>)}
              {result.errors.length > 6 && <div className="text-xs text-red-400">…ועוד {result.errors.length - 6}</div>}
            </div>
          )}

          {result.warnings.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex flex-col gap-1">
              {result.warnings.map((w, i) => (
                <div key={i} className="flex items-start gap-2 text-xs text-amber-800">
                  <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" /> {w}
                </div>
              ))}
            </div>
          )}

          {polygons.length > 0 && (
            <div className="rounded-xl border border-slate-200 divide-y divide-slate-100">
              {polygons.map((p, i) => (
                <div key={i} className="flex items-center justify-between px-4 py-2.5 text-sm">
                  <span className="font-medium text-slate-700">מצולע {i + 1}</span>
                  <span className="text-slate-500 tabular-nums">{p.length} נקודות</span>
                </div>
              ))}
            </div>
          )}

          {polygons.length > 0 && !result.hadOrderColumn && (
            <label className="flex items-start gap-2 text-xs text-slate-600 cursor-pointer">
              <input type="checkbox" checked={byProximity} onChange={e => setByProximity(e.target.checked)}
                className="mt-0.5 rounded border-slate-300" />
              <span>
                <b>לסדר את הנקודות לפי קרבה.</b> לרשימת עמודים שממוינת לפי מספר עמוד ולא לפי המסלול.
                אם הקו על המפה יוצא חוצה את עצמו, נסה עם או בלי הסימון הזה.
              </span>
            </label>
          )}

          <div className="text-xs text-slate-500">
            הנקודות ייטענו לעורך המפה ולא יישמרו עד שתלחץ "שמור".
          </div>

          <div className="flex gap-3 pt-1">
            <button onClick={load} disabled={polygons.length === 0}
              className="flex-1 bg-[#1B3A6B] text-white py-2.5 rounded-xl font-semibold text-sm hover:bg-[#15306a] disabled:opacity-50 transition-colors flex items-center justify-center gap-2">
              <CheckCircle2 size={15} /> טען {pointCount} נקודות לעורך
            </button>
            <button onClick={close} className="px-5 py-2.5 border border-slate-200 rounded-xl text-sm hover:bg-slate-50">
              ביטול
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
