import 'leaflet/dist/leaflet.css';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { doc, getDoc, updateDoc, serverTimestamp, collection, getDocs, query, where, limit } from 'firebase/firestore';
import { MapContainer, Marker, Tooltip, Polygon, Polyline, CircleMarker, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { Check, Plus, X, Undo2, ArrowRight } from 'lucide-react';
import { db } from '../firebase';
import type { Cemetery } from '../types';
import MapTiles from '../components/MapTiles';
import {
  locateGrave, rectangleFromAxis, totalsFromRegister,
  type GeoPoint, type PlotShape,
} from '../utils/graveLocator';

type Pins = Record<string, { latitude: number; longitude: number }>;
type Shapes = Record<string, PlotShape>;
type Blocks = Record<string, GeoPoint[]>;

/** How the next clicks on the map are read. */
type Mode = 'pin' | 'rect' | 'poly' | 'block';

const BLOCK_SEP = '/';
/** A plot's key: "גוש/חלקה" inside a block, or just the plot's name where the cemetery has no blocks. */
const keyOf = (block: string, plot: string) => (block ? `${block}${BLOCK_SEP}${plot}` : plot);
const splitKey = (key: string) => {
  const i = key.indexOf(BLOCK_SEP);
  return i < 0 ? { block: '', plot: key } : { block: key.slice(0, i), plot: key.slice(i + 1) };
};
const labelOf = (key: string) => {
  const { block, plot } = splitKey(key);
  return block ? `גוש ${block} · חלקה ${plot}` : `חלקה ${plot}`;
};

const pt = (lat: number, lng: number): GeoPoint => ({ latitude: lat, longitude: lng });
const ll = (p: GeoPoint): [number, number] => [p.latitude, p.longitude];

/** A plot's name as a label on the map; the selected one stands out. */
function plotIcon(name: string, selected: boolean) {
  return L.divIcon({
    className: '',
    html: `<div style="transform:translate(-50%,-50%);white-space:nowrap;padding:2px 7px;border-radius:999px;
      font:700 12px system-ui;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4);
      background:${selected ? '#d97706' : '#334155'};color:#fff">${name}</div>`,
  });
}

function ClickToDraw({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({ click: (e) => onPick(e.latlng.lat, e.latlng.lng) });
  return null;
}

const HINTS: Record<Mode, (n: number) => string> = {
  pin: () => 'לחצו על המפה במקום החלקה.',
  rect: (n) => [
    'לחצו על תחילת השורה הראשונה — הקבר הראשון בה.',
    'לחצו על סוף השורה הראשונה — הקבר האחרון בה.',
    'לחצו בצד השני של החלקה, בגובה השורה האחרונה — זה קובע את רוחבה.',
  ][Math.min(n, 2)],
  poly: (n) => (n < 2
    ? ['לחצו על תחילת השורה הראשונה — הקבר הראשון בה.', 'לחצו על סוף השורה הראשונה — הקבר האחרון בה.'][n]
    : 'עכשיו לחצו על פינות החלקה, אחת אחרי השנייה, ולחצו "סיום".'),
  block: () => 'לחצו על פינות הגוש, אחת אחרי השנייה, ולחצו "סיום".',
};

/**
 * Locate each plot (חלקה) of a cemetery on a satellite map — as a point, or as
 * an outline with its rows — so a deceased-search result in the app can navigate
 * to the plot, or right to the row and grave.
 *
 * An outline is drawn in two steps. A line along the plot's first row, from its
 * first grave to its last, gives the rows' direction; then the outline itself:
 * for the usual rectangular plot one more click on the far side sets its width,
 * for anything else you click its corners. Where a cemetery is divided into
 * blocks (גושים) a plot is named by its block and its own number, and a block
 * can be outlined too, to see where each begins.
 *
 * The number of rows and of graves per row comes from the burial register
 * (largest numbers on record for that plot) and can be corrected by hand.
 */
export default function CemeteryPlotsPage() {
  const { cityId = '', id = '' } = useParams<{ cityId: string; id: string }>();
  const navigate = useNavigate();
  const [cemetery, setCemetery] = useState<Cemetery | null>(null);
  const [loaded, setLoaded] = useState(false);
  const back = () => navigate(`/cities/${cityId}/cemeteries`);
  const onClose = back;
  const onSaved = () => {};

  useEffect(() => {
    if (!id) return;
    getDoc(doc(db, 'cemeteries', id)).then((snap) => {
      setCemetery(snap.exists() ? ({ id: snap.id, ...snap.data() } as Cemetery) : null);
      setLoaded(true);
    });
  }, [id]);

  const [pins, setPins] = useState<Pins>({});
  const [shapes, setShapes] = useState<Shapes>({});
  const [blocks, setBlocks] = useState<Blocks>({});
  const [extra, setExtra] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('rect');
  const [draft, setDraft] = useState<GeoPoint[]>([]);
  const [newPlot, setNewPlot] = useState('');
  const [newBlock, setNewBlock] = useState('');
  const [blockName, setBlockName] = useState('');
  const [saving, setSaving] = useState(false);
  // What the register says about the selected plot, and a trial grave to try it on.
  const [registerTotals, setRegisterTotals] = useState<{ rows: number; graves: number } | null>(null);
  const [testRow, setTestRow] = useState('');
  const [testGrave, setTestGrave] = useState('');

  useEffect(() => {
    setPins({ ...(cemetery?.plots ?? {}) });
    setShapes({ ...(cemetery?.plotShapes ?? {}) });
    setBlocks({ ...(cemetery?.blocks ?? {}) });
    setExtra([]);
    setDraft([]);
    setNewPlot('');
    const located = (k: string) => !!(cemetery?.plots?.[k] || cemetery?.plotShapes?.[k]);
    const first = (cemetery?.registerPlots ?? []).find((p) => !located(p));
    setSelected(first ?? cemetery?.registerPlots?.[0] ?? null);
  }, [cemetery]);

  const plots = useMemo(() => {
    const listed = cemetery?.registerPlots ?? [];
    const rest = [...Object.keys(pins), ...Object.keys(shapes), ...extra].filter((p) => !listed.includes(p));
    return [...listed, ...new Set(rest)];
  }, [cemetery, pins, shapes, extra]);

  // The register's grid for the selected plot, read once per selection.
  useEffect(() => {
    setRegisterTotals(null);
    setTestRow('');
    setTestGrave('');
    if (!cemetery || !selected) return;
    let live = true;
    const { block, plot } = splitKey(selected);
    const base = [where('cemeteryId', '==', cemetery.id), where('plot', '==', plot)];
    getDocs(query(collection(db, 'deceased'), ...base, ...(block ? [where('block', '==', block)] : []), limit(3000)))
      .then((snap) => {
        if (live && snap.size > 0) setRegisterTotals(totalsFromRegister(snap.docs.map((d) => d.data() as { row?: string; grave?: string })));
      })
      .catch(() => {});
    return () => { live = false; };
  }, [cemetery, selected]);

  if (!loaded) return <div className="p-8 text-slate-400 text-sm">טוען...</div>;
  if (!cemetery) return <div className="p-8 text-slate-400 text-sm">בית העלמין לא נמצא</div>;
  const center: [number, number] = cemetery.latitude && cemetery.longitude
    ? [cemetery.latitude, cemetery.longitude] : [31.77, 35.21];

  const located = (k: string) => !!(pins[k] || shapes[k]);
  const locatedCount = plots.filter(located).length;
  const shape = selected ? shapes[selected] : undefined;
  const totals = shape
    ? { rows: shape.rows ?? registerTotals?.rows ?? 1, graves: shape.graves ?? registerTotals?.graves ?? 1 }
    : null;

  const nextUnlocated = (from: string) => plots.slice(plots.indexOf(from) + 1).find((p) => !located(p));

  const finishShape = (next: PlotShape) => {
    if (!selected) return;
    // Saved with the grid size, so the app can place a grave without the register.
    const grid = registerTotals ?? undefined;
    setShapes((s) => ({ ...s, [selected]: { rows: grid?.rows, graves: grid?.graves, ...s[selected], ...next } }));
    setDraft([]);
    const after = nextUnlocated(selected);
    if (after) setSelected(after);
  };

  const pick = (lat: number, lng: number) => {
    const p = pt(lat, lng);
    if (mode === 'pin') {
      if (!selected) return;
      const next = { ...pins, [selected]: { latitude: lat, longitude: lng } };
      setPins(next);
      const after = plots.slice(plots.indexOf(selected) + 1).find((q) => !next[q] && !shapes[q]);
      if (after) setSelected(after);
      return;
    }
    if (mode === 'block') { setDraft((d) => [...d, p]); return; }
    if (!selected) return;
    if (mode === 'rect') {
      const next = [...draft, p];
      if (next.length === 3) {
        finishShape({ polygon: rectangleFromAxis(next[0], next[1], next[2]), axisA: next[0], axisB: next[1] });
      } else {
        setDraft(next);
      }
      return;
    }
    setDraft((d) => [...d, p]); // poly: two axis points, then corners
  };

  const finishPolygon = () => {
    if (mode === 'block') {
      if (!blockName.trim() || draft.length < 3) return;
      setBlocks((b) => ({ ...b, [blockName.trim()]: draft }));
      setDraft([]);
      setBlockName('');
      return;
    }
    if (draft.length < 5) return; // axis (2) + at least 3 corners
    finishShape({ polygon: draft.slice(2), axisA: draft[0], axisB: draft[1] });
  };

  const clear = (k: string) => {
    setPins((p) => { const n = { ...p }; delete n[k]; return n; });
    setShapes((s) => { const n = { ...s }; delete n[k]; return n; });
  };

  const addPlot = () => {
    const name = newPlot.trim();
    if (!name) return;
    const k = keyOf(newBlock.trim(), name);
    if (!plots.includes(k)) setExtra((e) => [...e, k]);
    setSelected(k);
    setNewPlot('');
  };

  const setCount = (field: 'rows' | 'graves', v: string) => {
    if (!selected) return;
    const n = parseInt(v, 10);
    setShapes((s) => ({ ...s, [selected]: { ...s[selected], [field]: Number.isFinite(n) && n > 0 ? n : undefined } }));
  };

  const trial = shape && totals && testRow && testGrave ? locateGrave(shape, testRow, testGrave, totals) : null;

  const save = async () => {
    setSaving(true);
    try {
      // A JSON round-trip drops the grid sizes still undefined, which Firestore refuses.
      const clean = JSON.parse(JSON.stringify(shapes));
      await updateDoc(doc(db, 'cemeteries', cemetery.id), {
        plots: pins, plotShapes: clean, blocks, updatedAt: serverTimestamp(),
      });
      onSaved();
      onClose();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'שגיאה בשמירה');
    } finally {
      setSaving(false);
    }
  };

  const MODES: { key: Mode; label: string }[] = [
    { key: 'rect', label: 'חלקה מלבנית' },
    { key: 'poly', label: 'חלקה בצורה חופשית' },
    { key: 'pin', label: 'נקודה בלבד' },
    { key: 'block', label: 'גוש' },
  ];

  return (
    <div dir="rtl" className="h-full min-h-[640px] flex flex-col gap-3 p-5">
      <div className="flex items-center gap-3">
        <button onClick={back} className="p-2 rounded-xl hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors" title="חזרה">
          <ArrowRight size={18} />
        </button>
        <div>
          <h1 className="text-xl font-bold text-slate-800">מיקום חלקות</h1>
          <p className="text-sm text-slate-400">{cemetery.name}</p>
        </div>
      </div>
      <div className="flex flex-col gap-3 flex-1 min-h-0">
        <div className="flex flex-wrap items-center gap-2">
          {MODES.map((m) => (
            <button
              key={m.key}
              onClick={() => { setMode(m.key); setDraft([]); }}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                mode === m.key ? 'bg-slate-700 border-slate-700 text-white' : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'}`}
            >{m.label}</button>
          ))}
          <span className="text-sm text-amber-800 font-medium mr-2">
            {mode === 'block' ? HINTS.block(draft.length) : (selected ? HINTS[mode](draft.length) : 'בחרו חלקה מהרשימה')}
          </span>
          {draft.length > 0 && (
            <span className="flex items-center gap-1.5 mr-auto">
              <button onClick={() => setDraft((d) => d.slice(0, -1))} className="flex items-center gap-1 text-xs text-slate-600 border border-slate-200 rounded-lg px-2 py-1 hover:bg-slate-50">
                <Undo2 size={12} /> בטל נקודה
              </button>
              {(mode === 'poly' || mode === 'block') && (
                <button
                  onClick={finishPolygon}
                  disabled={mode === 'block' ? draft.length < 3 || !blockName.trim() : draft.length < 5}
                  className="text-xs font-semibold bg-slate-700 text-white rounded-lg px-3 py-1 disabled:opacity-40"
                >סיום</button>
              )}
            </span>
          )}
        </div>
        {mode === 'block' && (
          <input
            value={blockName}
            onChange={(e) => setBlockName(e.target.value)}
            placeholder="שם הגוש (למשל 01)"
            className="w-56 border border-slate-200 rounded-lg px-3 py-1.5 text-sm"
          />
        )}

        <div className="flex gap-3 flex-1 min-h-[420px]">
          <div className="w-52 shrink-0 flex flex-col border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-3 py-2 text-xs font-semibold text-slate-500 bg-slate-50 border-b border-slate-200">
              {locatedCount} מתוך {plots.length} חלקות סומנו
            </div>
            <div className="flex-1 overflow-y-auto">
              {plots.length === 0 && (
                <p className="p-3 text-xs text-slate-400">אין רשימת חלקות. הוסיפו חלקה למטה.</p>
              )}
              {plots.map((p) => (
                <div
                  key={p}
                  className={`flex items-center justify-between px-3 py-1.5 text-sm cursor-pointer border-b border-slate-100
                    ${p === selected ? 'bg-amber-50 font-bold text-amber-800' : 'hover:bg-slate-50 text-slate-700'}`}
                  onClick={() => { setSelected(p); setDraft([]); if (mode === 'block') setMode('rect'); }}
                >
                  <span>{labelOf(p)}</span>
                  {located(p) ? (
                    <span className="flex items-center gap-1">
                      <Check size={14} className="text-green-600" />
                      <button
                        title="הסר מיקום"
                        onClick={(e) => { e.stopPropagation(); clear(p); }}
                        className="text-slate-300 hover:text-red-500"
                      ><X size={13} /></button>
                    </span>
                  ) : null}
                </div>
              ))}
              {Object.keys(blocks).length > 0 && (
                <div className="px-3 py-2 text-xs text-slate-400 border-t border-slate-100">
                  גושים מסומנים:{' '}
                  {Object.keys(blocks).map((b) => (
                    <button key={b} title="הסר גוש" onClick={() => setBlocks((x) => { const n = { ...x }; delete n[b]; return n; })}
                      className="inline-flex items-center gap-0.5 mx-0.5 px-1.5 rounded bg-slate-100 text-slate-600 hover:text-red-500">
                      {b}<X size={10} />
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="p-2 border-t border-slate-200 space-y-1">
              <input
                value={newBlock}
                onChange={(e) => setNewBlock(e.target.value)}
                placeholder="גוש (אופציונלי)"
                className="w-full min-w-0 border border-slate-200 rounded-lg px-2 py-1 text-xs"
              />
              <div className="flex gap-1">
                <input
                  value={newPlot}
                  onChange={(e) => setNewPlot(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') addPlot(); }}
                  placeholder="חלקה נוספת"
                  className="w-full min-w-0 border border-slate-200 rounded-lg px-2 py-1 text-sm"
                />
                <button onClick={addPlot} className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200" title="הוסף">
                  <Plus size={14} />
                </button>
              </div>
            </div>
          </div>

          <div className="flex-1 rounded-xl overflow-hidden border border-slate-200">
            <MapContainer center={center} zoom={18} maxZoom={21} className="w-full h-full">
              <MapTiles defaultSatellite />
              <ClickToDraw onPick={pick} />

              {Object.entries(blocks).map(([b, poly]) => (
                <Polygon key={`b-${b}`} positions={poly.map(ll)} pathOptions={{ color: '#0f766e', weight: 3, fillOpacity: 0.04 }}>
                  <Tooltip permanent direction="center">גוש {b}</Tooltip>
                </Polygon>
              ))}
              {Object.entries(shapes).map(([k, sh]) => (
                <Polygon
                  key={`s-${k}`}
                  positions={sh.polygon.map(ll)}
                  pathOptions={{ color: k === selected ? '#d97706' : '#16a34a', weight: k === selected ? 3 : 2, fillOpacity: k === selected ? 0.25 : 0.15 }}
                  eventHandlers={{ click: () => setSelected(k) }}
                >
                  <Tooltip permanent direction="center">{splitKey(k).plot}</Tooltip>
                </Polygon>
              ))}
              {shape && <Polyline positions={[ll(shape.axisA), ll(shape.axisB)]} pathOptions={{ color: '#fff', weight: 3, dashArray: '6 6' }} />}
              {shape && (
                <CircleMarker center={ll(shape.axisA)} radius={5} pathOptions={{ color: '#fff', fillColor: '#16a34a', fillOpacity: 1 }}>
                  <Tooltip>קבר ראשון</Tooltip>
                </CircleMarker>
              )}
              {trial && (
                <CircleMarker center={ll(trial)} radius={7} pathOptions={{ color: '#fff', weight: 2, fillColor: '#dc2626', fillOpacity: 1 }}>
                  <Tooltip permanent>שורה {testRow} · קבר {testGrave}</Tooltip>
                </CircleMarker>
              )}

              {plots.filter((p) => pins[p] && !shapes[p]).map((p) => (
                <Marker
                  key={p}
                  position={ll(pins[p])}
                  icon={plotIcon(splitKey(p).plot, p === selected)}
                  eventHandlers={{ click: () => setSelected(p) }}
                >
                  <Tooltip direction="top">{labelOf(p)}</Tooltip>
                </Marker>
              ))}

              {draft.length > 0 && <Polyline positions={draft.map(ll)} pathOptions={{ color: '#f59e0b', weight: 3 }} />}
              {draft.map((p, i) => (
                <CircleMarker key={i} center={ll(p)} radius={4} pathOptions={{ color: '#fff', fillColor: '#f59e0b', fillOpacity: 1 }} />
              ))}
            </MapContainer>
          </div>
        </div>

        {/* The selected plot's grid, and a trial grave to check it on the map */}
        {shape && totals && (
          <div className="flex flex-wrap items-end gap-4 border border-slate-200 rounded-xl px-4 py-3 bg-slate-50">
            <div>
              <div className="text-xs font-semibold text-slate-500 mb-1">שורות בחלקה</div>
              <input type="number" min={1} value={shape.rows ?? ''} placeholder={registerTotals ? String(registerTotals.rows) : ''}
                onChange={(e) => setCount('rows', e.target.value)} className="w-20 border border-slate-200 rounded-lg px-2 py-1 text-sm text-center" />
            </div>
            <div>
              <div className="text-xs font-semibold text-slate-500 mb-1">קברים בשורה</div>
              <input type="number" min={1} value={shape.graves ?? ''} placeholder={registerTotals ? String(registerTotals.graves) : ''}
                onChange={(e) => setCount('graves', e.target.value)} className="w-20 border border-slate-200 rounded-lg px-2 py-1 text-sm text-center" />
            </div>
            <p className="text-xs text-slate-400 max-w-[220px]">
              {registerTotals
                ? `לפי הרישום: ${registerTotals.rows} שורות, עד ${registerTotals.graves} קברים. אפשר לתקן אם החלקה גדולה יותר.`
                : 'אין רישום נפטרים לחלקה זו — מלאו את המספרים.'}
            </p>
            <div className="mr-auto flex items-end gap-2">
              <div>
                <div className="text-xs font-semibold text-slate-500 mb-1">בדיקה: שורה</div>
                <input value={testRow} onChange={(e) => setTestRow(e.target.value)} className="w-16 border border-slate-200 rounded-lg px-2 py-1 text-sm text-center" />
              </div>
              <div>
                <div className="text-xs font-semibold text-slate-500 mb-1">קבר</div>
                <input value={testGrave} onChange={(e) => setTestGrave(e.target.value)} className="w-16 border border-slate-200 rounded-lg px-2 py-1 text-sm text-center" />
              </div>
              <span className="text-xs text-slate-400 pb-1.5">{trial ? 'מסומן באדום במפה' : 'הקלידו שורה וקבר כדי לראות איפה האפליקציה תנווט'}</span>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between">
          <span className="text-sm text-slate-500">
            {selected ? <>מסמנים כעת: <b className="text-amber-700">{labelOf(selected)}</b></> : 'בחרו חלקה מהרשימה'}
          </span>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 rounded-lg border border-slate-200 text-sm hover:bg-slate-50">ביטול</button>
            <button
              onClick={save}
              disabled={saving}
              className="px-5 py-2 rounded-lg bg-slate-700 hover:bg-slate-800 text-white text-sm font-semibold disabled:opacity-50"
            >
              {saving ? 'שומר...' : 'שמור מיקומים'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
