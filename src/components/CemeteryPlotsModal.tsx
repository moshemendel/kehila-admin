import 'leaflet/dist/leaflet.css';
import { useEffect, useMemo, useState } from 'react';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { MapContainer, Marker, Tooltip, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { Check, Plus, X } from 'lucide-react';
import { db } from '../firebase';
import type { Cemetery } from '../types';
import Modal from './Modal';
import MapTiles from './MapTiles';

type Pins = Record<string, { latitude: number; longitude: number }>;

/** A plot's name as a label on the map; the selected one stands out. */
function plotIcon(name: string, selected: boolean) {
  return L.divIcon({
    className: '',
    html: `<div style="transform:translate(-50%,-50%);white-space:nowrap;padding:2px 7px;border-radius:999px;
      font:700 12px system-ui;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4);
      background:${selected ? '#d97706' : '#334155'};color:#fff">${name}</div>`,
  });
}

function ClickToPin({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({ click: (e) => onPick(e.latlng.lat, e.latlng.lng) });
  return null;
}

/**
 * Pin each plot (חלקה) of a cemetery on a satellite map, so a deceased-search
 * result in the app can navigate to the plot itself rather than the gate.
 *
 * The list is the plot names the burial register uses (registerPlots, kept up
 * to date by the weekly sync), plus any already pinned or added by hand for a
 * cemetery without a register. Pick a plot, click the map; the selection then
 * moves to the next plot without a pin, so a whole cemetery is a run of clicks.
 */
export default function CemeteryPlotsModal({ cemetery, onClose, onSaved }: {
  cemetery: Cemetery | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [pins, setPins] = useState<Pins>({});
  const [extra, setExtra] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [newPlot, setNewPlot] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setPins({ ...(cemetery?.plots ?? {}) });
    setExtra([]);
    setNewPlot('');
    const first = (cemetery?.registerPlots ?? []).find((p) => !cemetery?.plots?.[p]);
    setSelected(first ?? cemetery?.registerPlots?.[0] ?? null);
  }, [cemetery]);

  const plots = useMemo(() => {
    const listed = cemetery?.registerPlots ?? [];
    const rest = [...Object.keys(pins), ...extra].filter((p) => !listed.includes(p));
    return [...listed, ...new Set(rest)];
  }, [cemetery, pins, extra]);

  if (!cemetery) return null;
  const center: [number, number] = cemetery.latitude && cemetery.longitude
    ? [cemetery.latitude, cemetery.longitude] : [31.77, 35.21];
  const pinnedCount = plots.filter((p) => pins[p]).length;

  const pick = (lat: number, lng: number) => {
    if (!selected) return;
    const next = { ...pins, [selected]: { latitude: lat, longitude: lng } };
    setPins(next);
    const after = plots.slice(plots.indexOf(selected) + 1).find((p) => !next[p]);
    if (after) setSelected(after);
  };

  const clear = (p: string) => {
    const next = { ...pins };
    delete next[p];
    setPins(next);
  };

  const addPlot = () => {
    const name = newPlot.trim();
    if (!name) return;
    if (!plots.includes(name)) setExtra((e) => [...e, name]);
    setSelected(name);
    setNewPlot('');
  };

  const save = async () => {
    setSaving(true);
    try {
      await updateDoc(doc(db, 'cemeteries', cemetery.id), { plots: pins, updatedAt: serverTimestamp() });
      onSaved();
      onClose();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'שגיאה בשמירה');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open title={`מיקום חלקות — ${cemetery.name}`} onClose={onClose} size="xl">
      <div dir="rtl" className="space-y-3">
        <p className="text-sm text-slate-500">
          בחרו חלקה ולחצו על המפה במקום שלה. אחרי כל לחיצה עוברים לחלקה הבאה שאין לה מיקום.
          באפליקציה, תוצאת חיפוש נפטר בחלקה שסומנה תנווט לחלקה עצמה.
        </p>
        <div className="flex gap-3 h-[60vh] min-h-[380px]">
          <div className="w-44 shrink-0 flex flex-col border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-3 py-2 text-xs font-semibold text-slate-500 bg-slate-50 border-b border-slate-200">
              {pinnedCount} מתוך {plots.length} חלקות סומנו
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
                  onClick={() => setSelected(p)}
                >
                  <span>חלקה {p}</span>
                  {pins[p] ? (
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
            </div>
            <div className="flex gap-1 p-2 border-t border-slate-200">
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

          <div className="flex-1 rounded-xl overflow-hidden border border-slate-200">
            <MapContainer center={center} zoom={18} maxZoom={21} className="w-full h-full">
              <MapTiles defaultSatellite />
              <ClickToPin onPick={pick} />
              {plots.filter((p) => pins[p]).map((p) => (
                <Marker
                  key={p}
                  position={[pins[p].latitude, pins[p].longitude]}
                  icon={plotIcon(p, p === selected)}
                  eventHandlers={{ click: () => setSelected(p) }}
                >
                  <Tooltip direction="top">חלקה {p}</Tooltip>
                </Marker>
              ))}
            </MapContainer>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-sm text-slate-500">
            {selected ? <>מסמנים כעת: <b className="text-amber-700">חלקה {selected}</b></> : 'בחרו חלקה מהרשימה'}
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
    </Modal>
  );
}
