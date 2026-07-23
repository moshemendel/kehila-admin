import { useState } from 'react';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import type { DayKey, HoursBlock } from '../types';
import { nanoid } from '../utils/nanoid';

const DAY_CHIPS: [DayKey, string][] = [
  ['sunday', "א'"], ['monday', "ב'"], ['tuesday', "ג'"], ['wednesday', "ד'"],
  ['thursday', "ה'"], ['friday', "ו'"], ['saturday', "ש'"],
];

export interface HoursScheduleEditorProps {
  value: HoursBlock[];
  onChange: (blocks: HoursBlock[]) => void;
}

// Flexible opening-hours editor: each block is a time range applied to
// whichever days the manager picks — not fixed day groups, since one mikveh
// might have Sunday open late and another might have Sunday closed.
export default function HoursScheduleEditor({ value, onChange }: HoursScheduleEditorProps) {
  const [draft, setDraft] = useState<HoursBlock | null>(null);

  function openNew() {
    setDraft({ id: nanoid(8), days: [], start: '18:00', end: '22:00' });
  }

  function toggleDay(day: DayKey) {
    if (!draft) return;
    setDraft({
      ...draft,
      days: draft.days.includes(day) ? draft.days.filter(d => d !== day) : [...draft.days, day],
    });
  }

  function saveDraft() {
    if (!draft) return;
    if (draft.days.length === 0) { alert('יש לבחור לפחות יום אחד'); return; }
    if (draft.start >= draft.end) { alert('שעת הפתיחה חייבת להיות לפני שעת הסגירה'); return; }
    const exists = value.some(b => b.id === draft.id);
    onChange(exists ? value.map(b => (b.id === draft.id ? draft : b)) : [...value, draft]);
    setDraft(null);
  }

  function deleteBlock(id: string) {
    onChange(value.filter(b => b.id !== id));
  }

  return (
    <div>
      {value.length === 0 && !draft && (
        <p className="text-xs text-slate-400 text-center py-2">לא הוגדרו שעות פתיחה</p>
      )}

      {value.map(block => (
        <div key={block.id} className="flex items-center gap-2 py-2 border-b border-slate-100">
          <div className="flex gap-1">
            {DAY_CHIPS.map(([key, label]) => (
              <span
                key={key}
                className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold border ${
                  block.days.includes(key) ? 'bg-[#1B3A6B] border-[#1B3A6B] text-white' : 'bg-white border-slate-200 text-slate-400'
                }`}
              >
                {label}
              </span>
            ))}
          </div>
          <span className="flex-1 text-sm font-semibold text-slate-700">{block.start}–{block.end}</span>
          <button type="button" onClick={() => setDraft({ ...block })} className="p-1 text-slate-400 hover:text-blue-600">
            <Pencil size={14} />
          </button>
          <button type="button" onClick={() => deleteBlock(block.id)} className="p-1 text-slate-400 hover:text-red-500">
            <Trash2 size={14} />
          </button>
        </div>
      ))}

      {draft ? (
        <div className="bg-slate-50 rounded-lg border-[1.5px] border-blue-200 p-3 my-1.5 space-y-2">
          <label className="block text-xs font-semibold text-slate-500">ימים</label>
          <div className="flex flex-wrap gap-1.5">
            {DAY_CHIPS.map(([key, label]) => {
              const active = draft.days.includes(key);
              return (
                <button
                  type="button"
                  key={key}
                  onClick={() => toggleDay(key)}
                  className={`w-8 h-8 rounded-full text-xs font-bold border-[1.5px] ${
                    active ? 'bg-[#1B3A6B] border-[#1B3A6B] text-white' : 'bg-white border-slate-200 text-slate-600'
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>

          <div className="flex items-end gap-2.5">
            <div className="flex-1">
              <label className="block text-xs font-semibold text-slate-500 mb-1">פתיחה</label>
              <input type="time" value={draft.start} onChange={e => setDraft({ ...draft, start: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 bg-white" />
            </div>
            <span className="text-slate-400 mb-2">—</span>
            <div className="flex-1">
              <label className="block text-xs font-semibold text-slate-500 mb-1">סגירה</label>
              <input type="time" value={draft.end} onChange={e => setDraft({ ...draft, end: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 bg-white" />
            </div>
          </div>

          <div className="flex gap-2 pt-1">
            <button type="button" onClick={() => setDraft(null)}
              className="flex-1 py-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-100">
              ביטול
            </button>
            <button type="button" onClick={saveDraft}
              className="flex-1 py-2 rounded-lg bg-[#1B3A6B] text-white text-sm font-semibold hover:bg-[#15306a]">
              שמור
            </button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={openNew}
          className="w-full flex items-center justify-center gap-1.5 py-2 mt-1 border-[1.5px] border-dashed border-blue-300 rounded-lg text-sm text-blue-600 hover:bg-blue-50">
          <Plus size={16} /> הוסף שעות פתיחה
        </button>
      )}
    </div>
  );
}
