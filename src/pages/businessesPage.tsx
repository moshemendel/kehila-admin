import { useEffect, useRef, useState } from 'react';
import {
  collection, getDocs, query, where, doc, setDoc, deleteDoc,
  serverTimestamp, documentId, deleteField, getDoc, updateDoc, arrayUnion,
} from 'firebase/firestore';
import { ref as storageRef, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { db, storage } from '../firebase';
import { useParams, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useMapSync } from '../contexts/MapSyncContext';
import type { business, KosherCertificate, KosherLevel, City } from '../types';
import DataTable, { type Column } from '../components/DataTable';
import Modal from '../components/Modal';
import ExcelImportModal from '../components/ExcelImportModal';
import { exportToExcel } from '../utils/excel';
import { Plus, Pencil, Trash2, Upload, Download, ShieldCheck, EyeOff, ImagePlus, Star, X, MapPin } from 'lucide-react';
import 'leaflet/dist/leaflet.css';
import { MapContainer, TileLayer, Marker, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { nanoid } from '../utils/nanoid';
import ImageCropModal from '../components/ImageCropModal';
import { sendPush } from '../utils/push';

// Detects kosher-certificate activations/cancellations between saves, so admins
// (and the push we send below) find out about a cancellation even if it happens
// via a direct edit here rather than the mobile app's confirm-and-publish flow.
function detectCertChanges(
  oldCerts: KosherCertificate[],
  newCerts: KosherCertificate[],
): { issuedBy: string; active: boolean }[] {
  const changes: { issuedBy: string; active: boolean }[] = [];
  for (const oldC of oldCerts) {
    const match = newCerts.find(c => c.id === oldC.id);
    const isActiveNow = match?.isActive ?? false; // removed from the list = cancelled
    if (oldC.isActive !== isActiveNow) changes.push({ issuedBy: oldC.issuedBy, active: isActiveNow });
  }
  for (const newC of newCerts) {
    const existedBefore = oldCerts.some(c => c.id === newC.id);
    if (!existedBefore && newC.isActive) changes.push({ issuedBy: newC.issuedBy, active: true });
  }
  return changes;
}

// ─── Map picker ───────────────────────────────────────────────────────────────

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
    <MapContainer center={lat !== null && lng !== null ? [lat, lng] : [31.5, 35.0]} zoom={lat !== null && lng !== null ? 15 : 10} style={{ height: '100%', width: '100%' }}>
      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="© OpenStreetMap" />
      <MapClickHandler onPick={onPick} />
      {lat !== null && lng !== null && <Marker position={[lat, lng]} icon={PIN_ICON} />}
    </MapContainer>
  );
}

// ─── Constants ────────────────────────────────────────────────────────────────

const CATEGORIES = ['בשרי', 'חלבי', 'פרווה', 'טבעוני', 'קפה', 'מאפייה'];

const KOSHER_LEVELS: { value: KosherLevel; label: string }[] = [
  { value: 'mehadrin',      label: 'מהדרין'      },
  { value: 'regular',       label: 'רגיל'         },
  { value: 'chalav_israel', label: 'חלב ישראל'   },
  { value: 'bishul_israel', label: 'בישול ישראל' },
  { value: 'glatt',         label: 'גלאט'         },
];

const KL_LABEL: Record<KosherLevel, string> = Object.fromEntries(
  KOSHER_LEVELS.map(({ value, label }) => [value, label])
) as Record<KosherLevel, string>;

const DAYS_HE = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const DAYS_EN = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;

const EMPTY_FORM = {
  name: '', category: 'בשרי', neighborhood: '', address: '',
  phone: '', website: '', description: '', isHidden: false,
  latitude:  undefined as number | undefined,
  longitude: undefined as number | undefined,
  openingHours: {} as Record<string, string>,
};

type CertDraft = Omit<KosherCertificate, 'id'>;

const EMPTY_CERT: CertDraft = {
  issuedBy: '', kosherLevel: [], validFrom: '', validUntil: '', isActive: true, notes: '',
};


// ─── CertForm component ───────────────────────────────────────────────────────

function CertForm({ draft, onChange, onSave, onCancel, isNew }: {
  draft: CertDraft;
  onChange: (d: CertDraft) => void;
  onSave: () => void;
  onCancel: () => void;
  isNew?: boolean;
}) {
  const toggleLevel = (level: KosherLevel) => {
    const next = draft.kosherLevel.includes(level)
      ? draft.kosherLevel.filter(l => l !== level)
      : [...draft.kosherLevel, level];
    onChange({ ...draft, kosherLevel: next });
  };

  return (
    <div className="border border-blue-200 bg-blue-50/40 rounded-xl p-4 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="block text-xs font-semibold text-slate-600 mb-1.5">מגיש התעודה *</label>
          <input
            value={draft.issuedBy}
            onChange={e => onChange({ ...draft, issuedBy: e.target.value })}
            className={inp}
            placeholder='מעלה אדומים, בד"ץ מהדרין...'
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1.5">תוקף מ</label>
          <input type="date" value={draft.validFrom}
            onChange={e => onChange({ ...draft, validFrom: e.target.value })} className={inp} />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1.5">תוקף עד</label>
          <input type="date" value={draft.validUntil}
            onChange={e => onChange({ ...draft, validUntil: e.target.value })} className={inp} />
        </div>
      </div>

      <div>
        <label className="block text-xs font-semibold text-slate-600 mb-2">רמת כשרות</label>
        <div className="flex flex-wrap gap-2">
          {KOSHER_LEVELS.map(({ value, label }) => (
            <button key={value} type="button" onClick={() => toggleLevel(value)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                draft.kosherLevel.includes(value)
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-slate-600 border border-slate-200 hover:border-blue-300'
              }`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between pt-1">
        <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
          <input type="checkbox" checked={draft.isActive}
            onChange={e => onChange({ ...draft, isActive: e.target.checked })}
            className="w-4 h-4 accent-blue-600" />
          תעודה פעילה
        </label>
        <div className="flex gap-2">
          <button type="button" onClick={onCancel}
            className="px-3 py-1.5 text-xs border border-slate-200 rounded-lg hover:bg-white bg-white/60">
            ביטול
          </button>
          <button type="button" onClick={onSave} disabled={!draft.issuedBy.trim()}
            className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
            {isNew ? 'הוסף תעודה' : 'שמור'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function BusinessesPage() {
  const { cityId = '' } = useParams<{ cityId: string }>();
  const { appUser }     = useAuth();
  const { setMarkers }  = useMapSync();
  const location        = useLocation();

  // Route-based view mode: /kosher = kashrut mgmt, /businesses = ops mgmt
  const isOpsView      = location.pathname.endsWith('/businesses');
  const isKashrutView  = !isOpsView;

  const role           = appUser?.role ?? '';
  // A business manager can hold other roles too — check the full roles array, not just the primary role.
  const roles          = appUser?.roles ?? (appUser?.role ? [appUser.role] : []);
  const isBizManager   = roles.includes('business_manager');
  const isAdmin        = role === 'city_admin' || role === 'super_admin' || role === 'dev';
  const myBizIds       = appUser?.managedRestaurantIds ?? [];

  // On kashrut tab: show kashrut fields + cert CRUD + add/delete
  const canManageKash  = isKashrutView;
  // On businesses tab: show ops fields; business_manager filtered to their own
  const canManageOps   = isOpsView;

  // Business state
  const [data,       setData]       = useState<business[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [modalOpen,  setModalOpen]  = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editing,    setEditing]    = useState<business | null>(null);
  const [form,       setForm]       = useState(EMPTY_FORM);
  const [saving,     setSaving]     = useState(false);
  const [deleteId,   setDeleteId]   = useState<string | null>(null);

  // Certificate state (canManageKash only)
  const [certs,      setCerts]      = useState<KosherCertificate[]>([]);
  const [certEditId, setCertEditId] = useState<string | 'new' | null>(null);
  const [certDraft,  setCertDraft]  = useState<CertDraft>(EMPTY_CERT);

  // Image state (canManageOps)
  const [images,     setImages]     = useState<string[]>([]);  // ordered; [0] = primary
  const [uploading,  setUploading]  = useState(false);
  const [pendingId,  setPendingId]  = useState('');  // doc ID for new businesses
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Crop queue: files waiting to be cropped before upload
  const [cropQueue,    setCropQueue]    = useState<File[]>([]);
  const [cropFile,     setCropFile]     = useState<File | null>(null);
  const [cropFileIdx,  setCropFileIdx]  = useState(0);
  const [cropTotal,    setCropTotal]    = useState(0);

  // Neighborhood dropdown
  const [neighborhoods,       setNeighborhoods]       = useState<string[]>([]);
  const [addingNeighborhood,  setAddingNeighborhood]  = useState(false);
  const [newNeighborhoodText, setNewNeighborhoodText] = useState('');
  const [cityName, setCityName] = useState('');

  // Map modal
  const [mapModalOpen, setMapModalOpen] = useState(false);
  const [pendingPick,  setPendingPick]  = useState<{ lat: number; lng: number } | null>(null);

  // Contacts (איש קשר)
  const [contacts, setContacts] = useState<{ name: string; phone: string }[]>([]);

  // ── Data loading ────────────────────────────────────────────────────────────

  const load = async () => {
    if (!cityId) return;
    setLoading(true);
    try {
      let rows: business[] = [];

      if (isOpsView && isBizManager) {
        if (myBizIds.length > 0) {
          const snap = await getDocs(
            query(collection(db, 'businesses'), where(documentId(), 'in', myBizIds))
          );
          rows = snap.docs.map(d => ({ id: d.id, ...d.data() }) as business);
        }
      } else {
        const snap = await getDocs(
          query(collection(db, 'businesses'), where('cityId', '==', cityId))
        );
        rows = snap.docs.map(d => ({ id: d.id, ...d.data() }) as business);
      }

      setData(rows);
      setMarkers(rows.filter(r => r.latitude && r.longitude).map(r => ({
        id: r.id, lat: r.latitude!, lng: r.longitude!, label: r.name, type: 'business' as const,
      })));
    } catch (err) {
      console.error('Error loading businesses:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [cityId, isOpsView]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!cityId) return;
    getDoc(doc(db, 'cities', cityId)).then(snap => {
      const d = snap.data() as City | undefined;
      setNeighborhoods((d?.neighborhoods ?? []).sort(new Intl.Collator('he').compare));
      setCityName(d?.name ?? '');
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

  // ── Modal open helpers ──────────────────────────────────────────────────────

  const openAdd = () => {
    const id = nanoid();
    setEditing(null);
    setPendingId(id);
    setForm(EMPTY_FORM);
    setCerts([]);
    setCertEditId(null);
    setImages([]);
    setContacts([]);
    setPendingPick(null);
    setModalOpen(true);
  };

  const openEdit = (row: business) => {
    // Merge imageUrl (primary) + images (gallery) into one ordered list
    const allImages = [
      ...(row.imageUrl ? [row.imageUrl] : []),
      ...(row.images ?? []).filter(u => u !== row.imageUrl),
    ];
    setEditing(row);
    setPendingId(row.id);
    setForm({
      name: row.name, category: row.category, neighborhood: row.neighborhood ?? '',
      address: row.address ?? '', phone: row.phone ?? '', website: row.website ?? '',
      description: row.description ?? '', isHidden: row.isHidden ?? false,
      latitude: row.latitude, longitude: row.longitude,
      openingHours: (row.openingHours as any) ?? {},
    });
    setCerts(row.kosherCertificates ?? []);
    setCertEditId(null);
    setImages(allImages);
    setContacts(row.contacts?.map(c => ({ name: c.name, phone: c.phone ?? '' })) ?? []);
    setPendingPick(row.latitude != null && row.longitude != null ? { lat: row.latitude, lng: row.longitude } : null);
    setModalOpen(true);
  };

  // ── Image handlers ───────────────────────────────────────────────────────────

  const uploadBlob = async (blob: Blob, filename: string): Promise<string> => {
    const ext  = filename.split('.').pop()?.toLowerCase() ?? 'jpg';
    const path = `businesses/${pendingId}/gallery/${nanoid()}.${ext}`;
    const sRef = storageRef(storage, path);
    await uploadBytes(sRef, blob, { contentType: blob.type || `image/${ext}` });
    return getDownloadURL(sRef);
  };

  const advanceCropQueue = (remaining: File[]) => {
    if (remaining.length === 0) {
      setCropFile(null);
      setCropQueue([]);
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    setCropFile(remaining[0]);
    setCropFileIdx(cropTotal - remaining.length);
    setCropQueue(remaining.slice(1));
  };

  const onFilesSelected = (files: FileList) => {
    if (!files.length) return;
    const arr = Array.from(files);
    setCropTotal(arr.length);
    setCropFileIdx(0);
    setCropFile(arr[0]);
    setCropQueue(arr.slice(1));
  };

  const onCropConfirm = async (blob: Blob, filename: string) => {
    setCropFile(null);           // close crop modal immediately
    setUploading(true);
    try {
      const url = await uploadBlob(blob, filename);
      setImages(prev => [...prev, url]);
    } catch (err) {
      console.error('Image upload failed:', err);
    } finally {
      setUploading(false);
    }
    advanceCropQueue(cropQueue);
  };

  const onCropSkip = async (file: File) => {
    setCropFile(null);
    setUploading(true);
    try {
      const url = await uploadBlob(file, file.name);
      setImages(prev => [...prev, url]);
    } catch (err) {
      console.error('Image upload failed:', err);
    } finally {
      setUploading(false);
    }
    advanceCropQueue(cropQueue);
  };

  const onCropCancel = () => {
    setCropFile(null);
    setCropQueue([]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleImageDelete = (url: string) => {
    setImages(prev => prev.filter(u => u !== url));
    try {
      const match = url.match(/\/o\/(.+?)\?/);
      if (match) deleteObject(storageRef(storage, decodeURIComponent(match[1]))).catch(() => {});
    } catch { /* ignore */ }
  };

  const setPrimaryImage = (url: string) =>
    setImages(prev => [url, ...prev.filter(u => u !== url)]);

  // ── Save ────────────────────────────────────────────────────────────────────

  const handleSave = async () => {
    if (canManageKash && !form.name.trim()) return;
    setSaving(true);
    try {
      const id = pendingId || nanoid();
      const oldCerts = editing?.kosherCertificates ?? [];
      const newCerts = canManageKash ? certs : oldCerts;
      await setDoc(doc(db, 'businesses', id), {
        ...editing,
        ...(canManageKash ? {
          name: form.name, category: form.category, neighborhood: form.neighborhood,
          address: form.address,
          latitude:  form.latitude  ?? deleteField(),
          longitude: form.longitude ?? deleteField(),
          isHidden: form.isHidden,
          contacts: contacts.filter(c => c.name.trim()).map(c => ({ name: c.name, ...(c.phone ? { phone: c.phone } : {}) })),
        } : {}),
        ...(canManageOps ? {
          phone: form.phone, website: form.website,
          description: form.description, openingHours: form.openingHours,
          imageUrl: images[0] ?? '',
          images: images.slice(1),
        } : {}),
        id, cityId,
        kosherCertificates: newCerts,
        updatedAt: serverTimestamp(),
      }, { merge: true });

      if (canManageKash && editing) {
        // Awaited — setModalOpen(false) right after this closes/unmounts the modal,
        // which could abandon an un-awaited push mid-flight.
        for (const ch of detectCertChanges(oldCerts, newCerts)) {
          await sendPush({
            cityId, cityName,
            title: `${form.name} — ${ch.active ? 'עדכון כשרות' : 'ביטול כשרות'}`,
            body: ch.active ? `נוספה/הופעלה תעודת ${ch.issuedBy}` : `בוטלה תעודת ${ch.issuedBy}`,
            channel: 'general',
            sentBy: appUser?.uid ?? '',
            auto: true,
            data: { screen: 'Restaurants' },
          }).catch(() => {});
        }
      }

      setModalOpen(false);
      load();
    } catch (e: any) {
      alert(e?.message ?? 'שגיאה בשמירה');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    await deleteDoc(doc(db, 'businesses', id));
    setDeleteId(null);
    load();
  };

  const handleImport = async (rows: Partial<business>[]) => {
    await Promise.all(rows.map(row => {
      const id = nanoid();
      return setDoc(doc(db, 'businesses', id), {
        ...row, id, cityId, kosherCertificates: [], openingHours: {}, updatedAt: serverTimestamp(),
      });
    }));
    load();
  };

  const handleExport = () => {
    exportToExcel(
      data.map(r => ({
        'שם': r.name, 'קטגוריה': r.category, 'שכונה': r.neighborhood ?? '',
        'כתובת': r.address, 'טלפון': r.phone ?? '', 'אתר': r.website ?? '',
        'מוסתר': r.isHidden ? 'כן' : 'לא',
        'תעודות': r.kosherCertificates.filter(c => c.isActive).map(c => c.issuedBy).join(', '),
        'קו רוחב': r.latitude ?? '', 'קו אורך': r.longitude ?? '',
      })),
      'עסקים_כשרים'
    );
  };

  // ── Certificate helpers ─────────────────────────────────────────────────────

  const startAddCert  = () => { setCertDraft(EMPTY_CERT); setCertEditId('new'); };
  const startEditCert = (c: KosherCertificate) => {
    setCertDraft({ issuedBy: c.issuedBy, kosherLevel: [...c.kosherLevel], validFrom: c.validFrom, validUntil: c.validUntil, isActive: c.isActive, notes: c.notes ?? '' });
    setCertEditId(c.id);
  };
  const saveCert = () => {
    if (!certDraft.issuedBy.trim()) return;
    if (certEditId === 'new') {
      setCerts(p => [...p, { ...certDraft, id: nanoid() }]);
    } else if (certEditId) {
      setCerts(p => p.map(c => c.id === certEditId ? { ...c, ...certDraft } : c));
    }
    setCertEditId(null);
  };
  const deleteCert = (id: string) => setCerts(p => p.filter(c => c.id !== id));

  // ── Table columns ───────────────────────────────────────────────────────────

  const columns: Column<business>[] = [
    { key: 'name',     header: 'שם',       sortable: true },
    { key: 'category', header: 'קטגוריה' },
    { key: 'neighborhood', header: 'שכונה', sortable: true },
    { key: 'address',  header: 'כתובת' },
    {
      key: 'kosherCertificates', header: 'כשרות',
      render: r => (
        <div className="flex items-center gap-1">
          {r.kosherCertificates.filter(c => c.isActive).map(c => (
            <span key={c.id} className="flex items-center gap-1 text-xs bg-green-50 text-green-700 px-2 py-0.5 rounded-full border border-green-100">
              <ShieldCheck size={11} /> {c.issuedBy}
            </span>
          ))}
        </div>
      )
    },
    {
      key: 'isHidden', header: 'סטטוס',
      render: r => r.isHidden
        ? <span className="flex items-center gap-1 text-xs text-slate-400"><EyeOff size={12} /> מוסתר</span>
        : <span className="text-xs text-green-600">פעיל</span>
    },
  ];

  const canEdit = (row: business) =>
    canManageKash || (isOpsView && (!isBizManager || myBizIds.includes(row.id)));

  const f = (k: string) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm(p => ({ ...p, [k]: e.target.value }));

  const pageTitle  = isOpsView ? 'בתי עסק' : 'כשרות';
  const modalTitle = editing
    ? (isOpsView ? 'עריכת פרטי עסק' : 'עריכת עסק')
    : 'הוספת עסק';

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="p-8" dir="rtl">

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">{pageTitle}</h1>
          <p className="text-slate-400 text-sm mt-0.5">
            {isOpsView && isBizManager
              ? (data.length === 1 ? 'העסק שלך' : `${data.length} עסקים שלך`)
              : `${data.length} עסקים`}
          </p>
        </div>
        {canManageKash && (
          <div className="flex items-center gap-2">
            {isAdmin && (
              <>
                <button onClick={() => setImportOpen(true)} className="flex items-center gap-2 px-4 py-2 border border-slate-200 rounded-xl text-sm font-medium hover:bg-slate-50">
                  <Upload size={15} /> ייבוא Excel
                </button>
                <button onClick={handleExport} className="flex items-center gap-2 px-4 py-2 border border-slate-200 rounded-xl text-sm font-medium hover:bg-slate-50">
                  <Download size={15} /> ייצוא Excel
                </button>
              </>
            )}
            <button onClick={openAdd} className="flex items-center gap-2 px-4 py-2 bg-[#1B3A6B] text-white rounded-xl text-sm font-semibold hover:bg-[#15306a]">
              <Plus size={15} /> הוסף עסק
            </button>
          </div>
        )}
      </div>

      {/* Table */}
      {loading ? (
        <div className="text-center py-16 text-slate-400">טוען...</div>
      ) : isOpsView && isBizManager && data.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <p className="text-sm">לא נמצאו עסקים מקושרים לחשבון שלך.</p>
          <p className="text-xs mt-1 text-slate-300">פנה למנהל הכשרות לעדכון ההרשאות.</p>
        </div>
      ) : (
        <DataTable
          data={data} columns={columns} searchKeys={['name', 'category', 'neighborhood', 'address']}
          onRowClick={row => canEdit(row) ? openEdit(row) : undefined}
          actions={row => canEdit(row) ? (
            <div className="flex items-center gap-1">
              <button onClick={() => openEdit(row)} className="p-1.5 rounded-lg hover:bg-blue-50 text-slate-400 hover:text-blue-600">
                <Pencil size={14} />
              </button>
              {canManageKash && (
                <button onClick={() => setDeleteId(row.id)} className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500">
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ) : null}
        />
      )}

      {/* ── Edit / Add modal ── */}
      <Modal open={modalOpen} title={modalTitle} onClose={() => setModalOpen(false)}>
        <div className="space-y-4">

          {/* Ops view: read-only business name chip (no editing of the business name itself) */}
          {isOpsView && editing && (
            <div className="bg-slate-50 rounded-xl px-4 py-3 flex items-center gap-3 border border-slate-100">
              <span className="font-bold text-slate-800 text-sm">{editing.name}</span>
              <span className="text-slate-300">·</span>
              <span className="text-slate-500 text-xs">{editing.category}</span>
            </div>
          )}

          {/* ── Kashrut fields: name / category / neighborhood / address / location / hidden ── */}
          {canManageKash && (
            <div className="grid grid-cols-2 gap-4">
              <Field label="שם *" colSpan><input value={form.name} onChange={f('name')} className={inp} /></Field>
              <Field label="קטגוריה">
                <select value={form.category} onChange={f('category')} className={inp}>
                  {CATEGORIES.map(c => <option key={c}>{c}</option>)}
                </select>
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
              <Field label="כתובת" colSpan><input value={form.address} onChange={f('address')} className={inp} /></Field>

              {/* Location with map picker */}
              <div className="col-span-2">
                <label className="block text-xs font-semibold text-slate-600 mb-1.5">מיקום</label>
                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <input value={form.latitude ?? ''} type="number" step="any" placeholder="קו רוחב"
                      onChange={e => setForm(p => ({ ...p, latitude: parseFloat(e.target.value) || undefined }))} className={inp} />
                  </div>
                  <div className="flex-1">
                    <input value={form.longitude ?? ''} type="number" step="any" placeholder="קו אורך"
                      onChange={e => setForm(p => ({ ...p, longitude: parseFloat(e.target.value) || undefined }))} className={inp} />
                  </div>
                  <button type="button"
                    onClick={() => { setPendingPick(form.latitude != null && form.longitude != null ? { lat: form.latitude, lng: form.longitude } : null); setMapModalOpen(true); }}
                    className="flex items-center gap-1.5 px-3 py-2 border border-slate-200 rounded-lg text-sm text-blue-600 hover:bg-blue-50 whitespace-nowrap">
                    <MapPin size={14} /> בחר במפה
                  </button>
                </div>
              </div>

              {/* Contacts */}
              <div className="col-span-2">
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-semibold text-slate-600">אנשי קשר</label>
                  <button type="button" onClick={() => setContacts(p => [...p, { name: '', phone: '' }])}
                    className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 font-medium">
                    <Plus size={12} /> הוסף איש קשר
                  </button>
                </div>
                {contacts.length > 0 && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: '6px', marginBottom: '4px' }}>
                    <label className="text-xs font-semibold text-slate-600">שם איש קשר</label>
                    <label className="text-xs font-semibold text-slate-600">טלפון</label>
                    <div />
                  </div>
                )}
                <div className="space-y-1.5">
                  {contacts.map((c, i) => (
                    <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', alignItems: 'center', gap: '6px' }}>
                      <input value={c.name} onChange={e => setContacts(p => p.map((r, j) => j === i ? { ...r, name: e.target.value } : r))} className={inp} placeholder="שם" />
                      <input value={c.phone} onChange={e => setContacts(p => p.map((r, j) => j === i ? { ...r, phone: e.target.value } : r))} type="tel" className={inp} placeholder="טלפון" />
                      <button type="button" onClick={() => setContacts(p => p.filter((_, j) => j !== i))} className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="col-span-2 flex items-center gap-3">
                <input type="checkbox" id="isHidden" checked={form.isHidden}
                  onChange={e => setForm(p => ({ ...p, isHidden: e.target.checked }))} className="w-4 h-4 accent-blue-600" />
                <label htmlFor="isHidden" className="text-sm text-slate-600">הסתר מהאפליקציה (כשרות פגה / בהמתנה)</label>
              </div>
            </div>
          )}

          {/* ── Operational fields: phone / website / hours / description ── */}
          {canManageOps && (
            <div className={`grid grid-cols-2 gap-4${canManageKash ? ' pt-4 border-t border-slate-100' : ''}`}>
              <Field label="טלפון"><input value={form.phone} onChange={f('phone')} type="tel" className={inp} /></Field>
              <Field label="אתר אינטרנט"><input value={form.website} onChange={f('website')} type="url" className={inp} placeholder="https://" /></Field>
              <Field label="שעות פתיחה" colSpan>
                <div className="grid grid-cols-2 gap-2 mt-1">
                  {DAYS_EN.map((day, i) => (
                    <div key={day} className="flex items-center gap-2">
                      <span className="text-xs text-slate-500 w-12">{DAYS_HE[i]}</span>
                      <input
                        value={(form.openingHours as any)[day] ?? ''}
                        onChange={e => setForm(p => ({ ...p, openingHours: { ...p.openingHours, [day]: e.target.value } }))}
                        placeholder="09:00–22:00"
                        className={`${inp} flex-1 text-xs`}
                      />
                    </div>
                  ))}
                </div>
              </Field>
              <Field label="תיאור" colSpan>
                <textarea value={form.description} onChange={f('description')} rows={2} className={`${inp} resize-none`} />
              </Field>
            </div>
          )}

          {/* ── Image gallery (ops managers) ── */}
          {canManageOps && (
            <div className="pt-4 border-t border-slate-100">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-semibold text-slate-700">תמונות</span>
                <label className={`flex items-center gap-1.5 text-xs font-medium cursor-pointer transition-colors ${uploading ? 'text-slate-400 pointer-events-none' : 'text-blue-600 hover:text-blue-800'}`}>
                  <ImagePlus size={13} />
                  {uploading ? 'מעלה...' : 'הוספת תמונות'}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    disabled={uploading}
                    onChange={e => e.target.files && onFilesSelected(e.target.files)}
                  />
                </label>
              </div>

              {images.length === 0 ? (
                <p className="text-xs text-slate-400 text-center py-5 border border-dashed border-slate-200 rounded-xl">
                  אין תמונות — לחץ על "הוספת תמונות" להוספה
                </p>
              ) : (
                <div className="space-y-3">

                  {/* Primary / mood image — full width */}
                  <div>
                    <div className="flex items-center gap-1 mb-1.5">
                      <Star size={11} className="fill-amber-400 text-amber-400" />
                      <span className="text-[11px] font-semibold text-amber-600 uppercase tracking-wide">תמונת מצב</span>
                    </div>
                    <div className="relative rounded-xl overflow-hidden border-2 border-amber-300 bg-slate-100 h-40 group">
                      <img src={images[0]} alt="mood" className="w-full h-full object-contain" />
                      <button
                        type="button"
                        onClick={() => handleImageDelete(images[0])}
                        className="absolute top-2 left-2 p-1.5 rounded-lg bg-black/40 text-white hover:bg-red-500/80 transition-colors opacity-0 group-hover:opacity-100"
                      >
                        <X size={13} />
                      </button>
                    </div>
                  </div>

                  {/* Additional images */}
                  {images.length > 1 && (
                    <div>
                      <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-1.5">תמונות נוספות</p>
                      <div className="flex flex-wrap gap-3">
                        {images.slice(1).map((url) => (
                          <div key={url} className="flex flex-col gap-1 items-center">
                            <div className="relative rounded-xl overflow-hidden border border-slate-200 bg-slate-100 w-20 h-20 group flex-shrink-0">
                              <img src={url} alt="" className="w-full h-full object-contain" />
                              <button
                                type="button"
                                onClick={() => handleImageDelete(url)}
                                className="absolute top-1 left-1 p-1 rounded-lg bg-black/40 text-white hover:bg-red-500/80 transition-colors opacity-0 group-hover:opacity-100"
                              >
                                <X size={11} />
                              </button>
                            </div>
                            <button
                              type="button"
                              onClick={() => setPrimaryImage(url)}
                              className="flex items-center gap-0.5 text-[10px] font-medium text-amber-600 hover:text-amber-800 transition-colors"
                            >
                              <Star size={9} />
                              הגדר כמצב
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── Certificate CRUD (kashrut managers + admin) ── */}
          {canManageKash && (
            <div className="pt-4 border-t border-slate-100">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-semibold text-slate-700">תעודות כשרות</span>
                {certEditId !== 'new' && (
                  <button onClick={startAddCert}
                    className="flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-800 font-medium">
                    <Plus size={13} /> הוסף תעודה
                  </button>
                )}
              </div>

              <div className="space-y-2">
                {certs.map(cert =>
                  certEditId === cert.id ? (
                    <CertForm key={cert.id} draft={certDraft} onChange={setCertDraft} onSave={saveCert} onCancel={() => setCertEditId(null)} />
                  ) : (
                    <div key={cert.id} className={`flex items-center gap-3 p-3 rounded-xl border ${cert.isActive ? 'bg-green-50 border-green-100' : 'bg-slate-50 border-slate-100'}`}>
                      <ShieldCheck size={15} className={cert.isActive ? 'text-green-600' : 'text-slate-300'} />
                      <div className="flex-1 min-w-0">
                        <div className={`text-sm font-medium ${cert.isActive ? 'text-green-800' : 'text-slate-400 line-through'}`}>
                          {cert.issuedBy}
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5">
                          {cert.kosherLevel.map(l => KL_LABEL[l]).join(' · ')}
                          {cert.validUntil && ` · תוקף עד ${cert.validUntil}`}
                        </div>
                      </div>
                      <button onClick={() => startEditCert(cert)} className="p-1.5 rounded-lg hover:bg-white text-slate-400 hover:text-blue-600">
                        <Pencil size={13} />
                      </button>
                      <button onClick={() => deleteCert(cert.id)} className="p-1.5 rounded-lg hover:bg-white text-slate-400 hover:text-red-500">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  )
                )}

                {certs.length === 0 && certEditId !== 'new' && (
                  <p className="text-xs text-slate-400 text-center py-2">אין תעודות כשרות</p>
                )}

                {certEditId === 'new' && (
                  <CertForm draft={certDraft} onChange={setCertDraft} onSave={saveCert} onCancel={() => setCertEditId(null)} isNew />
                )}
              </div>
            </div>
          )}
        </div>

        <div className="flex gap-3 pt-4 border-t border-slate-100 mt-4">
          <button
            onClick={handleSave}
            disabled={saving || (canManageKash && !form.name.trim())}
            className="flex-1 bg-[#1B3A6B] text-white py-2.5 rounded-xl font-semibold text-sm hover:bg-[#15306a] disabled:opacity-50"
          >
            {saving ? 'שומר...' : editing ? 'שמור שינויים' : 'הוסף'}
          </button>
          <button onClick={() => setModalOpen(false)} className="px-5 py-2.5 border border-slate-200 rounded-xl text-sm hover:bg-slate-50">
            ביטול
          </button>
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

      {/* Delete confirm */}
      <Modal open={!!deleteId} title="מחיקת עסק" onClose={() => setDeleteId(null)} size="md">
        <p className="text-slate-600 text-sm mb-6">האם למחוק את העסק?</p>
        <div className="flex gap-3">
          <button onClick={() => deleteId && handleDelete(deleteId)} className="flex-1 bg-red-500 text-white py-2.5 rounded-xl font-semibold text-sm hover:bg-red-600">מחק</button>
          <button onClick={() => setDeleteId(null)} className="px-5 py-2.5 border border-slate-200 rounded-xl text-sm hover:bg-slate-50">ביטול</button>
        </div>
      </Modal>

      <ExcelImportModal<business>
        open={importOpen} onClose={() => setImportOpen(false)}
        title="ייבוא עסקים מ-Excel" templateFilename="עסקים_כשרים"
        fields={[
          { key: 'name', label: 'שם', required: true },
          { key: 'category', label: 'קטגוריה', required: true },
          { key: 'neighborhood', label: 'שכונה' },
          { key: 'address', label: 'כתובת', required: true },
          { key: 'phone', label: 'טלפון' },
          { key: 'website', label: 'אתר' },
          { key: 'latitude',  label: 'קו רוחב',  transform: v => parseFloat(v) || undefined },
          { key: 'longitude', label: 'קו אורך',  transform: v => parseFloat(v) || undefined },
        ]}
        onImport={handleImport}
      />

      {/* Image crop modal — shown before each upload */}
      <ImageCropModal
        file={cropFile}
        fileIndex={cropFileIdx}
        fileCount={cropTotal}
        onConfirm={onCropConfirm}
        onSkip={onCropSkip}
        onCancel={onCropCancel}
      />
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const inp = 'w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 bg-white';

function Field({ label, children, colSpan }: { label: string; children: React.ReactNode; colSpan?: boolean }) {
  return (
    <div className={colSpan ? 'col-span-2' : ''}>
      <label className="block text-xs font-semibold text-slate-600 mb-1.5">{label}</label>
      {children}
    </div>
  );
}
