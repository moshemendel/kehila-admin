import { useEffect, useState } from 'react';
import {
  collection, getDocs, query, where, doc, setDoc, deleteDoc,
  serverTimestamp, getDoc, updateDoc, arrayUnion,
} from 'firebase/firestore';
import { db } from '../firebase';
import { useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useMapSync } from '../contexts/MapSyncContext';
import type { Mikveh, MikvehType, HoursBlock, City } from '../types';
import DataTable, { type Column } from '../components/DataTable';
import Modal from '../components/Modal';
import ExcelImportModal from '../components/ExcelImportModal';
import HoursScheduleEditor from '../components/HoursScheduleEditor';
import { exportToExcel } from '../utils/excel';
import { Plus, Pencil, Trash2, Upload, Download, MapPin } from 'lucide-react';
import { nanoid } from '../utils/nanoid';
import 'leaflet/dist/leaflet.css';
import { MapContainer, TileLayer, Marker, useMapEvents } from 'react-leaflet';
import L from 'leaflet';

const TYPE_LABELS: Record<MikvehType, string> = { women: 'נשים', men: 'גברים', both: 'נשים וגברים' };

const PIN_ICON = L.divIcon({
  html: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="#1B3A6B">
    <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
  </svg>`,
  className: '', iconAnchor: [16, 32], iconSize: [32, 32],
});

function MapClickHandler({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({ click: e => onPick(e.latlng.lat, e.latlng.lng) });
  return null;
}

function MapPicker({ lat, lng, onPick }: { lat: number | null; lng: number | null; onPick: (lat: number, lng: number) => void }) {
  return (
    <MapContainer
      center={lat !== null && lng !== null ? [lat, lng] : [31.5, 35.0]}
      zoom={lat !== null && lng !== null ? 15 : 10}
      style={{ height: '100%', width: '100%' }}
    >
      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="© OpenStreetMap" />
      <MapClickHandler onPick={onPick} />
      {lat !== null && lng !== null && <Marker position={[lat, lng]} icon={PIN_ICON} />}
    </MapContainer>
  );
}

type ContactRow = { name: string; phone: string };
type ApptConfig = { slotDurationMin: number; parallelTracks: number; prepMultiplier: number };

const EMPTY_APPT_CONFIG: ApptConfig = { slotDurationMin: 30, parallelTracks: 1, prepMultiplier: 2 };

const EMPTY_FORM = {
  name: '', type: 'women' as MikvehType, neighborhood: '', address: '',
  phone: '', notes: '', requiresAppointment: false,
  latitude: undefined as number | undefined,
  longitude: undefined as number | undefined,
  hoursSchedule: [] as HoursBlock[],
  contacts: [{ name: '', phone: '' }] as ContactRow[],
  appointmentConfig: EMPTY_APPT_CONFIG as ApptConfig,
};

export default function MikvehPage() {
  const { cityId = '' } = useParams<{ cityId: string }>();
  const { appUser } = useAuth();
  const { setMarkers } = useMapSync();

  // A user can hold several roles at once — check the full array (falling back
  // to the single primary role for accounts saved before roles[] existed).
  const roles = appUser?.roles ?? (appUser?.role ? [appUser.role] : []);
  const isAdmin = roles.some((r) => ['city_admin', 'super_admin', 'dev', 'mikveh_manager'].includes(r));

  const [data, setData] = useState<Mikveh[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editing, setEditing] = useState<Mikveh | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  // Neighborhood dropdown state
  const [neighborhoods, setNeighborhoods] = useState<string[]>([]);
  const [addingNeighborhood, setAddingNeighborhood] = useState(false);
  const [newNeighborhoodText, setNewNeighborhoodText] = useState('');

  // Map modal state
  const [mapModalOpen, setMapModalOpen] = useState(false);
  const [pendingPick, setPendingPick] = useState<{ lat: number; lng: number } | null>(null);

  const load = async () => {
    if (!cityId) return;
    setLoading(true);
    const snap = await getDocs(query(collection(db, 'mikvaot'), where('cityId', '==', cityId)));
    const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }) as Mikveh);
    setData(rows);
    setMarkers(rows.filter(m => m.latitude && m.longitude).map(m => ({
      id: m.id, lat: m.latitude!, lng: m.longitude!, label: m.name, type: 'mikveh' as const,
    })));
    setLoading(false);
  };

  useEffect(() => { load(); }, [cityId]);

  useEffect(() => {
    if (!cityId) return;
    getDoc(doc(db, 'cities', cityId)).then(snap => {
      const d = snap.data() as City | undefined;
      setNeighborhoods((d?.neighborhoods ?? []).sort(new Intl.Collator('he').compare));
    });
  }, [cityId]);

  const handleAddNeighborhood = async () => {
    const text = newNeighborhoodText.trim();
    if (!text || !cityId) return;
    await updateDoc(doc(db, 'cities', cityId), { neighborhoods: arrayUnion(text) });
    setNeighborhoods(prev => [...prev, text].sort(new Intl.Collator('he').compare));
    setForm(p => ({ ...p, neighborhood: text }));
    setNewNeighborhoodText('');
    setAddingNeighborhood(false);
  };

  const openAdd = () => {
    setEditing(null);
    setPendingPick(null);
    setForm(EMPTY_FORM);
    setModalOpen(true);
  };

  const openEdit = (row: Mikveh) => {
    setEditing(row);
    setPendingPick(row.latitude != null && row.longitude != null ? { lat: row.latitude, lng: row.longitude } : null);
    setForm({
      name: row.name, type: row.type, neighborhood: row.neighborhood ?? '',
      address: row.address ?? '', phone: row.phone ?? '', notes: row.notes ?? '',
      requiresAppointment: row.requiresAppointment,
      latitude: row.latitude, longitude: row.longitude,
      hoursSchedule: row.hoursSchedule ?? [],
      contacts: row.contacts?.length ? row.contacts.map(c => ({ name: c.name, phone: c.phone ?? '' })) : [{ name: '', phone: '' }],
      // Merge over defaults rather than replacing outright — a doc saved before
      // parallelTracks/prepMultiplier existed would otherwise load those as undefined.
      appointmentConfig: row.appointmentConfig
        ? { ...EMPTY_APPT_CONFIG, ...row.appointmentConfig }
        : EMPTY_APPT_CONFIG,
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const id = editing?.id ?? nanoid();
      await setDoc(doc(db, 'mikvaot', id), {
        ...editing, ...form, id, cityId, updatedAt: serverTimestamp(),
        contacts: form.contacts.filter(c => c.name.trim()).map(c => ({ name: c.name, ...(c.phone ? { phone: c.phone } : {}) })),
        appointmentConfig: form.requiresAppointment ? form.appointmentConfig : null,
      }, { merge: true });
      setModalOpen(false);
      load();
    } catch (e: any) {
      alert(e?.message ?? 'שגיאה בשמירה');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    await deleteDoc(doc(db, 'mikvaot', id));
    setDeleteId(null);
    load();
  };

  const handleImport = async (rows: Partial<Mikveh>[]) => {
    await Promise.all(rows.map(row => {
      const id = nanoid();
      return setDoc(doc(db, 'mikvaot', id), {
        ...row, id, cityId, hoursSchedule: [], requiresAppointment: false, updatedAt: serverTimestamp(),
      });
    }));
    load();
  };

  const handleExport = () => {
    exportToExcel(
      data.map(m => ({
        'שם': m.name, 'סוג': TYPE_LABELS[m.type], 'שכונה': m.neighborhood ?? '',
        'כתובת': m.address, 'טלפון': m.phone ?? '',
        'דורש תיאום': m.requiresAppointment ? 'כן' : 'לא',
        'קו רוחב': m.latitude ?? '', 'קו אורך': m.longitude ?? '', 'הערות': m.notes ?? '',
      })),
      'מקואות'
    );
  };

  const updateContact = (i: number, field: keyof ContactRow, value: string) =>
    setForm(p => ({ ...p, contacts: p.contacts.map((c, j) => j === i ? { ...c, [field]: value } : c) }));

  const removeContact = (i: number) =>
    setForm(p => p.contacts.length > 1 ? { ...p, contacts: p.contacts.filter((_, j) => j !== i) } : p);

  const columns: Column<Mikveh>[] = [
    { key: 'name', header: 'שם', sortable: true },
    { key: 'type', header: 'סוג', render: r => TYPE_LABELS[r.type] },
    { key: 'neighborhood', header: 'שכונה', sortable: true },
    { key: 'address', header: 'כתובת' },
    { key: 'phone', header: 'טלפון' },
    { key: 'contactName', header: 'איש קשר', render: r => r.contacts?.[0]?.name || '—' },
    { key: 'contactPhone', header: 'טלפון איש קשר', render: r => r.contacts?.[0]?.phone || '—' },
    { key: 'requiresAppointment', header: 'תיאום', render: r => r.requiresAppointment ? 'נדרש' : 'לא נדרש' },
  ];

  const f = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }));

  return (
    <div className="p-8" dir="rtl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">מקואות</h1>
          <p className="text-slate-400 text-sm mt-0.5">{data.length} מקואות</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setImportOpen(true)}
            className="flex items-center gap-2 px-4 py-2 border border-slate-200 rounded-xl text-sm font-medium hover:bg-slate-50">
            <Upload size={15} /> ייבוא Excel
          </button>
          <button onClick={handleExport}
            className="flex items-center gap-2 px-4 py-2 border border-slate-200 rounded-xl text-sm font-medium hover:bg-slate-50">
            <Download size={15} /> ייצוא Excel
          </button>
          <button onClick={openAdd}
            className="flex items-center gap-2 px-4 py-2 bg-[#1B3A6B] text-white rounded-xl text-sm font-semibold hover:bg-[#15306a]">
            <Plus size={15} /> הוסף מקווה
          </button>
        </div>
      </div>

      {loading ? <div className="text-center py-16 text-slate-400">טוען...</div> : (
        <DataTable data={data} columns={columns} searchKeys={['name', 'neighborhood', 'address']}
          onRowClick={openEdit}
          actions={row => (
            <div className="flex items-center gap-1">
              <button onClick={() => openEdit(row)} className="p-1.5 rounded-lg hover:bg-blue-50 text-slate-400 hover:text-blue-600"><Pencil size={14} /></button>
              <button onClick={() => setDeleteId(row.id)} className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500"><Trash2 size={14} /></button>
            </div>
          )}
        />
      )}

      {/* Edit / Add modal */}
      <Modal open={modalOpen} title={editing ? 'עריכת מקווה' : 'הוספת מקווה'} onClose={() => setModalOpen(false)}>
        <div className="grid grid-cols-2 gap-4">
          {/* Name */}
          <Field label="שם *" colSpan><input value={form.name} onChange={f('name')} className={inp} /></Field>

          {/* Type | Neighborhood */}
          <Field label="סוג">
            <select value={form.type} onChange={f('type')} className={inp}>
              {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field label="שכונה">
            {addingNeighborhood ? (
              <div className="flex gap-1.5">
                <input
                  value={newNeighborhoodText}
                  onChange={e => setNewNeighborhoodText(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleAddNeighborhood()}
                  autoFocus
                  placeholder="שם שכונה חדשה"
                  className={inp}
                />
                <button onClick={handleAddNeighborhood} className="px-3 py-1.5 bg-[#1B3A6B] text-white rounded-lg text-xs font-semibold">הוסף</button>
                <button onClick={() => { setAddingNeighborhood(false); setNewNeighborhoodText(''); }} className="px-2 py-1.5 border border-slate-200 rounded-lg text-xs">×</button>
              </div>
            ) : (
              <div className="flex gap-1.5">
                <select value={form.neighborhood} onChange={f('neighborhood')} className={`${inp} flex-1`}>
                  <option value="">-- בחר שכונה --</option>
                  {neighborhoods.map(n => <option key={n} value={n}>{n}</option>)}
                </select>
                {isAdmin && (
                  <button onClick={() => setAddingNeighborhood(true)} className="px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs text-blue-600 hover:bg-blue-50 whitespace-nowrap">+ חדשה</button>
                )}
              </div>
            )}
          </Field>

          {/* Address */}
          <Field label="כתובת" colSpan><input value={form.address} onChange={f('address')} className={inp} /></Field>

          {/* Phone | Requires Appointment */}
          <Field label="טלפון (קו ישיר)"><input value={form.phone} onChange={f('phone')} type="tel" className={inp} /></Field>
          <Field label="תיאום מראש">
            <select value={form.requiresAppointment ? 'yes' : 'no'}
              onChange={e => setForm(p => ({ ...p, requiresAppointment: e.target.value === 'yes' }))} className={inp}>
              <option value="no">לא נדרש</option>
              <option value="yes">נדרש</option>
            </select>
          </Field>

          {/* Location */}
          <div className="col-span-2">
            <label className={lbl}>מיקום</label>
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <input
                  value={form.latitude ?? ''}
                  onChange={e => setForm(p => ({ ...p, latitude: parseFloat(e.target.value) || undefined }))}
                  type="number" step="any" placeholder="קו רוחב"
                  className={inp}
                />
              </div>
              <div className="flex-1">
                <input
                  value={form.longitude ?? ''}
                  onChange={e => setForm(p => ({ ...p, longitude: parseFloat(e.target.value) || undefined }))}
                  type="number" step="any" placeholder="קו אורך"
                  className={inp}
                />
              </div>
              <button
                type="button"
                onClick={() => { setPendingPick(form.latitude != null && form.longitude != null ? { lat: form.latitude, lng: form.longitude } : null); setMapModalOpen(true); }}
                className="flex items-center gap-1.5 px-3 py-2 border border-slate-200 rounded-lg text-sm text-blue-600 hover:bg-blue-50 whitespace-nowrap"
              >
                <MapPin size={14} /> בחר במפה
              </button>
            </div>
          </div>

          {/* Contacts */}
          <div className="col-span-2">
            <div className="flex items-center justify-between mb-1.5">
              <label className={lbl} style={{ marginBottom: 0 }}>אנשי קשר</label>
              <button
                type="button"
                onClick={() => setForm(p => ({ ...p, contacts: [...p.contacts, { name: '', phone: '' }] }))}
                className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 font-medium"
              >
                <Plus size={12} /> הוסף איש קשר
              </button>
            </div>
            {form.contacts.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: '6px', marginBottom: '4px' }}>
                <label className={lbl} style={{ marginBottom: 0 }}>שם איש קשר</label>
                <label className={lbl} style={{ marginBottom: 0 }}>טלפון</label>
                <div />
              </div>
            )}
            <div className="space-y-1.5">
              {form.contacts.map((c, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', alignItems: 'center', gap: '6px' }}>
                  <input value={c.name} onChange={e => updateContact(i, 'name', e.target.value)} className={inp} placeholder="שם" />
                  <input value={c.phone} onChange={e => updateContact(i, 'phone', e.target.value)} type="tel" className={inp} placeholder="טלפון" />
                  <button type="button" onClick={() => removeContact(i)} className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500">
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Opening hours — also used to generate appointment slots */}
          <Field label="שעות פתיחה" colSpan>
            <HoursScheduleEditor
              value={form.hoursSchedule}
              onChange={v => setForm(p => ({ ...p, hoursSchedule: v }))}
            />
          </Field>

          {/* Appointment config — only when requiresAppointment */}
          {form.requiresAppointment && (
            <div className="col-span-2 pt-3 border-t border-slate-100">
              <p className="text-sm font-semibold text-slate-700 mb-3">הגדרת תורים אונליין</p>
              <div className="grid grid-cols-3 gap-3">
                <Field label="משך תור (דקות)">
                  <input
                    type="number" min={5} step={5}
                    value={form.appointmentConfig.slotDurationMin}
                    onChange={e => setForm(p => ({ ...p, appointmentConfig: { ...p.appointmentConfig, slotDurationMin: parseInt(e.target.value) || 30 } }))}
                    className={inp}
                  />
                </Field>
                <Field label="חדרי הכנה (מקבילים)">
                  <input
                    type="number" min={1} step={1}
                    value={form.appointmentConfig.parallelTracks}
                    onChange={e => setForm(p => ({ ...p, appointmentConfig: { ...p.appointmentConfig, parallelTracks: parseInt(e.target.value) || 1 } }))}
                    className={inp}
                  />
                </Field>
                <Field label="מכפיל זמן הכנה">
                  <select
                    value={form.appointmentConfig.prepMultiplier}
                    onChange={e => setForm(p => ({ ...p, appointmentConfig: { ...p.appointmentConfig, prepMultiplier: parseInt(e.target.value) } }))}
                    className={inp}
                  >
                    <option value={2}>×2</option>
                    <option value={3}>×3</option>
                  </select>
                </Field>
              </div>
              <p className="text-xs text-slate-400 mt-2">שעות התורים מבוססות על שעות הפתיחה שהוגדרו למעלה.</p>
            </div>
          )}

          {/* Notes */}
          <Field label="הערות" colSpan>
            <textarea value={form.notes} onChange={f('notes')} rows={3} className={`${inp} resize-none`} />
          </Field>
        </div>

        <div className="flex gap-3 pt-4 border-t border-slate-100 mt-4">
          <button onClick={handleSave} disabled={saving || !form.name.trim() || !form.contacts[0]?.name.trim()}
            className="flex-1 bg-[#1B3A6B] text-white py-2.5 rounded-xl font-semibold text-sm hover:bg-[#15306a] disabled:opacity-50">
            {saving ? 'שומר...' : editing ? 'שמור שינויים' : 'הוסף'}
          </button>
          <button onClick={() => setModalOpen(false)} className="px-5 py-2.5 border border-slate-200 rounded-xl text-sm hover:bg-slate-50">ביטול</button>
        </div>
      </Modal>

      {/* Map picker modal */}
      <Modal open={mapModalOpen} title="בחר מיקום על המפה" onClose={() => setMapModalOpen(false)} size="xl">
        <div style={{ height: 480 }}>
          <MapPicker lat={pendingPick?.lat ?? null} lng={pendingPick?.lng ?? null} onPick={(lat, lng) => setPendingPick({ lat, lng })} />
        </div>
        {pendingPick && (
          <p className="text-xs text-slate-400 mt-2 text-center">{pendingPick.lat.toFixed(6)}, {pendingPick.lng.toFixed(6)}</p>
        )}
        <div className="flex gap-3 pt-4">
          <button onClick={() => { if (pendingPick) setForm(p => ({ ...p, latitude: pendingPick.lat, longitude: pendingPick.lng })); setMapModalOpen(false); }}
            disabled={!pendingPick} className="flex-1 bg-[#1B3A6B] text-white py-2.5 rounded-xl font-semibold text-sm hover:bg-[#15306a] disabled:opacity-40">
            אישור
          </button>
          <button onClick={() => setMapModalOpen(false)} className="px-5 py-2.5 border border-slate-200 rounded-xl text-sm hover:bg-slate-50">ביטול</button>
        </div>
      </Modal>

      <Modal open={!!deleteId} title="מחיקת מקווה" onClose={() => setDeleteId(null)} size="md">
        <p className="text-slate-600 text-sm mb-6">האם למחוק את המקווה?</p>
        <div className="flex gap-3">
          <button onClick={() => deleteId && handleDelete(deleteId)} className="flex-1 bg-red-500 text-white py-2.5 rounded-xl font-semibold text-sm hover:bg-red-600">מחק</button>
          <button onClick={() => setDeleteId(null)} className="px-5 py-2.5 border border-slate-200 rounded-xl text-sm hover:bg-slate-50">ביטול</button>
        </div>
      </Modal>

      <ExcelImportModal<Mikveh>
        open={importOpen} onClose={() => setImportOpen(false)}
        title="ייבוא מקואות מ-Excel" templateFilename="מקואות"
        fields={[
          { key: 'name', label: 'שם', required: true },
          { key: 'type', label: 'סוג', transform: v => (['women','men','both'].includes(v) ? v : 'women') },
          { key: 'neighborhood', label: 'שכונה' },
          { key: 'address', label: 'כתובת', required: true },
          { key: 'phone', label: 'טלפון' },
          { key: 'latitude', label: 'קו רוחב', transform: v => parseFloat(v) || undefined },
          { key: 'longitude', label: 'קו אורך', transform: v => parseFloat(v) || undefined },
          { key: 'notes', label: 'הערות' },
        ]}
        onImport={handleImport}
      />
    </div>
  );
}

const inp = 'w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 bg-white';
const lbl = 'block text-xs font-semibold text-slate-600 mb-1.5';
function Field({ label, children, colSpan }: { label: string; children: React.ReactNode; colSpan?: boolean }) {
  return <div className={colSpan ? 'col-span-2' : ''}><label className={lbl}>{label}</label>{children}</div>;
}
