import 'leaflet/dist/leaflet.css';
import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { doc, getDoc, updateDoc, serverTimestamp, arrayUnion } from 'firebase/firestore';
import { db } from '../firebase';
import type {
  Synagogue, PrayerTimeSlot, ZmanimAnchor,
  WeeklySchedule, ShabbatSchedule, Shiur, SynagogueAnnouncement, SynagogueEventCategory,
  NusachOption,
} from '../types';
import Modal from '../components/Modal';
import { ArrowRight, Plus, Trash2, Save, Pencil, MapPin } from 'lucide-react';
import { MapContainer, TileLayer, Marker, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { useMapSync } from '../contexts/MapSyncContext';
import { useAuth } from '../contexts/AuthContext';
import { nanoid } from '../utils/nanoid';

// ─── Constants ────────────────────────────────────────────────────────────────


const WEEKDAYS = [
  { num: 1, label: 'א׳' }, { num: 2, label: 'ב׳' }, { num: 3, label: 'ג׳' },
  { num: 4, label: 'ד׳' }, { num: 5, label: 'ה׳' }, { num: 6, label: 'ו׳' },
];
const ALL_DAYS = [...WEEKDAYS, { num: 7, label: 'ש׳' }];

const ANCHORS: { key: ZmanimAnchor; label: string }[] = [
  { key: 'netz', label: 'הנץ' }, { key: 'shkia', label: 'שקיעה' },
  { key: 'chatzot', label: 'חצות' }, { key: 'plagHamincha', label: 'פלג המנחה' },
  { key: 'minchaGedola', label: 'מנחה גדולה' }, { key: 'minchaKetana', label: 'מנחה קטנה' },
];

const PRAYER_TYPES: { key: keyof WeeklySchedule & string; label: string; color: string }[] = [
  { key: 'shacharit', label: 'שחרית', color: 'text-orange-600 bg-orange-50 border-orange-200' },
  { key: 'mincha',    label: 'מנחה',  color: 'text-blue-600 bg-blue-50 border-blue-200' },
  { key: 'maariv',   label: 'ערבית', color: 'text-indigo-600 bg-indigo-50 border-indigo-200' },
];

const SHABBAT_TYPES: { key: keyof ShabbatSchedule & string; label: string; color: string }[] = [
  { key: 'minchaFriday', label: 'מנחה ע"ש', color: 'text-amber-600 bg-amber-50 border-amber-200' },
  { key: 'shacharit',    label: 'שחרית',     color: 'text-orange-600 bg-orange-50 border-orange-200' },
  { key: 'mincha',       label: 'מנחה',      color: 'text-blue-600 bg-blue-50 border-blue-200' },
  { key: 'maariv',       label: 'ערבית',     color: 'text-indigo-600 bg-indigo-50 border-indigo-200' },
];

const EVENT_CATEGORIES: { key: SynagogueEventCategory; label: string }[] = [
  { key: 'announcement', label: 'הודעה' }, { key: 'alert', label: 'דחוף' },
  { key: 'shiur', label: 'שיעור' }, { key: 'community', label: 'קהילה' },
  { key: 'youth', label: 'נוער' }, { key: 'charity', label: 'צדקה' }, { key: 'holiday', label: 'חגים' },
];

// ─── Slot label helper ────────────────────────────────────────────────────────
function slotLabel(s: PrayerTimeSlot) {
  if (s.anchor) {
    const a = ANCHORS.find(x => x.key === s.anchor)?.label ?? s.anchor;
    if (!s.offsetMin) return a;
    const suffix = s.proportional ? 'ז׳' : '׳';
    return `${a} ${s.offsetMin > 0 ? '+' : ''}${s.offsetMin}${suffix}`;
  }
  return s.time || '—';
}

function daysLabel(days: number[] | undefined, all: typeof ALL_DAYS) {
  if (!days || days.length === all.length) return 'כל הימים';
  return days.map(d => all.find(x => x.num === d)?.label ?? d).join(' ');
}

// ─── Slot edit modal ──────────────────────────────────────────────────────────
function SlotModal({
  open, slot, onSave, onClose, hideWeekdays = false,
}: {
  open: boolean;
  slot: PrayerTimeSlot | null;
  onSave: (s: PrayerTimeSlot) => void;
  onClose: () => void;
  hideWeekdays?: boolean;
}) {
  const dayOptions = hideWeekdays ? [] : WEEKDAYS;
  const [mode, setMode] = useState<'fixed' | 'anchor'>('fixed');
  const [time, setTime] = useState('');
  const [anchor, setAnchor] = useState<ZmanimAnchor>('shkia');
  const [offset, setOffset] = useState(0);
  const [proportional, setProportional] = useState(false);
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5, 6]);
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (!open) return;
    if (slot) {
      setMode(slot.anchor ? 'anchor' : 'fixed');
      setTime(slot.time || '');
      setAnchor(slot.anchor ?? 'shkia');
      setOffset(slot.offsetMin ?? 0);
      setProportional(slot.proportional ?? false);
      setDays(slot.days ?? [1, 2, 3, 4, 5, 6]);
      setNotes(slot.notes ?? '');
    } else {
      setMode('fixed'); setTime(''); setAnchor('shkia'); setOffset(0);
      setProportional(false); setDays([1, 2, 3, 4, 5, 6]); setNotes('');
    }
  }, [open, slot]);

  const toggleDay = (d: number) =>
    setDays(p => p.includes(d) ? p.filter(x => x !== d) : [...p, d].sort((a, b) => a - b));

  const handleSave = () => {
    const s: PrayerTimeSlot = {
      time: mode === 'fixed' ? time : '',
      ...(mode === 'anchor' ? { anchor, offsetMin: offset, proportional: proportional || undefined } : {}),
      ...(!hideWeekdays ? { days } : {}),
      ...(notes ? { notes } : {}),
    };
    onSave(s);
    onClose();
  };

  const valid = mode === 'fixed' ? /^\d{1,2}:\d{2}$/.test(time) : true;

  return (
    <Modal open={open} title={slot ? 'עריכת זמן' : 'הוספת זמן'} onClose={onClose} size="md">
      <div className="flex flex-col gap-4">
        {/* Mode toggle */}
        <div className="flex rounded-lg border border-slate-200 overflow-hidden">
          {(['fixed', 'anchor'] as const).map(m => (
            <button key={m} onClick={() => setMode(m)}
              className={`flex-1 py-2 text-sm font-medium transition-colors ${mode === m ? 'bg-[#1B3A6B] text-white' : 'text-slate-500 hover:bg-slate-50'}`}>
              {m === 'fixed' ? 'זמן קבוע' : 'יחסי לזמן הלכתי'}
            </button>
          ))}
        </div>

        {mode === 'fixed' ? (
          <div>
            <label className={lbl}>שעה (HH:MM)</label>
            <input value={time} onChange={e => setTime(e.target.value)} placeholder="07:30" className={inp} />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={lbl}>עוגן</label>
                <select value={anchor} onChange={e => setAnchor(e.target.value as ZmanimAnchor)} className={inp}>
                  {ANCHORS.map(a => <option key={a.key} value={a.key}>{a.label}</option>)}
                </select>
              </div>
              <div>
                <label className={lbl}>הפרש (דקות, שלילי = לפני)</label>
                <input type="number" value={offset} onChange={e => setOffset(parseInt(e.target.value) || 0)} className={inp} />
              </div>
            </div>
            {/* Minute type toggle */}
            <div>
              <label className={lbl}>סוג דקות</label>
              <div className="flex rounded-lg border border-slate-200 overflow-hidden">
                {([false, true] as const).map(isProportional => (
                  <button
                    key={String(isProportional)}
                    type="button"
                    onClick={() => setProportional(isProportional)}
                    className={`flex-1 py-2 text-sm font-medium transition-colors ${proportional === isProportional ? 'bg-[#1B3A6B] text-white' : 'text-slate-500 hover:bg-slate-50'}`}
                  >
                    {isProportional ? 'דקות זמניות' : 'דקות שוות'}
                  </button>
                ))}
              </div>
              {proportional && (
                <p className="text-xs text-slate-400 mt-1">דקה זמנית = שעה זמנית ÷ 60 (משתנה לפי עונה)</p>
              )}
            </div>
          </>
        )}

        {!hideWeekdays && dayOptions.length > 0 && (
          <div>
            <label className={lbl}>ימים</label>
            <div className="flex gap-2 flex-wrap">
              {dayOptions.map(d => (
                <button key={d.num} onClick={() => toggleDay(d.num)}
                  className={`w-9 h-9 rounded-full text-sm font-bold border transition-colors ${days.includes(d.num) ? 'bg-[#1B3A6B] text-white border-[#1B3A6B]' : 'border-slate-200 text-slate-500 hover:border-slate-400'}`}>
                  {d.label}
                </button>
              ))}
              <button onClick={() => setDays(dayOptions.map(d => d.num))}
                className="px-3 h-9 rounded-full text-xs text-slate-500 border border-slate-200 hover:bg-slate-50">כל</button>
              <button onClick={() => setDays([])}
                className="px-3 h-9 rounded-full text-xs text-slate-500 border border-slate-200 hover:bg-slate-50">נקה</button>
            </div>
          </div>
        )}

        <div>
          <label className={lbl}>הערה (אופציונלי)</label>
          <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="למשל: קבלת שבת בקיץ" className={inp} />
        </div>

        <div className="flex gap-3 pt-2">
          <button onClick={handleSave} disabled={!valid}
            className="flex-1 bg-[#1B3A6B] text-white py-2.5 rounded-xl font-semibold text-sm hover:bg-[#15306a] disabled:opacity-50">
            שמור
          </button>
          <button onClick={onClose} className="px-5 py-2.5 border border-slate-200 rounded-xl text-sm hover:bg-slate-50">ביטול</button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Prayer section (one prayer type) ────────────────────────────────────────
function PrayerSection({
  label, color, slots, onChange, hideWeekdays = false,
}: {
  label: string; color: string; slots: PrayerTimeSlot[];
  onChange: (s: PrayerTimeSlot[]) => void;
  hideWeekdays?: boolean;
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const [editIdx, setEditIdx] = useState<number | null>(null);

  const openAdd = () => { setEditIdx(null); setModalOpen(true); };
  const openEdit = (i: number) => { setEditIdx(i); setModalOpen(true); };
  const handleSave = (s: PrayerTimeSlot) => {
    if (editIdx === null) onChange([...slots, s]);
    else onChange(slots.map((x, i) => (i === editIdx ? s : x)));
  };
  const remove = (i: number) => onChange(slots.filter((_, j) => j !== i));

  return (
    <div className={`rounded-xl border ${color} p-4`}>
      <div className="flex items-center justify-between mb-3">
        <span className="font-bold text-sm">{label}</span>
        <button onClick={openAdd} className="flex items-center gap-1 text-xs font-medium opacity-70 hover:opacity-100">
          <Plus size={13} /> הוסף זמן
        </button>
      </div>
      {slots.length === 0 && <p className="text-xs opacity-50 italic">אין זמנים</p>}
      <div className="flex flex-col gap-2">
        {slots.map((s, i) => (
          <div key={i} className="flex items-center justify-between bg-white/70 rounded-lg px-3 py-2">
            <div>
              <span className="text-sm font-semibold">{slotLabel(s)}</span>
              {!hideWeekdays && s.days && s.days.length < 6 && (
                <span className="text-xs opacity-60 mr-2">{daysLabel(s.days, WEEKDAYS)}</span>
              )}
              {s.notes && <span className="text-xs opacity-60 mr-2">· {s.notes}</span>}
            </div>
            <div className="flex gap-1">
              <button onClick={() => openEdit(i)} className="p-1 rounded hover:bg-black/5 opacity-50 hover:opacity-100"><Pencil size={12} /></button>
              <button onClick={() => remove(i)} className="p-1 rounded hover:bg-red-50 text-red-500 opacity-50 hover:opacity-100"><Trash2 size={12} /></button>
            </div>
          </div>
        ))}
      </div>
      <SlotModal
        open={modalOpen} slot={editIdx !== null ? slots[editIdx] : null}
        onSave={handleSave} onClose={() => setModalOpen(false)}
        hideWeekdays={hideWeekdays}
      />
    </div>
  );
}

// ─── Shiur modal ──────────────────────────────────────────────────────────────
function ShiurModal({ open, shiur, onSave, onClose }: {
  open: boolean; shiur: Shiur | null;
  onSave: (s: Shiur) => void; onClose: () => void;
}) {
  const [title, setTitle] = useState('');
  const [rabbi, setRabbi] = useState('');
  const [time, setTime] = useState('');
  const [daily, setDaily] = useState(false);
  const [days, setDays] = useState<number[]>([]);
  const [desc, setDesc] = useState('');

  useEffect(() => {
    if (!open) return;
    if (shiur) {
      setTitle(shiur.title); setRabbi(shiur.rabbi); setTime(shiur.time);
      setDaily(shiur.days === 'daily');
      setDays(Array.isArray(shiur.days) ? shiur.days : []);
      setDesc(shiur.description ?? '');
    } else {
      setTitle(''); setRabbi(''); setTime(''); setDaily(false); setDays([]); setDesc('');
    }
  }, [open, shiur]);

  const toggleDay = (d: number) =>
    setDays(p => p.includes(d) ? p.filter(x => x !== d) : [...p, d].sort((a, b) => a - b));

  const handleSave = () => {
    onSave({ id: shiur?.id ?? nanoid(), title, rabbi, time, days: daily ? 'daily' : days, description: desc || undefined });
    onClose();
  };

  return (
    <Modal open={open} title={shiur ? 'עריכת שיעור' : 'הוספת שיעור'} onClose={onClose} size="md">
      <div className="flex flex-col gap-4">
        <div>
          <label className={lbl}>כותרת *</label>
          <input value={title} onChange={e => setTitle(e.target.value)} className={inp} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={lbl}>שם הרב</label>
            <input value={rabbi} onChange={e => setRabbi(e.target.value)} className={inp} />
          </div>
          <div>
            <label className={lbl}>שעה</label>
            <input value={time} onChange={e => setTime(e.target.value)} placeholder="20:00" className={inp} />
          </div>
        </div>
        <div>
          <div className="flex items-center gap-3 mb-2">
            <input type="checkbox" id="daily" checked={daily} onChange={e => setDaily(e.target.checked)} className="w-4 h-4 accent-blue-600" />
            <label htmlFor="daily" className={lbl + ' mb-0 cursor-pointer'}>יומי</label>
          </div>
          {!daily && (
            <div className="flex gap-2 flex-wrap">
              {ALL_DAYS.map(d => (
                <button key={d.num} onClick={() => toggleDay(d.num)}
                  className={`w-9 h-9 rounded-full text-sm font-bold border transition-colors ${days.includes(d.num) ? 'bg-[#1B3A6B] text-white border-[#1B3A6B]' : 'border-slate-200 text-slate-500 hover:border-slate-400'}`}>
                  {d.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <div>
          <label className={lbl}>תיאור (אופציונלי)</label>
          <textarea value={desc} onChange={e => setDesc(e.target.value)} rows={2} className={`${inp} resize-none`} />
        </div>
        <div className="flex gap-3 pt-2">
          <button onClick={handleSave} disabled={!title.trim()}
            className="flex-1 bg-[#1B3A6B] text-white py-2.5 rounded-xl font-semibold text-sm hover:bg-[#15306a] disabled:opacity-50">
            שמור
          </button>
          <button onClick={onClose} className="px-5 py-2.5 border border-slate-200 rounded-xl text-sm hover:bg-slate-50">ביטול</button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Announcement modal ───────────────────────────────────────────────────────
function AnnouncementModal({ open, item, onSave, onClose }: {
  open: boolean; item: SynagogueAnnouncement | null;
  onSave: (a: SynagogueAnnouncement) => void; onClose: () => void;
}) {
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [category, setCategory] = useState<SynagogueEventCategory>('announcement');
  const [startDate, setStartDate] = useState('');
  const [location, setLocation] = useState('');
  const [isAlert, setIsAlert] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (item) {
      setTitle(item.title); setDesc(item.description); setCategory(item.category);
      setStartDate(item.startDate ? item.startDate.slice(0, 16) : '');
      setLocation(item.location ?? ''); setIsAlert(item.isAlert);
    } else {
      setTitle(''); setDesc(''); setCategory('announcement'); setStartDate(''); setLocation(''); setIsAlert(false);
    }
  }, [open, item]);

  const handleSave = () => {
    onSave({ id: item?.id ?? nanoid(), title, description: desc, category, startDate, location: location || undefined, isAlert, createdAt: item?.createdAt ?? new Date().toISOString() });
    onClose();
  };

  return (
    <Modal open={open} title={item ? 'עריכת הודעה' : 'הודעה חדשה'} onClose={onClose} size="md">
      <div className="flex flex-col gap-4">
        <div>
          <label className={lbl}>כותרת *</label>
          <input value={title} onChange={e => setTitle(e.target.value)} className={inp} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={lbl}>קטגוריה</label>
            <select value={category} onChange={e => setCategory(e.target.value as SynagogueEventCategory)} className={inp}>
              {EVENT_CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </div>
          <div>
            <label className={lbl}>תאריך ושעה</label>
            <input type="datetime-local" value={startDate} onChange={e => setStartDate(e.target.value)} className={inp} />
          </div>
        </div>
        <div>
          <label className={lbl}>מיקום (אופציונלי)</label>
          <input value={location} onChange={e => setLocation(e.target.value)} className={inp} />
        </div>
        <div>
          <label className={lbl}>תיאור</label>
          <textarea value={desc} onChange={e => setDesc(e.target.value)} rows={3} className={`${inp} resize-none`} />
        </div>
        <div className="flex items-center gap-3">
          <input type="checkbox" id="isAlert" checked={isAlert} onChange={e => setIsAlert(e.target.checked)} className="w-4 h-4 accent-red-600" />
          <label htmlFor="isAlert" className="text-sm text-slate-600 cursor-pointer">סמן כהודעה דחופה</label>
        </div>
        <div className="flex gap-3 pt-2">
          <button onClick={handleSave} disabled={!title.trim()}
            className="flex-1 bg-[#1B3A6B] text-white py-2.5 rounded-xl font-semibold text-sm hover:bg-[#15306a] disabled:opacity-50">
            שמור
          </button>
          <button onClick={onClose} className="px-5 py-2.5 border border-slate-200 rounded-xl text-sm hover:bg-slate-50">ביטול</button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Map picker ───────────────────────────────────────────────────────────────
const PIN_ICON = L.divIcon({
  className: '',
  html: `<div style="width:22px;height:22px;background:#1B3A6B;border:3px solid white;border-radius:50%;box-shadow:0 2px 8px rgba(0,0,0,0.4)"></div>`,
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});

function MapClickHandler({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({ click: e => onPick(e.latlng.lat, e.latlng.lng) });
  return null;
}

function MapPicker({ lat, lng, onPick }: { lat: number | null; lng: number | null; onPick: (lat: number, lng: number) => void }) {
  const center: [number, number] = (lat && lng) ? [lat, lng] : [31.7683, 35.2137];
  return (
    <MapContainer center={center} zoom={(lat && lng) ? 16 : 11} className="w-full h-full rounded-xl" zoomControl>
      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution='© OpenStreetMap' />
      <MapClickHandler onPick={onPick} />
      {lat !== null && lng !== null && <Marker position={[lat, lng]} icon={PIN_ICON} />}
    </MapContainer>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
type Tab = 'info' | 'weekday' | 'shabbat' | 'shiurim' | 'announcements';

export default function SynagogueDetailPage() {
  const { id, cityId } = useParams<{ id: string; cityId: string }>();
  const navigate = useNavigate();

  const { setMarkers, setSelectedId } = useMapSync();
  const { appUser } = useAuth();
  const isAdmin = ['city_admin', 'super_admin', 'dev'].includes(appUser?.role ?? '');
  const [syn, setSyn] = useState<Synagogue | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('info');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [nusachOptions, setNusachOptions] = useState<NusachOption[]>([]);
  const [addingNusach, setAddingNusach] = useState(false);
  const [newNusachLabel, setNewNusachLabel] = useState('');
  const [neighborhoods, setNeighborhoods] = useState<string[]>([]);
  const [addingNeighborhood, setAddingNeighborhood] = useState(false);
  const [newNeighborhoodText, setNewNeighborhoodText] = useState('');

  const [mapModalOpen, setMapModalOpen] = useState(false);
  const [pendingPick, setPendingPick] = useState<{ lat: number; lng: number } | null>(null);

  // Info form state
  const [info, setInfo] = useState({
    name: '', nusach: [] as string[], neighborhood: '',
    addressHe: '', rabbi: '', rabbiPhone: '',
    gabbaim: [] as { name: string; phone: string }[], notes: '',
    latitude: '', longitude: '',
  });

  // Prayer schedules
  const [weekly, setWeekly] = useState<WeeklySchedule>({ shacharit: [], mincha: [], maariv: [] });
  const [weeklyNotes, setWeeklyNotes] = useState('');
  const [shabbat, setShabbatSchedule] = useState<ShabbatSchedule>({});
  const [shabbatNotes, setShabbatNotes] = useState('');

  // Shiurim
  const [shiurim, setShiurim] = useState<Shiur[]>([]);
  const [shiurModal, setShiurModal] = useState(false);
  const [editShiur, setEditShiur] = useState<Shiur | null>(null);

  // Announcements
  const [announcements, setAnnouncements] = useState<SynagogueAnnouncement[]>([]);
  const [annModal, setAnnModal] = useState(false);
  const [editAnn, setEditAnn] = useState<SynagogueAnnouncement | null>(null);
  const [annView, setAnnView] = useState<'upcoming' | 'archive'>('upcoming');

  useEffect(() => {
    if (!cityId) return;
    getDoc(doc(db, 'cities', cityId)).then(snap => {
      const data = snap.data();
      const opts = data?.nusachOptions as NusachOption[] | undefined;
      if (opts?.length) setNusachOptions(opts);
      const hoods = data?.neighborhoods as string[] | undefined;
      if (hoods?.length) setNeighborhoods(hoods);
    });
  }, [cityId]);

  const handleAddNusach = async () => {
    const trimmed = newNusachLabel.trim();
    if (!trimmed || !cityId || nusachOptions.some(o => o.label === trimmed)) return;
    const newOpt: NusachOption = { key: trimmed, label: trimmed };
    await updateDoc(doc(db, 'cities', cityId), { nusachOptions: arrayUnion(newOpt) });
    const updated = [...nusachOptions, newOpt];
    setNusachOptions(updated);
    setInfo(p => ({ ...p, nusach: [...(p.nusach ?? []), trimmed] }));
    setNewNusachLabel('');
    setAddingNusach(false);
  };

  const handleAddNeighborhood = async () => {
    const trimmed = newNeighborhoodText.trim();
    if (!trimmed || !cityId || neighborhoods.includes(trimmed)) return;
    await updateDoc(doc(db, 'cities', cityId), { neighborhoods: arrayUnion(trimmed) });
    const updated = [...neighborhoods, trimmed].sort((a, b) => a.localeCompare(b, 'he'));
    setNeighborhoods(updated);
    setInfo(p => ({ ...p, neighborhood: trimmed }));
    setNewNeighborhoodText('');
    setAddingNeighborhood(false);
  };

  const toArr = (v: unknown): string[] =>
    Array.isArray(v) ? v : (typeof v === 'string' && v ? [v] : []);

  const nusachDisplay = (keys: unknown) =>
    toArr(keys).map(k => nusachOptions.find(o => o.key === k)?.label ?? k).join(' / ');

  const toggleNusach = (key: string) =>
    setInfo(p => ({
      ...p,
      nusach: (p.nusach ?? []).includes(key)
        ? (p.nusach ?? []).filter(k => k !== key)
        : [...(p.nusach ?? []), key],
    }));

  useEffect(() => {
    if (!id) return;
    getDoc(doc(db, 'synagogues', id)).then(snap => {
      if (!snap.exists()) { navigate(`/cities/${cityId}/synagogues`); return; }
      const data = { id: snap.id, ...snap.data() } as Synagogue;
      setSyn(data);
      // Show this synagogue's marker on the city map
      if (data.latitude && data.longitude) {
        setMarkers([{ id: data.id, lat: data.latitude, lng: data.longitude, label: data.name, type: 'synagogue' }]);
        setSelectedId(data.id);
      }
      setInfo({
        name: data.name, nusach: toArr(data.nusach), neighborhood: data.neighborhood ?? '',
        addressHe: data.address?.he ?? '', rabbi: data.rabbi ?? '',
        rabbiPhone: data.rabbiPhone ?? '',
        gabbaim: data.gabbaim?.length
          ? data.gabbaim.map(g => ({ name: g.name, phone: g.phone ?? '' }))
          : (data.gabbaiName ? [{ name: data.gabbaiName, phone: data.gabbaiPhone ?? '' }] : []),
        notes: data.notes ?? '',
        latitude: String(data.latitude ?? ''), longitude: String(data.longitude ?? ''),
      });
      const ws = data.weeklySchedule ?? { shacharit: [], mincha: [], maariv: [] };
      setWeekly({ shacharit: ws.shacharit ?? [], mincha: ws.mincha ?? [], maariv: ws.maariv ?? [] });
      setWeeklyNotes(ws.notes ?? '');
      const ss = data.shabbatSchedule ?? {};
      setShabbatSchedule({ minchaFriday: ss.minchaFriday ?? [], shacharit: ss.shacharit ?? [], mincha: ss.mincha ?? [], maariv: ss.maariv ?? [] });
      setShabbatNotes(ss.notes ?? '');
      setShiurim(data.shiurim ?? []);
      setAnnouncements(data.synagogueEvents ?? []);
      setLoading(false);
    });
  }, [id]);

  const flash = () => { setSaved(true); setTimeout(() => setSaved(false), 2000); };

  const saveInfo = async () => {
    if (!id || !info.name.trim()) return;
    setSaving(true);
    const firstGabbai = info.gabbaim[0];
    await updateDoc(doc(db, 'synagogues', id), {
      name: info.name, nusach: info.nusach, neighborhood: info.neighborhood,
      address: { he: info.addressHe },
      rabbi: info.rabbi, rabbiPhone: info.rabbiPhone,
      gabbaim: info.gabbaim,
      gabbaiName: firstGabbai?.name ?? '',
      gabbaiPhone: firstGabbai?.phone ?? '',
      notes: info.notes,
      latitude: parseFloat(info.latitude) || null,
      longitude: parseFloat(info.longitude) || null,
      updatedAt: serverTimestamp(),
    });
    setSaving(false); flash();
  };

  const saveWeekly = async () => {
    if (!id) return;
    setSaving(true);
    await updateDoc(doc(db, 'synagogues', id), {
      weeklySchedule: { ...weekly, notes: weeklyNotes },
      updatedAt: serverTimestamp(),
    });
    setSaving(false); flash();
  };

  const saveShabbat = async () => {
    if (!id) return;
    setSaving(true);
    await updateDoc(doc(db, 'synagogues', id), {
      shabbatSchedule: { ...shabbat, notes: shabbatNotes },
      updatedAt: serverTimestamp(),
    });
    setSaving(false); flash();
  };

  const saveShiurim = async (list: Shiur[]) => {
    if (!id) return;
    setShiurim(list);
    await updateDoc(doc(db, 'synagogues', id), { shiurim: list, updatedAt: serverTimestamp() });
    flash();
  };

  const saveAnnouncements = async (list: SynagogueAnnouncement[]) => {
    if (!id) return;
    setAnnouncements(list);
    await updateDoc(doc(db, 'synagogues', id), { synagogueEvents: list, updatedAt: serverTimestamp() });
    flash();
  };

  const handleShiurSave = (s: Shiur) => {
    const list = editShiur ? shiurim.map(x => (x.id === s.id ? s : x)) : [...shiurim, s];
    saveShiurim(list);
  };
  const deleteShiur = (id: string) => saveShiurim(shiurim.filter(x => x.id !== id));

  const handleAnnSave = (a: SynagogueAnnouncement) => {
    const list = editAnn ? announcements.map(x => (x.id === a.id ? a : x)) : [...announcements, a];
    saveAnnouncements(list);
  };
  const deleteAnn = (id: string) => saveAnnouncements(announcements.filter(x => x.id !== id));

  if (loading) return <div className="flex items-center justify-center h-64 text-slate-400">טוען...</div>;

  const TABS: { key: Tab; label: string }[] = [
    { key: 'info',          label: 'פרטים' },
    { key: 'weekday',       label: 'תפילות שבועיות' },
    { key: 'shabbat',       label: 'שבת' },
    { key: 'shiurim',       label: `שיעורים (${shiurim.length})` },
    { key: 'announcements', label: `הודעות (${announcements.length})` },
  ];

  return (
    <div className="p-8" dir="rtl">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate(`/cities/${cityId}/synagogues`)} className="p-2 rounded-xl hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors">
          <ArrowRight size={18} />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-slate-800">{syn?.name}</h1>
          <p className="text-slate-400 text-sm">{syn?.neighborhood} · {nusachDisplay(syn?.nusach ?? [])}</p>
        </div>
        {saved && <span className="mr-auto text-xs bg-green-100 text-green-700 px-3 py-1 rounded-full font-medium">נשמר ✓</span>}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-100 rounded-xl p-1 w-fit mb-6 flex-wrap">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${tab === t.key ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Basic info ─────────────────────────────────────────────────────────── */}
      {tab === 'info' && (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 max-w-2xl">
          <div>
              <div className="grid grid-cols-2 gap-4">

                {/* Name */}
                <InfoField label="שם *" colSpan>
                  <input value={info.name} onChange={e => setInfo(p => ({ ...p, name: e.target.value }))} className={inp} />
                </InfoField>

                {/* Nusach */}
                <InfoField label="נוסח">
                  <div className="flex flex-wrap gap-1.5 mb-1">
                    {nusachOptions.map(o => {
                      const active = (info.nusach ?? []).includes(o.key);
                      return (
                        <button key={o.key} type="button" onClick={() => toggleNusach(o.key)}
                          className={`px-3 py-1 text-xs rounded-full border font-medium transition-colors ${
                            active ? 'bg-[#1B3A6B] text-white border-[#1B3A6B]' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                          }`}>
                          {o.label}
                        </button>
                      );
                    })}
                    {isAdmin && !addingNusach && (
                      <button type="button" onClick={() => { setAddingNusach(true); setNewNusachLabel(''); }}
                        className="px-3 py-1 text-xs rounded-full border border-dashed border-slate-300 text-slate-400 hover:bg-slate-50">
                        + הוסף נוסח
                      </button>
                    )}
                  </div>
                  {isAdmin && addingNusach && (
                    <div className="flex gap-1.5 items-center">
                      <input autoFocus value={newNusachLabel} onChange={e => setNewNusachLabel(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') handleAddNusach(); if (e.key === 'Escape') setAddingNusach(false); }}
                        placeholder="שם הנוסח, למשל: תימני" className={`${inp} flex-1`} />
                      <button type="button" onClick={handleAddNusach}
                        className="px-3 py-1.5 bg-[#1B3A6B] text-white rounded-lg text-xs font-semibold">שמור</button>
                      <button type="button" onClick={() => setAddingNusach(false)}
                        className="px-3 py-1.5 border border-slate-200 rounded-lg text-xs text-slate-500">ביטול</button>
                    </div>
                  )}
                  {nusachOptions.length === 0 && <p className="text-xs text-slate-400">טוען נוסחים מהמסד...</p>}
                </InfoField>

                {/* Neighborhood */}
                <div>
                  <label className={lbl}>שכונה</label>
                  <select
                    value={info.neighborhood}
                    onChange={e => setInfo(p => ({ ...p, neighborhood: e.target.value }))}
                    className={inp}
                  >
                    <option value="">— בחר שכונה —</option>
                    {info.neighborhood && !neighborhoods.includes(info.neighborhood) && (
                      <option value={info.neighborhood}>{info.neighborhood}</option>
                    )}
                    {neighborhoods.map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                  {isAdmin && !addingNeighborhood && (
                    <button
                      type="button"
                      onClick={() => { setAddingNeighborhood(true); setNewNeighborhoodText(''); }}
                      className="mt-1.5 flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600 transition-colors"
                    >
                      <Plus size={11} /> הוסף שכונה
                    </button>
                  )}
                  {isAdmin && addingNeighborhood && (
                    <div className="flex gap-1.5 items-center mt-1.5">
                      <input
                        autoFocus
                        value={newNeighborhoodText}
                        onChange={e => setNewNeighborhoodText(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') handleAddNeighborhood(); if (e.key === 'Escape') setAddingNeighborhood(false); }}
                        placeholder="שם שכונה חדשה"
                        className={`${inp} flex-1`}
                      />
                      <button type="button" onClick={handleAddNeighborhood}
                        className="px-3 py-1.5 bg-[#1B3A6B] text-white rounded-lg text-xs font-semibold">הוסף</button>
                      <button type="button" onClick={() => setAddingNeighborhood(false)}
                        className="px-3 py-1.5 border border-slate-200 rounded-lg text-xs text-slate-500">ביטול</button>
                    </div>
                  )}
                </div>

                {/* Address */}
                <InfoField label="כתובת" colSpan>
                  <input value={info.addressHe} onChange={e => setInfo(p => ({ ...p, addressHe: e.target.value }))} className={inp} />
                </InfoField>

                {/* Rabbi — name + phone on same row */}
                <div className="col-span-2 grid grid-cols-2 gap-4">
                  <InfoField label="שם הרב">
                    <input value={info.rabbi} onChange={e => setInfo(p => ({ ...p, rabbi: e.target.value }))} className={inp} />
                  </InfoField>
                  <InfoField label="טלפון הרב">
                    <input value={info.rabbiPhone} onChange={e => setInfo(p => ({ ...p, rabbiPhone: e.target.value }))} type="tel" className={inp} />
                  </InfoField>
                </div>

                {/* Gabbaim list */}
                <div className="col-span-2">
                  {/* Column headers — same layout as the grid below */}
                  <div className="grid gap-2 mb-1.5" style={{ gridTemplateColumns: '1fr 1fr auto' }}>
                    <label className={lbl}>שם גבאי</label>
                    <label className={lbl}>טלפון גבאי</label>
                    <div />
                  </div>
                  {info.gabbaim.map((g, i) => (
                    <div key={i} className="grid gap-2 mb-2 items-center" style={{ gridTemplateColumns: '1fr 1fr auto' }}>
                      <input
                        value={g.name}
                        onChange={e => setInfo(p => ({ ...p, gabbaim: p.gabbaim.map((x, j) => j === i ? { ...x, name: e.target.value } : x) }))}
                        className={inp}
                      />
                      <input
                        value={g.phone}
                        onChange={e => setInfo(p => ({ ...p, gabbaim: p.gabbaim.map((x, j) => j === i ? { ...x, phone: e.target.value } : x) }))}
                        type="tel"
                        className={inp}
                      />
                      <button
                        type="button"
                        onClick={() => setInfo(p => ({ ...p, gabbaim: p.gabbaim.filter((_, j) => j !== i) }))}
                        className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => setInfo(p => ({ ...p, gabbaim: [...p.gabbaim, { name: '', phone: '' }] }))}
                    className="flex items-center gap-1.5 text-xs border border-dashed border-slate-300 text-slate-500 px-3 py-1.5 rounded-lg hover:bg-slate-50 transition-colors mt-1"
                  >
                    <Plus size={12} /> הוסף גבאי
                  </button>
                </div>

                {/* Location — lat + lng on same row + map toggle */}
                <div className="col-span-2">
                  <label className={lbl}>מיקום</label>
                  <div className="flex items-center gap-2">
                    <div className="flex-1">
                      <input
                        value={info.latitude} onChange={e => setInfo(p => ({ ...p, latitude: e.target.value }))}
                        type="number" step="any" placeholder="קו רוחב" className={inp}
                      />
                    </div>
                    <div className="flex-1">
                      <input
                        value={info.longitude} onChange={e => setInfo(p => ({ ...p, longitude: e.target.value }))}
                        type="number" step="any" placeholder="קו אורך" className={inp}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        const lat = parseFloat(info.latitude);
                        const lng = parseFloat(info.longitude);
                        setPendingPick((lat && lng) ? { lat, lng } : null);
                        setMapModalOpen(true);
                      }}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors flex-shrink-0"
                    >
                      <MapPin size={13} />
                      בחר במפה
                    </button>
                  </div>
                </div>

                {/* Notes */}
                <InfoField label="הערות" colSpan>
                  <textarea value={info.notes} onChange={e => setInfo(p => ({ ...p, notes: e.target.value }))} rows={3} className={`${inp} resize-none`} />
                </InfoField>

              </div>
              <SaveBar onSave={saveInfo} saving={saving} />
          </div>

          {/* Map modal */}
          <Modal open={mapModalOpen} title="בחר מיקום על המפה" onClose={() => setMapModalOpen(false)} size="xl">
            <div style={{ height: 480 }}>
              <MapPicker
                lat={pendingPick?.lat ?? null}
                lng={pendingPick?.lng ?? null}
                onPick={(lat, lng) => setPendingPick({ lat, lng })}
              />
            </div>
            {pendingPick && (
              <p className="text-xs text-slate-400 mt-2 text-center">
                {pendingPick.lat.toFixed(6)}, {pendingPick.lng.toFixed(6)}
              </p>
            )}
            <div className="flex gap-3 pt-4">
              <button
                onClick={() => {
                  if (pendingPick) {
                    setInfo(p => ({
                      ...p,
                      latitude: pendingPick.lat.toFixed(6),
                      longitude: pendingPick.lng.toFixed(6),
                    }));
                  }
                  setMapModalOpen(false);
                }}
                disabled={!pendingPick}
                className="flex-1 bg-[#1B3A6B] text-white py-2.5 rounded-xl font-semibold text-sm hover:bg-[#15306a] disabled:opacity-40"
              >
                אישור
              </button>
              <button
                onClick={() => setMapModalOpen(false)}
                className="px-5 py-2.5 border border-slate-200 rounded-xl text-sm hover:bg-slate-50"
              >
                ביטול
              </button>
            </div>
          </Modal>
        </div>
      )}

      {/* ── Weekday prayers ────────────────────────────────────────────────────── */}
      {tab === 'weekday' && (
        <div className="max-w-2xl flex flex-col gap-4">
          {PRAYER_TYPES.map(pt => (
            <PrayerSection
              key={pt.key} label={pt.label} color={pt.color}
              slots={(weekly as any)[pt.key] ?? []}
              onChange={s => setWeekly(p => ({ ...p, [pt.key]: s }))}
            />
          ))}
          <div>
            <label className={lbl}>הערות כלליות</label>
            <textarea value={weeklyNotes} onChange={e => setWeeklyNotes(e.target.value)} rows={2} className={`${inp} resize-none`} placeholder="למשל: בחגים — לפי לוח שנה" />
          </div>
          <SaveBar onSave={saveWeekly} saving={saving} />
        </div>
      )}

      {/* ── Shabbat ────────────────────────────────────────────────────────────── */}
      {tab === 'shabbat' && (
        <div className="max-w-2xl flex flex-col gap-4">
          {SHABBAT_TYPES.map(pt => (
            <PrayerSection
              key={pt.key} label={pt.label} color={pt.color}
              slots={(shabbat as any)[pt.key] ?? []}
              onChange={s => setShabbatSchedule(p => ({ ...p, [pt.key]: s }))}
              hideWeekdays
            />
          ))}
          <div>
            <label className={lbl}>הערות שבת</label>
            <textarea value={shabbatNotes} onChange={e => setShabbatNotes(e.target.value)} rows={2} className={`${inp} resize-none`} />
          </div>
          <SaveBar onSave={saveShabbat} saving={saving} />
        </div>
      )}

      {/* ── Shiurim ────────────────────────────────────────────────────────────── */}
      {tab === 'shiurim' && (
        <div className="max-w-2xl">
          <div className="flex justify-end mb-4">
            <button onClick={() => { setEditShiur(null); setShiurModal(true); }}
              className="flex items-center gap-2 px-4 py-2 bg-[#1B3A6B] text-white rounded-xl text-sm font-semibold hover:bg-[#15306a]">
              <Plus size={15} /> הוסף שיעור
            </button>
          </div>
          {shiurim.length === 0 && <p className="text-slate-400 text-sm">אין שיעורים</p>}
          <div className="flex flex-col gap-3">
            {shiurim.map(s => (
              <div key={s.id} className="bg-white rounded-xl border border-slate-100 shadow-sm p-4 flex items-start justify-between">
                <div>
                  <div className="font-semibold text-slate-800">נושא: {s.title}</div>
                  <div className="text-sm text-slate-500 mt-0.5">
                    {s.rabbi && <span className="ml-3">מוסר השיעור: {s.rabbi}</span>}
                    <span className="ml-3">⏰ {s.time}</span>
                    <span>{s.days === 'daily' ? 'יומי' : daysLabel(s.days, ALL_DAYS)}</span>
                  </div>
                  {s.description && <p className="text-xs text-slate-400 mt-1">הערות: {s.description}</p>}
                </div>
                <div className="flex gap-1 flex-shrink-0">
                  <button onClick={() => { setEditShiur(s); setShiurModal(true); }} className="p-1.5 rounded-lg hover:bg-blue-50 text-slate-400 hover:text-blue-600"><Pencil size={14} /></button>
                  <button onClick={() => deleteShiur(s.id)} className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500"><Trash2 size={14} /></button>
                </div>
              </div>
            ))}
          </div>
          <ShiurModal open={shiurModal} shiur={editShiur} onSave={handleShiurSave} onClose={() => setShiurModal(false)} />
        </div>
      )}

      {/* ── Announcements ──────────────────────────────────────────────────────── */}
      {tab === 'announcements' && (() => {
        // Announcements without a startDate can't be judged past, so they stay "upcoming".
        const now = new Date();
        const upcomingAnn = announcements.filter(a => !a.startDate || new Date(a.startDate) >= now);
        const archiveAnn  = announcements.filter(a => a.startDate && new Date(a.startDate) < now);
        const visibleAnn  = annView === 'upcoming' ? upcomingAnn : archiveAnn;

        return (
        <div className="max-w-2xl">
          <div className="flex items-center justify-between mb-4">
            <div className="flex gap-1 bg-slate-100 rounded-xl p-1 w-fit">
              {([['upcoming', 'פעילות', upcomingAnn.length], ['archive', 'ארכיון', archiveAnn.length]] as const).map(([v, label, count]) => (
                <button key={v} onClick={() => setAnnView(v)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${annView === v ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}>
                  {label} <span className="text-xs text-slate-400">({count})</span>
                </button>
              ))}
            </div>
            <button onClick={() => { setEditAnn(null); setAnnModal(true); }}
              className="flex items-center gap-2 px-4 py-2 bg-[#1B3A6B] text-white rounded-xl text-sm font-semibold hover:bg-[#15306a]">
              <Plus size={15} /> הודעה חדשה
            </button>
          </div>
          {visibleAnn.length === 0 && (
            <p className="text-slate-400 text-sm">{annView === 'upcoming' ? 'אין הודעות פעילות' : 'אין הודעות בארכיון'}</p>
          )}
          <div className="flex flex-col gap-3">
            {[...visibleAnn].sort((a, b) => b.startDate.localeCompare(a.startDate)).map(a => (
              <div key={a.id} className={`bg-white rounded-xl border shadow-sm p-4 flex items-start justify-between ${a.isAlert ? 'border-red-200' : 'border-slate-100'}`}>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-slate-800">{a.title}</span>
                    {a.isAlert && <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full">דחוף</span>}
                    <span className="text-xs text-slate-400">{EVENT_CATEGORIES.find(c => c.key === a.category)?.label}</span>
                  </div>
                  {a.startDate && <div className="text-xs text-slate-400 mt-0.5">{new Date(a.startDate).toLocaleString('he-IL')}</div>}
                  {a.location && <div className="text-xs text-slate-400">{a.location}</div>}
                  <p className="text-sm text-slate-600 mt-1 line-clamp-2">{a.description}</p>
                </div>
                <div className="flex gap-1 flex-shrink-0">
                  <button onClick={() => { setEditAnn(a); setAnnModal(true); }} className="p-1.5 rounded-lg hover:bg-blue-50 text-slate-400 hover:text-blue-600"><Pencil size={14} /></button>
                  <button onClick={() => deleteAnn(a.id)} className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500"><Trash2 size={14} /></button>
                </div>
              </div>
            ))}
          </div>
          <AnnouncementModal open={annModal} item={editAnn} onSave={handleAnnSave} onClose={() => setAnnModal(false)} />
        </div>
        );
      })()}
    </div>
  );
}

// ─── Shared helpers ───────────────────────────────────────────────────────────
const inp = 'w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 bg-white';
const lbl = 'block text-xs font-semibold text-slate-600 mb-1.5';

function InfoField({ label, children, colSpan }: { label: string; children: React.ReactNode; colSpan?: boolean }) {
  return <div className={colSpan ? 'col-span-2' : ''}><label className={lbl}>{label}</label>{children}</div>;
}

function SaveBar({ onSave, saving }: { onSave: () => void; saving: boolean }) {
  return (
    <div className="pt-4 border-t border-slate-100 mt-2">
      <button onClick={onSave} disabled={saving}
        className="flex items-center gap-2 px-6 py-2.5 bg-[#1B3A6B] text-white rounded-xl font-semibold text-sm hover:bg-[#15306a] disabled:opacity-50 transition-colors">
        <Save size={15} />
        {saving ? 'שומר...' : 'שמור שינויים'}
      </button>
    </div>
  );
}
