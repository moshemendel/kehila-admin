import { useMemo, useState } from 'react';
import { ChevronDown, Info } from 'lucide-react';
import Modal from './Modal';
import {
  ZMANIM_PRESETS, ZMANIM_CATALOG, PRESET_ABOUT, relevantKeys, calcZmanim, describeSettings, minToStr,
} from '../utils/zmanim';
import type {
  ZmanimSettings, ZmanimRule, RuleMethod, MisheyakirMethod, AlotMethod,
} from '../utils/zmanim';

/**
 * Edits one zmanim method — a city's or a synagogue's. Pick a ready-made one
 * (חזון שמים, אור החיים, …), read what it means, and — only if wanted — adjust
 * a single definition. It edits a whole ZmanimSettings and hands it back, so
 * what is saved is exactly what the mobile app's calcZmanim runs on; the
 * preview (kept in view beside the options) runs that same function
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
const MGA_END_KEYS = ['13.5', '18', '72', 'custom'] as const;
const MGA_END_LABEL: Record<(typeof MGA_END_KEYS)[number], string> = {
  '13.5': "הגאונים — 13.5 דק' זמניות", '18': "הגאונים — 18 דק' זמניות", '72': "רבנו תם — 72 דק' זמניות", custom: 'מותאם',
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

export default function ZmanimMethodEditor({ value, onChange, point, shown, onShownChange }: {
  value: ZmanimSettings;
  onChange: (s: ZmanimSettings) => void;
  /** Which zmanim residents see (a city's choice). Omitted = the preview just lists them, with no ticks. */
  shown?: Set<string>;
  onShownChange?: (s: Set<string>) => void;
  /** Where the preview is computed; omitted = no preview. */
  point?: { latitude: number; longitude: number; timezone: string } | null;
}) {
  // A manual edit leaves the preset it started from, so the selected card does
  // not claim a method that has been changed.
  const edit = (patch: Partial<ZmanimSettings>) =>
    onChange({ ...value, ...patch, presetKey: 'custom', basedOn: value.presetKey === 'custom' ? value.basedOn : value.presetKey });
  // Choosing a ready-made method also unticks the times it does not have (a GRA
  // calendar has no MGA shma), so what residents see matches what that method publishes.
  const pick = (settings: ZmanimSettings) => {
    onChange(settings);
    onShownChange?.(relevantKeys(settings));
  };

  const activeKey = value.presetKey ?? ZMANIM_PRESETS.find(p => JSON.stringify(p.settings) === JSON.stringify(value))?.key;
  const preview = useMemo(
    () => (point ? calcZmanim(new Date(), point.latitude, point.longitude, value, point.timezone, 0, 0) : null),
    [point, value],
  );

  // The fine-tuning stays folded away until someone wants it — most managers
  // only ever pick a method — but it opens by itself on a method already edited.
  const [customOpen, setCustomOpen] = useState(activeKey === 'custom');
  const [infoKey, setInfoKey] = useState<string | null>(null);
  const infoPreset = ZMANIM_PRESETS.find(p => p.key === infoKey);
  const infoAbout = infoKey ? PRESET_ABOUT[infoKey] : undefined;

  const mish = value.misheyakir ?? { method: 'third' as MisheyakirMethod, value: 0 };
  const defaultMgaAlot: ZmanimRule = { method: 'proportional', value: 72 };
  const defaultMgaTzet: ZmanimRule = { method: 'proportional', value: 13.5 };
  const mga = value.mgaDay;
  // The MGA's day ends at tzeit — by the Geonim (13.5 or 18 zmaniyot minutes after
  // sunset) or by Rabbeinu Tam (72); anything else is the hand-built case.
  const mgaTzet = mga?.tzet ?? defaultMgaTzet;
  const mgaChoice = mgaTzet.method === 'proportional' && [13.5, 18, 72].includes(mgaTzet.value) ? String(mgaTzet.value) as (typeof MGA_END_KEYS)[number] : 'custom';

  return (
    <div className="grid lg:grid-cols-[minmax(0,1fr)_300px] gap-6 items-start">
      {/* Options — the part that scrolls with the page */}
      <div className="space-y-6 min-w-0">
        <section>
          <h3 className="text-sm font-bold text-slate-700 mb-2">שיטה מוכנה</h3>
          <div className="grid sm:grid-cols-2 gap-2">
            {ZMANIM_PRESETS.map(p => {
              const on = activeKey === p.key;
              return (
                <div key={p.key}
                  className={`rounded-xl border transition-colors flex flex-col ${on
                    ? 'border-[#1B3A6B] bg-[#1B3A6B]/5'
                    : 'border-slate-200 bg-white hover:border-slate-300'}`}>
                  <button type="button" onClick={() => pick(p.settings)} className="text-right p-3 flex-1">
                    <div className="text-sm font-bold text-slate-800">{p.label}</div>
                    <div className="text-xs text-slate-500 mt-0.5">{p.posek}</div>
                    <div className="text-xs text-slate-400 mt-1 leading-relaxed">{p.description}</div>
                  </button>
                  <button type="button" onClick={() => setInfoKey(p.key)}
                    className="flex items-center gap-1 text-xs font-semibold text-[#1B3A6B] hover:underline px-3 pb-2.5 self-start">
                    <Info size={13} /> הסבר מפורט
                  </button>
                </div>
              );
            })}
          </div>
          {activeKey === 'custom' && <p className="text-xs text-[#1B3A6B] font-semibold mt-2">מותאם אישית — שונה מהשיטה המוכנה</p>}
        </section>

        <section>
          <button type="button" onClick={() => setCustomOpen(o => !o)}
            className="w-full flex items-center justify-between bg-white border border-slate-200 rounded-xl px-4 py-3 text-right hover:border-slate-300 transition-colors">
            <span>
              <span className="block text-sm font-bold text-slate-800">התאמה אישית</span>
              <span className="block text-xs text-slate-500">לשנות הגדרה אחת בשיטה שנבחרה — צאת השבת, הדלקת נרות ועוד</span>
            </span>
            <ChevronDown size={18} className={`text-slate-400 transition-transform ${customOpen ? 'rotate-180' : ''}`} />
          </button>

          {customOpen && (
            <div className="mt-2 bg-white border border-slate-200 rounded-2xl px-5">
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

              <Block title={'יום המג"א (לחישוב סוף זמן ק"ש, תפילה ופלג)'}>
                <p className="text-xs text-slate-500">סוף היום — צאת הכוכבים:</p>
                <Chips options={MGA_END_KEYS} labels={MGA_END_LABEL} value={mgaChoice}
                  onPick={k => k === 'custom'
                    ? edit({ mgaDay: mga ?? { alot: defaultMgaAlot, tzet: mgaTzet } })
                    : edit({ mgaDay: { alot: mga?.alot ?? defaultMgaAlot, tzet: { method: 'proportional', value: Number(k) } } })} />
                {mga && mgaChoice === 'custom' && (
                  <div className="space-y-2 pt-1">
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
                )}
              </Block>

              <Block title="הדלקת נרות">
                <NumberField value={value.candleLightingMin ?? 20} suffix="דק' לפני השקיעה (מנהג העיר)"
                  onCommit={v => edit({ candleLightingMin: v })} />
                <NumberField value={value.candleLightingAltMin ?? 40} suffix="דק' לפני השקיעה (לנוהגים להקדים)"
                  onCommit={v => edit({ candleLightingAltMin: v })} />
              </Block>
            </div>
          )}
        </section>
      </div>

      {/* Preview — every time, with a tick for each one residents should see.
          Stays in view while the options scroll. */}
      {preview && (
        <aside className="lg:sticky lg:top-6">
          <h3 className="text-sm font-bold text-slate-700 mb-0.5">תצוגה מקדימה להיום</h3>
          {shown && <p className="text-xs text-slate-500 mb-2">סמנו את הזמנים שיוצגו לתושבים</p>}
          <div className="bg-white border border-slate-200 rounded-2xl divide-y divide-slate-100">
            {ZMANIM_CATALOG.map(z => {
              const on = !shown || shown.has(z.key);
              return (
                <label key={z.key}
                  className={`flex items-center gap-2.5 px-4 py-2 text-sm ${shown ? 'cursor-pointer' : ''}`}>
                  {shown && (
                    <input type="checkbox" className="h-4 w-4 accent-[#1B3A6B] shrink-0" checked={on}
                      onChange={e => {
                        const n = new Set(shown);
                        if (e.target.checked) n.add(z.key); else n.delete(z.key);
                        onShownChange?.(n);
                      }} />
                  )}
                  <span className={`flex-1 ${on ? 'text-slate-700' : 'text-slate-400'}`}>{z.label}</span>
                  <span className={`font-bold tabular-nums ${on ? 'text-slate-800' : 'text-slate-300'}`} dir="ltr">
                    {minToStr(preview[z.key] as number, false, z.key === 'candleLighting' ? 'down' : 'up')}
                  </span>
                </label>
              );
            })}
          </div>
        </aside>
      )}

      <Modal open={!!infoPreset} onClose={() => setInfoKey(null)}
        title={infoPreset ? `${infoPreset.label} — ${infoPreset.posek}` : ''} size="lg">
        {infoPreset && (
          <div className="space-y-5">
            {infoAbout && <p className="text-sm text-slate-700 leading-relaxed">{infoAbout.about}</p>}
            <div>
              <h4 className="text-sm font-bold text-slate-800 mb-2">איך מחושב כל זמן</h4>
              <dl className="border border-slate-200 rounded-xl divide-y divide-slate-100">
                {describeSettings(infoPreset.settings).map(r => (
                  <div key={r.label} className="flex gap-4 px-4 py-2 text-sm">
                    <dt className="w-36 shrink-0 text-slate-500">{r.label}</dt>
                    <dd className="text-slate-800">{r.text}</dd>
                  </div>
                ))}
              </dl>
            </div>
            {infoAbout?.source && (
              <p className="text-xs text-slate-500">
                מקור:{' '}
                {infoAbout.source.url
                  ? <a href={infoAbout.source.url} target="_blank" rel="noreferrer" className="text-[#1B3A6B] underline">{infoAbout.source.label}</a>
                  : infoAbout.source.label}
              </p>
            )}
            <button type="button" onClick={() => { pick(infoPreset.settings); setInfoKey(null); }}
              className="bg-[#1B3A6B] text-white px-5 py-2 rounded-xl font-semibold text-sm hover:bg-[#15306a] transition-colors">
              בחירת שיטה זו
            </button>
          </div>
        )}
      </Modal>
    </div>
  );
}
