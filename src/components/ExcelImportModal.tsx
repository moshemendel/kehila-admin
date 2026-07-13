import { useState, useRef } from 'react';
import { FileSpreadsheet, AlertCircle, CheckCircle2, Download } from 'lucide-react';
import Modal from './Modal';
import { parseExcelFile, downloadTemplate } from '../utils/excel';

export interface ImportField {
  key: string;
  label: string;
  required?: boolean;
  transform?: (val: string) => unknown;
}

interface Props<T> {
  open: boolean;
  onClose: () => void;
  title: string;
  fields: ImportField[];
  onImport: (rows: Partial<T>[]) => Promise<void>;
  templateFilename: string;
}

export default function ExcelImportModal<T>({ open, onClose, title, fields, onImport, templateFilename }: Props<T>) {
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [mapped, setMapped] = useState<Partial<T>[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [step, setStep] = useState<'upload' | 'preview' | 'done'>('upload');
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const reset = () => { setRows([]); setMapped([]); setErrors([]); setStep('upload'); };
  const handleClose = () => { reset(); onClose(); };

  const handleFile = async (file: File) => {
    try {
      const data = await parseExcelFile(file);
      setRows(data);

      const errs: string[] = [];
      const result: Partial<T>[] = data.map((row, i) => {
        const obj: Record<string, unknown> = {};
        fields.forEach(f => {
          const val = row[f.label]?.trim() ?? '';
          if (f.required && !val) errs.push(`שורה ${i + 2}: שדה "${f.label}" חסר`);
          obj[f.key] = f.transform ? f.transform(val) : val || undefined;
        });
        return obj as Partial<T>;
      });

      setErrors(errs);
      setMapped(result);
      setStep('preview');
    } catch {
      setErrors(['שגיאה בקריאת הקובץ. ודא שהוא קובץ Excel תקין.']);
      setStep('preview');
    }
  };

  const handleConfirm = async () => {
    setSaving(true);
    try {
      await onImport(mapped);
      setStep('done');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} title={title} onClose={handleClose} size="xl">
      {step === 'upload' && (
        <div className="flex flex-col gap-5">
          <button
            onClick={() => downloadTemplate(fields.map(f => ({ key: f.key, label: f.label })), templateFilename)}
            className="flex items-center gap-2 text-sm text-blue-600 hover:text-blue-800 font-medium"
          >
            <Download size={15} />
            הורד תבנית Excel
          </button>

          <div
            className="border-2 border-dashed border-slate-200 rounded-xl p-12 flex flex-col items-center gap-3 cursor-pointer hover:border-blue-400 hover:bg-blue-50/40 transition-colors"
            onClick={() => inputRef.current?.click()}
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
          >
            <FileSpreadsheet size={40} className="text-slate-300" />
            <div className="text-slate-500 text-sm font-medium">גרור קובץ Excel לכאן, או לחץ לבחירה</div>
            <div className="text-slate-400 text-xs">.xlsx, .xls</div>
          </div>
          <input ref={inputRef} type="file" accept=".xlsx,.xls" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />

          <div className="bg-slate-50 rounded-xl p-4">
            <div className="text-xs font-semibold text-slate-600 mb-2">עמודות נדרשות:</div>
            <div className="flex flex-wrap gap-2">
              {fields.map(f => (
                <span key={f.key} className={`text-xs px-2 py-1 rounded-full ${f.required ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500'}`}>
                  {f.label}{f.required ? ' *' : ''}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {step === 'preview' && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium text-slate-700">{rows.length} שורות נמצאו בקובץ</div>
            <button onClick={reset} className="text-xs text-blue-600 hover:underline">← החלף קובץ</button>
          </div>

          {errors.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex flex-col gap-1">
              <div className="flex items-center gap-2 text-red-700 font-semibold text-sm mb-1">
                <AlertCircle size={15} /> {errors.length} שגיאות
              </div>
              {errors.slice(0, 5).map((e, i) => <div key={i} className="text-xs text-red-600">{e}</div>)}
              {errors.length > 5 && <div className="text-xs text-red-400">...ועוד {errors.length - 5}</div>}
            </div>
          )}

          <div className="overflow-x-auto rounded-xl border border-slate-200 max-h-72">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 sticky top-0">
                <tr>
                  {fields.map(f => <th key={f.key} className="text-right px-3 py-2 font-semibold text-slate-600">{f.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 10).map((row, i) => (
                  <tr key={i} className="border-b border-slate-100">
                    {fields.map(f => <td key={f.key} className="px-3 py-2 text-slate-700 max-w-32 truncate">{row[f.label] || '—'}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length > 10 && <div className="text-center text-xs text-slate-400 py-2">...ועוד {rows.length - 10} שורות</div>}
          </div>

          <div className="flex gap-3 pt-2">
            <button
              onClick={handleConfirm}
              disabled={saving || (errors.length > 0 && mapped.length === 0)}
              className="flex-1 bg-[#1B3A6B] text-white py-2.5 rounded-xl font-semibold text-sm hover:bg-[#15306a] disabled:opacity-50 transition-colors"
            >
              {saving ? 'שומר...' : `ייבוא ${mapped.length} רשומות`}
            </button>
            <button onClick={handleClose} className="px-5 py-2.5 border border-slate-200 rounded-xl text-sm hover:bg-slate-50">
              ביטול
            </button>
          </div>
        </div>
      )}

      {step === 'done' && (
        <div className="flex flex-col items-center gap-4 py-8">
          <CheckCircle2 size={48} className="text-green-500" />
          <div className="text-lg font-bold text-slate-800">הייבוא הושלם!</div>
          <div className="text-sm text-slate-500">{mapped.length} רשומות יובאו בהצלחה</div>
          <button onClick={handleClose} className="mt-2 px-8 py-2.5 bg-[#1B3A6B] text-white rounded-xl font-semibold text-sm hover:bg-[#15306a]">
            סגור
          </button>
        </div>
      )}
    </Modal>
  );
}
