import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { doc, getDoc, updateDoc, deleteField } from 'firebase/firestore';
import { db } from '../firebase';
import type { City, CityModules } from '../types';
import CityModulesEditor from '../components/CityModulesEditor';
import { CityForm, calcMountainAngle, type FormState } from './CitiesMapPage';
import { Check } from 'lucide-react';
import AppHeaderPreview from '../components/AppHeaderPreview';
import {
  DEFAULT_HEADER_BOTTOM, HEADER_PRESETS, MIN_LOGO_SCALE, MAX_LOGO_SCALE, LOGO_SCALE_STEP, validateHeaderColor,
} from '../utils/headerColor';
import { uploadCityLogo, deleteCityLogoByUrl, validateLogoFile } from '../utils/uploadCityLogo';

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
  const [hidden, setHidden]       = useState(false);
  const [rcLogoUrl, setRcLogoUrl] = useState('');
  const [savedLogoUrl, setSavedLogoUrl] = useState('');
  const [logoBusy, setLogoBusy]   = useState(false);
  const [logoError, setLogoError] = useState('');
  const [showUrl, setShowUrl]     = useState(false);
  const [logoFrame, setLogoFrame] = useState<'disc' | 'none'>('disc');
  const [headerColor, setHeaderColor] = useState('');   // '' = default blue
  const [logoScale, setLogoScale] = useState(1);
  const colorError = headerColor.trim() ? validateHeaderColor(headerColor.trim()) : null;

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
        setHidden(!!c.hidden);
        setRcLogoUrl(c.religiousCouncilLogoUrl ?? '');
        setSavedLogoUrl(c.religiousCouncilLogoUrl ?? '');
        setLogoFrame(c.religiousCouncilLogoFrame === 'none' ? 'none' : 'disc');
        setHeaderColor(c.headerColor ?? '');
        setLogoScale(c.religiousCouncilLogoScale ?? 1);
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
    if (!cityId || !form.name.trim() || !form.latitude || !form.longitude || colorError) return;
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
        hidden,
        // An emptied field removes the logo rather than saving an empty string.
        religiousCouncilLogoUrl: rcLogoUrl.trim() || deleteField(),
        // Defaults are removed rather than stored, so untouched cities stay untouched.
        religiousCouncilLogoFrame: logoFrame === 'none' ? 'none' : deleteField(),
        religiousCouncilLogoScale: Math.abs(logoScale - 1) < 0.001 ? deleteField() : Math.round(logoScale * 100) / 100,
        headerColor: !headerColor.trim() || headerColor.trim().toUpperCase() === DEFAULT_HEADER_BOTTOM
          ? deleteField() : headerColor.trim().toUpperCase(),
      });
      // The replaced/removed logo is deleted only now that the document no
      // longer points at it. Best-effort; external URLs are left alone.
      const newUrl = rcLogoUrl.trim();
      if (savedLogoUrl && savedLogoUrl !== newUrl) void deleteCityLogoByUrl(savedLogoUrl);
      setSavedLogoUrl(newUrl);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e: any) {
      alert(e?.message ?? 'שגיאה בשמירה');
    } finally {
      setSaving(false);
    }
  };

  const onPickLogo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !cityId) return;
    const err = validateLogoFile(file);
    if (err) { setLogoError(err); return; }
    setLogoError('');
    setLogoBusy(true);
    try {
      const url = await uploadCityLogo(cityId, file);
      // A previous upload that was never saved is an orphan; drop it.
      if (rcLogoUrl && rcLogoUrl !== savedLogoUrl) void deleteCityLogoByUrl(rcLogoUrl);
      setRcLogoUrl(url);
    } catch (e: any) {
      console.error('[city logo upload]', e);
      setLogoError(`העלאת התמונה נכשלה (${e?.code ?? e?.message ?? 'שגיאה לא ידועה'}). בדוק שהקובץ תקין ונסה שוב.`);
    } finally {
      setLogoBusy(false);
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
          <h3 className="text-sm font-semibold text-slate-800 mb-1">סמל המועצה הדתית</h3>
          <p className="text-xs text-slate-500 mb-3">
            העלה תמונה (PNG שקוף וריבועי מומלץ, עד 5MB). היא נשמרת בשרתי המערכת ולא תלויה באתר חיצוני.
            מוצגת במסך הבית של האפליקציה ובכותרות הרשימות (בתי כנסת, מקוואות, כשרות...). בלי תמונה — לא מוצג סמל.
          </p>
          <div className="flex items-center gap-4">
            <div className="w-24 h-24 rounded-xl border border-slate-200 bg-slate-50 flex items-center justify-center overflow-hidden shrink-0">
              {rcLogoUrl
                ? <img src={rcLogoUrl} alt="סמל המועצה" className="max-w-full max-h-full object-contain" />
                : <span className="text-xs text-slate-400">אין סמל</span>}
            </div>
            <div className="flex flex-wrap gap-2">
              <label className={`px-4 py-2 rounded-xl text-sm font-semibold border border-slate-200 cursor-pointer hover:bg-slate-50 ${logoBusy ? 'opacity-50 pointer-events-none' : ''}`}>
                {logoBusy ? 'מעלה...' : rcLogoUrl ? 'החלף תמונה' : 'בחר תמונה'}
                <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={onPickLogo} disabled={logoBusy} />
              </label>
              {rcLogoUrl && (
                <button type="button" onClick={() => { setRcLogoUrl(''); setLogoError(''); }}
                  className="px-4 py-2 rounded-xl text-sm font-semibold border border-red-200 text-red-600 hover:bg-red-50">
                  הסר
                </button>
              )}
            </div>
          </div>
          {logoError && <p className="text-xs text-red-600 mt-2">{logoError}</p>}
          <p className="text-[11px] text-slate-400 mt-2">השינוי נשמר רק בלחיצה על "שמור שינויים".</p>
          {/* An existing external URL stays visible and editable; otherwise the URL box is an opt-in fallback. */}
          <button type="button" onClick={() => setShowUrl(v => !v)} className="text-xs text-slate-500 underline mt-3">
            {showUrl ? 'הסתר קישור חיצוני' : 'מתקדם: קישור חיצוני'}
          </button>
          {(showUrl || (rcLogoUrl && !rcLogoUrl.includes('firebasestorage'))) && (
            <>
              <p className="text-xs text-amber-600 mt-2">קישור חיצוני עלול להפסיק לעבוד אם התמונה תוסר מהאתר המארח. עדיף להעלות קובץ.</p>
              <input value={rcLogoUrl} onChange={e => setRcLogoUrl(e.target.value)} dir="ltr" placeholder="https://..."
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm mt-1" />
            </>
          )}
        </div>

        <div className="pt-5 mt-5 border-t border-slate-100">
          <h3 className="text-sm font-semibold text-slate-800 mb-1">כותרת מסך הבית</h3>
          <p className="text-xs text-slate-500 mb-4">
            מסגרת הסמל, צבע הכותרת וגודל הסמל — כל אחד בנפרד. התצוגה מתעדכנת מיד; השינוי נשמר בלחיצה על "שמור שינויים".
          </p>

          <div className="mb-5"><AppHeaderPreview cityName={form.name} logoUrl={rcLogoUrl.trim()} frame={logoFrame} color={headerColor.trim()} scale={logoScale} /></div>

          <div className="space-y-5">
            <div>
              <span className="block text-xs font-semibold text-slate-600 mb-1.5">מסגרת הסמל</span>
              <div className="inline-flex rounded-xl border border-slate-200 overflow-hidden">
                {([['disc', 'עיגול לבן'], ['none', 'בלי מסגרת']] as const).map(([v, label]) => (
                  <button key={v} type="button" onClick={() => setLogoFrame(v)}
                    className={`px-4 py-2 text-sm font-medium transition-colors ${logoFrame === v ? 'bg-[#1B3A6B] text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
                    {label}
                  </button>
                ))}
              </div>
              {logoFrame === 'disc' && /\.jpe?g(\?|$)|%2F[^?]*\.jpe?g/i.test(rcLogoUrl) && (
                <p className="text-xs text-amber-600 mt-1.5">הסמל הוא JPEG ולכן יש לו רקע משלו — מומלץ לבחור "בלי מסגרת".</p>
              )}
            </div>

            <div>
              <span className="block text-xs font-semibold text-slate-600 mb-1.5">צבע הכותרת</span>
              <div className="flex flex-wrap gap-2 mb-2">
                {HEADER_PRESETS.map(p => (
                  <button key={p.color} type="button" title={p.label} aria-label={p.label}
                    onClick={() => setHeaderColor(p.color === DEFAULT_HEADER_BOTTOM ? '' : p.color)}
                    className={`w-8 h-8 rounded-full border-2 ${(headerColor.trim() || DEFAULT_HEADER_BOTTOM).toUpperCase() === p.color ? 'border-slate-800' : 'border-white ring-1 ring-slate-200'}`}
                    style={{ background: p.color }} />
                ))}
              </div>
              <div className="flex items-center gap-2">
                <input type="color" aria-label="בחירת צבע"
                  value={/^#[0-9a-fA-F]{6}$/.test(headerColor.trim()) ? headerColor.trim() : DEFAULT_HEADER_BOTTOM}
                  onChange={e => setHeaderColor(e.target.value.toUpperCase() === DEFAULT_HEADER_BOTTOM ? '' : e.target.value.toUpperCase())}
                  className="h-9 w-12 rounded border border-slate-200 bg-white p-0.5" />
                <input value={headerColor} onChange={e => setHeaderColor(e.target.value)} dir="ltr" placeholder={DEFAULT_HEADER_BOTTOM}
                  className="w-32 border border-slate-200 rounded-xl px-3 py-2 text-sm" />
                {headerColor && (
                  <button type="button" onClick={() => setHeaderColor('')} className="text-xs text-slate-500 underline">איפוס לברירת מחדל</button>
                )}
              </div>
              {colorError && <p className="text-xs text-red-600 mt-1.5">{colorError}</p>}
            </div>

            <div>
              <span className="block text-xs font-semibold text-slate-600 mb-1.5">
                גודל הסמל: <span dir="ltr">{Math.round(logoScale * 100)}%</span>
              </span>
              <div className="flex items-center gap-3">
                <input type="range" min={MIN_LOGO_SCALE} max={MAX_LOGO_SCALE} step={LOGO_SCALE_STEP} value={logoScale}
                  onChange={e => setLogoScale(Math.round(parseFloat(e.target.value) * 100) / 100)}
                  className="w-64 accent-[#1B3A6B]" />
                {Math.abs(logoScale - 1) >= 0.001 && (
                  <button type="button" onClick={() => setLogoScale(1)} className="text-xs text-slate-500 underline">איפוס</button>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="pt-5 mt-5 border-t border-slate-100">
          <CityModulesEditor value={modules} onChange={setModules} />
        </div>

        <div className="pt-5 mt-5 border-t border-slate-100">
          <label htmlFor="city-hidden" className="flex items-start gap-3 cursor-pointer">
            <input
              id="city-hidden"
              type="checkbox"
              checked={hidden}
              onChange={e => setHidden(e.target.checked)}
              className="mt-1 h-4 w-4 accent-[#1B3A6B]"
            />
            <span>
              <span className="block text-sm font-semibold text-slate-800">העיר מוסתרת מהאפליקציה</span>
              <span className="block text-xs text-slate-500 mt-0.5">
                תושבים לא יראו אותה ברשימת הערים עד שתבטל את הסימון. מנהלי העיר ומנהלי המערכת רואים אותה כדי לבדוק אותה לפני הפתיחה.
              </span>
            </span>
          </label>
        </div>

        <div className="flex items-center gap-3 pt-4 border-t border-slate-100 mt-4">
          <button
            onClick={handleSave}
            disabled={saving || !form.name.trim() || !form.latitude || !form.longitude || !!colorError}
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
