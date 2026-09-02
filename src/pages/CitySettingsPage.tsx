import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import type { City, CityModules } from '../types';
import CityModulesEditor from '../components/CityModulesEditor';
import { CityForm, calcMountainAngle, type FormState } from './CitiesMapPage';
import { Check } from 'lucide-react';

const EMPTY: FormState = { name: '', country: '', timezone: '', latitude: '', longitude: '', elevation: '' };

// City-settings surface for a city_admin to edit their own city's fields — the
// interactive map picker lives only in CitiesMapPage (super_admin only), so
// elevation/mountain-angle here are derived from the typed coordinates instead.
export default function CitySettingsPage() {
  const { cityId } = useParams<{ cityId: string }>();
  const [form, setForm]         = useState<FormState>(EMPTY);
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [saved, setSaved]       = useState(false);
  const [maLoading, setMaLoading] = useState(false);
  const [maAngle, setMaAngle]     = useState<number | null>(null);
  const [modules, setModules]     = useState<CityModules>({});

  useEffect(() => {
    if (!cityId) return;
    setLoading(true);
    getDoc(doc(db, 'cities', cityId)).then(snap => {
      if (snap.exists()) {
        const c = { id: snap.id, ...snap.data() } as City;
        setForm({
          name: c.name, country: c.country ?? '', timezone: c.timezone ?? '',
          latitude: String(c.latitude), longitude: String(c.longitude),
          elevation: c.elevation != null ? String(c.elevation) : '',
        });
        setModules(c.modules ?? {});
        if (c.latitude && c.longitude) {
          setMaLoading(true);
          calcMountainAngle(c.latitude, c.longitude, c.elevation ?? 0)
            .then(setMaAngle)
            .finally(() => setMaLoading(false));
        }
      }
      setLoading(false);
    });
  }, [cityId]);

  const handleSave = async () => {
    if (!cityId || !form.name.trim() || !form.latitude || !form.longitude) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, 'cities', cityId), {
        name: form.name.trim(),
        country: form.country.trim(),
        timezone: form.timezone.trim(),
        latitude: parseFloat(form.latitude),
        longitude: parseFloat(form.longitude),
        ...(form.elevation !== '' && { elevation: parseInt(form.elevation, 10) }),
        // Written whole rather than merged: the editor removes a key when a
        // module goes back to 'live', and a merge would leave the old value
        // behind.
        modules,
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

  return (
    <div className="p-8 max-w-2xl" dir="rtl">
      <h1 className="text-2xl font-bold text-slate-800 mb-1">הגדרות עיר</h1>
      <p className="text-slate-400 text-sm mb-6">עריכת פרטי העיר שלך</p>

      <div className="bg-white border border-slate-200 rounded-2xl p-6">
        <CityForm form={form} setForm={setForm} maLoading={maLoading} maAngle={maAngle} />

        <div className="pt-5 mt-5 border-t border-slate-100">
          <CityModulesEditor value={modules} onChange={setModules} />
        </div>

        <div className="flex items-center gap-3 pt-4 border-t border-slate-100 mt-4">
          <button
            onClick={handleSave}
            disabled={saving || !form.name.trim() || !form.latitude || !form.longitude}
            className="bg-[#1B3A6B] text-white px-6 py-2.5 rounded-xl font-semibold text-sm hover:bg-[#15306a] disabled:opacity-50 transition-colors"
          >
            {saving ? 'שומר...' : 'שמור שינויים'}
          </button>
          {saved && (
            <span className="flex items-center gap-1.5 text-green-600 text-sm font-medium">
              <Check size={15} /> נשמר בהצלחה
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
