import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { deleteField, doc, getDoc, updateDoc } from 'firebase/firestore';
import { Check } from 'lucide-react';
import { db } from '../firebase';
import type { City } from '../types';
import ZmanimMethodEditor from '../components/ZmanimMethodEditor';
import { PRESET_RAV_OVADIA } from '../utils/zmanim';
import type { ZmanimSettings } from '../utils/zmanim';

// The zmanim the council publishes. Residents see this method until they pick
// their own, and every synagogue's anchored prayer times ("30 min before
// sunset") follow it unless its gabbai chose another. Fixed clock times the
// council sets are not zmanim and never pass through here.
export default function ZmanimPage() {
  const { cityId } = useParams<{ cityId: string }>();
  const [city, setCity] = useState<City | null>(null);
  const [value, setValue] = useState<ZmanimSettings>(PRESET_RAV_OVADIA);
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!cityId) return;
    setLoading(true);
    getDoc(doc(db, 'cities', cityId)).then(snap => {
      if (snap.exists()) {
        const c = { id: snap.id, ...snap.data() } as City;
        setCity(c);
        setValue(c.zmanimSettings ?? PRESET_RAV_OVADIA);
        setNote(c.zmanimNote ?? '');
      }
      setLoading(false);
    });
  }, [cityId]);

  const handleSave = async () => {
    if (!cityId) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, 'cities', cityId), {
        // Round-tripped through JSON: a rule switched off is `undefined` in the
        // editor, which Firestore refuses; this drops the key instead.
        zmanimSettings: JSON.parse(JSON.stringify(value)),
        zmanimNote: note.trim() ? note.trim() : deleteField(),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e: any) {
      alert(e?.message ?? 'שגיאה בשמירה');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="p-8 text-slate-400 text-sm">טוען...</div>;
  if (!city) return <div className="p-8 text-slate-400 text-sm">העיר לא נמצאה</div>;

  return (
    <div className="p-8 max-w-3xl" dir="rtl">
      <h1 className="text-2xl font-bold text-slate-800 mb-1">זמני העיר</h1>
      <p className="text-slate-500 text-sm mb-6 leading-relaxed">
        שיטת החישוב שמפרסמת העיר. תושבים רואים אותה כברירת מחדל, וזמני התפילה המעוגנים בבתי הכנסת
        ("חצי שעה לפני שקיעה") נמדדים לפיה — אלא אם הגבאי בחר שיטה אחרת לבית הכנסת שלו.
        שעות קבועות של המועצה הדתית אינן מושפעות.
      </p>

      <ZmanimMethodEditor
        value={value}
        onChange={setValue}
        point={{ latitude: city.latitude, longitude: city.longitude, timezone: city.timezone || 'Asia/Jerusalem' }}
      />

      <div className="mt-6">
        <label className="block text-sm font-bold text-slate-700 mb-1.5">הערה מתחת לזמנים (אופציונלי)</label>
        <textarea
          value={note}
          onChange={e => setNote(e.target.value)}
          rows={2}
          placeholder="למשל: מנהג העיר — צאת השבת 40 דקות אחרי שקיעה"
          className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B3A6B]/30"
        />
      </div>

      <div className="flex items-center gap-3 pt-4 mt-4 border-t border-slate-100">
        <button onClick={handleSave} disabled={saving}
          className="bg-[#1B3A6B] text-white px-6 py-2.5 rounded-xl font-semibold text-sm hover:bg-[#15306a] disabled:opacity-50 transition-colors">
          {saving ? 'שומר...' : 'שמור שינויים'}
        </button>
        {saved && (
          <span className="flex items-center gap-1.5 text-green-600 text-sm font-medium">
            <Check size={15} /> נשמר — תושבים יראו בפתיחה הבאה של האפליקציה
          </span>
        )}
      </div>
    </div>
  );
}
