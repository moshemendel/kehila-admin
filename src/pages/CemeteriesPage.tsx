import { useEffect, useState } from 'react';
import {
  collection, getDocs, query, where, doc,
  deleteDoc, updateDoc, addDoc, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase';
import { useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import type { Cemetery, Area } from '../types';
import DataTable, { type Column } from '../components/DataTable';
import Modal from '../components/Modal';
import { Plus, Trash2, Flower2 } from 'lucide-react';
import { useRoleCatalogue } from '../utils/roleCatalogue';

const EMPTY_FORM = {
  name: '', areaIds: [] as string[],
  contactName: '', contactPhone: '', directionsUrl: '',
  latitude: undefined as number | undefined,
  longitude: undefined as number | undefined,
  notes: '',
};

export default function CemeteriesPage() {
  const { cityId = '' } = useParams<{ cityId: string }>();
  const { appUser } = useAuth();
  const cat = useRoleCatalogue();
  // No dedicated operator role exists for cemeteries — same reasoning as
  // GemachPage: content authority only, nothing between a gabbai and a full
  // content admin fits a static contact record.
  const roles = appUser?.roles ?? (appUser?.role ? [appUser.role] : []);
  const isAdmin = roles.some(r => cat.byKey(r)?.content);

  const [cemeteries, setCemeteries] = useState<Cemetery[]>([]);
  const [areas,      setAreas]      = useState<Area[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [modalOpen,  setModalOpen]  = useState(false);
  const [form,       setForm]       = useState(EMPTY_FORM);
  const [editId,     setEditId]     = useState<string | null>(null);
  const [saving,     setSaving]     = useState(false);
  const [deleteId,   setDeleteId]   = useState<string | null>(null);

  const load = async () => {
    if (!cityId) return;
    setLoading(true);
    try {
      const [cSnap, aSnap] = await Promise.all([
        getDocs(query(collection(db, 'cemeteries'), where('cityId', '==', cityId))),
        getDocs(query(collection(db, 'areas'), where('cityId', '==', cityId))),
      ]);
      const sorted = cSnap.docs
        .map(d => ({ id: d.id, ...d.data() }) as Cemetery)
        .sort((a, b) => a.name.localeCompare(b.name, 'he'));
      setCemeteries(sorted);
      setAreas(aSnap.docs.map(d => ({ id: d.id, ...d.data() }) as Area)
        .sort((a, b) => a.name.localeCompare(b.name, 'he')));
    } catch (err) {
      console.error('CemeteriesPage load error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [cityId]); // eslint-disable-line react-hooks/exhaustive-deps

  const areaName = (id: string) => areas.find(a => a.id === id)?.name ?? id;

  const openAdd = () => { setForm(EMPTY_FORM); setEditId(null); setModalOpen(true); };
  const openEdit = (c: Cemetery) => {
    setForm({
      name: c.name, areaIds: c.areaIds ?? [],
      contactName: c.contactName ?? '', contactPhone: c.contactPhone ?? '',
      directionsUrl: c.directionsUrl ?? '',
      latitude: c.latitude, longitude: c.longitude,
      notes: c.notes ?? '',
    });
    setEditId(c.id);
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        areaIds: form.areaIds,
        contactName: form.contactName.trim() || null,
        contactPhone: form.contactPhone.trim() || null,
        directionsUrl: form.directionsUrl.trim() || null,
        latitude: form.latitude ?? null,
        longitude: form.longitude ?? null,
        notes: form.notes.trim() || null,
        updatedAt: serverTimestamp(),
      };
      if (editId) {
        await updateDoc(doc(db, 'cemeteries', editId), payload);
      } else {
        await addDoc(collection(db, 'cemeteries'), { ...payload, cityId });
      }
      setModalOpen(false);
      await load();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await deleteDoc(doc(db, 'cemeteries', deleteId));
      setDeleteId(null);
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'שגיאה במחיקה');
    }
  };

  const toggleArea = (id: string) => {
    setForm(p => ({
      ...p,
      areaIds: p.areaIds.includes(id) ? p.areaIds.filter(a => a !== id) : [...p.areaIds, id],
    }));
  };

  const cols: Column<Cemetery>[] = [
    { key: 'name', header: 'שם', sortable: true },
    { key: 'areaIds', header: 'יישוב/ים', render: c =>
      (c.areaIds ?? []).length ? (c.areaIds ?? []).map(areaName).join(' + ') : '—' },
    { key: 'contactName', header: 'איש קשר', render: c => c.contactName ?? '—' },
    { key: 'contactPhone', header: 'טלפון', render: c => c.contactPhone ?? '—' },
    { key: 'directionsUrl', header: 'ניווט', render: c => c.directionsUrl ? (
      <a href={c.directionsUrl} target="_blank" rel="noopener noreferrer"
        onClick={e => e.stopPropagation()}
        className="text-blue-600 hover:underline text-xs font-semibold">פתח ניווט</a>
    ) : '—' },
  ];

  return (
    <div className="p-6 space-y-6" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Flower2 className="text-slate-500" size={24} />
          <div>
            <h1 className="text-2xl font-bold text-slate-800">קבורה ובית עלמין</h1>
            <p className="text-sm text-slate-500">ניהול בתי עלמין ואנשי קשר</p>
          </div>
        </div>
        {isAdmin && (
          <button
            onClick={openAdd}
            className="flex items-center gap-2 bg-slate-600 hover:bg-slate-700 text-white px-4 py-2 rounded-lg text-sm font-semibold transition-colors"
          >
            <Plus size={16} /> הוסף בית עלמין
          </button>
        )}
      </div>

      {loading ? (
        <div className="text-center py-16 text-slate-400">טוען...</div>
      ) : (
        <DataTable
          columns={cols}
          data={cemeteries}
          searchKeys={['name', 'contactName']}
          onRowClick={isAdmin ? openEdit : undefined}
          actionsHeader="מחיקה"
          actions={isAdmin ? (c) => (
            <button onClick={() => setDeleteId(c.id)} className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500"><Trash2 size={14} /></button>
          ) : undefined}
        />
      )}

      {/* Add/Edit modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editId ? 'עריכת בית עלמין' : 'הוספת בית עלמין'}
      >
        <div className="space-y-4" dir="rtl">
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">שם *</label>
            <input
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-right"
              value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
              placeholder="לדוגמה: בית העלמין אפיקים"
            />
          </div>

          {/* Areas — hidden for a plain single-area city, the same "golden rule"
              the app itself follows: nothing to choose between. */}
          {areas.length > 1 && (
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">
                יישוב/ים שהבית עלמין משרת
              </label>
              <div className="flex flex-wrap gap-2">
                {areas.map(a => {
                  const active = form.areaIds.includes(a.id);
                  return (
                    <button
                      key={a.id} type="button" onClick={() => toggleArea(a.id)}
                      className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                        active ? 'bg-slate-700 text-white border-slate-700' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'
                      }`}
                    >
                      {a.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">שם איש קשר</label>
              <input
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-right"
                value={form.contactName} onChange={e => setForm(p => ({ ...p, contactName: e.target.value }))}
                placeholder="שם מלא"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">טלפון</label>
              <input
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-right"
                value={form.contactPhone} onChange={e => setForm(p => ({ ...p, contactPhone: e.target.value }))}
                placeholder="050-0000000"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">קישור ניווט (Waze / Google Maps)</label>
            <input
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-left"
              dir="ltr"
              value={form.directionsUrl} onChange={e => setForm(p => ({ ...p, directionsUrl: e.target.value }))}
              placeholder="https://waze.com/..."
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">קו רוחב</label>
              <input
                type="number" step="any"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-left"
                dir="ltr"
                value={form.latitude ?? ''}
                onChange={e => setForm(p => ({ ...p, latitude: parseFloat(e.target.value) || undefined }))}
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">קו אורך</label>
              <input
                type="number" step="any"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-left"
                dir="ltr"
                value={form.longitude ?? ''}
                onChange={e => setForm(p => ({ ...p, longitude: parseFloat(e.target.value) || undefined }))}
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">הערות</label>
            <textarea
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-right"
              rows={3} value={form.notes}
              onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
            />
          </div>

          <div className="flex gap-3 justify-end pt-2">
            <button onClick={() => setModalOpen(false)} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800">ביטול</button>
            <button
              onClick={handleSave} disabled={saving}
              className="px-5 py-2 bg-slate-600 hover:bg-slate-700 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-50"
            >
              {saving ? 'שומר...' : 'שמור'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Delete confirm */}
      <Modal open={!!deleteId} onClose={() => setDeleteId(null)} title="מחיקת בית עלמין">
        <p className="text-sm text-slate-600 mb-4">האם למחוק את בית העלמין? פעולה זו אינה הפיכה.</p>
        <div className="flex gap-3 justify-end">
          <button onClick={() => setDeleteId(null)} className="px-4 py-2 text-sm text-slate-600">ביטול</button>
          <button onClick={handleDelete} className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold rounded-lg">
            <Trash2 size={14} /> מחק
          </button>
        </div>
      </Modal>
    </div>
  );
}
