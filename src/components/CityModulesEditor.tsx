import type { CityModules, ModuleKey, ModuleState } from '../types';

/**
 * Which parts of the app a city runs.
 *
 * The mobile app reads this straight off the city document — no build, no
 * release — so a second city can onboard with its gemach registry still empty
 * and its kashrut certificates unverified, without either decision leaking into
 * anyone else's city.
 *
 * Keys match the app's own module list in src/utils/modules.ts. Adding one
 * there means adding it here; there is no shared package between the two
 * projects, and a key that exists in only one place simply does nothing.
 */
const SECTIONS: { key: ModuleKey; label: string; hint: string }[] = [
  { key: 'Synagogues',  label: 'בתי כנסת',   hint: 'רשימת בתי הכנסת וזמני התפילות' },
  { key: 'PrayerTimes', label: 'מניינים',     hint: 'לוח המניינים בעיר' },
  { key: 'Zmanim',      label: 'זמנים',       hint: 'זמני היום' },
  { key: 'Businesses',  label: 'כשרות',       hint: 'עסקים ותעודות כשרות' },
  { key: 'Mikveh',      label: 'מקוואות',     hint: 'פרטי המקוואות ושעות' },
  { key: 'Events',      label: 'אירועים',     hint: 'אירועים, שיעורים והודעות' },
  { key: 'Eruv',        label: 'עירוב',       hint: 'מפת העירוב ועדכוני תקינות' },
  { key: 'Gemach',      label: 'גמ"ח',        hint: 'רשימת הגמ"חים בעיר' },
  { key: 'Selichot',    label: 'סליחות',      hint: 'זמני סליחות — מופיע בעונה בלבד' },
];

const FEATURES: { key: ModuleKey; label: string; hint: string }[] = [
  { key: 'mikvehBooking',  label: 'קביעת תורים למקווה', hint: 'בתוך מדור המקוואות' },
  { key: 'zmanimSettings', label: 'הגדרות זמנים',        hint: 'בחירת שיטת חישוב על ידי המשתמש' },
];

const STATES: { key: ModuleState; label: string; hint: string; on: string }[] = [
  { key: 'live', label: 'פעיל', hint: 'עובד כרגיל',                    on: 'bg-green-600 text-white border-green-600' },
  { key: 'soon', label: 'בקרוב', hint: 'נראה, עם מסך שמסביר',          on: 'bg-amber-500 text-white border-amber-500' },
  { key: 'off',  label: 'כבוי',  hint: 'לא קיים — מוסר מכל המסכים',    on: 'bg-slate-600 text-white border-slate-600' },
];

function Row({ label, hint, state, onChange }: {
  label: string; hint: string; state: ModuleState; onChange: (s: ModuleState) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5 border-b border-slate-100 last:border-0">
      <div className="min-w-0">
        <div className="text-sm font-medium text-slate-800">{label}</div>
        <div className="text-xs text-slate-400 truncate">{hint}</div>
      </div>
      <div className="flex shrink-0 rounded-lg overflow-hidden border border-slate-200">
        {STATES.map((s) => (
          <button
            key={s.key}
            type="button"
            title={s.hint}
            onClick={() => onChange(s.key)}
            className={`px-3 py-1.5 text-xs font-semibold border-l border-slate-200 last:border-l-0 transition-colors ${
              state === s.key ? s.on : 'bg-white text-slate-500 hover:bg-slate-50'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function CityModulesEditor({ value, onChange }: {
  value: CityModules;
  onChange: (next: CityModules) => void;
}) {
  const stateOf = (k: ModuleKey): ModuleState => value[k] ?? 'live';

  const set = (k: ModuleKey, s: ModuleState) => {
    const next = { ...value };
    // 'live' is the default, so it is stored as the absence of a key — the
    // document keeps only what differs from a plain city.
    if (s === 'live') delete next[k];
    else next[k] = s;
    onChange(next);
  };

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-base font-bold text-slate-800">מודולים</h2>
        <p className="text-xs text-slate-400 mt-0.5">
          מה מהאפליקציה פעיל בעיר הזאת. שינוי נכנס לתוקף מיד — בלי גרסה חדשה.
        </p>
      </div>

      <div className="text-xs font-semibold text-slate-400 mb-1">מדורים</div>
      {SECTIONS.map((m) => (
        <Row key={m.key} label={m.label} hint={m.hint}
          state={stateOf(m.key)} onChange={(s) => set(m.key, s)} />
      ))}

      <div className="text-xs font-semibold text-slate-400 mb-1 mt-5">אפשרויות בתוך מדור</div>
      {FEATURES.map((m) => (
        <Row key={m.key} label={m.label} hint={m.hint}
          state={stateOf(m.key)} onChange={(s) => set(m.key, s)} />
      ))}
    </div>
  );
}
