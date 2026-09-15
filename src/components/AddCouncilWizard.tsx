// One flow for creating any tenant — a plain city/local council/municipality
// and a real regional council are the same shape here (one City doc + N Area
// docs), differing only in how many settlement rows end up confirmed. `kind`
// is derived from that count, never chosen by hand: 1 settlement → 'city',
// more → 'regional_council'.
import { useEffect, useState } from 'react';
import { writeBatch, doc, getDoc, serverTimestamp } from 'firebase/firestore';
import { MapPin, Search, Plus, X, Loader2, RotateCw } from 'lucide-react';
import { db } from '../firebase';
import { nanoid } from '../utils/nanoid';
import Modal from './Modal';
import { CityForm, type FormState, calcMountainAngle } from '../pages/CitiesMapPage';
import { MapPicker } from '../pages/SynagogueDetailPage';
import {
  searchCouncilSettlements,
  searchLocalityByName,
  geocodeSettlement,
  geocodeLocality,
  batchElevations,
  fetchAllLocalities,
  LOCALITIES_RESOURCE,
  type LocalityEntry,
} from '../utils/councilLookup';
import { haversineKm } from '../utils/geocode';

const EMPTY_FORM: FormState = { name: '', country: 'ישראל', timezone: 'Asia/Jerusalem', latitude: '', longitude: '', elevation: '' };

type WizardStep = 'basics' | 'settlements' | 'review';

interface SettlementRow {
  /** 'centre' for the pre-populated row, a cbsCode for a registry hit, or `manual-<id>`. */
  id: string;
  cbsCode?: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  elevation: number | null;
  status: 'pending' | 'resolved' | 'not-found';
  included: boolean;
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** Called after a successful create, so the caller can refresh its list. */
  onDone: () => void;
}

const inp = 'w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400';
const primaryBtn = 'flex-1 bg-[#1B3A6B] text-white py-2.5 rounded-xl font-semibold text-sm hover:bg-[#15306a] disabled:opacity-50 transition-colors';
const secondaryBtn = 'px-5 py-2.5 border border-slate-200 rounded-xl text-sm hover:bg-slate-50 transition-colors';

const STEP_LABEL: Record<WizardStep, string> = {
  basics: 'שלב 1 מתוך 3 — פרטי הרשות',
  settlements: 'שלב 2 מתוך 3 — יישובים',
  review: 'שלב 3 מתוך 3 — סקירה ואישור',
};

export default function AddCouncilWizard({ open, onClose, onDone }: Props) {
  const [step, setStep] = useState<WizardStep>('basics');
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [elevLoading, setElevLoading] = useState(false);
  const [maLoading, setMaLoading] = useState(false);
  const [maAngle, setMaAngle] = useState<number | null>(null);

  const [rows, setRows] = useState<SettlementRow[]>([]);
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState<string | null>(null);
  const [localities, setLocalities] = useState<LocalityEntry[]>([]);

  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchResultCount, setSearchResultCount] = useState<number | null>(null);
  const [geocoding, setGeocoding] = useState(false);
  const [geocodeProgress, setGeocodeProgress] = useState<{ done: number; total: number } | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);

  /** 'centre' or a row id — the nested map-pick modal target. Also guards the
   *  outer Modal's Escape/backdrop close while it's open (Modal.tsx registers
   *  its own document-level Escape listener per instance, so two open at once
   *  would both fire on one Escape press without this guard). */
  const [mapPickTarget, setMapPickTarget] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStep('basics');
    setForm(EMPTY_FORM);
    setMaAngle(null);
    setLocateError(null);
    setRows([]);
    setSearchQuery('');
    setSearchError(null);
    setSearchResultCount(null);
    setGeocodeProgress(null);
    setRetryingId(null);
    setMapPickTarget(null);
    fetchAllLocalities().then(setLocalities).catch(() => {});
  }, [open]);

  // Substring match against the cached national locality list, narrowing live
  // as the name is typed — resolves an abbreviated/ambiguous name (e.g.
  // "מעלות") against the ~10-ish real candidates before ever geocoding,
  // rather than silently taking whatever Nominatim ranks first nationwide.
  // Excludes an exact match so the list clears itself once one is picked.
  const normalizeForMatch = (s: string) => s.replace(/[-־]/g, ' ').replace(/\s+/g, ' ').trim();
  const nameQuery = form.name.trim();
  const nameMatches = nameQuery.length >= 2
    ? localities
        .filter(l => l.name !== nameQuery && normalizeForMatch(l.name).includes(normalizeForMatch(nameQuery)))
        .sort((a, b) => {
          const aStarts = normalizeForMatch(a.name).startsWith(normalizeForMatch(nameQuery));
          const bStarts = normalizeForMatch(b.name).startsWith(normalizeForMatch(nameQuery));
          if (aStarts !== bStarts) return aStarts ? -1 : 1;
          return a.name.localeCompare(b.name, 'he');
        })
        .slice(0, 8)
    : [];

  // ── Elevation + mountain-angle preview, shared by Step 1's map-pick and every row's ──

  const resolveElevation = async (lat: number, lng: number): Promise<number | null> => {
    const [elev] = await batchElevations([{ latitude: lat, longitude: lng }]);
    return elev;
  };

  const handleMapPick = async (target: string, lat: number, lng: number) => {
    setMapPickTarget(null);
    if (target === 'centre') {
      setForm(prev => ({ ...prev, latitude: lat.toFixed(6), longitude: lng.toFixed(6), elevation: '' }));
      setElevLoading(true);
      const elev = await resolveElevation(lat, lng);
      setElevLoading(false);
      if (elev != null) setForm(prev => ({ ...prev, elevation: String(elev) }));
      setMaLoading(true);
      try { setMaAngle(await calcMountainAngle(lat, lng, elev ?? 0)); } catch { /* fail silently */ }
      finally { setMaLoading(false); }
    } else {
      setRows(prev => prev.map(r => r.id !== target ? r : { ...r, latitude: lat, longitude: lng, status: 'resolved' }));
      const elev = await resolveElevation(lat, lng);
      if (elev != null) setRows(prev => prev.map(r => r.id !== target ? r : { ...r, elevation: elev }));
    }
  };

  /** A regional council has no single "location" of its own — skip trying to
   *  geocode it and go straight to finding its settlements; the centre gets
   *  computed as their centroid once they're resolved (see
   *  proceedToCouncilSettlements / handleGeocodeAll). Doesn't touch `rows`:
   *  it's already [] the first time this runs (fresh wizard open), and
   *  leaving it alone on a repeat visit — back to step 1, then this again —
   *  means it doesn't wipe settlements already found in step 2. */
  const proceedToCouncilSettlements = (name: string) => {
    setForm(prev => ({ ...prev, name }));
    setSearchQuery(name);
    setStep('settlements');
    runSettlementSearch(name);
  };

  const handleLocateCentre = async (nameOverride?: string) => {
    const name = (nameOverride ?? form.name).trim();
    if (!name) return;
    if (localities.find(l => l.name === name)?.isCouncil) {
      proceedToCouncilSettlements(name);
      return;
    }
    setLocating(true);
    setLocateError(null);
    try {
      const hit = await geocodeLocality(name);
      if (!hit) {
        setLocateError('לא נמצא מיקום לפי השם — אפשר לבחור במפה');
        return;
      }
      setForm(prev => ({ ...prev, latitude: hit.latitude.toFixed(6), longitude: hit.longitude.toFixed(6), elevation: '' }));
      setElevLoading(true);
      const elev = await resolveElevation(hit.latitude, hit.longitude);
      setElevLoading(false);
      if (elev != null) setForm(prev => ({ ...prev, elevation: String(elev) }));
      setMaLoading(true);
      try { setMaAngle(await calcMountainAngle(hit.latitude, hit.longitude, elev ?? 0)); } catch { /* fail silently */ }
      finally { setMaLoading(false); }
    } catch (e) {
      setLocateError(e instanceof Error ? e.message : 'שגיאה באיתור המיקום');
    } finally {
      setLocating(false);
    }
  };

  /** A dropdown pick is already disambiguated — set the official spelling and
   *  geocode it immediately (still a deliberate user action, same as clicking
   *  the locate button itself). */
  const selectLocality = (loc: LocalityEntry) => {
    setForm(prev => ({ ...prev, name: loc.name }));
    handleLocateCentre(loc.name);
  };

  const activePick = mapPickTarget === 'centre'
    ? { lat: form.latitude ? parseFloat(form.latitude) : null, lng: form.longitude ? parseFloat(form.longitude) : null }
    : (() => {
        const row = rows.find(r => r.id === mapPickTarget);
        return { lat: row?.latitude ?? null, lng: row?.longitude ?? null };
      })();

  // ── Step 1 → 2 ──────────────────────────────────────────────────────────────

  const goToSettlements = () => {
    // A council's coordinates here (if any) are a computed centroid, not a
    // real point of its own — e.g. reachable by going back to step 1 after
    // the centroid already finalized, then forward again via this button
    // rather than the locate-by-name path. Route it through the same
    // council flow instead of seeding a synthetic settlement for it.
    if (localities.find(l => l.name === form.name.trim())?.isCouncil) {
      proceedToCouncilSettlements(form.name.trim());
      return;
    }
    const centre: SettlementRow = {
      id: 'centre',
      name: form.name.trim(),
      latitude: parseFloat(form.latitude),
      longitude: parseFloat(form.longitude),
      elevation: form.elevation !== '' ? parseInt(form.elevation, 10) : null,
      status: 'resolved',
      included: true,
    };
    setRows(prev => {
      const i = prev.findIndex(r => r.id === 'centre');
      if (i === -1) return [centre, ...prev];
      const next = [...prev];
      next[i] = { ...centre, cbsCode: prev[i].cbsCode }; // keep a cbsCode already merged in from a prior search
      return next;
    });
    if (!searchQuery) setSearchQuery(form.name.trim());
    setStep('settlements');
  };

  // ── Step 2: search, manual add, geocode ─────────────────────────────────────

  const runSettlementSearch = async (query: string) => {
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    setSearchError(null);
    setSearchResultCount(null);
    try {
      let hits = await searchCouncilSettlements(q);
      if (hits.length === 0) {
        const single = await searchLocalityByName(q);
        hits = single ? [single] : [];
      }
      setSearchResultCount(hits.length);
      if (hits.length === 0) {
        setSearchError('לא נמצא במרשם הישובים — אפשר להוסיף ידנית');
        return;
      }
      setRows(prev => {
        const next = [...prev];
        for (const hit of hits) {
          const centreIdx = next.findIndex(r => r.id === 'centre');
          if (centreIdx !== -1 && next[centreIdx].name.trim() === hit.name.trim()) {
            next[centreIdx] = { ...next[centreIdx], cbsCode: hit.cbsCode };
            continue;
          }
          if (next.some(r => r.cbsCode === hit.cbsCode)) continue;
          next.push({
            id: hit.cbsCode, cbsCode: hit.cbsCode, name: hit.name,
            latitude: null, longitude: null, elevation: null, status: 'pending', included: true,
          });
        }
        return next;
      });
    } catch (e) {
      setSearchError(e instanceof Error ? e.message : 'שגיאה בחיפוש יישובים');
    } finally {
      setSearching(false);
    }
  };

  const handleSearch = () => runSettlementSearch(searchQuery);

  const addManualRow = () => setRows(prev => [...prev, {
    id: `manual-${nanoid(8)}`, name: '', latitude: null, longitude: null,
    elevation: null, status: 'pending', included: true,
  }]);

  const removeRow = (id: string) => setRows(prev => prev.filter(r => r.id !== id));

  /** null when there's no centre yet — a regional council skips step 1
   *  entirely (see proceedToCouncilSettlements), so this is normal until the
   *  centroid finalizes below, not a fallback for something gone wrong. */
  const currentCentre = (): { latitude: number; longitude: number } | null =>
    form.latitude && form.longitude
      ? { latitude: parseFloat(form.latitude), longitude: parseFloat(form.longitude) }
      : null;

  /** Once a regional council's settlements are geocoded, its centre is their
   *  centroid — simpler and more meaningful than geocoding the council name
   *  itself (which rarely resolves to anything but a same-named natural
   *  feature). Only fires when nothing has set a centre already, by any
   *  other means, so it never overrides a real one. */
  const finalizeCentroidIfNeeded = async (finalRows: SettlementRow[]) => {
    if (form.latitude || form.longitude) return;
    const points = finalRows.filter(r => r.included && r.latitude != null && r.longitude != null);
    if (!points.length) return;
    const avgLat = points.reduce((s, r) => s + r.latitude!, 0) / points.length;
    const avgLon = points.reduce((s, r) => s + r.longitude!, 0) / points.length;
    setForm(prev => ({ ...prev, latitude: avgLat.toFixed(6), longitude: avgLon.toFixed(6) }));
    setElevLoading(true);
    const elev = await resolveElevation(avgLat, avgLon);
    setElevLoading(false);
    if (elev != null) setForm(prev => ({ ...prev, elevation: String(elev) }));
    setMaLoading(true);
    try { setMaAngle(await calcMountainAngle(avgLat, avgLon, elev ?? 0)); } catch { /* fail silently */ }
    finally { setMaLoading(false); }
  };

  /** Re-tries just one failed row — Nominatim occasionally misses on a transient
   *  blip that a moment later succeeds; re-running the whole batch already
   *  retries every unresolved row, this is the same thing scoped to one. */
  const retryRow = async (id: string) => {
    const row = rows.find(r => r.id === id);
    if (!row || !row.name.trim()) return;
    setRetryingId(id);
    try {
      const hit = await geocodeSettlement(row.name, currentCentre()).catch(() => null);
      let working: SettlementRow[] = [];
      setRows(prev => {
        working = prev.map(r => r.id !== id ? r : hit
          ? { ...r, latitude: hit.latitude, longitude: hit.longitude, status: 'resolved' as const }
          : { ...r, status: 'not-found' as const });
        return working;
      });
      if (hit) {
        const elev = await resolveElevation(hit.latitude, hit.longitude);
        if (elev != null) setRows(prev => prev.map(r => r.id === id ? { ...r, elevation: elev } : r));
        await finalizeCentroidIfNeeded(working);
      }
    } finally {
      setRetryingId(null);
    }
  };

  const handleGeocodeAll = async () => {
    const centre = currentCentre();
    const targets = rows.filter(r => r.included && r.id !== 'centre' && r.status !== 'resolved' && r.name.trim());
    if (!targets.length) return;
    setGeocoding(true);
    setGeocodeProgress({ done: 0, total: targets.length });
    let working = rows;
    for (let i = 0; i < targets.length; i++) {
      const row = targets[i];
      const hit = await geocodeSettlement(row.name, centre).catch(() => null);
      working = working.map(r => r.id !== row.id ? r : hit
        ? { ...r, latitude: hit.latitude, longitude: hit.longitude, status: 'resolved' as const }
        : { ...r, status: 'not-found' as const });
      setRows(working);
      setGeocodeProgress({ done: i + 1, total: targets.length });
    }
    setGeocoding(false);
    setGeocodeProgress(null);

    const need = working.filter(r => r.included && r.latitude != null && r.longitude != null && r.elevation == null);
    if (need.length) {
      const elevs = await batchElevations(need.map(r => ({ latitude: r.latitude!, longitude: r.longitude! })));
      working = working.map(r => {
        const idx = need.findIndex(n => n.id === r.id);
        return idx === -1 ? r : { ...r, elevation: elevs[idx] };
      });
      setRows(working);
    }
    await finalizeCentroidIfNeeded(working);
  };

  const includedRows = rows.filter(r => r.included);
  const distanceOf = (r: SettlementRow) =>
    r.latitude == null || r.longitude == null || !form.latitude || !form.longitude
      ? null
      : haversineKm(parseFloat(form.latitude), parseFloat(form.longitude), r.latitude, r.longitude);

  // ── Step 3: confirm & write ──────────────────────────────────────────────────

  const handleConfirm = async () => {
    if (!form.latitude || !form.longitude) return; // council centroid never finalized (e.g. nothing geocoded)
    if (includedRows.some(r => r.latitude == null || r.longitude == null)) return;
    setSaving(true);
    try {
      const withCbs = includedRows.filter(r => r.cbsCode);
      const collisions = (await Promise.all(withCbs.map(async r => {
        const snap = await getDoc(doc(db, 'areas', `area-${r.cbsCode}`));
        return snap.exists() ? r.name : null;
      }))).filter((n): n is string => n !== null);
      if (collisions.length && !confirm(`היישובים הבאים כבר קיימים במערכת: ${collisions.join(', ')}. להמשיך ולדרוס?`)) {
        setSaving(false);
        return;
      }

      const cityId = nanoid(16);
      const kind: 'city' | 'regional_council' = includedRows.length === 1 ? 'city' : 'regional_council';
      const radiusKm = includedRows.length === 1 ? 3 : 2;

      const batch = writeBatch(db);
      batch.set(doc(db, 'cities', cityId), {
        name: form.name.trim(),
        country: form.country.trim() || 'ישראל',
        timezone: form.timezone.trim() || 'Asia/Jerusalem',
        latitude: parseFloat(form.latitude),
        longitude: parseFloat(form.longitude),
        ...(form.elevation !== '' && { elevation: parseInt(form.elevation, 10) }),
        kind,
      });

      for (const row of includedRows) {
        const areaId = row.cbsCode ? `area-${row.cbsCode}` : `area-manual-${nanoid(12)}`;
        batch.set(doc(db, 'areas', areaId), {
          cityId,
          name: row.name.trim(),
          ...(row.cbsCode && { cbsCode: row.cbsCode }),
          latitude: row.latitude,
          longitude: row.longitude,
          ...(row.elevation != null && { elevation: row.elevation }),
          radiusKm,
          isDefault: includedRows.length === 1,
          parentId: null,
          source: row.cbsCode ? `data.gov.il/${LOCALITIES_RESOURCE}` : 'manual',
          updatedAt: serverTimestamp(),
        });
      }

      await batch.commit();
      onDone();
      onClose();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'שגיאה בשמירה');
    } finally {
      setSaving(false);
    }
  };

  const summary = includedRows.length <= 1
    ? 'ייווצר: עיר עם יישוב ברירת מחדל אחד'
    : `ייווצר: מועצה אזורית עם ${includedRows.length} יישובים`;

  return (
    <>
      <Modal
        open={open}
        title="הוספת עיר / מועצה"
        onClose={() => { if (mapPickTarget === null) onClose(); }}
        size="xl"
      >
        <div className="text-xs font-semibold text-blue-600 mb-4">{STEP_LABEL[step]}</div>

        {step === 'basics' && (
          <>
            <CityForm
              form={form} setForm={setForm}
              onPickMap={() => setMapPickTarget('centre')}
              elevLoading={elevLoading} maLoading={maLoading} maAngle={maAngle}
              belowName={nameMatches.length > 0 && (
                <div className="absolute z-10 top-full mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg max-h-56 overflow-y-auto" dir="rtl">
                  {nameMatches.map(loc => (
                    <button
                      key={loc.cbsCode ?? loc.name}
                      type="button"
                      onClick={() => selectLocality(loc)}
                      className="w-full text-right px-3 py-2 text-sm hover:bg-blue-50 flex items-center justify-between gap-2 border-b border-slate-50 last:border-0"
                    >
                      <span className="font-medium text-slate-700">{loc.name}</span>
                      <span className="text-xs text-slate-400 whitespace-nowrap">{loc.isCouncil ? 'מועצה אזורית' : 'רשות עצמאית'}</span>
                    </button>
                  ))}
                </div>
              )}
              pickMapExtra={
                <div className="flex items-center gap-2" dir="rtl">
                  <button
                    type="button"
                    onClick={() => handleLocateCentre()}
                    disabled={locating || !form.name.trim()}
                    className="flex items-center gap-1.5 text-xs font-semibold text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 px-3 py-2 rounded-lg border border-blue-200 disabled:opacity-50 transition-colors"
                  >
                    {locating ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />}
                    אתר קואורדינטות לפי השם
                  </button>
                  {locateError && <span className="text-xs text-amber-600">{locateError}</span>}
                </div>
              }
            />
            <div className="flex gap-3 pt-4 border-t border-slate-100 mt-4">
              <button
                onClick={goToSettlements}
                disabled={!form.name.trim() || !form.latitude || !form.longitude}
                className={primaryBtn}
              >
                המשך ליישובים
              </button>
              <button onClick={onClose} className={secondaryBtn}>ביטול</button>
            </div>
          </>
        )}

        {step === 'settlements' && (
          <>
            <div dir="rtl">
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">חיפוש יישובים לפי שם המועצה או היישוב</label>
              <div className="flex gap-2 mb-1.5">
                <input
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleSearch(); } }}
                  placeholder="עמק הירדן"
                  className={inp}
                />
                <button
                  onClick={handleSearch}
                  disabled={searching || !searchQuery.trim()}
                  className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg border border-blue-200 disabled:opacity-50 transition-colors whitespace-nowrap"
                >
                  {searching ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
                  חפש
                </button>
              </div>
              {searchError && <p className="text-xs text-amber-600 mb-2">{searchError}</p>}
              {searchResultCount != null && searchResultCount > 0 && (
                <p className="text-xs text-slate-500 mb-2">נמצאו {searchResultCount} יישובים</p>
              )}

              <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 max-h-72 overflow-y-auto mt-3">
                {rows.map(row => (
                  <div key={row.id} className="flex items-center gap-2 px-3 py-2">
                    <input
                      type="checkbox"
                      checked={row.included}
                      onChange={e => setRows(prev => prev.map(r => r.id === row.id ? { ...r, included: e.target.checked } : r))}
                    />
                    {row.id === 'centre' ? (
                      <span className="flex-1 text-sm font-semibold text-slate-700">📍 {row.name} (נקודת המרכז)</span>
                    ) : (
                      <input
                        value={row.name}
                        onChange={e => setRows(prev => prev.map(r => r.id === row.id ? { ...r, name: e.target.value } : r))}
                        placeholder="שם היישוב"
                        className="flex-1 text-sm px-2 py-1 border border-transparent hover:border-slate-200 focus:border-blue-400 rounded outline-none"
                      />
                    )}
                    {row.cbsCode && <span className="text-xs text-slate-400 font-mono">{row.cbsCode}</span>}
                    <span className={
                      row.status === 'resolved' ? 'text-xs text-green-600 font-semibold'
                      : row.status === 'not-found' ? 'text-xs text-amber-600 font-semibold'
                      : 'text-xs text-slate-400'
                    }>
                      {row.status === 'resolved' ? 'אותר' : row.status === 'not-found' ? 'לא אותר' : 'ממתין'}
                    </span>
                    {row.status === 'not-found' && (
                      <button
                        onClick={() => retryRow(row.id)}
                        disabled={geocoding || retryingId !== null}
                        title="נסה שוב"
                        className="text-blue-600 hover:text-blue-800 p-1 disabled:opacity-50"
                      >
                        {retryingId === row.id ? <Loader2 size={14} className="animate-spin" /> : <RotateCw size={14} />}
                      </button>
                    )}
                    {row.status !== 'resolved' && (
                      <button
                        onClick={() => setMapPickTarget(row.id)}
                        title="בחר במפה"
                        className="text-blue-600 hover:text-blue-800 p-1"
                      >
                        <MapPin size={14} />
                      </button>
                    )}
                    {row.id !== 'centre' && (
                      <button onClick={() => removeRow(row.id)} title="הסר" className="text-slate-300 hover:text-red-500 p-1">
                        <X size={14} />
                      </button>
                    )}
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-between mt-3">
                <button
                  onClick={addManualRow}
                  className="flex items-center gap-1.5 text-xs font-semibold text-blue-600 hover:text-blue-800"
                >
                  <Plus size={13} />
                  הוסף יישוב ידנית
                </button>
                <button
                  onClick={handleGeocodeAll}
                  disabled={geocoding || retryingId !== null || !rows.some(r => r.included && r.id !== 'centre' && r.status !== 'resolved' && r.name.trim())}
                  className="flex items-center gap-1.5 text-xs font-semibold text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 px-3 py-2 rounded-lg border border-blue-200 disabled:opacity-50 transition-colors"
                >
                  {geocoding && <Loader2 size={13} className="animate-spin" />}
                  {geocoding && geocodeProgress
                    ? `מאתר קואורדינטות… ${geocodeProgress.done}/${geocodeProgress.total}`
                    : 'אתר קואורדינטות'}
                </button>
              </div>
            </div>

            <div className="flex gap-3 pt-4 border-t border-slate-100 mt-4">
              <button onClick={() => setStep('review')} disabled={includedRows.length === 0} className={primaryBtn}>
                המשך לסקירה
              </button>
              <button onClick={() => setStep('basics')} className={secondaryBtn}>חזרה</button>
            </div>
          </>
        )}

        {step === 'review' && (
          <>
            <div className="px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm font-semibold text-slate-700 mb-3" dir="rtl">
              {summary}
            </div>
            {includedRows.length > 1 && includedRows.some(r => r.id === 'centre') && (
              <p className="text-xs text-amber-600 mb-2" dir="rtl">
                📍 השורה המסומנת היא נקודת המרכז שהוזנה בשלב 1 — היא לא בהכרח יישוב בפני עצמו. ברוב המועצות האזוריות אין ליישוב בשם המועצה עצמו; אם זה המקרה כאן, הסר אותה מהרשימה.
              </p>
            )}
            <div className="border border-slate-200 rounded-lg overflow-x-auto" dir="rtl">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-slate-500">
                  <tr>
                    <th className="px-2 py-2 text-right font-semibold">שם</th>
                    <th className="px-2 py-2 text-right font-semibold">קוד</th>
                    <th className="px-2 py-2 text-right font-semibold">קו רוחב</th>
                    <th className="px-2 py-2 text-right font-semibold">קו אורך</th>
                    <th className="px-2 py-2 text-right font-semibold">גובה</th>
                    <th className="px-2 py-2 text-right font-semibold">מרחק</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {includedRows.map(row => {
                    const dist = distanceOf(row);
                    return (
                      <tr key={row.id}>
                        <td className="px-2 py-1.5">
                          <div className="flex items-center gap-1">
                            {row.id === 'centre' && (
                              <span title="נקודת המרכז שהוזנה בשלב 1 — לא בהכרח יישוב בפני עצמו" className="text-xs flex-shrink-0">📍</span>
                            )}
                            <input
                              value={row.name}
                              onChange={e => setRows(prev => prev.map(r => r.id === row.id ? { ...r, name: e.target.value } : r))}
                              className="w-24 px-1.5 py-1 text-xs border border-transparent hover:border-slate-200 focus:border-blue-400 rounded outline-none"
                            />
                          </div>
                        </td>
                        <td className="px-2 py-1.5 text-slate-400 font-mono">{row.cbsCode ?? '—'}</td>
                        <td className="px-2 py-1.5">
                          <input
                            type="number" step="any"
                            value={row.latitude ?? ''}
                            onChange={e => setRows(prev => prev.map(r => r.id === row.id ? { ...r, latitude: e.target.value === '' ? null : parseFloat(e.target.value) } : r))}
                            className="w-20 px-1.5 py-1 text-xs border border-transparent hover:border-slate-200 focus:border-blue-400 rounded outline-none"
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <input
                            type="number" step="any"
                            value={row.longitude ?? ''}
                            onChange={e => setRows(prev => prev.map(r => r.id === row.id ? { ...r, longitude: e.target.value === '' ? null : parseFloat(e.target.value) } : r))}
                            className="w-20 px-1.5 py-1 text-xs border border-transparent hover:border-slate-200 focus:border-blue-400 rounded outline-none"
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <input
                            type="number" step="1"
                            value={row.elevation ?? ''}
                            onChange={e => setRows(prev => prev.map(r => r.id === row.id ? { ...r, elevation: e.target.value === '' ? null : parseInt(e.target.value, 10) } : r))}
                            className="w-16 px-1.5 py-1 text-xs border border-transparent hover:border-slate-200 focus:border-blue-400 rounded outline-none"
                          />
                        </td>
                        <td className={`px-2 py-1.5 ${dist != null && dist > 40 ? 'text-amber-600 font-semibold' : 'text-slate-400'}`}>
                          {dist == null ? '—' : `${dist.toFixed(1)} ק"מ`}
                        </td>
                        <td className="px-1">
                          <button onClick={() => setMapPickTarget(row.id)} title="בחר במפה" className="text-blue-600 hover:text-blue-800 p-1">
                            <MapPin size={13} />
                          </button>
                          {row.id !== 'centre' && (
                            <button
                              onClick={() => setRows(prev => prev.map(r => r.id === row.id ? { ...r, included: false } : r))}
                              title="הסר" className="text-slate-300 hover:text-red-500 p-1"
                            >
                              <X size={13} />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex gap-3 pt-4 border-t border-slate-100 mt-4">
              <button
                onClick={handleConfirm}
                disabled={saving || !form.latitude || !form.longitude || includedRows.length === 0 || includedRows.some(r => r.latitude == null || r.longitude == null)}
                className={primaryBtn}
              >
                {saving ? 'שומר...' : 'אישור ויצירה'}
              </button>
              <button onClick={() => setStep('settlements')} className={secondaryBtn}>חזרה</button>
            </div>
          </>
        )}
      </Modal>

      <Modal
        open={mapPickTarget !== null}
        title="בחר מיקום על המפה"
        onClose={() => setMapPickTarget(null)}
        size="xl"
      >
        <div style={{ height: 480 }}>
          <MapPicker
            lat={activePick.lat} lng={activePick.lng}
            onPick={(lat, lng) => handleMapPick(mapPickTarget!, lat, lng)}
          />
        </div>
        <div className="flex justify-end pt-3">
          <button onClick={() => setMapPickTarget(null)} className={secondaryBtn}>סגור</button>
        </div>
      </Modal>
    </>
  );
}
