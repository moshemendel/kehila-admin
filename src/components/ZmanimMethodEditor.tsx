import { useMemo } from 'react';
import {
  ZMANIM_PRESETS, calcZmanim, minToStr,
} from '../utils/zmanim';
import type {
  ZmanimSettings, ZmanimRule, RuleMethod, MisheyakirMethod, AlotMethod,
} from '../utils/zmanim';

/**
 * Edits one zmanim method — a city's or a synagogue's. Pick a ready-made one
 * (חזון שמים, אור החיים, …) and adjust any single definition. It edits a whole
 * ZmanimSettings and hands it back, so what is saved is exactly what the mobile
 * app's calcZmanim runs on; the preview underneath runs that same function
 * (src/utils/zmanim.ts is a copy of the app's) on today's date.
 */

const METHOD_LABEL: Record<RuleMethod, string> = {
  fixed: 'קבועות', proportional: 'זמניות', degrees: 'מעלות', longer: 'הארוך (זמניות/קבועות)',
};
const UNIT: Record<RuleMethod, string> = {
  fixed: "דק' קבועות", proportional: "דק' זמניות", degrees: '° מתחת לאופק', longer: "דק' (הארוך מבין השניים)",
};
const MISHEYAKIR_LABEL: Record<MisheyakirMethod, string> = {
  third: 'שליש מעלות→נץ', degrees: 'מעלות', fixed: "דק' לפני הנץ", afterAlotProportional: "דק' זמניות אחרי עלות",
};
const ALL_METHODS: RuleMethod[] = ['fixed', 'proportional', 'degrees', 'longer'];

const inp = 'w-24 border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm text-center focus:outline-none focus:ring-2 focus:ring-[#1B3A6B]/30';

function Chips<T extends string>({ options, labels, value, onPick }: {
  options: readonly T[]; labels: Record<T, string>; value: T; onPick: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map(o => (
        <button key={o} type="button" onClick={() => onPick(o)}
          className={`px-3 py-1 rounded-full text-xs font-semibold border transition-colors ${o === value
            ? 'bg-[#1B3A6B] border-[#1B3A6B] text-white'
            : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'}`}>
          {labels[o]}
        </button>
      ))}
    </div>
  );
}

function NumberField({ value, onCommit, suffix }: { value: number; onCommit: (n: number) => void; suffix: string }) {
  return (
    <div className="flex items-center gap-2">
      <input type="number" step="any" min="0" className={inp} value={value}
        onChange={e => { const n = parseFloat(e.target.value); if (Number.isFinite(n) && n >= 0) onCommit(n); }} />
      <span className="text-xs text-slate-500">{suffix}</span>
    </div>
  );
}

function Block({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="py-4 border-b border-slate-100 last:border-b-0 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-bold text-slate-800">{title}</span>
        {action}
      </div>
      {children}
    </div>
  );
}

function RuleRow({ title, rule, onChange, methods = ALL_METHODS }: {
  title: string; rule: ZmanimRule; onChange: (r: ZmanimRule) => void; methods?: readonly RuleMethod[];
}) {
  return (
    <Block title={title}>
      <Chips options={methods} labels={METHOD_LABEL} value={rule.method} onPick={method => onChange({ ...rule, method })} />
      <NumberField value={rule.value} suffix={UNIT[rule.method]} onCommit={value => onChange({ ...rule, value })} />
    </Block>
  );
}

const linkBtn = 'text-xs font-semibold text-[#1B3A6B] hover:underline';

export default function ZmanimMethodEditor({ value, onChange, point }: {
  value: ZmanimSettings;
  onChange: (s: ZmanimSettings) => void;
  /** Where the preview is computed; omitted = no preview. */
  point?: { latitude: number; longitude: number; timezone: string } | null;
}) {
  // A manual edit leaves the preset it started from, so the selected card does
  // not claim a method that has been changed.
  const edit = (patch: Partial<ZmanimSettings>) => onChange({ ...value, ...patch, presetKey: 'custom' });

  const activeKey = value.presetKey ?? ZMANIM_PRESETS.find(p => JSON.stringify(p.settings) === JSON.stringify(value))?.key;
  const preview = useMemo(
    () => (point ? calcZmanim(new Date(), point.latitude, point.longitude, value, point.timezone, 0, 0) : null),
    [point, value],
  );

  const mish = value.misheyakir ?? { method: 'third' as MisheyakirMethod, value: 0 };
  const defaultMgaAlot: ZmanimRule = { method: 'proportional', value: 72 };
  const defaultMgaTzet: ZmanimRule = { method: 'proportional', value: 13.5 };
  const mga = value.mgaDay;

  return (
    <div className="space-y-6">
      <section>
        <h3 className="text-sm font-bold text-slate-700 mb-2">שיטה מוכנה</h3>
        <div className="grid sm:grid-cols-2 gap-2">
          {ZMANIM_PRESETS.map(p => {
            const on = activeKey === p.key;
            return (
              <button key={p.key} type="button" onClick={() => onChange(p.settings)}
                className={`text-right rounded-xl border p-3 transition-colors ${on
                  ? 'border-[#1B3A6B] bg-[#1B3A6B]/5'
                  : 'border-slate-200 bg-white hover:border-slate-300'}`}>
                <div className="text-sm font-bold text-slate-800">{p.label}</div>
                <div className="text-xs text-slate-500 mt-0.5">{p.posek}</div>
                <div className="text-xs text-slate-400 mt-1 leading-relaxed">{p.description}</div>
              </button>
            );
          })}
        </div>
        {activeKey === 'custom' && <p className="text-xs text-[#1B3A6B] font-semibold mt-2">מותאם אישית — שונה מהשיטה המוכנה</p>}
      </section>

      <section>
        <h3 className="text-sm font-bold text-slate-700 mb-1">עריכת הפרטים</h3>
        <div className="bg-white border border-slate-200 rounded-2xl px-5">
          <RuleRow title="עלות השחר" rule={{ method: value.alotMethod, value: value.alotValue }}
            methods={['fixed', 'proportional', 'degrees']}
            onChange={r => edit({ alotMethod: r.method as AlotMethod, alotValue: r.value })} />

          <Block title="זמן טלית ותפילין">
            <Chips options={['third', 'degrees', 'fixed', 'afterAlotProportional'] as const} labels={MISHEYAKIR_LABEL}
              value={mish.method}
              onPick={method => edit({ misheyakir: { method, value: method === 'third' ? 0 : (mish.value || 11.5) } })} />
            {mish.method !== 'third' && (
              <NumberField value={mish.value}
                suffix={mish.method === 'degrees' ? '° מתחת לאופק' : mish.method === 'fixed' ? "דק' לפני הנץ" : "דק' זמניות אחרי עלות"}
                onCommit={v => edit({ misheyakir: { method: mish.method, value: v } })} />
            )}
          </Block>

          <RuleRow title="מנחה גדולה (אחרי חצות)" rule={value.minchaGedola ?? { method: 'proportional', value: 30 }}
            methods={['fixed', 'proportional', 'longer']} onChange={r => edit({ minchaGedola: r })} />

          <RuleRow title="צאת הכוכבים" rule={{ method: value.tzetMethod, value: value.tzetMinutes }}
            onChange={r => edit({ tzetMethod: r.method, tzetMinutes: r.value })} />

          <Block title="צאת השבת (מנהג העיר)"
            action={<button type="button" className={linkBtn}
              onClick={() => edit({ shabbatExit: value.shabbatExit ? undefined : { method: 'degrees', value: 8.5 } })}>
              {value.shabbatExit ? 'כמו צאת הכוכבים' : 'התאמה אישית'}
            </button>}>
            {value.shabbatExit ? (
              <>
                <Chips options={ALL_METHODS} labels={METHOD_LABEL} value={value.shabbatExit.method}
                  onPick={method => edit({ shabbatExit: { ...value.shabbatExit!, method } })} />
                <NumberField value={value.shabbatExit.value} suffix={UNIT[value.shabbatExit.method]}
                  onCommit={v => edit({ shabbatExit: { ...value.shabbatExit!, value: v } })} />
              </>
            ) : <p className="text-xs text-slate-400">כמו צאת הכוכבים</p>}
          </Block>

          <RuleRow title="רבנו תם" rule={value.rabbenuTam ?? { method: 'proportional', value: 72 }}
            onChange={r => edit({ rabbenuTam: r })} />

          <Block title={'יום המג"א (לחישוב סוף זמן ק"ש ותפילה)'}
            action={<button type="button" className={linkBtn}
              onClick={() => edit({ mgaDay: mga ? undefined : { alot: defaultMgaAlot, tzet: defaultMgaTzet } })}>
              {mga ? 'ברירת מחדל' : 'התאמה אישית'}
            </button>}>
            {mga ? (
              <div className="space-y-2">
                <p className="text-xs text-slate-500">תחילת היום (עלות)</p>
                <Chips options={ALL_METHODS} labels={METHOD_LABEL} value={mga.alot.method}
                  onPick={method => edit({ mgaDay: { ...mga, alot: { ...mga.alot, method } } })} />
                <NumberField value={mga.alot.value} suffix={UNIT[mga.alot.method]}
                  onCommit={v => edit({ mgaDay: { ...mga, alot: { ...mga.alot, value: v } } })} />
                <p className="text-xs text-slate-500 pt-1">סוף היום (צאת)</p>
                <Chips options={ALL_METHODS} labels={METHOD_LABEL} value={mga.tzet.method}
                  onPick={method => edit({ mgaDay: { ...mga, tzet: { ...mga.tzet, method } } })} />
                <NumberField value={mga.tzet.value} suffix={UNIT[mga.tzet.method]}
                  onCommit={v => edit({ mgaDay: { ...mga, tzet: { ...mga.tzet, value: v } } })} />
              </div>
            ) : <p className="text-xs text-slate-400">עלות 72 דק' זמניות עד צאת 13.5 דק' זמניות</p>}
          </Block>

          <Block title="הדלקת נרות">
            <NumberField value={value.candleLightingMin ?? 20} suffix="דק' לפני השקיעה (מנהג העיר)"
              onCommit={v => edit({ candleLightingMin: v })} />
            <NumberField value={value.candleLightingAltMin ?? 40} suffix="דק' לפני השקיעה (לנוהגים להקדים)"
              onCommit={v => edit({ candleLightingAltMin: v })} />
          </Block>
        </div>
      </section>

      {preview && (
        <section>
          <h3 className="text-sm font-bold text-slate-700 mb-2">תצוגה מקדימה להיום</h3>
          <div className="bg-white border border-slate-200 rounded-2xl divide-y divide-slate-100">
            {([
              ['עלות השחר', preview.alot], ['משיכיר', preview.misheyakir], ['הנץ החמה', preview.netz],
              ['סוף ק"ש (גר"א)', preview.sofZmanShma], ['סוף ק"ש (מג"א)', preview.sofZmanShmaMga],
              ['חצות', preview.chatzot], ['מנחה גדולה', preview.minchaGedola], ['שקיעה', preview.shkia],
              ['צאת הכוכבים', preview.tzetHakochavim], ['צאת השבת', preview.tzetShabbat],
              ['רבנו תם', preview.tzetRabbenuTam], ['הדלקת נרות', preview.candleLighting],
            ] as [string, number][]).map(([label, min]) => (
              <div key={label} className="flex justify-between px-5 py-2 text-sm">
                <span className="text-slate-600">{label}</span>
                <span className="font-bold text-slate-800 tabular-nums" dir="ltr">{minToStr(min)}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
