import { useState } from 'react';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import type { DayKey, HoursBlock, ZmanimAnchor } from '../types';
import { nanoid } from '../utils/nanoid';

const DAY_CHIPS: [DayKey, string][] = [
  ['sunday', "א'"], ['monday', "ב'"], ['tuesday', "ג'"], ['wednesday', "ד'"],
  ['thursday', "ה'"], ['friday', "ו'"], ['saturday', "ש'"],
];

const ANCHORS: { key: ZmanimAnchor; label: string }[] = [
  { key: 'netz', label: 'הנץ' }, { key: 'shkia', label: 'שקיעה' }, { key: 'tzeit', label: 'צאת הכוכבים' },
  { key: 'chatzot', label: 'חצות' }, { key: 'plagHamincha', label: 'פלג המנחה' },
  { key: 'minchaGedola', label: 'מנחה גדולה' }, { key: 'minchaKetana', label: 'מנחה קטנה' },
];

function anchorFormula(anchor: ZmanimAnchor, offsetMin = 0, proportional = false): string {
  const base = ANCHORS.find(a => a.key === anchor)?.label ?? anchor;
  if (!offsetMin) return base;
  const suffix = proportional ? 'ז׳' : '׳';
  return `${base} ${offsetMin > 0 ? '+' : ''}${offsetMin}${suffix}`;
}

function blockFormula(block: HoursBlock): string {
  const start = block.startAnchor ? anchorFormula(block.startAnchor, block.startOffsetMin, block.startProportional) : block.start;
  const end   = block.endAnchor   ? anchorFormula(block.endAnchor,   block.endOffsetMin,   block.endProportional)   : block.end;
  return `${start}–${end}`;
}

export interface HoursScheduleEditorProps {
  value: HoursBlock[];
  onChange: (blocks: HoursBlock[]) => void;
}

// Flexible opening-hours editor: each block is a time range applied to
// whichever days the manager picks — not fixed day groups, since one mikveh
// might have Sunday open late and another might have Sunday closed. Each
// boundary (start/end) can independently be a fixed clock time or relative
// to a halachic anchor (e.g. "30 min before sunset"), mirroring the anchor
// model already used for synagogue prayer times (see SynagogueDetailPage's
// SlotModal). Formula-only display here — no zmanim engine in this app.
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
    // Can't compare unresolved anchor-relative times as strings — only
    // validate ordering when both boundaries are fixed clock times.
    if (!draft.startAnchor && !draft.endAnchor && draft.start >= draft.end) {
      alert('שעת הפתיחה חייבת להיות לפני שעת הסגירה'); return;
    }
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
          <span className="flex-1 text-sm font-semibold text-slate-700">{blockFormula(block)}</span>
          <button type="button" onClick={() => setDraft({ ...block })} className="p-1 text-slate-400 hover:text-blue-600">
            <Pencil size={14} />
          </button>
          <button type="button" onClick={() => deleteBlock(block.id)} className="p-1 text-slate-400 hover:text-red-500">
            <Trash2 size={14} />
          </button>
        </div>
      ))}

      {draft ? (
        <div className="bg-slate-50 rounded-lg border-[1.5px] border-blue-200 p-3 my-1.5 space-y-3">
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1.5">ימים</label>
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
          </div>

          <BoundaryField
            label="פתיחה"
            time={draft.start}
            anchor={draft.startAnchor}
            offsetMin={draft.startOffsetMin}
            proportional={draft.startProportional}
            onSetFixed={t => setDraft({ ...draft, start: t, startAnchor: undefined, startOffsetMin: undefined, startProportional: undefined })}
            onSetAnchor={a => setDraft({ ...draft, start: '', startAnchor: a, startOffsetMin: draft.startOffsetMin ?? 0 })}
            onSetOffset={o => setDraft({ ...draft, startOffsetMin: o })}
            onSetProportional={p => setDraft({ ...draft, startProportional: p })}
          />

          <BoundaryField
            label="סגירה"
            time={draft.end}
            anchor={draft.endAnchor}
            offsetMin={draft.endOffsetMin}
            proportional={draft.endProportional}
            onSetFixed={t => setDraft({ ...draft, end: t, endAnchor: undefined, endOffsetMin: undefined, endProportional: undefined })}
            onSetAnchor={a => setDraft({ ...draft, end: '', endAnchor: a, endOffsetMin: draft.endOffsetMin ?? 0 })}
            onSetOffset={o => setDraft({ ...draft, endOffsetMin: o })}
            onSetProportional={p => setDraft({ ...draft, endProportional: p })}
          />

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

// ─── One boundary (start or end): fixed clock time, or anchor + offset ───────
function BoundaryField({ label, time, anchor, offsetMin, proportional, onSetFixed, onSetAnchor, onSetOffset, onSetProportional }: {
  label: string;
  time: string;
  anchor?: ZmanimAnchor;
  offsetMin?: number;
  proportional?: boolean;
  onSetFixed: (time: string) => void;
  onSetAnchor: (anchor: ZmanimAnchor) => void;
  onSetOffset: (offsetMin: number) => void;
  onSetProportional: (proportional: boolean) => void;
}) {
  const isAnchor = !!anchor;
  const inp = 'w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 bg-white';

  return (
    <div>
      <label className="block text-xs font-semibold text-slate-500 mb-1">{label}</label>
      <div className="flex rounded-lg border border-[#1B3A6B] overflow-hidden mb-1.5">
        {(['fixed', 'anchor'] as const).map(m => (
          <button
            key={m}
            type="button"
            onClick={() => m === 'fixed' ? onSetFixed(time || '18:00') : onSetAnchor(anchor ?? 'shkia')}
            className={`flex-1 py-1.5 text-xs font-semibold transition-colors ${
              (m === 'anchor') === isAnchor ? 'bg-[#1B3A6B] text-white' : 'text-[#1B3A6B] hover:bg-blue-50'
            }`}
          >
            {m === 'fixed' ? 'זמן קבוע' : 'יחסי לזמן הלכתי'}
          </button>
        ))}
      </div>

      {!isAnchor ? (
        <input type="time" value={time} onChange={e => onSetFixed(e.target.value)} className={inp} />
      ) : (
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <select value={anchor} onChange={e => onSetAnchor(e.target.value as ZmanimAnchor)} className={inp}>
              {ANCHORS.map(a => <option key={a.key} value={a.key}>{a.label}</option>)}
            </select>
          </div>
          <div className="w-24">
            <input
              type="number" step={1} value={offsetMin ?? 0}
              onChange={e => onSetOffset(parseInt(e.target.value, 10) || 0)}
              className={inp}
            />
          </div>
          <div className="flex rounded-lg border border-slate-200 overflow-hidden h-[38px]">
            {([false, true] as const).map(p => (
              <button
                key={String(p)}
                type="button"
                onClick={() => onSetProportional(p)}
                className={`px-2.5 text-xs font-semibold ${
                  !!proportional === p ? 'bg-[#1B3A6B] text-white' : 'text-slate-500 hover:bg-slate-50'
                }`}
              >
                {p ? 'ז׳' : "'"}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
