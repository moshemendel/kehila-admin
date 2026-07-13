import { useEffect, useState } from 'react';
import { collection, getDocs, query, where, doc, deleteDoc, updateDoc, addDoc, serverTimestamp, getDoc, arrayUnion } from 'firebase/firestore';
import { db } from '../firebase';
import { useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useMapSync } from '../contexts/MapSyncContext';
import type { CommunityEvent, EventCategory, PendingCommunityEvent, City } from '../types';
import DataTable, { type Column } from '../components/DataTable';
import Modal from '../components/Modal';
import { Plus, Trash2, CheckCircle2, XCircle } from 'lucide-react';

const CATEGORY_LABELS: Record<EventCategory, string> = {
  shiur: 'שיעור', community: 'קהילה', youth: 'נוער', charity: 'צדקה',
  holiday: 'חגים', announcement: 'הודעה', alert: 'דחוף',
};

const EMPTY_FORM = {
  title: '', description: '', category: 'shiur' as EventCategory,
  startDate: '', location: '', neighborhood: '', isAlert: false,
};

interface PendingEvent extends PendingCommunityEvent { id: string; }

// `createdAt` is typed as Date but is actually stored (and read back) as a Firestore Timestamp.
function toMillis(v: unknown): number {
  if (v && typeof (v as { toMillis?: () => number }).toMillis === 'function') {
    return (v as { toMillis: () => number }).toMillis();
  }
  if (v instanceof Date) return v.getTime();
  return 0;
}

export default function EventsPage() {
  const { cityId = '' } = useParams<{ cityId: string }>();
  const { appUser } = useAuth();
  const { setMarkers } = useMapSync();

  const isAdmin = ['city_admin', 'super_admin', 'dev'].includes(appUser?.role ?? '');

  const [events, setEvents] = useState<CommunityEvent[]>([]);
  const [pending, setPending] = useState<PendingEvent[]>([]);
  const [tab, setTab] = useState<'published' | 'expired' | 'pending'>('published');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const [neighborhoods,       setNeighborhoods]       = useState<string[]>([]);
  const [addingNeighborhood,  setAddingNeighborhood]  = useState(false);
  const [newNeighborhoodText, setNewNeighborhoodText] = useState('');

  const load = async () => {
    if (!cityId) return;
    setLoading(true);
    setError(null);
    try {
      // Sorted client-side rather than combining `where` + `orderBy` on different
      // fields, which needs a composite index that isn't guaranteed to exist.
      const [eSnap, pSnap] = await Promise.all([
        getDocs(query(collection(db, 'events'), where('cityId', '==', cityId))),
        getDocs(query(collection(db, 'pending_events'), where('cityId', '==', cityId), where('status', '==', 'pending'))),
      ]);
      const loadedEvents = eSnap.docs.map(d => ({ id: d.id, ...d.data() }) as CommunityEvent);
      loadedEvents.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
      setEvents(loadedEvents);
      setPending(pSnap.docs.map(d => ({ id: d.id, ...d.data() }) as PendingEvent));
    } catch (err) {
      console.error('Failed to load events', err);
      setError(err instanceof Error ? err.message : 'שגיאה בטעינת האירועים');
    } finally {
      setLoading(false);
    }
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

  const handleCreate = async () => {
    if (!form.title.trim()) return;
    setSaving(true);
    await addDoc(collection(db, 'events'), {
      ...form, cityId, createdBy: appUser?.uid ?? '',
      createdAt: serverTimestamp(), isAlert: form.isAlert,
      neighborhood: form.neighborhood || undefined,
    });
    setSaving(false);
    setModalOpen(false);
    setForm(EMPTY_FORM);
    load();
  };

  const handleDelete = async (id: string) => {
    await deleteDoc(doc(db, 'events', id));
    setDeleteId(null);
    load();
  };

  const handleApprovePending = async (p: PendingEvent) => {
    await addDoc(collection(db, 'events'), {
      cityId, title: p.title, description: p.description, category: p.category,
      startDate: p.startDate, endDate: p.endDate, location: p.location,
      organizer: p.organizer, isAlert: p.isAlert,
      createdBy: p.submittedBy, createdAt: serverTimestamp(),
      synagogueId: p.synagogueId,
    });
    await updateDoc(doc(db, 'pending_events', p.id), { status: 'approved' });
    load();
  };

  const handleRejectPending = async (id: string) => {
    await updateDoc(doc(db, 'pending_events', id), { status: 'rejected' });
    load();
  };

  const columns: Column<CommunityEvent>[] = [
    { key: 'title', header: 'כותרת', sortable: true },
    { key: 'category', header: 'קטגוריה', render: r => CATEGORY_LABELS[r.category] ?? r.category },
    { key: 'neighborhood', header: 'שכונה', sortable: true },
    { key: 'startDate', header: 'תאריך', render: r => r.startDate ? new Date(r.startDate).toLocaleDateString('he-IL') : '—' },
    { key: 'location', header: 'מיקום' },
    { key: 'isAlert', header: 'דחוף', render: r => r.isAlert ? <span className="text-xs bg-red-50 text-red-600 px-2 py-0.5 rounded-full border border-red-100">דחוף</span> : null },
  ];

  const pendingColumns: Column<PendingEvent>[] = [
    { key: 'title', header: 'כותרת' },
    { key: 'synagogueName', header: 'בית כנסת', render: r => (r as any).synagogueName ?? '—' },
    { key: 'submittedByName', header: 'הוגש ע"י', render: r => (r as any).submittedByName ?? '—' },
    { key: 'category', header: 'קטגוריה', render: r => CATEGORY_LABELS[r.category] ?? r.category },
    { key: 'startDate', header: 'תאריך', render: r => r.startDate ? new Date(r.startDate).toLocaleDateString('he-IL') : '—' },
  ];

  const f = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }));

  // Events without a start date can't be judged expired, so they stay in "upcoming".
  const now = new Date();
  const upcomingEvents = events.filter(e => !e.startDate || new Date(e.startDate) >= now);
  const expiredEvents  = events.filter(e => e.startDate && new Date(e.startDate) < now);

  return (
    <div className="p-8" dir="rtl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">אירועים</h1>
          <p className="text-slate-400 text-sm mt-0.5">{upcomingEvents.length} אירועים פעילים</p>
        </div>
        <button onClick={() => setModalOpen(true)}
          className="flex items-center gap-2 px-4 py-2 bg-[#1B3A6B] text-white rounded-xl text-sm font-semibold hover:bg-[#15306a]">
          <Plus size={15} /> אירוע חדש
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-100 rounded-xl p-1 w-fit mb-5">
        {([['published', 'פורסם', upcomingEvents.length], ['pending', 'ממתין לאישור', pending.length], ['expired', 'ארכיון']] as const).map(([t, label, count]) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${tab === t ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}>
            {label} {count > 0 && <span className={`mr-1 text-xs px-1.5 py-0.5 rounded-full ${t === 'pending' ? 'bg-orange-100 text-orange-600' : 'bg-slate-200 text-slate-600'}`}>{count}</span>}
          </button>
        ))}
      </div>

      {error ? (
        <div className="text-center py-16 text-red-500 text-sm">
          שגיאה בטעינת האירועים: {error}
          <div className="mt-3">
            <button onClick={() => load()} className="px-4 py-1.5 border border-slate-200 rounded-lg text-sm hover:bg-slate-50">נסה שוב</button>
          </div>
        </div>
      ) : loading ? <div className="text-center py-16 text-slate-400">טוען...</div> : (
        tab === 'published' ? (
          <DataTable data={upcomingEvents} columns={columns} searchKeys={['title', 'location']}
            actions={row => (
              <button onClick={() => setDeleteId(row.id)} className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500"><Trash2 size={14} /></button>
            )}
          />
        ) : tab === 'expired' ? (
          <DataTable data={expiredEvents} columns={columns} searchKeys={['title', 'location']}
            actions={row => (
              <button onClick={() => setDeleteId(row.id)} className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500"><Trash2 size={14} /></button>
            )}
          />
        ) : (
          <DataTable data={pending} columns={pendingColumns} searchKeys={['title']}
            actions={row => (
              <div className="flex items-center gap-1">
                <button onClick={() => handleApprovePending(row)} className="p-1.5 rounded-lg hover:bg-green-50 text-slate-400 hover:text-green-600" title="אשר">
                  <CheckCircle2 size={16} />
                </button>
                <button onClick={() => handleRejectPending(row.id)} className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500" title="דחה">
                  <XCircle size={16} />
                </button>
              </div>
            )}
          />
        )
      )}

      {/* Create event modal */}
      <Modal open={modalOpen} title="אירוע חדש" onClose={() => setModalOpen(false)}>
        <div className="grid grid-cols-2 gap-4">
          <Field label="כותרת *" colSpan><input value={form.title} onChange={f('title')} className={inp} /></Field>
          <Field label="קטגוריה">
            <select value={form.category} onChange={f('category')} className={inp}>
              {Object.entries(CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field label="תאריך ושעה">
            <input value={form.startDate} onChange={f('startDate')} type="datetime-local" className={inp} />
          </Field>
          <Field label="שכונה">
            {addingNeighborhood ? (
              <div className="flex gap-1.5">
                <input value={newNeighborhoodText} onChange={e => setNewNeighborhoodText(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleAddNeighborhood()} autoFocus placeholder="שם שכונה חדשה" className={inp} />
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
          <Field label="מיקום" colSpan><input value={form.location} onChange={f('location')} className={inp} /></Field>
          <Field label="תיאור" colSpan>
            <textarea value={form.description} onChange={f('description')} rows={3} className={`${inp} resize-none`} />
          </Field>
          <div className="col-span-2 flex items-center gap-3">
            <input type="checkbox" id="isAlert" checked={form.isAlert}
              onChange={e => setForm(p => ({ ...p, isAlert: e.target.checked }))} className="w-4 h-4 accent-red-600" />
            <label htmlFor="isAlert" className="text-sm text-slate-600">סמן כהודעה דחופה</label>
          </div>
        </div>
        <div className="flex gap-3 pt-4 border-t border-slate-100 mt-4">
          <button onClick={handleCreate} disabled={saving || !form.title.trim()}
            className="flex-1 bg-[#1B3A6B] text-white py-2.5 rounded-xl font-semibold text-sm hover:bg-[#15306a] disabled:opacity-50">
            {saving ? 'שומר...' : 'פרסם אירוע'}
          </button>
          <button onClick={() => setModalOpen(false)} className="px-5 py-2.5 border border-slate-200 rounded-xl text-sm hover:bg-slate-50">ביטול</button>
        </div>
      </Modal>

      <Modal open={!!deleteId} title="מחיקת אירוע" onClose={() => setDeleteId(null)} size="md">
        <p className="text-slate-600 text-sm mb-6">האם למחוק את האירוע?</p>
        <div className="flex gap-3">
          <button onClick={() => deleteId && handleDelete(deleteId)} className="flex-1 bg-red-500 text-white py-2.5 rounded-xl font-semibold text-sm hover:bg-red-600">מחק</button>
          <button onClick={() => setDeleteId(null)} className="px-5 py-2.5 border border-slate-200 rounded-xl text-sm hover:bg-slate-50">ביטול</button>
        </div>
      </Modal>
    </div>
  );
}

const inp = 'w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 bg-white';
function Field({ label, children, colSpan }: { label: string; children: React.ReactNode; colSpan?: boolean }) {
  return <div className={colSpan ? 'col-span-2' : ''}><label className="block text-xs font-semibold text-slate-600 mb-1.5">{label}</label>{children}</div>;
}
