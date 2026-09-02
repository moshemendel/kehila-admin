import { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import type { CityModules, ModuleState } from '../types';

/**
 * Which parts of the app a city runs.
 *
 * The mobile app reads this straight off the city document — no build, no
 * release — so a second city can onboard with its gemach registry still empty
 * and its kashrut certificates unverified, without either decision reaching
 * anyone else's city.
 *
 * THE LIST COMES FROM THE APP, not from here. A module is not a name, it is a
 * screen: adding one to a document does not create it, so only the app's own
 * source can say what exists. It publishes its catalogue to config/modules
 * (scripts/sync-catalogue.mjs), and this renders whatever it finds there. Keeping
 * a second copy here would mean a switch could be added that writes a key the
 * app ignores — saved successfully, and doing nothing, with nothing to say so.
 */
interface CatalogueEntry {
  key: string;
  kind: 'section' | 'feature';
  label: string;
  hint: string;
}

const STATES: { key: ModuleState; label: string; hint: string; on: string }[] = [
  { key: 'live', label: 'פעיל',  hint: 'עובד כרגיל',                 on: 'bg-green-600 text-white border-green-600' },
  { key: 'soon', label: 'בקרוב', hint: 'נראה, עם מסך שמסביר',        on: 'bg-amber-500 text-white border-amber-500' },
  { key: 'off',  label: 'כבוי',  hint: 'לא קיים — מוסר מכל המסכים',  on: 'bg-slate-600 text-white border-slate-600' },
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
  const [catalogue, setCatalogue] = useState<CatalogueEntry[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    getDoc(doc(db, 'config', 'modules'))
      .then((snap) => {
        const list = snap.exists() ? (snap.data().modules as CatalogueEntry[]) : null;
        if (list?.length) setCatalogue(list);
        else setFailed(true);
      })
      .catch(() => setFailed(true));
  }, []);

  const stateOf = (k: string): ModuleState => value[k as keyof CityModules] ?? 'live';

  const set = (k: string, s: ModuleState) => {
    const next = { ...value } as Record<string, ModuleState>;
    // 'live' is the default, so it is stored as the absence of a key — the
    // document keeps only what differs from a plain city.
    if (s === 'live') delete next[k];
    else next[k] = s;
    onChange(next as CityModules);
  };

  if (failed) {
    return (
      <div className="text-sm text-slate-500">
        <h2 className="text-base font-bold text-slate-800 mb-1">מודולים</h2>
        רשימת המודולים לא נמצאה. יש להריץ באפליקציה:
        <code className="mx-1 px-1.5 py-0.5 bg-slate-100 rounded text-xs">node scripts/sync-catalogue.mjs</code>
      </div>
    );
  }
  if (!catalogue) return <div className="text-sm text-slate-400">טוען מודולים...</div>;

  const sections = catalogue.filter((m) => m.kind === 'section');
  const features = catalogue.filter((m) => m.kind === 'feature');

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-base font-bold text-slate-800">מודולים</h2>
        <p className="text-xs text-slate-400 mt-0.5">
          מה מהאפליקציה פעיל בעיר הזאת. שינוי נכנס לתוקף מיד — בלי גרסה חדשה.
        </p>
      </div>

      <div className="text-xs font-semibold text-slate-400 mb-1">מדורים</div>
      {sections.map((m) => (
        <Row key={m.key} label={m.label} hint={m.hint}
          state={stateOf(m.key)} onChange={(s) => set(m.key, s)} />
      ))}

      {features.length > 0 && (
        <>
          <div className="text-xs font-semibold text-slate-400 mb-1 mt-5">אפשרויות בתוך מדור</div>
          {features.map((m) => (
            <Row key={m.key} label={m.label} hint={m.hint}
              state={stateOf(m.key)} onChange={(s) => set(m.key, s)} />
          ))}
        </>
      )}
    </div>
  );
}
