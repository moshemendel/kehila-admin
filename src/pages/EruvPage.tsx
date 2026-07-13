import { useEffect, useState, useCallback } from 'react';
import {
  doc, getDoc, setDoc, collection, query, where,
  onSnapshot, updateDoc, serverTimestamp, orderBy,
} from 'firebase/firestore';
import { db } from '../firebase';
import { useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import type { City } from '../types';
import 'leaflet/dist/leaflet.css';
import { MapContainer, TileLayer, Marker, Polyline, Polygon, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import {
  CheckCircle2, XCircle, HelpCircle, Trash2, Undo2, RotateCcw,
  MapPin, Save, GitBranch, Scissors, Link, Plus, Bell,
} from 'lucide-react';
import { sendEruvStatusPush } from '../utils/push';

// ─── Local types ──────────────────────────────────────────────────────────────

type EruvStatusValue = 'valid' | 'invalid' | 'unknown';
type SegmentMode = 'off' | 'selectA' | 'selectB' | 'addPoints' | 'deletePoint' | 'bridgeA' | 'bridgeB';

interface EruvCoord { lat: number; lng: number; }

interface EruvReport {
  id: string;
  cityId: string;
  userId: string;
  userDisplayName?: string;
  type: 'breach' | 'question';
  description: string;
  userLocation?: { latitude: number; longitude: number };
  imageUrl?: string;
  status: 'open' | 'resolved';
  resolvedBy?: string;
  resolvedAt?: any;
  createdAt: any;
}

// ─── Constants ────────────────────────────────────────────────────────────────

// Colors for each polygon (active uses #1B3A6B)
const POLY_COLORS = ['#E07B00', '#2e7d32', '#7b1fa2', '#c62828'];

function areAdjacent(a: number, b: number, count: number) {
  return Math.abs(a - b) === 1 || (Math.min(a, b) === 0 && Math.max(a, b) === count - 1);
}

// ─── Leaflet icons ────────────────────────────────────────────────────────────

const makeIcon = (color: string, size = 12) => L.divIcon({
  html: `<div style="width:${size}px;height:${size}px;background:${color};border:2.5px solid white;border-radius:50%;box-shadow:0 1px 4px rgba(0,0,0,.45)"></div>`,
  className: '',
  iconAnchor: [size / 2, size / 2],
  iconSize: [size, size],
});

const ICONS = {
  normal:  makeIcon('#1B3A6B'),
  A:       makeIcon('#2e7d32', 16),
  B:       makeIcon('#c62828', 16),
  new:     makeIcon('#1565C0'),
  bridge:  makeIcon('#E07B00'),
  delete:  makeIcon('#c62828'),
};

// ─── Map interaction components ───────────────────────────────────────────────

function MapClickHandler({ onAdd }: { onAdd: (lat: number, lng: number) => void }) {
  useMapEvents({ click: e => onAdd(e.latlng.lat, e.latlng.lng) });
  return null;
}

// ─── Status config ────────────────────────────────────────────────────────────

const STATUS_INFO: Record<EruvStatusValue, { label: string; color: string; bg: string; Icon: any }> = {
  valid:   { label: 'כשר',     color: 'text-emerald-700', bg: 'bg-emerald-50 border-emerald-200', Icon: CheckCircle2 },
  invalid: { label: 'פסול',    color: 'text-red-700',     bg: 'bg-red-50 border-red-200',         Icon: XCircle      },
  unknown: { label: 'לא ידוע', color: 'text-slate-600',   bg: 'bg-slate-50 border-slate-200',     Icon: HelpCircle   },
};

type TabKey = 'status' | 'polygon' | 'reports';

// ─── Component ────────────────────────────────────────────────────────────────

export default function EruvPage() {
  const { cityId = '' } = useParams<{ cityId: string }>();
  const { appUser } = useAuth();

  const [tab, setTab] = useState<TabKey>('status');
  const [city, setCity] = useState<City | null>(null);

  // Status tab
  const [statusValue, setStatusValue] = useState<EruvStatusValue>('unknown');
  const [notes, setNotes] = useState('');
  const [savingStatus, setSavingStatus] = useState(false);
  const [statusSaved, setStatusSaved] = useState(false);

  // Polygon tab
  const [polygons,         setPolygons]         = useState<EruvCoord[][]>([[]]);
  const [activePolygonIdx, setActivePolygonIdx] = useState(0);
  const [savingPolygon,    setSavingPolygon]    = useState(false);
  const [polygonSaved,     setPolygonSaved]     = useState(false);
  const [saveError,        setSaveError]        = useState<string | null>(null);
  const [pushSent,         setPushSent]         = useState<number | null>(null);

  // Segment editing state
  const [segmentMode,  setSegmentMode]  = useState<SegmentMode>('off');
  const [segmentA,     setSegmentA]     = useState<number | null>(null);
  const [segmentB,     setSegmentB]     = useState<number | null>(null);
  const [origSegmentA, setOrigSegmentA] = useState<number | null>(null);

  // Reports tab
  const [reports,   setReports]   = useState<EruvReport[]>([]);
  const [reportTab, setReportTab] = useState<'open' | 'resolved'>('open');

  const activePoints = polygons[activePolygonIdx] ?? [];

  const updateActivePolygon = useCallback((fn: (pts: EruvCoord[]) => EruvCoord[]) => {
    setPolygons(prev => {
      const next = [...prev];
      next[activePolygonIdx] = fn(next[activePolygonIdx] ?? []);
      return next;
    });
  }, [activePolygonIdx]);

  // Load city
  useEffect(() => {
    if (!cityId) return;
    getDoc(doc(db, 'cities', cityId)).then(snap => {
      if (snap.exists()) setCity({ id: snap.id, ...snap.data() } as City);
    });
  }, [cityId]);

  // Load eruv status + polygon
  useEffect(() => {
    if (!cityId) return;
    getDoc(doc(db, 'eruvStatus', cityId)).then(snap => {
      if (!snap.exists()) return;
      const d = snap.data() as any;
      setStatusValue(d.status ?? 'unknown');
      setNotes(d.notes ?? '');
      // Load polygons — new format: [{points:[...]}, ...]; legacy: flat array of coords
      if (Array.isArray(d.polygons) && d.polygons.length > 0) {
        setPolygons(d.polygons.map((poly: any) =>
          (poly.points ?? []).map((p: any) => ({ lat: p.latitude, lng: p.longitude }))
        ));
      } else if (Array.isArray(d.polygon) && d.polygon.length > 0) {
        setPolygons([d.polygon.map((p: any) => ({ lat: p.latitude, lng: p.longitude }))]);
      }
    });
  }, [cityId]);

  // Real-time reports listener
  useEffect(() => {
    if (!cityId) return;
    const q = query(
      collection(db, 'eruvReports'),
      where('cityId', '==', cityId),
      orderBy('createdAt', 'desc'),
    );
    return onSnapshot(q, snap => {
      setReports(snap.docs.map(d => ({ id: d.id, ...d.data() }) as EruvReport));
    });
  }, [cityId]);

  // ─── Segment helpers ────────────────────────────────────────────────────────

  function resetSegment() {
    setSegmentMode('off');
    setSegmentA(null);
    setSegmentB(null);
    setOrigSegmentA(null);
  }

  function handleMarkerClick(pointIdx: number) {
    if (segmentMode === 'bridgeA') {
      setSegmentA(pointIdx); setSegmentMode('bridgeB'); return;
    }
    if (segmentMode === 'bridgeB') {
      if (pointIdx === segmentA) { setSegmentA(null); setSegmentMode('bridgeA'); return; }
      const a = segmentA!;
      const b = pointIdx;
      const n = activePoints.length;
      const between = a < b ? b - a - 1 : (n - a - 1) + b;
      const remaining = n - between;
      if (between === 0) { alert('הנקודות צמודות — אין נקודות ביניהן למחיקה'); resetSegment(); return; }
      if (remaining < 3) { alert(`לא ניתן: מחיקת ${between} נקודות תשאיר פחות מ-3`); return; }
      if (window.confirm(`${between} נקודות יימחקו בין נקודה ${a + 1} לנקודה ${b + 1}. לחבר ישירות?`)) {
        const toDelete = new Set<number>();
        if (a < b) { for (let j = a + 1; j < b; j++) toDelete.add(j); }
        else { for (let j = a + 1; j < n; j++) toDelete.add(j); for (let j = 0; j < b; j++) toDelete.add(j); }
        updateActivePolygon(prev => prev.filter((_, idx) => !toDelete.has(idx)));
        resetSegment();
      }
      return;
    }
    if (segmentMode === 'deletePoint') {
      if (activePoints.length <= 3) { alert('מצולע חייב להכיל לפחות 3 נקודות'); return; }
      updateActivePolygon(prev => prev.filter((_, idx) => idx !== pointIdx));
      return;
    }
    if (segmentMode === 'selectA') {
      setSegmentA(pointIdx); setSegmentMode('selectB'); return;
    }
    if (segmentMode === 'selectB') {
      if (pointIdx === segmentA) { setSegmentA(null); setSegmentMode('selectA'); return; }
      if (!areAdjacent(pointIdx, segmentA!, activePoints.length)) return;
      setSegmentB(pointIdx); setOrigSegmentA(segmentA); setSegmentMode('addPoints'); return;
    }
    if (segmentMode === 'addPoints' && pointIdx === segmentB) { resetSegment(); }
  }

  const handleMapClick = useCallback((lat: number, lng: number) => {
    if (segmentMode === 'addPoints' && segmentA !== null && segmentB !== null) {
      const insertAt = segmentA + 1;
      updateActivePolygon(prev => {
        const next = [...prev];
        next.splice(insertAt, 0, { lat, lng });
        return next;
      });
      const newB = segmentB > segmentA ? segmentB + 1 : segmentB;
      setSegmentA(insertAt);
      setSegmentB(newB);
      return;
    }
    if (segmentMode === 'off') {
      updateActivePolygon(prev => [...prev, { lat, lng }]);
    }
  }, [segmentMode, segmentA, segmentB, updateActivePolygon]);

  function removeLastPoint() {
    if (segmentMode === 'addPoints' && segmentA !== null && origSegmentA !== null) {
      if (segmentA === origSegmentA) { setSegmentB(null); setOrigSegmentA(null); setSegmentMode('selectB'); return; }
      const prevA = segmentA - 1;
      const newB  = segmentB! > segmentA ? segmentB! - 1 : segmentB!;
      updateActivePolygon(prev => prev.filter((_, i) => i !== segmentA));
      setSegmentA(prevA); setSegmentB(newB); return;
    }
    updateActivePolygon(prev => prev.slice(0, -1));
  }

  // ─── Multi-polygon helpers ──────────────────────────────────────────────────

  function addPolygon() {
    setPolygons(prev => [...prev, []]);
    setActivePolygonIdx(polygons.length);
    resetSegment();
  }

  function deleteActivePolygon() {
    if (!window.confirm('למחוק את המצולע הנבחר?')) return;
    if (polygons.length <= 1) { setPolygons([[]]); resetSegment(); return; }
    const next = polygons.filter((_, i) => i !== activePolygonIdx);
    setPolygons(next);
    setActivePolygonIdx(Math.max(0, activePolygonIdx - 1));
    resetSegment();
  }

  // ─── Save handlers ──────────────────────────────────────────────────────────

  const handleSaveStatus = async () => {
    if (!cityId) return;
    setSavingStatus(true);
    setSaveError(null);
    setPushSent(null);
    try {
      await setDoc(doc(db, 'eruvStatus', cityId), {
        status: statusValue, notes,
        updatedBy: appUser?.uid ?? '',
        updatedAt: serverTimestamp(),
      }, { merge: true });
      setStatusSaved(true);
      setTimeout(() => setStatusSaved(false), 3000);

      // Auto-send push notification for valid/invalid status
      if (statusValue !== 'unknown' && city) {
        const count = await sendEruvStatusPush(cityId, city.name, statusValue, appUser?.uid ?? '');
        setPushSent(count);
        setTimeout(() => setPushSent(null), 5000);
      }
    } catch (e: any) {
      setSaveError(e?.message ?? 'שגיאה בשמירה');
    } finally {
      setSavingStatus(false);
    }
  };

  const handleSavePolygon = async () => {
    if (!cityId) return;
    const valid = polygons.filter(p => p.length >= 3);
    if (valid.length === 0) { alert('יש לסמן לפחות מצולע אחד עם 3 נקודות'); return; }
    setSavingPolygon(true);
    setSaveError(null);
    try {
      await setDoc(doc(db, 'eruvStatus', cityId), {
        polygons: valid.map(poly => ({ points: poly.map(p => ({ latitude: p.lat, longitude: p.lng })) })),
        updatedBy: appUser?.uid ?? '',
      }, { merge: true });
      setPolygonSaved(true);
      setTimeout(() => setPolygonSaved(false), 2000);
    } catch (e: any) {
      setSaveError(e?.message ?? 'שגיאה בשמירה');
    } finally {
      setSavingPolygon(false);
    }
  };

  const handleResolveReport = async (id: string) => {
    await updateDoc(doc(db, 'eruvReports', id), {
      status: 'resolved',
      resolvedBy: appUser?.uid ?? '',
      resolvedAt: serverTimestamp(),
    });
  };

  // ─── Marker role & icon ─────────────────────────────────────────────────────

  function markerRole(i: number): keyof typeof ICONS {
    if (segmentMode === 'deletePoint') return 'delete';
    if (segmentMode === 'bridgeB' && segmentA !== null) { if (i === segmentA) return 'A'; return 'bridge'; }
    if (i === segmentA) return 'A';
    if (i === segmentB) return 'B';
    if (segmentMode === 'addPoints' && origSegmentA !== null && segmentA !== null && i > origSegmentA && i <= segmentA) return 'new';
    return 'normal';
  }

  // ─── Hint text ──────────────────────────────────────────────────────────────

  const hintText = (() => {
    if (segmentMode === 'selectA')     return 'בחר נקודת התחלה (א\') לעריכת קטע';
    if (segmentMode === 'selectB')     return `נקודה ${segmentA! + 1} — בחר נקודה צמודה כ-ב'`;
    if (segmentMode === 'addPoints')   return `א'=${segmentA! + 1} ב'=${segmentB! + 1} — לחץ מפה להוסיף · לחץ ב' לסיום`;
    if (segmentMode === 'deletePoint') return 'לחץ על נקודה למחיקה — שכניה יתחברו';
    if (segmentMode === 'bridgeA')     return 'בחר נקודת התחלה לחיבור ישיר';
    if (segmentMode === 'bridgeB')     return `נקודה ${segmentA! + 1} — בחר נקודת סיום לחיבור`;
    return activePoints.length === 0 ? 'לחץ על המפה להוסיף נקודות' : 'לחץ מפה להוסיף · לחץ נקודה לפעולות';
  })();

  // ─── Derived data ───────────────────────────────────────────────────────────

  const openReports     = reports.filter(r => r.status === 'open');
  const resolvedReports = reports.filter(r => r.status === 'resolved');
  const si              = STATUS_INFO[statusValue];

  const mapCenter: [number, number] = city ? [city.latitude, city.longitude] : [31.77, 35.22];

  const validPolygonCount = polygons.filter(p => p.length >= 3).length;

  return (
    <div className="p-8" dir="rtl">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800">עירוב</h1>
        <p className="text-slate-400 text-sm mt-0.5">ניהול גבולות ומצב העירוב</p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 bg-slate-100 rounded-xl p-1 w-fit mb-6">
        {(['status', 'polygon', 'reports'] as TabKey[]).map(t => {
          const labels: Record<TabKey, string> = { status: 'מצב', polygon: 'גבולות', reports: 'דיווחים' };
          return (
            <button key={t} onClick={() => setTab(t)}
              className={`flex items-center gap-1.5 px-5 py-2 rounded-lg text-sm font-medium transition-colors ${tab === t ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}>
              {labels[t]}
              {t === 'reports' && openReports.length > 0 && (
                <span className="text-xs px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-600">{openReports.length}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── מצב ── */}
      {tab === 'status' && (
        <div className="max-w-lg space-y-5">
          <div className={`rounded-xl border p-5 flex items-center gap-4 ${si.bg}`}>
            <si.Icon size={32} className={si.color} />
            <div>
              <div className="text-xs text-slate-500 mb-0.5">מצב נוכחי</div>
              <div className={`text-lg font-bold ${si.color}`}>{si.label}</div>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-2">עדכון מצב</label>
            <div className="flex gap-2">
              {(['valid', 'invalid', 'unknown'] as EruvStatusValue[]).map(v => {
                const info = STATUS_INFO[v];
                return (
                  <button key={v} onClick={() => setStatusValue(v)}
                    className={`flex items-center gap-2 px-4 py-2 rounded-xl border text-sm font-medium transition-all ${
                      statusValue === v
                        ? `${info.bg} ${info.color} ring-2 ring-offset-1 ring-current`
                        : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
                    }`}>
                    <info.Icon size={15} />
                    {info.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5">הערות</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
              placeholder="לדוגמה: תיקון בוצע בפינת רחוב..."
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 resize-none" />
          </div>

          {saveError && (
            <div className="px-3 py-2 bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg font-medium flex items-center gap-2">
              <XCircle size={13} className="flex-shrink-0" />
              {saveError}
            </div>
          )}

          <button onClick={handleSaveStatus} disabled={savingStatus}
            className="flex items-center gap-2 px-5 py-2.5 bg-[#1B3A6B] text-white rounded-xl font-semibold text-sm hover:bg-[#15306a] disabled:opacity-50">
            {statusSaved ? <CheckCircle2 size={15} /> : <Save size={15} />}
            {statusSaved ? 'נשמר!' : savingStatus ? 'שומר...' : 'שמור מצב'}
          </button>

          {pushSent !== null && (
            <div className="flex items-center gap-2 px-4 py-2.5 bg-blue-50 border border-blue-200 rounded-xl text-sm text-blue-700 font-medium">
              <Bell size={14} className="flex-shrink-0" />
              {pushSent === 0
                ? 'אין מכשירים רשומים — לא נשלחה התראה'
                : `התראה נשלחה ל-${pushSent} מכשירים`}
            </div>
          )}
        </div>
      )}

      {/* ── גבולות ── */}
      {tab === 'polygon' && (
        <div className="space-y-3">
          {/* Polygon selector row */}
          <div className="flex items-center gap-2 flex-wrap">
            {polygons.map((poly, i) => {
              const isActive = i === activePolygonIdx;
              const color = isActive ? '#1B3A6B' : POLY_COLORS[(i - 1 + POLY_COLORS.length) % POLY_COLORS.length];
              return (
                <button key={i} onClick={() => { setActivePolygonIdx(i); resetSegment(); }}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${
                    isActive
                      ? 'bg-[#1B3A6B] text-white border-[#1B3A6B]'
                      : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'
                  }`}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, display: 'inline-block', flexShrink: 0 }} />
                  מצולע {i + 1}{poly.length > 0 ? ` (${poly.length})` : ''}
                </button>
              );
            })}
            {polygons.length < 5 && (
              <button onClick={addPolygon}
                className="flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold border border-dashed border-blue-400 text-blue-600 hover:bg-blue-50">
                <Plus size={12} /> הוסף אזור
              </button>
            )}
            {polygons.length > 1 && (
              <button onClick={deleteActivePolygon}
                className="flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold border border-red-200 text-red-600 hover:bg-red-50">
                <Trash2 size={12} /> מחק מצולע {activePolygonIdx + 1}
              </button>
            )}
          </div>

          {/* Toolbar */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Mode buttons */}
            <div className="flex items-center gap-1 bg-slate-100 rounded-xl p-1">
              <ToolBtn icon={<Undo2 size={14} />} label="בטל" active={false}
                disabled={activePoints.length === 0}
                onClick={removeLastPoint} />
              <ToolBtn icon={<RotateCcw size={14} />} label="נקה" active={false}
                disabled={activePoints.length === 0}
                onClick={() => { updateActivePolygon(() => []); resetSegment(); }} />
              <div className="w-px h-6 bg-slate-300 mx-0.5" />
              <ToolBtn icon={<GitBranch size={14} />} label="ערוך קטע"
                active={segmentMode === 'selectA' || segmentMode === 'selectB' || segmentMode === 'addPoints'}
                disabled={activePoints.length < 2}
                onClick={() => segmentMode === 'off' ? setSegmentMode('selectA') : resetSegment()}
                activeColor="bg-blue-600 text-white" />
              <ToolBtn icon={<Scissors size={14} />} label="מחק נקודה"
                active={segmentMode === 'deletePoint'}
                disabled={activePoints.length <= 3}
                onClick={() => segmentMode === 'deletePoint' ? resetSegment() : setSegmentMode('deletePoint')}
                activeColor="bg-red-600 text-white" />
              <ToolBtn icon={<Link size={14} />} label="חיבור ישיר"
                active={segmentMode === 'bridgeA' || segmentMode === 'bridgeB'}
                disabled={activePoints.length <= 4}
                onClick={() => (segmentMode === 'bridgeA' || segmentMode === 'bridgeB') ? resetSegment() : setSegmentMode('bridgeA')}
                activeColor="bg-orange-500 text-white" />
            </div>

            {/* Save button */}
            <button onClick={handleSavePolygon} disabled={savingPolygon || validPolygonCount === 0}
              className="flex items-center gap-1.5 px-4 py-1.5 bg-[#1B3A6B] text-white rounded-lg text-xs font-semibold hover:bg-[#15306a] disabled:opacity-50 mr-auto">
              {polygonSaved ? <CheckCircle2 size={13} /> : <Save size={13} />}
              {polygonSaved ? 'נשמר!' : savingPolygon ? 'שומר...' : `שמור (${validPolygonCount} מצולעים)`}
            </button>
          </div>

          {/* Error banner */}
          {saveError && (
            <div className="px-3 py-2 bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg font-medium flex items-center gap-2">
              <XCircle size={13} className="flex-shrink-0" />
              {saveError}
            </div>
          )}

          {/* Hint bar */}
          <div className="px-3 py-2 bg-slate-800/80 text-white text-xs rounded-lg font-medium text-center">
            {hintText}
          </div>

          {/* Map */}
          {!city ? (
            <div className="h-[520px] rounded-xl border border-slate-200 bg-slate-50 flex items-center justify-center text-slate-400 text-sm">
              טוען מפה...
            </div>
          ) : (
            <div className="rounded-xl overflow-hidden border border-slate-200" style={{ height: 520 }}>
              <MapContainer center={mapCenter} zoom={14} style={{ height: '100%', width: '100%' }}>
                <TileLayer
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  attribution='© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                />
                {(segmentMode === 'off' || segmentMode === 'addPoints') && (
                  <MapClickHandler onAdd={handleMapClick} />
                )}

                {/* Non-active polygons */}
                {polygons.map((poly, polyIdx) => {
                  if (polyIdx === activePolygonIdx || poly.length < 3) return null;
                  const color = POLY_COLORS[(polyIdx - 1 + POLY_COLORS.length) % POLY_COLORS.length];
                  const positions = poly.map(p => [p.lat, p.lng] as [number, number]);
                  return (
                    <Polygon key={polyIdx} positions={positions}
                      pathOptions={{ color, fillColor: color, fillOpacity: 0.12, weight: 2 }} />
                  );
                })}

                {/* Active polygon outline */}
                {activePoints.length > 1 && (() => {
                  const pts = activePoints.map(p => [p.lat, p.lng] as [number, number]);
                  if (activePoints.length > 2) pts.push(pts[0]);
                  return <Polyline positions={pts} pathOptions={{ color: '#1B3A6B', weight: 2.5, dashArray: '7 5' }} />;
                })()}

                {/* Active polygon markers */}
                {activePoints.map((p, i) => {
                  const role = markerRole(i);
                  return (
                    <Marker key={`${i}-${role}`} position={[p.lat, p.lng]} icon={ICONS[role]}
                      draggable={segmentMode === 'off'}
                      eventHandlers={{
                        click: () => handleMarkerClick(i),
                        dragend: e => {
                          const ll = (e.target as L.Marker).getLatLng();
                          updateActivePolygon(prev => prev.map((pt, idx) => idx === i ? { lat: ll.lat, lng: ll.lng } : pt));
                        },
                      }}
                    />
                  );
                })}
              </MapContainer>
            </div>
          )}
        </div>
      )}

      {/* ── דיווחים ── */}
      {tab === 'reports' && (
        <div className="space-y-5">
          <div className="flex gap-1 bg-slate-100 rounded-xl p-1 w-fit">
            {(['open', 'resolved'] as const).map(t => (
              <button key={t} onClick={() => setReportTab(t)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${reportTab === t ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}>
                {t === 'open' ? `פתוחים (${openReports.length})` : `טופלו (${resolvedReports.length})`}
              </button>
            ))}
          </div>

          {(reportTab === 'open' ? openReports : resolvedReports).length === 0 ? (
            <div className="text-center py-16 text-slate-400 text-sm">אין דיווחים</div>
          ) : (
            <div className="space-y-3">
              {(reportTab === 'open' ? openReports : resolvedReports).map(r => (
                <div key={r.id} className="bg-white rounded-xl border border-slate-200 p-4 flex gap-4">
                  {r.imageUrl && (
                    <img src={r.imageUrl} alt="" className="w-20 h-20 rounded-lg object-cover flex-shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${r.type === 'breach' ? 'bg-red-50 text-red-600' : 'bg-orange-50 text-orange-600'}`}>
                        {r.type === 'breach' ? 'פרצה' : 'שאלה'}
                      </span>
                      <span className="text-xs text-slate-400">{r.userDisplayName ?? 'משתמש'}</span>
                      {r.createdAt?.toDate && (
                        <span className="text-xs text-slate-400">{r.createdAt.toDate().toLocaleDateString('he-IL')}</span>
                      )}
                    </div>
                    <p className="text-sm text-slate-700 mb-2">{r.description}</p>
                    {r.userLocation && (
                      <a href={`https://maps.google.com/?q=${r.userLocation.latitude},${r.userLocation.longitude}`}
                        target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline">
                        <MapPin size={11} /> מיקום המדווח
                      </a>
                    )}
                    {reportTab === 'resolved' && r.resolvedAt?.toDate && (
                      <div className="text-xs text-emerald-600 mt-1">טופל ב-{r.resolvedAt.toDate().toLocaleDateString('he-IL')}</div>
                    )}
                  </div>
                  {reportTab === 'open' && (
                    <button onClick={() => handleResolveReport(r.id)}
                      className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 text-emerald-700 rounded-lg text-xs font-semibold hover:bg-emerald-100 h-fit self-start mt-1">
                      <CheckCircle2 size={13} /> סמן כטופל
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Toolbar button ───────────────────────────────────────────────────────────

function ToolBtn({ icon, label, active, disabled, onClick, activeColor = 'bg-slate-700 text-white' }: {
  icon: React.ReactNode; label: string; active: boolean;
  disabled?: boolean; onClick: () => void; activeColor?: string;
}) {
  return (
    <button
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors disabled:opacity-40 ${
        active ? activeColor : 'text-slate-600 hover:bg-slate-200'
      }`}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}
