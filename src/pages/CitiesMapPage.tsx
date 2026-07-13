import 'leaflet/dist/leaflet.css';
import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, getDocs, query, where, doc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { getCountFromServer } from 'firebase/firestore';
import { MapContainer, TileLayer, Marker, Tooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { useCityContext } from '../contexts/CityContext';
import type { City } from '../types';
import Modal from '../components/Modal';
import { nanoid } from '../utils/nanoid';
import { Search, ArrowLeft, X, Plus, Pencil, Trash2, ExternalLink, MapPin } from 'lucide-react';

// ─── Sunrise azimuth & mountain angle (matches astral_times.py) ──────────────

function getDeclRad(date = new Date()): number {
  const doy = Math.round((date.getTime() - new Date(date.getFullYear(), 0, 0).getTime()) / 86_400_000);
  const g   = (2 * Math.PI / 365) * (doy - 1);
  return 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g)
       - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g); // radians
}

function sunriseAzimuth(latDeg: number, declRad: number): number {
  const D = Math.PI / 180;
  const lat = latDeg * D;
  const cosAz = (Math.sin(declRad) + Math.sin(-0.833 * D) * Math.sin(lat))
              / (Math.cos(0.833  * D) * Math.cos(lat));
  return Math.acos(Math.max(-1, Math.min(1, cosAz))) / D;
}

function destPoint(lat: number, lon: number, azDeg: number, km: number): [number, number] {
  const D = Math.PI / 180, R = 6371;
  const la = lat * D, lo = lon * D, b = azDeg * D, d = km / R;
  const la2 = Math.asin(Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(b));
  const lo2 = lo + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(la), Math.cos(d) - Math.sin(la) * Math.sin(la2));
  return [la2 / D, lo2 / D];
}

export async function calcMountainAngle(lat: number, lon: number, myElev: number): Promise<number> {
  const az  = sunriseAzimuth(lat, getDeclRad());
  const pts = Array.from({ length: 80 }, (_, i) => destPoint(lat, lon, az, i + 1));
  const res = await fetch(
    `https://api.open-meteo.com/v1/elevation?latitude=${pts.map(p => p[0].toFixed(6)).join(',')}&longitude=${pts.map(p => p[1].toFixed(6)).join(',')}`
  );
  if (!res.ok) return 0;
  const elevs: (number | null)[] = ((await res.json()) as { elevation: (number | null)[] }).elevation ?? [];
  let maxAngle = 0;
  elevs.forEach((elev, i) => {
    if (elev != null) maxAngle = Math.max(maxAngle, Math.atan2(elev - myElev, (i + 1) * 1000) * (180 / Math.PI));
  });
  return Math.round(maxAngle * 1000) / 1000;
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface CityWithStats extends City {
  stats?: { synagogues: number; mikvaot: number; restaurants: number; users: number };
  statsLoading: boolean;
}

export type FormState = { name: string; country: string; timezone: string; latitude: string; longitude: string; elevation: string };
const EMPTY: FormState = { name: '', country: 'ישראל', timezone: 'Asia/Jerusalem', latitude: '', longitude: '', elevation: '' };

// ─── Marker icons ─────────────────────────────────────────────────────────────

const makeIcon = (color: string, size: number) =>
  L.divIcon({
    className: '',
    html: `
      <div style="position:relative;width:${size}px;height:${size * 1.3}px">
        <div style="
          width:${size}px;height:${size}px;background:${color};
          border-radius:50% 50% 50% 0;transform:rotate(-45deg);
          border:2.5px solid white;box-shadow:0 3px 12px rgba(0,0,0,0.35);
          position:absolute;top:0;left:0;
        "></div>
        <div style="
          position:absolute;top:${size * 0.18}px;left:${size * 0.18}px;
          width:${size * 0.64}px;height:${size * 0.64}px;
          background:white;border-radius:50%;opacity:0.9;
        "></div>
      </div>`,
    iconSize:    [size, size * 1.3],
    iconAnchor:  [size / 2, size * 1.3],
    popupAnchor: [0, -(size * 1.3 + 4)],
  });

const ICON_DEFAULT  = makeIcon('#1B3A6B', 32);
const ICON_HOVER    = makeIcon('#2563EB', 38);
const ICON_SELECTED = makeIcon('#DC2626', 40);

// ─── Map helpers ──────────────────────────────────────────────────────────────

function MapController({
  target,
  onReady,
  onMapClick,
}: {
  target: [number, number] | null;
  onReady: (m: L.Map) => void;
  onMapClick: (lat: number, lng: number) => void;
}) {
  const map = useMap();
  useEffect(() => { onReady(map); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (target) map.flyTo(target, 14, { duration: 0.9 });
  }, [target, map]);
  useEffect(() => {
    const handler = (e: L.LeafletMouseEvent) => onMapClick(e.latlng.lat, e.latlng.lng);
    map.on('click', handler);
    return () => { map.off('click', handler); };
  }, [map, onMapClick]);
  return null;
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function CitiesMapPage() {
  const navigate = useNavigate();
  const { appUser } = useAuth();
  const { setSelectedCity } = useCityContext();
  const isSuperAdmin = appUser?.role === 'super_admin' || appUser?.role === 'dev';

  const [cities, setCities]           = useState<CityWithStats[]>([]);
  const [loading, setLoading]         = useState(true);
  const [search, setSearch]           = useState('');
  const [flyTarget, setFlyTarget]     = useState<[number, number] | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [actionCity, setActionCity]   = useState<CityWithStats | null>(null);

  const [addOpen, setAddOpen]         = useState(false);
  const [editOpen, setEditOpen]       = useState(false);
  const [deleteOpen, setDeleteOpen]   = useState(false);
  const [form, setForm]               = useState<FormState>(EMPTY);
  const [saving, setSaving]           = useState(false);
  const [coordPickMode, setCoordPickMode] = useState(false);
  const [pendingModal, setPendingModal]   = useState<'add' | 'edit' | null>(null);
  const [elevLoading, setElevLoading]     = useState(false);
  const [maLoading, setMaLoading]         = useState(false);
  const [previewMa, setPreviewMa]         = useState<number | null>(null);

  const mapRef    = useRef<L.Map | null>(null);
  const searchRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (mapRef.current) {
      mapRef.current.getContainer().style.cursor = coordPickMode ? 'crosshair' : '';
    }
  }, [coordPickMode]);

  // ── Load cities ──────────────────────────────────────────────────────────────

  const load = async () => {
    const snap = await getDocs(collection(db, 'cities'));
    const list: CityWithStats[] = snap.docs
      .map(d => ({ id: d.id, ...d.data(), statsLoading: true } as CityWithStats))
      .filter(c => c.latitude && c.longitude);
    setCities(list);
    setLoading(false);

    list.forEach(city => {
      const cnt = (col: string) =>
        getCountFromServer(query(collection(db, col), where('cityId', '==', city.id)))
          .then(s => s.data().count).catch(() => 0);
      Promise.all([cnt('synagogues'), cnt('mikvaot'), cnt('businesses'), cnt('users')]).then(
        ([synagogues, mikvaot, restaurants, users]) => {
          setCities(prev =>
            prev.map(c => c.id === city.id ? { ...c, stats: { synagogues, mikvaot, restaurants, users }, statsLoading: false } : c)
          );
        }
      );
    });
  };

  useEffect(() => { load(); }, []);

  // Close dropdown on outside click
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) setDropdownOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const computeAndSetMa = useCallback(async (lat: number, lng: number, elev: number) => {
    setMaLoading(true);
    try {
      const ma = await calcMountainAngle(lat, lng, elev);
      setPreviewMa(ma);
    } catch { /* fail silently */ }
    finally { setMaLoading(false); }
  }, []);

  const fetchAndSetElevation = useCallback(async (lat: number, lng: number) => {
    setElevLoading(true);
    let myElev = 0;
    try {
      const res  = await fetch(`https://api.open-meteo.com/v1/elevation?latitude=${lat}&longitude=${lng}`);
      if (res.ok) {
        const json = await res.json();
        const elev = json?.elevation?.[0];
        if (typeof elev === 'number') {
          myElev = Math.round(elev);
          setForm(prev => ({ ...prev, elevation: String(myElev) }));
        }
      }
    } catch { /* fail silently */ }
    finally { setElevLoading(false); }
    computeAndSetMa(lat, lng, myElev);
  }, [computeAndSetMa]);

  const closeAction = useCallback(() => setActionCity(null), []);

  const enterPickMode = (fromModal: 'add' | 'edit') => {
    if (fromModal === 'add') setAddOpen(false);
    if (fromModal === 'edit') setEditOpen(false);
    setPendingModal(fromModal);
    setCoordPickMode(true);
  };

  const cancelPickMode = useCallback(() => {
    setCoordPickMode(false);
    if (pendingModal === 'add') setAddOpen(true);
    else if (pendingModal === 'edit') setEditOpen(true);
    setPendingModal(null);
  }, [pendingModal]);

  const handleMapClick = useCallback((lat: number, lng: number) => {
    if (coordPickMode) {
      setForm(prev => ({ ...prev, latitude: lat.toFixed(6), longitude: lng.toFixed(6), elevation: '' }));
      setCoordPickMode(false);
      if (pendingModal === 'add') setAddOpen(true);
      if (pendingModal === 'edit') setEditOpen(true);
      setPendingModal(null);
      fetchAndSetElevation(lat, lng);
    } else {
      closeAction();
    }
  }, [coordPickMode, pendingModal, closeAction, fetchAndSetElevation]);

  // ── City selection (from marker or dropdown) ──────────────────────────────

  const flyTo = (city: CityWithStats) => {
    setFlyTarget([city.latitude, city.longitude]);
    setSearch(city.name);
    setDropdownOpen(false);
  };

  const handleMarkerClick = (city: CityWithStats) => {
    flyTo(city);
    setSelectedCity(city.id, city.name);
    setActionCity(city);
  };

  const handleDropdownClick = (city: CityWithStats) => {
    flyTo(city);
    setSelectedCity(city.id, city.name);
    setActionCity(city);
  };

  // ── CRUD ─────────────────────────────────────────────────────────────────────

  const openAdd = () => { setForm(EMPTY); setPreviewMa(null); setAddOpen(true); };

  const openEdit = (city: CityWithStats) => {
    setForm({
      name: city.name, country: city.country ?? 'ישראל',
      timezone: city.timezone ?? 'Asia/Jerusalem',
      latitude: String(city.latitude), longitude: String(city.longitude),
      elevation: city.elevation != null ? String(city.elevation) : '',
    });
    setPreviewMa(null);
    setEditOpen(true);
    // Auto-compute today's mountain angle preview
    computeAndSetMa(city.latitude, city.longitude, city.elevation ?? 0);
  };

  const handleAdd = async () => {
    if (!form.name.trim() || !form.latitude || !form.longitude) return;
    setSaving(true);
    const id = nanoid(16);
    await setDoc(doc(db, 'cities', id), {
      name: form.name.trim(),
      country: form.country.trim() || 'ישראל',
      timezone: form.timezone.trim() || 'Asia/Jerusalem',
      latitude: parseFloat(form.latitude),
      longitude: parseFloat(form.longitude),
      ...(form.elevation !== '' && { elevation: parseInt(form.elevation, 10) }),
    });
    setSaving(false);
    setAddOpen(false);
    setForm(EMPTY);
    load();
  };

  const handleEdit = async () => {
    if (!actionCity || !form.name.trim() || !form.latitude || !form.longitude) return;
    setSaving(true);
    await updateDoc(doc(db, 'cities', actionCity.id), {
      name: form.name.trim(),
      country: form.country.trim(),
      timezone: form.timezone.trim(),
      latitude: parseFloat(form.latitude),
      longitude: parseFloat(form.longitude),
      ...(form.elevation !== '' && { elevation: parseInt(form.elevation, 10) }),
    });
    setSaving(false);
    setEditOpen(false);
    setActionCity(null);
    load();
  };

  const handleDelete = async () => {
    if (!actionCity) return;
    setSaving(true);
    await deleteDoc(doc(db, 'cities', actionCity.id));
    setSaving(false);
    setDeleteOpen(false);
    setActionCity(null);
    load();
  };

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-slate-400">
        <div className="text-center">
          <div className="text-2xl mb-2">🗺️</div>
          <div className="text-sm">טוען מפה...</div>
        </div>
      </div>
    );
  }

  const center: [number, number] = [31.5, 34.9];
  const filtered = cities.filter(c => !search || c.name.toLowerCase().includes(search.toLowerCase()));

  const inp = 'w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400';

  return (
    <div className="relative flex-1 h-full" dir="rtl">

      {/* ── Map ── */}
      <MapContainer center={center} zoom={8} className="h-full w-full" zoomControl={false}>
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        />
        <MapController
          target={flyTarget}
          onReady={m => { mapRef.current = m; }}
          onMapClick={handleMapClick}
        />

        {cities.map(city => {
          const isSelected = actionCity?.id === city.id;
          return (
            <Marker
              key={city.id}
              position={[city.latitude, city.longitude]}
              icon={isSelected ? ICON_SELECTED : ICON_DEFAULT}
              zIndexOffset={isSelected ? 1000 : 0}
              eventHandlers={{
                mouseover: e => { if (!isSelected) e.target.setIcon(ICON_HOVER); },
                mouseout:  e => { if (!isSelected) e.target.setIcon(ICON_DEFAULT); },
                click:     (e) => { e.originalEvent.stopPropagation(); handleMarkerClick(city); },
              }}
            >
              <Tooltip direction="top" offset={[0, -38]} opacity={1}>
                <span style={{ fontFamily: 'inherit', fontWeight: 600, fontSize: 13, color: '#1B3A6B' }}>
                  {city.name}
                </span>
              </Tooltip>
            </Marker>
          );
        })}
      </MapContainer>

      {/* ── Search overlay ── */}
      <div ref={searchRef} className="absolute top-4 right-4 z-[1000] w-72" style={{ direction: 'rtl' }}>
        <div className="bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2.5">
            <Search size={16} className="text-slate-400 flex-shrink-0" />
            <input
              value={search}
              onChange={e => { setSearch(e.target.value); setDropdownOpen(true); }}
              onFocus={() => setDropdownOpen(true)}
              placeholder="חפש עיר..."
              className="flex-1 text-sm outline-none bg-transparent text-slate-700 placeholder-slate-400"
            />
            {search && (
              <button onClick={() => { setSearch(''); setDropdownOpen(false); }} className="text-slate-300 hover:text-slate-500">
                <X size={14} />
              </button>
            )}
          </div>

          {dropdownOpen && (
            <div className="border-t border-slate-100 max-h-64 overflow-y-auto">
              {filtered.length === 0 && (
                <div className="px-4 py-3 text-sm text-slate-400">לא נמצאו ערים</div>
              )}
              {filtered.map(city => (
                <button
                  key={city.id}
                  onClick={() => handleDropdownClick(city)}
                  className="w-full text-right px-4 py-2.5 hover:bg-blue-50 flex items-center justify-between group transition-colors"
                >
                  <div>
                    <div className="text-sm font-semibold text-slate-800">{city.name}</div>
                    {!city.statsLoading && city.stats && (
                      <div className="text-xs text-slate-400">
                        {city.stats.synagogues} בתי כנסת · {city.stats.users} משתמשים
                      </div>
                    )}
                  </div>
                  <ArrowLeft size={14} className="text-slate-300 group-hover:text-blue-500 transition-colors" />
                </button>
              ))}
            </div>
          )}
        </div>

        {!dropdownOpen && (
          <div className="mt-2 flex items-center gap-2 flex-wrap">
            {cities.map(city => (
              <button
                key={city.id}
                onClick={() => handleDropdownClick(city)}
                className={`text-xs font-semibold px-3 py-1.5 rounded-full shadow border transition-colors ${
                  actionCity?.id === city.id
                    ? 'bg-red-600 text-white border-red-600'
                    : 'bg-white/90 backdrop-blur-sm text-[#1B3A6B] border-slate-200 hover:bg-[#1B3A6B] hover:text-white'
                }`}
              >
                {city.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── City action panel ── */}
      {actionCity && (
        <div
          className="absolute bottom-20 left-1/2 -translate-x-1/2 z-[1000] bg-white rounded-2xl shadow-2xl border border-slate-200 p-4 w-72"
          style={{ direction: 'rtl' }}
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="font-bold text-slate-800">{actionCity.name}</div>
              {!actionCity.statsLoading && actionCity.stats && (
                <div className="text-xs text-slate-400 mt-0.5">
                  {actionCity.stats.synagogues} בתי כנסת · {actionCity.stats.mikvaot} מקואות · {actionCity.stats.users} משתמשים
                </div>
              )}
            </div>
            <button onClick={closeAction} className="text-slate-300 hover:text-slate-500">
              <X size={15} />
            </button>
          </div>

          {/* Actions */}
          <div className="flex gap-2">
            <button
              onClick={() => navigate(`/cities/${actionCity.id}`)}
              className="flex-1 flex items-center justify-center gap-1.5 bg-[#1B3A6B] text-white text-xs font-semibold py-2 rounded-xl hover:bg-[#15306a] transition-colors"
            >
              <ExternalLink size={12} />
              פתח דשבורד
            </button>
            {isSuperAdmin && (
              <>
                <button
                  onClick={() => openEdit(actionCity)}
                  className="flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium border border-slate-200 rounded-xl hover:bg-blue-50 hover:text-blue-600 hover:border-blue-200 transition-colors text-slate-600"
                >
                  <Pencil size={12} />
                  ערוך
                </button>
                <button
                  onClick={() => setDeleteOpen(true)}
                  className="flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium border border-slate-200 rounded-xl hover:bg-red-50 hover:text-red-600 hover:border-red-200 transition-colors text-slate-400"
                >
                  <Trash2 size={12} />
                  מחק
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Add city button (super_admin only) ── */}
      {isSuperAdmin && (
        <button
          onClick={openAdd}
          className="absolute bottom-6 right-4 z-[1000] flex items-center gap-2 bg-[#1B3A6B] text-white text-sm font-semibold px-4 py-2.5 rounded-xl shadow-lg hover:bg-[#15306a] transition-colors"
        >
          <Plus size={15} />
          הוסף עיר
        </button>
      )}

      {/* ── Zoom controls ── */}
      <div className="absolute bottom-6 left-4 z-[1000] flex flex-col gap-1">
        {(['+', '−'] as const).map((label, i) => (
          <button
            key={label}
            onClick={() => i === 0 ? mapRef.current?.zoomIn() : mapRef.current?.zoomOut()}
            className="w-8 h-8 bg-white border border-slate-200 rounded-lg shadow text-slate-600 font-bold text-base flex items-center justify-center hover:bg-slate-50 transition-colors"
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Coordinate pick banner ── */}
      {coordPickMode && (
        <div
          className="absolute top-4 left-1/2 -translate-x-1/2 z-[1000] flex items-center gap-3 bg-slate-900/90 text-white px-5 py-3 rounded-2xl shadow-xl text-sm font-medium"
          style={{ direction: 'rtl' }}
        >
          <MapPin size={15} className="text-blue-400 flex-shrink-0" />
          לחץ על המפה לבחירת מיקום העיר
          <button
            onClick={cancelPickMode}
            className="mr-2 text-red-400 hover:text-red-300 font-semibold underline"
          >
            ביטול
          </button>
        </div>
      )}

      {/* ── Add modal ── */}
      <Modal open={addOpen} title="הוספת עיר" onClose={() => setAddOpen(false)}>
        <CityForm form={form} setForm={setForm} onPickMap={() => enterPickMode('add')} elevLoading={elevLoading} maLoading={maLoading} maAngle={previewMa} />
        <div className="flex gap-3 pt-4 border-t border-slate-100 mt-4">
          <button
            onClick={handleAdd}
            disabled={saving || !form.name.trim() || !form.latitude || !form.longitude}
            className="flex-1 bg-[#1B3A6B] text-white py-2.5 rounded-xl font-semibold text-sm hover:bg-[#15306a] disabled:opacity-50 transition-colors"
          >
            {saving ? 'שומר...' : 'הוסף עיר'}
          </button>
          <button onClick={() => setAddOpen(false)} className="px-5 py-2.5 border border-slate-200 rounded-xl text-sm hover:bg-slate-50">
            ביטול
          </button>
        </div>
      </Modal>

      {/* ── Edit modal ── */}
      <Modal open={editOpen} title={`עריכת ${actionCity?.name ?? 'עיר'}`} onClose={() => setEditOpen(false)}>
        <CityForm form={form} setForm={setForm} onPickMap={() => enterPickMode('edit')} elevLoading={elevLoading} />
        <div className="flex gap-3 pt-4 border-t border-slate-100 mt-4">
          <button
            onClick={handleEdit}
            disabled={saving || !form.name.trim() || !form.latitude || !form.longitude}
            className="flex-1 bg-[#1B3A6B] text-white py-2.5 rounded-xl font-semibold text-sm hover:bg-[#15306a] disabled:opacity-50 transition-colors"
          >
            {saving ? 'שומר...' : 'שמור שינויים'}
          </button>
          <button onClick={() => setEditOpen(false)} className="px-5 py-2.5 border border-slate-200 rounded-xl text-sm hover:bg-slate-50">
            ביטול
          </button>
        </div>
      </Modal>

      {/* ── Delete confirm ── */}
      <Modal open={deleteOpen} title="מחיקת עיר" onClose={() => setDeleteOpen(false)} size="md">
        <p className="text-slate-600 text-sm mb-2">
          האם למחוק את <strong>{actionCity?.name}</strong>?
        </p>
        <p className="text-amber-600 text-xs bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-6">
          שים לב: המחיקה מסירה רק את העיר. בתי הכנסת, מקואות ונתוני המשתמשים לא יימחקו.
        </p>
        <div className="flex gap-3">
          <button
            onClick={handleDelete}
            disabled={saving}
            className="flex-1 bg-red-500 text-white py-2.5 rounded-xl font-semibold text-sm hover:bg-red-600 disabled:opacity-50"
          >
            {saving ? 'מוחק...' : 'מחק עיר'}
          </button>
          <button onClick={() => setDeleteOpen(false)} className="px-5 py-2.5 border border-slate-200 rounded-xl text-sm hover:bg-slate-50">
            ביטול
          </button>
        </div>
      </Modal>
    </div>
  );
}

// ─── Shared form component ────────────────────────────────────────────────────

export function CityForm({ form, setForm, onPickMap, elevLoading, maLoading, maAngle }: { form: FormState; setForm: (f: FormState) => void; onPickMap?: () => void; elevLoading?: boolean; maLoading?: boolean; maAngle?: number | null }) {
  const f = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [k]: e.target.value });
  const inp = 'w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400';

  return (
    <div className="grid grid-cols-2 gap-4" dir="rtl">
      <div className="col-span-2">
        <label className="block text-xs font-semibold text-slate-600 mb-1.5">שם העיר *</label>
        <input value={form.name} onChange={f('name')} placeholder="מעלה אדומים" className={inp} />
      </div>
      <div>
        <label className="block text-xs font-semibold text-slate-600 mb-1.5">מדינה</label>
        <input value={form.country} onChange={f('country')} className={inp} />
      </div>
      <div>
        <label className="block text-xs font-semibold text-slate-600 mb-1.5">אזור זמן</label>
        <input value={form.timezone} onChange={f('timezone')} placeholder="Asia/Jerusalem" className={inp} />
      </div>
      <div>
        <label className="block text-xs font-semibold text-slate-600 mb-1.5">קו רוחב *</label>
        <input value={form.latitude} onChange={f('latitude')} type="number" step="any" placeholder="31.77" className={inp} />
      </div>
      <div>
        <label className="block text-xs font-semibold text-slate-600 mb-1.5">קו אורך *</label>
        <input value={form.longitude} onChange={f('longitude')} type="number" step="any" placeholder="35.24" className={inp} />
      </div>
      {onPickMap && (
        <div className="col-span-2">
          <button
            type="button"
            onClick={onPickMap}
            className="flex items-center gap-1.5 text-xs font-semibold text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 px-3 py-2 rounded-lg border border-blue-200 transition-colors"
          >
            <MapPin size={13} />
            בחר במפה
          </button>
        </div>
      )}
      <div>
        <label className="block text-xs font-semibold text-slate-600 mb-1.5">גובה מ"מ (מ')</label>
        <div className="relative">
          <input
            value={form.elevation}
            onChange={f('elevation')}
            type="number"
            step="1"
            placeholder="750"
            disabled={elevLoading}
            className={inp}
          />
          {elevLoading && (
            <div className="absolute inset-0 flex items-center px-3 text-sm text-slate-400 pointer-events-none bg-white rounded-lg">
              מחשב גובה...
            </div>
          )}
        </div>
      </div>
      <div className="flex items-end">
        <p className="text-xs text-slate-400">הגובה מחושב אוטומטית בבחירה מהמפה, נדרש לחישוב זמני היום.</p>
      </div>
      <div className="col-span-2 flex items-center justify-between px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg">
        <span className="text-xs text-slate-500">
          {maLoading
            ? 'סורק שדה הרים לכיוון הזריחה...'
            : maAngle != null
              ? `זווית הר היום: ${maAngle}° — מחושב יומית לפי כיוון הזריחה`
              : 'זווית הר — מחושבת יומית לפי כיוון הזריחה, אינה נשמרת'
          }
        </span>
        {!maLoading && maAngle != null && (
          <span className="text-sm font-bold text-slate-700 ml-2 dir-ltr">{maAngle}°</span>
        )}
        {maLoading && <div className="w-3 h-3 rounded-full border-2 border-slate-400 border-t-transparent animate-spin" />}
      </div>
    </div>
  );
}
