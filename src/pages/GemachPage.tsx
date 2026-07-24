import { useEffect, useState } from 'react';
import {
  collection, getDocs, query, where, doc,
  deleteDoc, updateDoc, addDoc, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase';
import { useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import type { Gemach, GemachCategory, PendingGemach } from '../types';
import DataTable, { type Column } from '../components/DataTable';
import Modal from '../components/Modal';
import { Plus, Trash2, CheckCircle2, XCircle, Gift } from 'lucide-react';

const CATEGORY_LABELS: Record<GemachCategory, string> = {
  clothing:  'ביגוד',
  baby:      'תינוקות',
  medical:   'ציוד רפואי',
  food:      'מזון',
  books:     'ספרים',
  wedding:   'חתנות',
  household: 'ציוד בית',
  tools:     'כלים',
  other:     'אחר',
};

const CATEGORIES = Object.entries(CATEGORY_LABELS) as [GemachCategory, string][];

const EMPTY_FORM = {
  name: '', category: 'clothing' as GemachCategory,
  contactName: '', phone: '', neighborhood: '',
  description: '', hours: '',
};

export default function GemachPage() {
  const { cityId = '' } = useParams<{ cityId: string }>();
  const { appUser } = useAuth();
  const isAdmin = ['city_admin', 'super_admin', 'dev'].includes(appUser?.role ?? '');

  const [gemachs,  setGemachs]  = useState<Gemach[]>([]);
  const [pending,  setPending]  = useState<PendingGemach[]>([]);
  const [tab,      setTab]      = useState<'published' | 'pending'>('published');
  const [loading,  setLoading]  = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [form,     setForm]     = useState(EMPTY_FORM);
  const [editId,   setEditId]   = useState<string | null>(null);
  const [saving,   setSaving]   = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const load = async () => {
    if (!cityId) return;
    setLoading(true);
    try {
      const [gSnap, pSnap] = await Promise.all([
        getDocs(query(collection(db, 'gemachs'), where('cityId', '==', cityId))),
        getDocs(query(collection(db, 'pending_gemachs'), where('cityId', '==', cityId), where('status', '==', 'pending'))),
      ]);
      const sorted = gSnap.docs
        .map(d => ({ id: d.id, ...d.data() }) as Gemach)
        .sort((a, b) => {
          const ta = (a as any).createdAt?.toMillis?.() ?? 0;
          const tb = (b as any).createdAt?.toMillis?.() ?? 0;
          return tb - ta;
        });
      setGemachs(sorted);
      setPending(pSnap.docs.map(d => ({ id: d.id, ...d.data() }) as PendingGemach));
    } catch (err) {
      console.error('GemachPage load error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [cityId]);

  const openAdd = () => { setForm(EMPTY_FORM); setEditId(null); setModalOpen(true); };
  const openEdit = (g: Gemach) => {
    setForm({
      name: g.name, category: g.category,
      contactName: g.contactName ?? '', phone: g.phone ?? '',
      neighborhood: g.neighborhood ?? '', description: g.description ?? '',
      hours: g.hours ?? '',
    });
    setEditId(g.id);
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      if (editId) {
        await updateDoc(doc(db, 'gemachs', editId), {
          ...form, name: form.name.trim(),
        });
      } else {
        await addDoc(collection(db, 'gemachs'), {
          ...form, name: form.name.trim(), cityId,
          isActive: true, createdAt: serverTimestamp(),
          createdBy: appUser?.uid ?? '',
        });
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
      await deleteDoc(doc(db, 'gemachs', deleteId));
      setDeleteId(null);
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'שגיאה במחיקה');
    }
  };

  const toggleActive = async (g: Gemach) => {
    try {
      await updateDoc(doc(db, 'gemachs', g.id), { isActive: !g.isActive });
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'שגיאה בעדכון');
    }
  };

  const approvePending = async (p: PendingGemach) => {
    try {
      await addDoc(collection(db, 'gemachs'), {
        cityId: p.cityId, name: p.name, category: p.category,
        contactName: p.contactName, phone: p.phone,
        neighborhood: p.neighborhood ?? null,
        description: p.description ?? null,
        hours: p.hours ?? null,
        isActive: true, createdAt: serverTimestamp(),
        // The original submitter owns the gemach once approved — not whoever
        // happened to click approve.
        createdBy: p.submittedBy ?? '',
      });
      await updateDoc(doc(db, 'pending_gemachs', p.id), { status: 'approved' });
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'שגיאה באישור');
    }
  };

  const rejectPending = async (p: PendingGemach) => {
    try {
      await updateDoc(doc(db, 'pending_gemachs', p.id), { status: 'rejected' });
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'שגיאה בדחייה');
    }
  };

  const gemachCols: Column<Gemach>[] = [
    { key: 'name',     label: 'שם הגמ"ח' },
    { key: 'category', label: 'קטגוריה',  render: g => CATEGORY_LABELS[g.category] },
    { key: 'phone',    label: 'טלפון',    render: g => g.phone ?? '—' },
    { key: 'neighborhood', label: 'שכונה', render: g => g.neighborhood ?? '—' },
    { key: 'isActive', label: 'פעיל',     render: g => (
      <button
        onClick={() => toggleActive(g)}
        className={`text-xs font-bold px-2 py-0.5 rounded-full ${
          g.isActive ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'
        }`}
      >
        {g.isActive ? 'פעיל' : 'מושבת'}
      </button>
    )},
  ];

  const pendingCols: Column<PendingGemach>[] = [
    { key: 'name',        label: 'שם הגמ"ח' },
    { key: 'category',    label: 'קטגוריה',  render: p => CATEGORY_LABELS[p.category] },
    { key: 'contactName', label: 'איש קשר' },
    { key: 'phone',       label: 'טלפון' },
    { key: 'submittedByName', label: 'הוגש ע"י', render: p => p.submittedByName ?? '—' },
  ];

  return (
    <div className="p-6 space-y-6" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Gift className="text-[#B06B3A]" size={24} />
          <div>
            <h1 className="text-2xl font-bold text-slate-800">גמ"ח</h1>
            <p className="text-sm text-slate-500">ניהול גמילות חסדים</p>
          </div>
          {pending.length > 0 && (
            <span className="bg-amber-100 text-amber-700 text-xs font-bold px-2 py-0.5 rounded-full">
              {pending.length} ממתינים לאישור
            </span>
          )}
        </div>
        {isAdmin && (
          <button
            onClick={openAdd}
            className="flex items-center gap-2 bg-[#B06B3A] hover:bg-[#8B5230] text-white px-4 py-2 rounded-lg text-sm font-semibold transition-colors"
          >
            <Plus size={16} /> הוסף גמ"ח
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-slate-200">
        {(['published', 'pending'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors ${
              tab === t
                ? 'border-[#B06B3A] text-[#B06B3A]'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {t === 'published' ? `גמ"חים פעילים (${gemachs.length})` : `ממתינים לאישור (${pending.length})`}
          </button>
        ))}
      </div>

      {/* Published list */}
      {tab === 'published' && (
        <DataTable
          columns={gemachCols}
          data={gemachs}
          loading={loading}
          onEdit={isAdmin ? openEdit : undefined}
          onDelete={isAdmin ? (g) => setDeleteId(g.id) : undefined}
          emptyMessage='אין גמ"חים עדיין'
        />
      )}

      {/* Pending list */}
      {tab === 'pending' && (
        <div className="space-y-3">
          {loading && <p className="text-slate-400 text-sm">טוען...</p>}
          {!loading && pending.length === 0 && (
            <p className="text-slate-400 text-sm text-center py-8">אין בקשות ממתינות</p>
          )}
          {pending.map(p => (
            <div key={p.id} className="bg-white border border-slate-200 rounded-xl p-4 flex items-start gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-bold text-slate-800">{p.name}</span>
                  <span className="text-xs bg-amber-50 text-amber-600 font-semibold px-2 py-0.5 rounded-full">
                    {CATEGORY_LABELS[p.category]}
                  </span>
                </div>
                <p className="text-sm text-slate-600">{p.contactName} · {p.phone}</p>
                {p.description && <p className="text-xs text-slate-400 mt-1">{p.description}</p>}
                {p.submittedByName && (
                  <p className="text-xs text-slate-400 mt-1">הוגש ע"י: {p.submittedByName}</p>
                )}
              </div>
              <div className="flex gap-2 flex-shrink-0">
                <button
                  onClick={() => approvePending(p)}
                  className="flex items-center gap-1 bg-green-50 hover:bg-green-100 text-green-700 text-xs font-semibold px-3 py-2 rounded-lg transition-colors"
                >
                  <CheckCircle2 size={14} /> אשר
                </button>
                <button
                  onClick={() => rejectPending(p)}
                  className="flex items-center gap-1 bg-red-50 hover:bg-red-100 text-red-600 text-xs font-semibold px-3 py-2 rounded-lg transition-colors"
                >
                  <XCircle size={14} /> דחה
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add/Edit modal */}
      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editId ? 'עריכת גמ"ח' : 'הוספת גמ"ח'}
      >
        <div className="space-y-4" dir="rtl">
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">שם הגמ"ח *</label>
            <input
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-right"
              value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
              placeholder='לדוגמה: גמ"ח בגדי ילדים'
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">קטגוריה</label>
            <select
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
              value={form.category}
              onChange={e => setForm(p => ({ ...p, category: e.target.value as GemachCategory }))}
            >
              {CATEGORIES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>

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
                value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))}
                placeholder="050-0000000"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">שכונה</label>
              <input
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-right"
                value={form.neighborhood} onChange={e => setForm(p => ({ ...p, neighborhood: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">שעות פעילות</label>
              <input
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-right"
                value={form.hours} onChange={e => setForm(p => ({ ...p, hours: e.target.value }))}
                placeholder='א-ה 9:00-12:00'
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">תיאור</label>
            <textarea
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-right"
              rows={3} value={form.description}
              onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
            />
          </div>

          <div className="flex gap-3 justify-end pt-2">
            <button onClick={() => setModalOpen(false)} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800">ביטול</button>
            <button
              onClick={handleSave} disabled={saving}
              className="px-5 py-2 bg-[#B06B3A] hover:bg-[#8B5230] text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-50"
            >
              {saving ? 'שומר...' : 'שמור'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Delete confirm */}
      <Modal isOpen={!!deleteId} onClose={() => setDeleteId(null)} title='מחיקת גמ"ח'>
        <p className="text-sm text-slate-600 mb-4">האם למחוק את הגמ"ח? פעולה זו אינה הפיכה.</p>
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
