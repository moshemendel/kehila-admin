import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  doc, getDoc, setDoc, addDoc, getDocs, collection, query, where,
  onSnapshot, updateDoc, serverTimestamp, orderBy, deleteField,
} from 'firebase/firestore';
import { db } from '../firebase';
import { useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import type { City } from '../types';
import 'leaflet/dist/leaflet.css';
import { MapContainer, Marker, Polyline, Polygon, Tooltip, useMapEvents, useMap } from 'react-leaflet';
import L from 'leaflet';
import {
  CheckCircle2, XCircle, HelpCircle, Trash2, Undo2, RotateCcw,
  MapPin, Save, GitBranch, Scissors, Link, Plus, Bell, Pencil, Upload, Download,
} from 'lucide-react';
import { sendEruvStatusPush } from '../utils/push';
import MapTiles from '../components/MapTiles';
import EruvPointsImportModal from '../components/EruvPointsImportModal';
import { exportEruvPoints } from '../utils/eruvPoints';

// ─── Local types ──────────────────────────────────────────────────────────────

type EruvStatusValue = 'valid' | 'invalid' | 'unknown';
type SegmentMode = 'off' | 'selectA' | 'selectB' | 'addPoints' | 'deletePoint' | 'bridgeA' | 'bridgeB';

interface EruvCoord { lat: number; lng: number; }

interface EruvReport {
  id: string;
  cityId: string;
  eruvId?: string;
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

// One physical eruv. Most cities have exactly one; a regional council can
// have several (one per settlement, or per settlement-group sharing one
// boundary) — see src/types/index.ts's EruvStatus comment in the mobile app
// for the full reasoning, this mirrors it.
interface EruvStatusDoc {
  id: string;
  cityId: string;
  areaIds: string[];
  label?: string;
  status: EruvStatusValue;
  notes?: string;
  updatedAt?: any;
  updatedBy?: string;
}

interface AreaOption { id: string; name: string; latitude?: number; longitude?: number; }

// Picker used both to create a brand-new eruv (checking one or more
// uncovered settlements) and to edit an existing eruv's areaIds (checking
// its own settlements plus any still-uncovered ones) — same UI, since both
// are "which settlements does this eruv cover" with a different starting
// selection.
type EruvPicker = { mode: 'create' } | { mode: 'edit'; eruv: EruvStatusDoc };

// ─── Constants ────────────────────────────────────────────────────────────────

// One colour per ring, the same on its chip and on the map.
const POLY_COLORS = ['#1B3A6B', '#E07B00', '#2e7d32', '#7b1fa2', '#c62828'];
const polyColor = (i: number) => POLY_COLORS[i % POLY_COLORS.length];

/**
 * How one ring is drawn. Stored with its points (polygons[i].style), so a
 * ring keeps its look across saves. fillColor null = same as the outline.
 */
interface PolyStyle { color: string; fillColor: string | null; fillOpacity: number; }
const DEFAULT_FILL_OPACITY = 0.18;
const defaultStyle = (i: number): PolyStyle =>
  ({ color: polyColor(i), fillColor: null, fillOpacity: DEFAULT_FILL_OPACITY });

function readStyle(raw: unknown, i: number): PolyStyle {
  const d = defaultStyle(i);
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Partial<PolyStyle>;
  const hex = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
  return {
    color: hex(r.color) ? r.color : d.color,
    fillColor: hex(r.fillColor) ? r.fillColor : null,
    fillOpacity: typeof r.fillOpacity === 'number' && r.fillOpacity >= 0 && r.fillOpacity <= 1
      ? r.fillOpacity : d.fillOpacity,
  };
}
// Tall enough to work in, short enough that the toolbar above stays on screen.
const MAP_HEIGHT = 'max(420px, calc(100vh - 300px))';

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

/**
 * Frames the map each time `token` changes: on the selected eruv's boundary
 * when it has one, otherwise on `fallback` (its settlement, or the city).
 * Token-driven so it fires on switching eruv or importing a file, and never
 * while the admin is editing points.
 */
function FitToPoints({ token, points, fallback }: {
  token: number; points: EruvCoord[]; fallback: [number, number];
}) {
  const map = useMap();
  useEffect(() => {
    if (!token) return;
    if (points.length >= 2) {
      map.fitBounds(L.latLngBounds(points.map(p => [p.lat, p.lng] as [number, number])), { padding: [30, 30] });
    } else {
      map.setView(fallback, 15);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);
  return null;
}

// ─── Status config ────────────────────────────────────────────────────────────

const STATUS_INFO: Record<EruvStatusValue, { label: string; color: string; bg: string; Icon: any }> = {
  valid:   { label: 'כשר',     color: 'text-emerald-700', bg: 'bg-emerald-50 border-emerald-200', Icon: CheckCircle2 },
  invalid: { label: 'פסול',    color: 'text-red-700',     bg: 'bg-red-50 border-red-200',         Icon: XCircle      },
  unknown: { label: 'לא ידוע', color: 'text-slate-600',   bg: 'bg-slate-50 border-slate-200',     Icon: HelpCircle   },
};

type TabKey = 'status' | 'reports';

// Status dot colours in the all-eruvin list. The map itself draws each ring
// in its own saved style, the same as in the single-eruv editor.
const STATUS_MAP_COLOR: Record<EruvStatusValue, string> = {
  valid: '#059669', invalid: '#dc2626', unknown: '#d97706',
};

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
  // null = nothing selected: every ring shows as a plain filled shape. Only a
  // selected ring shows its points and takes edits.
  const [activePolygonIdx, setActivePolygonIdx] = useState<number | null>(null);
  // Index-aligned with polygons; a missing entry means the default look.
  const [polyStyles,       setPolyStyles]       = useState<PolyStyle[]>([]);
  const [savingPolygon,    setSavingPolygon]    = useState(false);
  const [polygonSaved,     setPolygonSaved]     = useState(false);
  const [saveError,        setSaveError]        = useState<string | null>(null);
  const [importOpen,       setImportOpen]       = useState(false);
  // Bumped to re-frame the map: on switching eruv, and after an import.
  const [fitToken,         setFitToken]         = useState(0);
  const [pushSent,         setPushSent]         = useState<number | null>(null);

  // Segment editing state
  const [segmentMode,  setSegmentMode]  = useState<SegmentMode>('off');
  const [segmentA,     setSegmentA]     = useState<number | null>(null);
  const [segmentB,     setSegmentB]     = useState<number | null>(null);
  const [origSegmentA, setOrigSegmentA] = useState<number | null>(null);

  // Reports tab
  const [reports,   setReports]   = useState<EruvReport[]>([]);
  const [reportTab, setReportTab] = useState<'open' | 'resolved'>('open');

  // Settlement selector — most cities have exactly one eruv and this whole
  // layer is invisible for them (activeEruv just becomes eruvs[0]). A
  // regional council can have several.
  const [eruvs,        setEruvs]        = useState<EruvStatusDoc[]>([]);
  const [activeEruvId, setActiveEruvId] = useState<string | null>(null);
  const [areas,        setAreas]        = useState<AreaOption[]>([]);

  // Create/edit picker — see EruvPicker above.
  const [picker,         setPicker]         = useState<EruvPicker | null>(null);
  const [pickerSelected, setPickerSelected] = useState<Set<string>>(new Set());
  const [pickerLabel,    setPickerLabel]    = useState('');
  const [pickerSaving,   setPickerSaving]   = useState(false);
  const [pickerError,    setPickerError]    = useState<string | null>(null);

  const activeEruv = useMemo(() => eruvs.find(e => e.id === activeEruvId) ?? null, [eruvs, activeEruvId]);

  // All-eruvin view, for a council with more than one: every settlement's
  // boundary on one map, coloured by status, nothing editable. It is where a
  // multi-eruv council starts; clicking an eruv opens it for editing.
  const [showAll, setShowAll] = useState(true);
  const overview = showAll && eruvs.length > 1;
  const overviewRings = useMemo(() => eruvs.flatMap(e => {
    const raw = (e as { polygons?: { points?: { latitude: number; longitude: number }[]; style?: unknown }[] }).polygons ?? [];
    return raw
      .map((poly, i) => ({
        eruv: e,
        key: `${e.id}-${i}`,
        points: (poly.points ?? []).map(p => ({ lat: p.latitude, lng: p.longitude })),
        style: readStyle(poly.style, i),
      }))
      .filter(r => r.points.length >= 3);
  }), [eruvs]);
  const coveredAreaIds = useMemo(() => new Set(eruvs.flatMap(e => e.areaIds ?? [])), [eruvs]);
  const uncoveredAreas = useMemo(() => areas.filter(a => !coveredAreaIds.has(a.id)), [areas, coveredAreaIds]);
  // Areas selectable in the picker: for a new eruv, whatever's uncovered; for
  // editing an existing one, that plus its own current areas (which read as
  // "covered" globally, but must stay checkable so they can be kept or
  // unchecked) — everything covered by ANOTHER eruv stays hidden either way.
  const pickerAvailableAreas = useMemo(() => {
    if (!picker) return [];
    if (picker.mode === 'create') return uncoveredAreas;
    const ownIds = new Set(picker.eruv.areaIds ?? []);
    return areas.filter(a => ownIds.has(a.id) || !coveredAreaIds.has(a.id));
  }, [picker, areas, uncoveredAreas, coveredAreaIds]);
  function eruvLabel(e: EruvStatusDoc | null): string {
    if (!e) return '';
    if (e.label) return e.label;
    const names = e.areaIds.map(id => areas.find(a => a.id === id)?.name).filter(Boolean);
    return names.join(' + ') || 'עירוב';
  }

  const activePoints = activePolygonIdx === null ? [] : (polygons[activePolygonIdx] ?? []);
  const styleOf = (i: number): PolyStyle => polyStyles[i] ?? defaultStyle(i);
  function updateStyle(i: number, patch: Partial<PolyStyle>) {
    setPolyStyles(prev => {
      const next = polygons.map((_, j) => prev[j] ?? defaultStyle(j));
      next[i] = { ...next[i], ...patch };
      return next;
    });
  }

  const updateActivePolygon = useCallback((fn: (pts: EruvCoord[]) => EruvCoord[]) => {
    if (activePolygonIdx === null) return;
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

  // Load this city's areas — for the "add a settlement" picker and for
  // resolving a label-less eruv's display name from its areaIds.
  useEffect(() => {
    if (!cityId) return;
    getDocs(query(collection(db, 'areas'), where('cityId', '==', cityId))).then(snap => {
      setAreas(snap.docs.map(d => {
        const a = d.data() as { name: string; latitude?: number; longitude?: number };
        return { id: d.id, name: a.name, latitude: a.latitude, longitude: a.longitude };
      }));
    });
  }, [cityId]);

  // Live list of this city's eruv(in). Default the selection to the first
  // one once loaded, or to whichever one just got created (handleAddEruv
  // sets activeEruvId itself, so this only fires the FIRST time).
  useEffect(() => {
    if (!cityId) return;
    const q = query(collection(db, 'eruvStatus'), where('cityId', '==', cityId));
    return onSnapshot(q, snap => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }) as EruvStatusDoc);
      setEruvs(list);
      setActiveEruvId(current => current && list.some(e => e.id === current) ? current : (list[0]?.id ?? null));
    });
  }, [cityId]);

  // Sync the status/polygon form state to whichever eruv is now selected.
  useEffect(() => {
    if (!activeEruv) { setStatusValue('unknown'); setNotes(''); setPolygons([[]]); setPolyStyles([]); setActivePolygonIdx(null); return; }
    setStatusValue(activeEruv.status ?? 'unknown');
    setNotes(activeEruv.notes ?? '');
    const d = activeEruv as any;
    // Load polygons — new format: [{points:[...]}, ...]; legacy: flat array of coords
    if (Array.isArray(d.polygons) && d.polygons.length > 0) {
      setPolygons(d.polygons.map((poly: any) =>
        (poly.points ?? []).map((p: any) => ({ lat: p.latitude, lng: p.longitude }))
      ));
      setPolyStyles(d.polygons.map((poly: any, i: number) => readStyle(poly.style, i)));
    } else if (Array.isArray(d.polygon) && d.polygon.length > 0) {
      setPolygons([d.polygon.map((p: any) => ({ lat: p.latitude, lng: p.longitude }))]);
      setPolyStyles([]);
    } else {
      setPolygons([[]]);
      setPolyStyles([]);
    }
  }, [activeEruv]);

  // A different eruv was picked: start with nothing selected and frame it.
  // Keyed on the id, not the document, so a snapshot of the same eruv (after
  // a status save, say) does not drop the selection or move the map. An eruv
  // with no boundary yet gets its one empty ring selected, so the first click
  // on the map starts drawing.
  useEffect(() => {
    if (!activeEruvId) return;
    setActivePolygonIdx(initialSelection(activeEruvId));
    resetSegment();
    setFitToken(t => t + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeEruvId]);

  /** What to select on opening an eruv: nothing when it has a boundary (every
   *  ring shows plain), its one empty ring when it has none, so the first
   *  click on the map starts drawing. */
  function initialSelection(id: string): number | null {
    const d = eruvs.find(e => e.id === id) as { polygons?: unknown[]; polygon?: unknown[] } | undefined;
    const hasBoundary = (d?.polygons?.length ?? 0) > 0 || (d?.polygon?.length ?? 0) > 0;
    return hasBoundary ? null : 0;
  }

  function selectEruv(id: string) {
    setShowAll(false);
    setActiveEruvId(id);
    setActivePolygonIdx(initialSelection(id));
    resetSegment();
    setFitToken(t => t + 1);
  }

  function openOverview() {
    setShowAll(true);
    setActivePolygonIdx(null);
    resetSegment();
    setFitToken(t => t + 1);
  }

  function openCreatePicker() {
    setPicker({ mode: 'create' });
    setPickerSelected(new Set());
    setPickerLabel('');
    setPickerError(null);
  }

  function openEditPicker(eruv: EruvStatusDoc) {
    setPicker({ mode: 'edit', eruv });
    setPickerSelected(new Set(eruv.areaIds ?? []));
    setPickerLabel(eruv.label ?? '');
    setPickerError(null);
  }

  function togglePickerArea(id: string) {
    setPickerSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function handleConfirmPicker() {
    if (!picker || pickerSelected.size === 0) return;
    const areaIds = Array.from(pickerSelected);
    const label = pickerLabel.trim();
    setPickerSaving(true);
    setPickerError(null);
    try {
      if (picker.mode === 'create') {
        const ref = await addDoc(collection(db, 'eruvStatus'), {
          cityId, areaIds, ...(label ? { label } : {}),
          status: 'unknown', updatedBy: appUser?.uid ?? '', updatedAt: serverTimestamp(),
        });
        setActiveEruvId(ref.id);
      } else {
        // Merge so polygons/status on this eruv are left untouched; deleteField
        // clears a label the admin blanked back out, so it falls back to the
        // auto joined-names display again instead of keeping a stale value.
        await setDoc(doc(db, 'eruvStatus', picker.eruv.id), {
          areaIds,
          label: label ? label : deleteField(),
          updatedBy: appUser?.uid ?? '', updatedAt: serverTimestamp(),
        }, { merge: true });
      }
      setPicker(null);
    } catch (e: any) {
      setPickerError(e?.message ?? 'שגיאה בשמירה');
    } finally {
      setPickerSaving(false);
    }
  }

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
    if (segmentMode === 'off' && activePolygonIdx !== null) {
      updateActivePolygon(prev => [...prev, { lat, lng }]);
    }
  }, [segmentMode, segmentA, segmentB, updateActivePolygon, activePolygonIdx]);

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
    if (activePolygonIdx === null) return;
    if (!window.confirm('למחוק את המצולע הנבחר?')) return;
    if (polygons.length <= 1) { setPolygons([[]]); setPolyStyles([]); setActivePolygonIdx(0); resetSegment(); return; }
    setPolygons(polygons.filter((_, i) => i !== activePolygonIdx));
    setPolyStyles(prev => prev.filter((_, i) => i !== activePolygonIdx));
    setActivePolygonIdx(null);
    resetSegment();
  }

  /** Select a ring for editing, or — when it is already selected — put it
   *  back to a plain shape. */
  function togglePolygon(i: number) {
    setActivePolygonIdx(cur => (cur === i ? null : i));
    resetSegment();
  }

  // ─── Save handlers ──────────────────────────────────────────────────────────

  const handleSaveStatus = async () => {
    if (!activeEruvId) return;
    setSavingStatus(true);
    setSaveError(null);
    setPushSent(null);
    try {
      await setDoc(doc(db, 'eruvStatus', activeEruvId), {
        status: statusValue, notes,
        updatedBy: appUser?.uid ?? '',
        updatedAt: serverTimestamp(),
      }, { merge: true });
      setStatusSaved(true);
      setTimeout(() => setStatusSaved(false), 3000);

      // Auto-send push notification for valid/invalid status. areaIds narrows
      // it to this eruv's own settlement(s) — on a single-eruv city that's
      // everyone anyway, since its one area is the whole city.
      if (statusValue !== 'unknown' && city) {
        const count = await sendEruvStatusPush(
          cityId, city.name, statusValue, appUser?.uid ?? '',
          activeEruv?.areaIds, activeEruv?.label,
        );
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
    if (!activeEruvId) return;
    const valid = polygons.map((p, i) => ({ p, i })).filter(({ p }) => p.length >= 3);
    if (valid.length === 0) { alert('יש לסמן לפחות מצולע אחד עם 3 נקודות'); return; }
    setSavingPolygon(true);
    setSaveError(null);
    try {
      await setDoc(doc(db, 'eruvStatus', activeEruvId), {
        polygons: valid.map(({ p, i }) => {
          const st = styleOf(i);
          return {
            points: p.map(pt => ({ latitude: pt.lat, longitude: pt.lng })),
            style: { color: st.color, fillColor: st.fillColor, fillOpacity: st.fillOpacity },
          };
        }),
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
    if (activePolygonIdx === null) return 'לחץ על מצולע במפה כדי לערוך אותו';
    return activePoints.length === 0
      ? 'לחץ על המפה להוסיף נקודות'
      : 'לחץ מפה להוסיף · לחץ נקודה לפעולות · לחץ על המצולע לסיום עריכה';
  })();

  // ─── Derived data ───────────────────────────────────────────────────────────

  const openReports     = reports.filter(r => r.status === 'open');
  const resolvedReports = reports.filter(r => r.status === 'resolved');
  const si              = STATUS_INFO[statusValue];

  const mapCenter: [number, number] = city ? [city.latitude, city.longitude] : [31.77, 35.22];
  // Where to look at an eruv that has no boundary yet: its first settlement.
  const firstArea = areas.find(a => a.id === activeEruv?.areaIds?.[0]);
  const eruvCenter: [number, number] = firstArea?.latitude != null && firstArea?.longitude != null
    ? [firstArea.latitude, firstArea.longitude] : mapCenter;

  const validPolygonCount = polygons.filter(p => p.length >= 3).length;

  return (
    <div className="p-8" dir="rtl">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800">
          עירוב{overview ? ' · כל היישובים' : eruvs.length > 1 && activeEruv ? ` · ${eruvLabel(activeEruv)}` : ''}
        </h1>
        <p className="text-slate-400 text-sm mt-0.5">ניהול גבולות ומצב העירוב</p>
      </div>

      {/* Settlement row — hidden for a plain single-area city. Shown whenever
          there's more than one area at all (not just more than one eruv, or
          uncovered areas left) so a regional council whose settlements are
          already fully assigned into eruvin still has a way to reach the
          edit picker below — otherwise a council with e.g. 2 settlements
          both already in one combined eruv would have no UI left to reach. */}
      {areas.length > 1 && (
        <div className="flex items-center gap-2 flex-wrap mb-6 relative">
          {eruvs.length > 1 && (
            <button onClick={openOverview}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${
                overview ? 'bg-[#1B3A6B] text-white border-[#1B3A6B]' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'
              }`}>
              <MapPin size={12} /> כל העירובים
            </button>
          )}
          {eruvs.map(e => {
            const active = !overview && e.id === activeEruvId;
            const dot = e.status === 'valid' ? 'bg-emerald-500' : e.status === 'invalid' ? 'bg-red-500' : 'bg-amber-400';
            return (
              <div key={e.id}
                className={`flex items-center rounded-full border transition-all ${
                  active ? 'bg-[#1B3A6B] text-white border-[#1B3A6B]' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'
                }`}>
                <button onClick={() => selectEruv(e.id)}
                  className="flex items-center gap-1.5 pr-3 pl-1.5 py-1.5 text-xs font-semibold">
                  <span className={`w-2 h-2 rounded-full ${dot}`} />
                  {eruvLabel(e)}
                </button>
                <button onClick={() => openEditPicker(e)} title="ערוך יישובים"
                  className={`p-1.5 ml-0.5 mr-1.5 rounded-full ${active ? 'hover:bg-white/20' : 'hover:bg-slate-100'}`}>
                  <Pencil size={11} />
                </button>
              </div>
            );
          })}
          {uncoveredAreas.length > 0 && (
            <button onClick={openCreatePicker}
              className="flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold border border-dashed border-blue-400 text-blue-600 hover:bg-blue-50">
              <Plus size={12} /> עירוב חדש
            </button>
          )}
          {picker && (
            <div className="absolute top-full right-0 mt-1 w-72 bg-white rounded-xl border border-slate-200 shadow-lg p-3 z-10">
              <div className="text-xs font-semibold text-slate-700 mb-2">
                {picker.mode === 'edit' ? `עריכת יישובים · ${eruvLabel(picker.eruv)}` : 'עירוב חדש'}
              </div>
              <input value={pickerLabel} onChange={e => setPickerLabel(e.target.value)}
                placeholder="שם תצוגה (אופציונלי)"
                className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg mb-2 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400" />
              <div className="max-h-56 overflow-y-auto space-y-0.5 mb-2">
                {pickerAvailableAreas.length === 0 && (
                  <div className="text-xs text-slate-400 py-2 text-center">אין יישובים זמינים</div>
                )}
                {pickerAvailableAreas.map(a => {
                  const checked = pickerSelected.has(a.id);
                  return (
                    <label key={a.id}
                      className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm text-slate-700 hover:bg-slate-50 cursor-pointer">
                      <input type="checkbox" checked={checked} onChange={() => togglePickerArea(a.id)}
                        className="rounded border-slate-300" />
                      {a.name}
                    </label>
                  );
                })}
              </div>
              {pickerError && <div className="text-xs text-red-600 mb-2">{pickerError}</div>}
              {pickerSelected.size === 0 && (
                <div className="text-xs text-slate-400 mb-2">בחר לפחות יישוב אחד</div>
              )}
              <div className="flex gap-2">
                <button onClick={() => setPicker(null)}
                  className="flex-1 px-3 py-1.5 text-xs font-semibold text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50">
                  ביטול
                </button>
                <button onClick={handleConfirmPicker} disabled={pickerSelected.size === 0 || pickerSaving}
                  className="flex-1 px-3 py-1.5 text-xs font-semibold text-white bg-[#1B3A6B] rounded-lg hover:bg-[#15306a] disabled:opacity-50">
                  {pickerSaving ? 'שומר...' : picker.mode === 'edit' ? 'שמור' : 'צור'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Two columns on a wide screen: status and reports on the right, the
          boundary map always on the left — the map is what an admin checks
          against while doing either, so it no longer hides behind a tab. */}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] items-start">
      <div className="min-w-0">

      {/* Tab bar */}
      <div className="flex gap-1 bg-slate-100 rounded-xl p-1 w-fit mb-6">
        {(['status', 'reports'] as TabKey[]).map(t => {
          const labels: Record<TabKey, string> = { status: 'מצב', reports: 'דיווחים' };
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

      {/* ── מצב, כל העירובים ── */}
      {tab === 'status' && overview && (() => {
        const count = (v: EruvStatusValue) => eruvs.filter(e => (e.status ?? 'unknown') === v).length;
        return (
          <div className="space-y-4">
            <div className="flex gap-2 flex-wrap">
              {(['valid', 'invalid', 'unknown'] as EruvStatusValue[]).map(v => {
                const info = STATUS_INFO[v];
                return (
                  <div key={v} className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-sm font-medium ${info.bg} ${info.color}`}>
                    <info.Icon size={15} /> {info.label}: <span className="tabular-nums">{count(v)}</span>
                  </div>
                );
              })}
            </div>
            <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100">
              {[...eruvs].sort((a, b) => eruvLabel(a).localeCompare(eruvLabel(b), 'he')).map(e => {
                const info = STATUS_INFO[e.status ?? 'unknown'];
                const rings = overviewRings.filter(r => r.eruv.id === e.id).length;
                const updated = e.updatedAt?.toDate?.() as Date | undefined;
                return (
                  <button key={e.id} onClick={() => selectEruv(e.id)}
                    className="w-full flex items-center gap-3 px-4 py-3 text-right hover:bg-slate-50 transition-colors">
                    <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: STATUS_MAP_COLOR[e.status ?? 'unknown'] }} />
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-semibold text-slate-800 truncate">{eruvLabel(e)}</span>
                      <span className="block text-xs text-slate-400">
                        {rings === 0 ? 'אין גבולות' : rings === 1 ? 'מצולע אחד' : `${rings} מצולעים`}
                        {updated ? ` · עודכן ${updated.toLocaleDateString('he-IL')}` : ''}
                      </span>
                    </span>
                    <span className={`text-xs font-semibold ${info.color}`}>{info.label}</span>
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-slate-400">לעדכון מצב או גבולות, בחר עירוב מהרשימה או מהמפה.</p>
          </div>
        );
      })()}

      {/* ── מצב ── */}
      {tab === 'status' && !overview && (
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

          <button onClick={handleSaveStatus} disabled={savingStatus || !activeEruvId}
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

      {/* ── גבולות ── */}
      <div className="min-w-0 space-y-3 xl:sticky xl:top-6">
          {!overview && (<>
          {/* Polygon selector row */}
          <div className="flex items-center gap-2 flex-wrap">
            {polygons.map((poly, i) => {
              const isActive = i === activePolygonIdx;
              const color = styleOf(i).color;
              return (
                <button key={i} onClick={() => togglePolygon(i)}
                  title={isActive ? 'סיום עריכה' : 'עריכת המצולע'}
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
            {polygons.length > 1 && activePolygonIdx !== null && (
              <button onClick={deleteActivePolygon}
                className="flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold border border-red-200 text-red-600 hover:bg-red-50">
                <Trash2 size={12} /> מחק מצולע {(activePolygonIdx ?? 0) + 1}
              </button>
            )}
          </div>

          {/* Look of the selected ring */}
          {activePolygonIdx !== null && (() => {
            const idx = activePolygonIdx;
            const st = styleOf(idx);
            const transparency = Math.round((1 - st.fillOpacity) * 100);
            return (
              <div className="flex items-center gap-x-5 gap-y-2 flex-wrap bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-600">
                <span className="font-semibold text-slate-700">עיצוב מצולע {idx + 1}</span>
                <label className="flex items-center gap-1.5">
                  צבע קו
                  <input type="color" value={st.color}
                    onChange={e => updateStyle(idx, { color: e.target.value })}
                    className="w-7 h-7 rounded cursor-pointer border border-slate-200 bg-white p-0.5" />
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={st.fillColor === null}
                    onChange={e => updateStyle(idx, { fillColor: e.target.checked ? null : st.color })}
                    className="rounded border-slate-300" />
                  מילוי בצבע הקו
                </label>
                {st.fillColor !== null && (
                  <label className="flex items-center gap-1.5">
                    צבע מילוי
                    <input type="color" value={st.fillColor}
                      onChange={e => updateStyle(idx, { fillColor: e.target.value })}
                      className="w-7 h-7 rounded cursor-pointer border border-slate-200 bg-white p-0.5" />
                  </label>
                )}
                <label className="flex items-center gap-2">
                  שקיפות מילוי
                  <input type="range" min={0} max={100} step={5} value={transparency}
                    onChange={e => updateStyle(idx, { fillOpacity: 1 - Number(e.target.value) / 100 })}
                    className="w-28 accent-[#1B3A6B]" />
                  <span className="tabular-nums w-9 text-left">{transparency}%</span>
                </label>
                <button onClick={() => updateStyle(idx, defaultStyle(idx))}
                  className="text-blue-600 hover:underline mr-auto">
                  ברירת מחדל
                </button>
              </div>
            );
          })()}

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

            <div className="flex items-center gap-1 bg-slate-100 rounded-xl p-1">
              <ToolBtn icon={<Upload size={14} />} label="ייבוא מקובץ" active={false}
                disabled={!activeEruvId}
                onClick={() => setImportOpen(true)} />
              <ToolBtn icon={<Download size={14} />} label="ייצוא CSV" active={false}
                disabled={polygons.every(p => p.length === 0)}
                onClick={() => exportEruvPoints(polygons.filter(p => p.length > 0), eruvLabel(activeEruv) || city?.name || 'eruv')} />
            </div>

            {/* Save button */}
            <button onClick={handleSavePolygon} disabled={savingPolygon || validPolygonCount === 0 || !activeEruvId}
              className="flex items-center gap-1.5 px-4 py-1.5 bg-[#1B3A6B] text-white rounded-lg text-xs font-semibold hover:bg-[#15306a] disabled:opacity-50 mr-auto">
              {polygonSaved ? <CheckCircle2 size={13} /> : <Save size={13} />}
              {polygonSaved ? 'נשמר!' : savingPolygon ? 'שומר...' : `שמור (${validPolygonCount} מצולעים)`}
            </button>
          </div>

          </>)}

          {/* Error banner */}
          {saveError && (
            <div className="px-3 py-2 bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg font-medium flex items-center gap-2">
              <XCircle size={13} className="flex-shrink-0" />
              {saveError}
            </div>
          )}

          {/* Hint bar */}
          <div className="px-3 py-2 bg-slate-800/80 text-white text-xs rounded-lg font-medium text-center">
            {overview ? 'כל העירובים · לחץ על עירוב כדי לערוך אותו' : hintText}
          </div>
          {overview && (
            <div className="flex items-center gap-x-4 gap-y-1.5 flex-wrap text-xs text-slate-500">
              {eruvs.map(e => {
                const first = overviewRings.find(r => r.eruv.id === e.id);
                if (!first) return null;
                return (
                  <button key={e.id} onClick={() => selectEruv(e.id)}
                    className="flex items-center gap-1.5 hover:text-slate-800">
                    <span className="w-3 h-3 rounded-sm border"
                      style={{ background: first.style.fillColor ?? first.style.color, borderColor: first.style.color }} />
                    {eruvLabel(e)}
                  </button>
                );
              })}
              {eruvs.length > new Set(overviewRings.map(r => r.eruv.id)).size && (
                <span className="text-slate-400 mr-auto">
                  {eruvs.length - new Set(overviewRings.map(r => r.eruv.id)).size} עירובים בלי גבולות
                </span>
              )}
            </div>
          )}

          {/* Map */}
          {!city ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 flex items-center justify-center text-slate-400 text-sm" style={{ height: MAP_HEIGHT }}>
              טוען מפה...
            </div>
          ) : (
            <div className="rounded-xl overflow-hidden border border-slate-200" style={{ height: MAP_HEIGHT }}>
              <MapContainer center={mapCenter} zoom={14} style={{ height: '100%', width: '100%' }}>
                <FitToPoints token={fitToken}
                  points={overview ? overviewRings.flatMap(r => r.points) : polygons.flat()}
                  fallback={overview ? mapCenter : eruvCenter} />
                <MapTiles defaultSatellite />
                {!overview && (segmentMode === 'off' || segmentMode === 'addPoints') && (
                  <MapClickHandler onAdd={handleMapClick} />
                )}

                {overview && overviewRings.map(r => {
                  const st = r.style;
                  return (
                    <Polygon key={r.key}
                      positions={r.points.map(p => [p.lat, p.lng] as [number, number])}
                      pathOptions={{ color: st.color, fillColor: st.fillColor ?? st.color, fillOpacity: st.fillOpacity, weight: 2.5 }}
                      eventHandlers={{ click: () => selectEruv(r.eruv.id) }}>
                      <Tooltip sticky>
                        {eruvLabel(r.eruv)} · {STATUS_INFO[r.eruv.status ?? 'unknown'].label}
                      </Tooltip>
                    </Polygon>
                  );
                })}

                {!overview && (<>

                {/* Every ring not being edited: a plain filled shape. Clicking one
                    selects it. bubblingMouseEvents off, or the same click would
                    also reach the map and add a point to whatever was selected. */}
                {polygons.map((poly, polyIdx) => {
                  if (polyIdx === activePolygonIdx || poly.length < 3) return null;
                  const st = styleOf(polyIdx);
                  return (
                    <Polygon key={`ring-${polyIdx}`}
                      positions={poly.map(p => [p.lat, p.lng] as [number, number])}
                      pathOptions={{
                        color: st.color, fillColor: st.fillColor ?? st.color, fillOpacity: st.fillOpacity,
                        weight: 2.5, bubblingMouseEvents: false,
                      }}
                      eventHandlers={{ click: () => { if (segmentMode === 'off') togglePolygon(polyIdx); } }} />
                  );
                })}

                {/* The ring being edited: dashed, with its points. Clicking inside
                    it ends editing — except while adding points to a segment,
                    when the click has to reach the map (keyed on the mode, since
                    Leaflet reads bubblingMouseEvents only when the layer is made). */}
                {activePolygonIdx !== null && activePoints.length > 2 && (
                  <Polygon key={`active-${activePolygonIdx}-${segmentMode}`}
                    positions={activePoints.map(p => [p.lat, p.lng] as [number, number])}
                    pathOptions={{
                      color: styleOf(activePolygonIdx).color,
                      fillColor: styleOf(activePolygonIdx).fillColor ?? styleOf(activePolygonIdx).color,
                      fillOpacity: styleOf(activePolygonIdx).fillOpacity, weight: 2.5, dashArray: '7 5',
                      bubblingMouseEvents: segmentMode === 'addPoints',
                    }}
                    eventHandlers={{ click: () => { if (segmentMode === 'off') togglePolygon(activePolygonIdx); } }} />
                )}
                {activePolygonIdx !== null && activePoints.length === 2 && (
                  <Polyline positions={activePoints.map(p => [p.lat, p.lng] as [number, number])}
                    pathOptions={{ color: styleOf(activePolygonIdx).color, weight: 2.5, dashArray: '7 5' }} />
                )}

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
                </>)}
              </MapContainer>
            </div>
          )}
      </div>
      </div>

      <EruvPointsImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        centre={city ? { lat: city.latitude, lng: city.longitude } : undefined}
        hasExisting={polygons.some(p => p.length > 0)}
        onLoad={loaded => {
          setPolygons(loaded);
          setPolyStyles([]);
          setActivePolygonIdx(null);
          resetSegment();
          setFitToken(t => t + 1);
        }}
      />
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
