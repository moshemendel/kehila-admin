import { useEffect, useState } from 'react';
import {
  collection, getDocs, getDoc, query, where, doc,
  deleteDoc, updateDoc, addDoc, serverTimestamp, arrayUnion,
} from 'firebase/firestore';
import { db } from '../firebase';
import { useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import type { Cemetery, Area } from '../types';
import DataTable, { type Column } from '../components/DataTable';
import Modal from '../components/Modal';
import { Plus, Trash2, Flower2, MapPin } from 'lucide-react';
import CemeteryPlotsModal from '../components/CemeteryPlotsModal';
import { useRoleCatalogue } from '../utils/roleCatalogue';
// The same click-to-place map the synagogue page uses.
import { MapPicker } from './SynagogueDetailPage';
import AddressGeocodeField from '../components/AddressGeocodeField';

const EMPTY_FORM = {
  name: '', areaIds: [] as string[], neighborhood: '', address: '',
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
  const [plotsFor,   setPlotsFor]   = useState<Cemetery | null>(null);
  // The city's neighbourhoods (one list shared with synagogues and the rest) and
  // the map the location is picked on.
  const [neighborhoods, setNeighborhoods] = useState<string[]>([]);
  // Where the city is, so an address search resolves in the right town.
  const [cityInfo, setCityInfo] = useState<{ name: string; lat?: number; lon?: number }>({ name: '' });
  const [addingHood, setAddingHood]       = useState(false);
  const [newHood, setNewHood]             = useState('');
  const [mapOpen, setMapOpen]             = useState(false);
  const [pendingPick, setPendingPick]     = useState<{ lat: number; lng: number } | null>(null);

  const load = async () => {
    if (!cityId) return;
    setLoading(true);
    try {
      const [cSnap, aSnap, citySnap] = await Promise.all([
        getDocs(query(collection(db, 'cemeteries'), where('cityId', '==', cityId))),
        getDocs(query(collection(db, 'areas'), where('cityId', '==', cityId))),
        getDoc(doc(db, 'cities', cityId)),
      ]);
      const cd = citySnap.data();
      setCityInfo({ name: (cd?.name as string) ?? '', lat: cd?.latitude as number | undefined, lon: cd?.longitude as number | undefined });
      setNeighborhoods(((citySnap.data()?.neighborhoods as string[] | undefined) ?? []).slice().sort((a, b) => a.localeCompare(b, 'he')));
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
      name: c.name, areaIds: c.areaIds ?? [], neighborhood: c.neighborhood ?? '', address: c.address ?? '',
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
        neighborhood: form.neighborhood || null,
        address: form.address.trim() || null,
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

  const handleAddNeighborhood = async () => {
    const text = newHood.trim();
    if (!text || !cityId || neighborhoods.includes(text)) return;
    await updateDoc(doc(db, 'cities', cityId), { neighborhoods: arrayUnion(text) });
    setNeighborhoods(prev => [...prev, text].sort((a, b) => a.localeCompare(b, 'he')));
    setForm(p => ({ ...p, neighborhood: text }));
    setNewHood('');
    setAddingHood(false);
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
    { key: 'neighborhood', header: 'שכונה', sortable: true, render: c => c.neighborhood ?? '—' },
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
          actionsHeader="פעולות"
          actions={isAdmin ? (c) => (
            <div className="flex items-center gap-1">
              <button
                onClick={(e) => { e.stopPropagation(); setPlotsFor(c); }}
                title="מיקום חלקות"
                className="flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-slate-800 text-xs font-semibold"
              >
                <MapPin size={14} />
                חלקות{c.registerPlots?.length ? ` (${Object.keys(c.plots ?? {}).length}/${c.registerPlots.length})` : ''}
              </button>
              <button onClick={() => setDeleteId(c.id)} className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500"><Trash2 size={14} /></button>
            </div>
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

          {/* Neighbourhood — the city's shared list, with a way to add one */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">שכונה</label>
            {addingHood ? (
              <div className="flex gap-1.5 items-center">
                <input
                  autoFocus
                  value={newHood}
                  onChange={e => setNewHood(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleAddNeighborhood(); if (e.key === 'Escape') setAddingHood(false); }}
                  placeholder="שם שכונה חדשה"
                  className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm text-right"
                />
                <button type="button" onClick={handleAddNeighborhood}
                  className="px-3 py-2 bg-slate-600 text-white rounded-lg text-xs font-semibold">הוסף</button>
                <button type="button" onClick={() => { setAddingHood(false); setNewHood(''); }}
                  className="px-3 py-2 border border-slate-200 rounded-lg text-xs text-slate-500">ביטול</button>
              </div>
            ) : (
              <div className="flex gap-1.5 items-center">
                <select
                  value={form.neighborhood}
                  onChange={e => setForm(p => ({ ...p, neighborhood: e.target.value }))}
                  className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm text-right bg-white"
                >
                  <option value="">— בחר שכונה —</option>
                  {form.neighborhood && !neighborhoods.includes(form.neighborhood) && (
                    <option value={form.neighborhood}>{form.neighborhood}</option>
                  )}
                  {neighborhoods.map(n => <option key={n} value={n}>{n}</option>)}
                </select>
                <button type="button" onClick={() => setAddingHood(true)}
                  className="px-2.5 py-2 border border-slate-200 rounded-lg text-xs text-blue-600 hover:bg-blue-50 whitespace-nowrap">+ חדשה</button>
              </div>
            )}
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
            <div className="flex items-center justify-between mb-1">
              <label className="block text-sm font-semibold text-slate-700">קישור ניווט (Waze / Google Maps)</label>
              {form.latitude != null && form.longitude != null && (
                <button
                  type="button"
                  onClick={() => setForm(p => ({
                    ...p,
                    directionsUrl: `https://www.google.com/maps/dir/?api=1&destination=${p.latitude},${p.longitude}`,
                  }))}
                  className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                >
                  צור קישור מהקואורדינטות
                </button>
              )}
            </div>
            <input
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-left"
              dir="ltr"
              value={form.directionsUrl} onChange={e => setForm(p => ({ ...p, directionsUrl: e.target.value }))}
              placeholder="https://waze.com/..."
            />
          </div>

          {/* Address — "אתר" resolves it to coordinates, as on the synagogue page */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">כתובת</label>
            <AddressGeocodeField
              value={form.address}
              onChange={v => setForm(p => ({ ...p, address: v }))}
              onPick={r => setForm(p => ({ ...p, latitude: r.latitude, longitude: r.longitude }))}
              cityName={cityInfo.name}
              cityLat={cityInfo.lat}
              cityLon={cityInfo.lon}
              cbsCode={(areas.find(a => a.id === form.areaIds[0]) ?? areas.find(a => a.isDefault))?.cbsCode}
              inputClassName="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-right"
            />
          </div>

          <div className="flex items-center justify-between -mb-1">
            <label className="block text-sm font-semibold text-slate-700">מיקום</label>
            <button
              type="button"
              onClick={() => {
                setPendingPick(form.latitude != null && form.longitude != null ? { lat: form.latitude, lng: form.longitude } : null);
                setMapOpen(true);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors"
            >
              <MapPin size={13} /> בחר במפה
            </button>
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

      {/* Map picker — click to place the cemetery */}
      <Modal open={mapOpen} title="בחר מיקום על המפה" onClose={() => setMapOpen(false)} size="xl">
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
                setForm(p => ({ ...p, latitude: Number(pendingPick.lat.toFixed(6)), longitude: Number(pendingPick.lng.toFixed(6)) }));
              }
              setMapOpen(false);
            }}
            disabled={!pendingPick}
            className="flex-1 bg-slate-600 text-white py-2.5 rounded-xl font-semibold text-sm hover:bg-slate-700 disabled:opacity-40"
          >
            אישור
          </button>
          <button onClick={() => setMapOpen(false)} className="px-5 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-600">ביטול</button>
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
      <CemeteryPlotsModal cemetery={plotsFor} onClose={() => setPlotsFor(null)} onSaved={load} />
    </div>
  );
}
