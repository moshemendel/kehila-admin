import { useEffect, useState } from 'react';
import { collection, getDocs, query, where, doc, setDoc, deleteDoc, serverTimestamp, getDoc, updateDoc, arrayUnion, documentId } from 'firebase/firestore';
import { useNavigate, useParams } from 'react-router-dom';
import { db } from '../firebase';
import { useMapSync } from '../contexts/MapSyncContext';
import { useAuth } from '../contexts/AuthContext';
import type { Synagogue, NusachOption } from '../types';
import DataTable, { type Column } from '../components/DataTable';
import Modal from '../components/Modal';
import ExcelImportModal from '../components/ExcelImportModal';
import { exportToExcel } from '../utils/excel';
import { Plus, Trash2, Upload, Download } from 'lucide-react';
import { nanoid } from '../utils/nanoid';

// The create modal deliberately collects only enough to identify the synagogue.
// Everything else (contacts, gabbaim, coordinates, prayer times, shiurim,
// announcements) is edited on SynagogueDetailPage, which is a superset of these
// fields — duplicating them here meant two places to keep in sync.
const EMPTY = {
  name: '', nusach: [] as string[], neighborhood: '', address: { he: '' },
};

export default function SynagoguesPage() {
  const { cityId = '' } = useParams<{ cityId: string }>();
  const navigate = useNavigate();
  const { setMarkers, selectedId, setSelectedId } = useMapSync();
  const { appUser } = useAuth();
  const isAdmin = ['city_admin', 'super_admin', 'dev'].includes(appUser?.role ?? '');
  // A gabbai can hold other roles too — check the full roles array, not just the primary role.
  const roles      = appUser?.roles ?? (appUser?.role ? [appUser.role] : []);
  const isGabbai   = roles.includes('gabbai');
  const mySynIds   = appUser?.managedSynagogueIds ?? [];

  const [data, setData] = useState<Synagogue[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [nusachOptions, setNusachOptions] = useState<NusachOption[]>([]);
  const [addingNusach, setAddingNusach] = useState(false);
  const [newNusachLabel, setNewNusachLabel] = useState('');
  const [neighborhoods, setNeighborhoods] = useState<string[]>([]);
  const [addingNeighborhood, setAddingNeighborhood] = useState(false);
  const [newNeighborhoodText, setNewNeighborhoodText] = useState('');

  const loadNusach = async () => {
    if (!cityId) return;
    const snap = await getDoc(doc(db, 'cities', cityId));
    const opts = snap.data()?.nusachOptions as NusachOption[] | undefined;
    if (opts?.length) setNusachOptions(opts);
    const hoods = snap.data()?.neighborhoods as string[] | undefined;
    setNeighborhoods((hoods ?? []).sort((a, b) => a.localeCompare(b, 'he')));
  };

  const handleAddNeighborhood = async () => {
    const text = newNeighborhoodText.trim();
    if (!text || !cityId || neighborhoods.includes(text)) return;
    await updateDoc(doc(db, 'cities', cityId), { neighborhoods: arrayUnion(text) });
    setNeighborhoods(prev => [...prev, text].sort((a, b) => a.localeCompare(b, 'he')));
    setForm(p => ({ ...p, neighborhood: text }));
    setNewNeighborhoodText('');
    setAddingNeighborhood(false);
  };

  const handleAddNusach = async () => {
    const trimmed = newNusachLabel.trim();
    if (!trimmed || nusachOptions.some(o => o.label === trimmed)) return;
    const newOpt: NusachOption = { key: trimmed, label: trimmed };
    await updateDoc(doc(db, 'cities', cityId), { nusachOptions: arrayUnion(newOpt) });
    const updated = [...nusachOptions, newOpt];
    setNusachOptions(updated);
    setForm(p => ({ ...p, nusach: [...(p.nusach ?? []), trimmed] }));
    setNewNusachLabel('');
    setAddingNusach(false);
  };

  const toArr = (v: unknown): string[] =>
    Array.isArray(v) ? v : (typeof v === 'string' && v ? [v] : []);

  const nusachDisplay = (keys: unknown) =>
    toArr(keys).map(k => nusachOptions.find(o => o.key === k)?.label ?? k).join(' / ');

  const toggleNusach = (key: string) =>
    setForm(p => ({
      ...p,
      nusach: (p.nusach ?? []).includes(key)
        ? (p.nusach ?? []).filter(k => k !== key)
        : [...(p.nusach ?? []), key],
    }));

  const load = async () => {
    if (!cityId) return;
    setLoading(true);
    let rows: Synagogue[] = [];
    if (isGabbai && !isAdmin) {
      if (mySynIds.length > 0) {
        const snap = await getDocs(query(collection(db, 'synagogues'), where(documentId(), 'in', mySynIds)));
        rows = snap.docs.map(d => ({ id: d.id, ...d.data() }) as Synagogue);
      }
    } else {
      const snap = await getDocs(query(collection(db, 'synagogues'), where('cityId', '==', cityId)));
      rows = snap.docs.map(d => ({ id: d.id, ...d.data() }) as Synagogue);
    }
    setData(rows);
    setMarkers(rows.filter(s => s.latitude && s.longitude).map(s => ({
      id: s.id, lat: s.latitude!, lng: s.longitude!, label: s.name, type: 'synagogue' as const,
    })));
    setLoading(false);
  };

  useEffect(() => { load(); loadNusach(); }, [cityId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Map marker click → scroll to matching row and highlight it
  useEffect(() => {
    if (!selectedId) return;
    document.getElementById(`syn-row-${selectedId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [selectedId]);

  const openAdd = () => { setForm(EMPTY); setModalOpen(true); };

  const handleSave = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const id = nanoid();
      await setDoc(doc(db, 'synagogues', id), {
        ...form,
        id,
        cityId,
        weeklySchedule: { shacharit: [], mincha: [], maariv: [] },
        updatedAt: serverTimestamp(),
      });
      setModalOpen(false);
      // Straight into the full editor rather than back to the table — the new
      // record still needs contacts, coordinates and prayer times.
      navigate(`/cities/${cityId}/synagogues/${id}`);
    } catch (e: any) {
      alert(e?.message ?? 'שגיאה בשמירה');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    await deleteDoc(doc(db, 'synagogues', id));
    setDeleteId(null);
    load();
  };

  const handleImport = async (rows: Partial<Synagogue>[]) => {
    await Promise.all(rows.map(row => {
      const id = nanoid();
      return setDoc(doc(db, 'synagogues', id), {
        ...row, id, cityId,
        weeklySchedule: { shacharit: [], mincha: [], maariv: [] },
        updatedAt: serverTimestamp(),
      });
    }));
    load();
  };

  const handleExport = () => {
    exportToExcel(
      data.map(s => ({
        'שם': s.name, 'נוסח': nusachDisplay(s.nusach ?? []), 'שכונה': s.neighborhood ?? '',
        'כתובת': s.address?.he ?? '', 'טלפון': s.phone ?? '', 'רב': s.rabbi ?? '',
        'טלפון רב': s.rabbiPhone ?? '', 'גבאי': s.gabbaiName ?? '',
        'טלפון גבאי': s.gabbaiPhone ?? '', 'קו רוחב': s.latitude ?? '',
        'קו אורך': s.longitude ?? '', 'הערות': s.notes ?? '',
      })),
      'בתי_כנסת'
    );
  };

  const firstGabbai = (r: Synagogue) => r.gabbaim?.[0]?.name || r.gabbaiName || '—';
  const firstGabbaiPhone = (r: Synagogue) => r.gabbaim?.[0]?.phone || r.gabbaiPhone || '—';

  const columns: Column<Synagogue>[] = [
    { key: 'name',         header: 'שם',       sortable: true },
    { key: 'nusach',       header: 'נוסח',      render: r => nusachDisplay(r.nusach ?? []) },
    { key: 'neighborhood', header: 'שכונה',     sortable: true },
    { key: 'address',      header: 'כתובת',     render: r => r.address?.he ?? '—' },
    { key: 'gabbaiName',   header: 'גבאי',      render: firstGabbai },
    { key: 'gabbaiPhone',  header: 'טלפון גבאי', render: firstGabbaiPhone },
  ];

  const f = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }));


  return (
    <div className="p-8" dir="rtl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">בתי כנסת</h1>
          <p className="text-slate-400 text-sm mt-0.5">{data.length} בתי כנסת</p>
        </div>
        {isAdmin && (
          <div className="flex items-center gap-2">
            <button onClick={() => setImportOpen(true)}
              className="flex items-center gap-2 px-4 py-2 border border-slate-200 rounded-xl text-sm font-medium hover:bg-slate-50 transition-colors">
              <Upload size={15} /> ייבוא Excel
            </button>
            <button onClick={handleExport}
              className="flex items-center gap-2 px-4 py-2 border border-slate-200 rounded-xl text-sm font-medium hover:bg-slate-50 transition-colors">
              <Download size={15} /> ייצוא Excel
            </button>
            <button onClick={openAdd}
              className="flex items-center gap-2 px-4 py-2 bg-[#1B3A6B] text-white rounded-xl text-sm font-semibold hover:bg-[#15306a] transition-colors">
              <Plus size={15} /> הוסף בית כנסת
            </button>
          </div>
        )}
      </div>

      {loading ? (
        <div className="text-center py-16 text-slate-400">טוען...</div>
      ) : (
        <DataTable
          data={data}
          columns={columns}
          searchKeys={['name', 'neighborhood', 'rabbi']}
          onRowClick={row => { setSelectedId(row.id); navigate(`/cities/${cityId}/synagogues/${row.id}`); }}
          rowId={row => `syn-row-${row.id}`}
          highlightId={selectedId ?? undefined}
          actions={isAdmin ? (row => (
            <button onClick={() => setDeleteId(row.id)} className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500 transition-colors">
              <Trash2 size={14} />
            </button>
          )) : undefined}
        />
      )}

      {/* Add / Edit modal */}
      <Modal open={modalOpen} title="הוספת בית כנסת" onClose={() => setModalOpen(false)}>
        <div className="grid grid-cols-2 gap-4">
          <Field label="שם *" colSpan>
            <input value={form.name} onChange={f('name')} placeholder="שם בית הכנסת" className={inp} />
          </Field>
          <Field label="נוסח" colSpan>
            <div className="flex flex-wrap gap-1.5 mb-1.5">
              {nusachOptions.map(o => {
                const active = (form.nusach ?? []).includes(o.key);
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
          <Field label="כתובת">
            <input value={form.address?.he ?? ''} onChange={e => setForm(p => ({ ...p, address: { ...p.address, he: e.target.value } }))} className={inp} />
          </Field>
          <p className="col-span-2 text-xs text-slate-400 -mt-1">
            שאר הפרטים — טלפונים, רב, גבאים, מיקום וזמני תפילה — נערכים בעמוד בית הכנסת, שייפתח מיד לאחר ההוספה.
          </p>
        </div>
        <div className="flex gap-3 pt-4 border-t border-slate-100 mt-4">
          <button onClick={handleSave} disabled={saving || !form.name.trim()}
            className="flex-1 bg-[#1B3A6B] text-white py-2.5 rounded-xl font-semibold text-sm hover:bg-[#15306a] disabled:opacity-50 transition-colors">
            {saving ? 'שומר...' : 'הוסף והמשך לעריכה'}
          </button>
          <button onClick={() => setModalOpen(false)} className="px-5 py-2.5 border border-slate-200 rounded-xl text-sm hover:bg-slate-50">
            ביטול
          </button>
        </div>
      </Modal>

      {/* Delete confirm */}
      <Modal open={!!deleteId} title="מחיקת בית כנסת" onClose={() => setDeleteId(null)} size="md">
        <p className="text-slate-600 text-sm mb-6">האם למחוק את בית הכנסת? פעולה זו אינה ניתנת לביטול.</p>
        <div className="flex gap-3">
          <button onClick={() => deleteId && handleDelete(deleteId)}
            className="flex-1 bg-red-500 text-white py-2.5 rounded-xl font-semibold text-sm hover:bg-red-600">
            מחק
          </button>
          <button onClick={() => setDeleteId(null)} className="px-5 py-2.5 border border-slate-200 rounded-xl text-sm hover:bg-slate-50">
            ביטול
          </button>
        </div>
      </Modal>

      {/* Excel import */}
      <ExcelImportModal<Synagogue>
        open={importOpen}
        onClose={() => setImportOpen(false)}
        title="ייבוא בתי כנסת מ-Excel"
        templateFilename="בתי_כנסת"
        fields={[
          { key: 'name',         label: 'שם',          required: true },
          { key: 'nusach',       label: 'נוסח',         transform: v => v ? [v] : [] },
          { key: 'neighborhood', label: 'שכונה' },
          { key: 'phone',        label: 'טלפון' },
          { key: 'rabbi',        label: 'שם הרב' },
          { key: 'rabbiPhone',   label: 'טלפון רב' },
          { key: 'gabbaiName',   label: 'שם גבאי' },
          { key: 'gabbaiPhone',  label: 'טלפון גבאי' },
          { key: 'latitude',     label: 'קו רוחב',      transform: v => parseFloat(v) || undefined },
          { key: 'longitude',    label: 'קו אורך',      transform: v => parseFloat(v) || undefined },
          { key: 'notes',        label: 'הערות' },
        ]}
        onImport={handleImport}
      />
    </div>
  );
}

const inp = 'w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 bg-white';

function Field({ label, children, colSpan }: { label: string; children: React.ReactNode; colSpan?: boolean }) {
  return (
    <div className={colSpan ? 'col-span-2' : ''}>
      <label className="block text-xs font-semibold text-slate-600 mb-1.5">{label}</label>
      {children}
    </div>
  );
}
