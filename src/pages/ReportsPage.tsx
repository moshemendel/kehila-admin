import { useEffect, useState } from 'react';
import { collection, getDocs, query, where, doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { useParams, useNavigate } from 'react-router-dom';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import type { ContentReport, ReportEntityType, ReportReason } from '../types';
import DataTable, { type Column } from '../components/DataTable';
import { CheckCircle2, XCircle, Flag, ExternalLink } from 'lucide-react';

const REASON_LABELS: Record<ReportReason, string> = {
  wrong_hours:    'שעות לא נכונות',
  wrong_contact:  'טלפון / איש קשר',
  wrong_location: 'מיקום או כתובת',
  closed:         'המקום סגור / לא פעיל',
  wrong_details:  'פרטים אחרים שגויים',
  other:          'אחר',
};

const ENTITY_LABELS: Record<ReportEntityType, string> = {
  synagogue: 'בית כנסת',
  business:  'בית עסק',
  mikveh:    'מקווה',
  event:     'אירוע',
  gemach:    'גמ"ח',
};

/** Only synagogues have a detail page in this dashboard today. */
function entityHref(cityId: string, r: ContentReport): string | null {
  return r.entityType === 'synagogue' ? `/cities/${cityId}/synagogues/${r.entityId}` : null;
}

const fmtDate = (ts?: { seconds: number } | null) =>
  ts?.seconds ? new Date(ts.seconds * 1000).toLocaleDateString('he-IL') : '—';

export default function ReportsPage() {
  const { cityId = '' } = useParams<{ cityId: string }>();
  const navigate = useNavigate();
  const { appUser } = useAuth();

  const [data, setData]       = useState<ContentReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [showHandled, setShowHandled] = useState(false);

  // Scoped by role. Firestore rules are NOT filters: a manager who can't read
  // every report in the city would get permission-denied for the whole query,
  // so each role asks only for the subset the rules allow.
  // Mirrors fetchReportsFor in kehila-app/src/services/reports.ts — keep in sync.
  const load = async () => {
    if (!cityId || !appUser) return;
    setLoading(true);
    const roles: string[] = appUser.roles ?? (appUser.role ? [appUser.role] : []);
    const isAdmin = roles.some(r => ['city_admin', 'super_admin', 'dev'].includes(r));
    const col = collection(db, 'contentReports');
    const queries = [];

    if (isAdmin) {
      queries.push(query(col, where('cityId', '==', cityId)));
    } else {
      const synIds = (appUser.managedSynagogueIds ?? []).slice(0, 30);
      if (roles.includes('gabbai') && synIds.length)
        queries.push(query(col, where('cityId', '==', cityId), where('entityType', '==', 'synagogue'), where('entityId', 'in', synIds)));
      const bizIds = (appUser.managedRestaurantIds ?? []).slice(0, 30);
      if (roles.includes('business_manager') && bizIds.length)
        queries.push(query(col, where('cityId', '==', cityId), where('entityType', '==', 'business'), where('entityId', 'in', bizIds)));
      if (roles.includes('kosher_manager'))
        queries.push(query(col, where('cityId', '==', cityId), where('entityType', '==', 'business')));
      if (roles.includes('mikveh_manager'))
        queries.push(query(col, where('cityId', '==', cityId), where('entityType', '==', 'mikveh')));
      if (roles.includes('event_manager'))
        queries.push(query(col, where('cityId', '==', cityId), where('entityType', '==', 'event')));
    }

    const snaps = await Promise.all(queries.map(q => getDocs(q)));
    const byId = new Map<string, ContentReport>();
    snaps.forEach(snap => snap.docs.forEach(d => byId.set(d.id, { id: d.id, ...d.data() } as ContentReport)));
    setData([...byId.values()].sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0)));
    setLoading(false);
  };

  useEffect(() => { load(); }, [cityId, appUser]); // eslint-disable-line react-hooks/exhaustive-deps

  const handle = async (r: ContentReport, status: 'resolved' | 'dismissed') => {
    await updateDoc(doc(db, 'contentReports', r.id), {
      status,
      handledBy: appUser?.uid ?? '',
      handledAt: serverTimestamp(),
    });
    load();
  };

  const visible = showHandled ? data : data.filter(r => r.status === 'open');
  const openCount = data.filter(r => r.status === 'open').length;

  const columns: Column<ContentReport>[] = [
    {
      key: 'entityName',
      header: 'הפריט',
      render: r => {
        const href = entityHref(cityId, r);
        return (
          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-slate-700">{r.entityName}</span>
            <span className="text-xs text-slate-400">({ENTITY_LABELS[r.entityType]})</span>
            {href && (
              <button
                onClick={e => { e.stopPropagation(); navigate(href); }}
                className="text-blue-600 hover:text-blue-700"
                title="פתח את הפריט"
              >
                <ExternalLink size={13} />
              </button>
            )}
          </div>
        );
      },
    },
    { key: 'reason',  header: 'הבעיה',  render: r => REASON_LABELS[r.reason] ?? r.reason },
    {
      key: 'details',
      header: 'פירוט',
      render: r => r.details
        ? <span className="text-slate-600">{r.details}</span>
        : <span className="text-slate-300">—</span>,
    },
    { key: 'userName',  header: 'דיווח ע״י', render: r => r.userName || <span className="text-slate-400">אנונימי</span> },
    { key: 'createdAt', header: 'תאריך',    render: r => fmtDate(r.createdAt) },
    {
      key: 'status',
      header: 'סטטוס',
      render: r => (
        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
          r.status === 'open'     ? 'bg-amber-50 text-amber-700'
          : r.status === 'resolved' ? 'bg-emerald-50 text-emerald-700'
          : 'bg-slate-100 text-slate-500'
        }`}>
          {r.status === 'open' ? 'פתוח' : r.status === 'resolved' ? 'טופל' : 'נדחה'}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Flag size={20} className="text-amber-500" />
          <h1 className="text-xl font-bold text-slate-800">דיווחים על מידע שגוי</h1>
          {openCount > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-xs font-bold">
              {openCount} פתוחים
            </span>
          )}
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-500">
          <input type="checkbox" checked={showHandled} onChange={e => setShowHandled(e.target.checked)} />
          הצג גם דיווחים שטופלו
        </label>
      </div>

      {loading ? (
        <div className="text-center py-16 text-slate-400">טוען...</div>
      ) : visible.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          {showHandled ? 'אין דיווחים' : 'אין דיווחים פתוחים 🎉'}
        </div>
      ) : (
        <DataTable
          data={visible}
          columns={columns}
          searchKeys={['entityName', 'details', 'userName']}
          actions={r => r.status === 'open' ? (
            <div className="flex items-center gap-1">
              <button
                onClick={() => handle(r, 'resolved')}
                title="סמן כטופל"
                className="p-1.5 rounded-lg hover:bg-emerald-50 text-slate-400 hover:text-emerald-600"
              >
                <CheckCircle2 size={15} />
              </button>
              <button
                onClick={() => handle(r, 'dismissed')}
                title="דחה דיווח"
                className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600"
              >
                <XCircle size={15} />
              </button>
            </div>
          ) : null}
        />
      )}
    </div>
  );
}
