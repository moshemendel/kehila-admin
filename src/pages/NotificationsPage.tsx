import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import {
  collection, query, orderBy, limit, getDocs, where, documentId, Timestamp,
} from 'firebase/firestore';
import { db } from '../firebase';
import { sendPush } from '../utils/push';
import { useAuth } from '../contexts/AuthContext';
import type { City } from '../types';
import { Bell, Send, Users, AlertCircle, CheckCircle2 } from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

type NotifChannel = 'eruv' | 'general';

interface SentNotification {
  id: string;
  cityId: string;
  cityName: string;
  channel: NotifChannel;
  roles: string[] | null;
  title: string;
  body: string;
  recipientCount: number;
  sentAt: Timestamp;
  sentBy: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const ROLE_OPTIONS = [
  { value: 'user',             label: 'משתמשים רשומים' },
  { value: 'guest',            label: 'אורחים' },
  { value: 'gabbai',           label: "גבאים" },
  { value: 'eruv_manager',     label: 'מנהלי עירוב' },
  { value: 'kosher_manager',   label: 'מנהלי כשרות' },
  { value: 'event_manager',    label: 'מנהלי אירועים' },
  { value: 'business_manager', label: 'מנהלי עסקים' },
  { value: 'city_admin',       label: 'מנהלי עיר' },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

interface TokenRecord { token: string; role: string; roles: string[]; }

async function fetchTokenRecords(cityId: string | 'all'): Promise<TokenRecord[]> {
  const col = collection(db, 'pushTokens');
  const snap = cityId === 'all'
    ? await getDocs(col)
    : await getDocs(query(col, where('cityId', '==', cityId)));

  return snap.docs.map(d => {
    const data       = d.data();
    const singleRole = data.role as string;
    return { token: data.token as string, role: singleRole, roles: (data.roles as string[] | undefined) ?? [singleRole] };
  });
}

function filterByChannel(records: TokenRecord[], channel: NotifChannel): TokenRecord[] {
  return channel === 'general' ? records.filter(r => r.role !== 'guest') : records;
}

// Per-role recipient counts for the audience chips — independent of which roles are
// currently selected, so the badges always show the full breakdown for this city/channel.
function countByRole(records: TokenRecord[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const r of records) {
    for (const role of r.roles) counts[role] = (counts[role] ?? 0) + 1;
  }
  return counts;
}


function formatTs(ts: Timestamp): string {
  const d = ts.toDate();
  return d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: '2-digit' })
    + ' · '
    + d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function NotificationsPage() {
  const { appUser } = useAuth();
  const { cityId: routeCityId } = useParams<{ cityId?: string }>();
  // A "dev" scoped to one city behaves like city_admin — locked to that city.
  const canPickCity = appUser?.role === 'super_admin' || (appUser?.role === 'dev' && !appUser?.cityId);

  // ── State ────────────────────────────────────────────────────────────────────

  const [cities, setCities]           = useState<City[]>([]);
  const [cityId, setCityId]           = useState<string>('');
  const [channel, setChannel]         = useState<NotifChannel>('eruv');
  const [roles, setRoles]             = useState<string[] | null>(null); // null = all roles
  const [title, setTitle]             = useState('');
  const [body, setBody]               = useState('');
  const [recipientCount, setRecipientCount] = useState<number | null>(null);
  const [countLoading, setCountLoading]     = useState(false);
  const [roleCounts, setRoleCounts]         = useState<Record<string, number>>({});
  const [targetScreen, setTargetScreen] = useState<string>('');
  const [sending, setSending]         = useState(false);
  const [result, setResult]           = useState<{ ok: boolean; msg: string } | null>(null);
  const [history, setHistory]         = useState<SentNotification[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [senderNames, setSenderNames] = useState<Record<string, string>>({});

  // ── Load cities ───────────────────────────────────────────────────────────────

  useEffect(() => {
    getDocs(collection(db, 'cities')).then(snap => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() } as City))
        .sort((a, b) => a.name.localeCompare(b.name, 'he'));
      setCities(list);
      // Default city selection
      if (!canPickCity) {
        setCityId(routeCityId ?? appUser?.cityId ?? '');
      } else if (routeCityId) {
        setCityId(routeCityId);
      } else if (list.length > 0) {
        setCityId('all');
      }
    });
  }, [canPickCity, routeCityId, appUser?.cityId]);

  // ── Load history ──────────────────────────────────────────────────────────────

  const loadHistory = useCallback(() => {
    setHistoryLoading(true);
    const myCityId = routeCityId ?? appUser?.cityId ?? '';
    // Multi-city accounts (super_admin / unscoped dev) oversee everything and see the
    // full history; everyone else sees every notification relevant to their own city
    // (their city plus any "all cities" broadcasts) — not just the ones they personally
    // sent, since a city can have more than one admin sending alerts.
    // Sorted client-side (rather than an additional `where` + `orderBy` combo) to avoid
    // depending on a composite index that may not exist for this field pairing.
    const historyQuery = canPickCity
      ? query(collection(db, 'sentNotifications'), orderBy('sentAt', 'desc'), limit(20))
      : query(collection(db, 'sentNotifications'), where('cityId', 'in', [myCityId, 'all']));
    getDocs(historyQuery).then(async snap => {
      const rows = snap.docs.map(d => ({ id: d.id, ...d.data() } as SentNotification));
      rows.sort((a, b) => b.sentAt.toMillis() - a.sentAt.toMillis());
      const trimmed = canPickCity ? rows : rows.slice(0, 20);
      setHistory(trimmed);
      setHistoryLoading(false);

      // Resolve sender uids to display names for the "שולח" column.
      const uids = Array.from(new Set(trimmed.map(n => n.sentBy).filter(Boolean)));
      if (uids.length > 0) {
        const usersSnap = await getDocs(query(collection(db, 'users'), where(documentId(), 'in', uids)));
        const names: Record<string, string> = {};
        usersSnap.docs.forEach(d => { names[d.id] = (d.data().displayName as string) ?? d.id; });
        setSenderNames(names);
      }
    }).catch(() => setHistoryLoading(false));
  }, [canPickCity, routeCityId, appUser?.cityId]);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  // ── Live recipient count + per-role breakdown ───────────────────────────────

  // Fetched once per city — re-filtered client-side as the channel/role selection changes,
  // so toggling audience chips doesn't re-query Firestore each time.
  const [tokenRecords, setTokenRecords] = useState<TokenRecord[]>([]);

  useEffect(() => {
    if (!cityId) { setTokenRecords([]); return; }
    setCountLoading(true);
    fetchTokenRecords(cityId).then(records => {
      setTokenRecords(records);
      setCountLoading(false);
    }).catch(() => setCountLoading(false));
  }, [cityId]);

  useEffect(() => {
    if (!cityId) { setRecipientCount(null); setRoleCounts({}); return; }
    const channelRecords = filterByChannel(tokenRecords, channel);
    setRoleCounts(countByRole(channelRecords));
    setRecipientCount(channelRecords.filter(r => !roles || r.roles.some(x => roles.includes(x))).length);
  }, [tokenRecords, roles, channel, cityId]);

  // ── Toggle role ───────────────────────────────────────────────────────────────

  function toggleRole(role: string) {
    setRoles(prev => {
      if (prev === null) {
        // Switch from "all" to specific — start with just this role
        return [role];
      }
      if (prev.includes(role)) {
        const next = prev.filter(r => r !== role);
        return next.length === 0 ? null : next; // back to "all" if none selected
      }
      return [...prev, role];
    });
  }

  // ── Send ──────────────────────────────────────────────────────────────────────

  async function handleSend() {
    if (!title.trim() || !body.trim() || !cityId) return;
    setSending(true);
    setResult(null);
    try {
      const cityName = cityId === 'all'
        ? 'כל הערים'
        : (cities.find(c => c.id === cityId)?.name ?? cityId);

      const data = targetScreen ? { screen: targetScreen } : undefined;

      const count = await sendPush({
        cityId, cityName,
        title: title.trim(),
        body: body.trim(),
        channel,
        roles,
        sentBy: appUser?.uid ?? '',
        data,
      });

      if (count === 0) {
        setResult({ ok: false, msg: 'לא נמצאו מכשירים רשומים עבור הקהל שנבחר.' });
        setSending(false);
        return;
      }

      setResult({ ok: true, msg: `הודעה נשלחה ל-${count} מכשירים.` });
      setTitle('');
      setBody('');
      loadHistory();
    } catch (e: any) {
      setResult({ ok: false, msg: `שגיאה בשליחה: ${e?.message ?? 'בעיה לא ידועה'}` });
    }
    setSending(false);
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  const canSend = title.trim().length > 0 && body.trim().length > 0 && cityId && !sending;

  return (
    <div className="p-8 max-w-4xl mx-auto" dir="rtl">

      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <div className="w-10 h-10 rounded-xl bg-[#1B3A6B]/10 flex items-center justify-center">
          <Bell size={20} className="text-[#1B3A6B]" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-800">שליחת התראות</h1>
          <p className="text-slate-400 text-sm">שלח הודעת push לכל משתמשי האפליקציה</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">

        {/* ── Composer ── */}
        <div className="lg:col-span-3 space-y-4">

          {/* City */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
            <label className="text-sm font-semibold text-slate-700 mb-2 block">עיר יעד</label>
            {!canPickCity ? (
              <div className="text-slate-600 font-medium">
                {cities.find(c => c.id === appUser?.cityId)?.name ?? 'העיר שלי'}
              </div>
            ) : (
              <select
                value={cityId}
                onChange={e => setCityId(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
              >
                <option value="all">כל הערים</option>
                {cities.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            )}
          </div>

          {/* Channel */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
            <label className="text-sm font-semibold text-slate-700 mb-3 block">סוג הודעה</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setChannel('eruv')}
                className={`flex flex-col items-center gap-1.5 px-3 py-3 rounded-xl border text-sm font-semibold transition-all ${
                  channel === 'eruv'
                    ? 'bg-[#1B3A6B] text-white border-[#1B3A6B]'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                }`}
              >
                <span className="text-lg">🕍</span>
                <span>עירוב</span>
                <span className={`text-xs font-normal ${channel === 'eruv' ? 'text-blue-200' : 'text-slate-400'}`}>
                  כולל אורחים
                </span>
              </button>
              <button
                onClick={() => setChannel('general')}
                className={`flex flex-col items-center gap-1.5 px-3 py-3 rounded-xl border text-sm font-semibold transition-all ${
                  channel === 'general'
                    ? 'bg-[#1B3A6B] text-white border-[#1B3A6B]'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                }`}
              >
                <span className="text-lg">📢</span>
                <span>כללי</span>
                <span className={`text-xs font-normal ${channel === 'general' ? 'text-blue-200' : 'text-slate-400'}`}>
                  משתמשים רשומים בלבד
                </span>
              </button>
            </div>
          </div>

          {/* Audience */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
            <div className="flex items-center justify-between mb-3">
              <label className="text-sm font-semibold text-slate-700">קהל יעד</label>
              <button
                onClick={() => setRoles(null)}
                className={`text-xs font-semibold px-3 py-1 rounded-full border transition-colors ${
                  roles === null
                    ? 'bg-[#1B3A6B] text-white border-[#1B3A6B]'
                    : 'text-slate-500 border-slate-200 hover:border-slate-300'
                }`}
              >
                כולם
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {ROLE_OPTIONS.map(r => {
                const active = roles !== null && roles.includes(r.value);
                return (
                  <button
                    key={r.value}
                    onClick={() => toggleRole(r.value)}
                    className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors ${
                      active
                        ? 'bg-[#1B3A6B] text-white border-[#1B3A6B]'
                        : 'text-slate-500 border-slate-200 hover:border-slate-300 hover:text-slate-700'
                    }`}
                  >
                    {r.label}
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                      active ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'
                    }`}>
                      {roleCounts[r.value] ?? 0}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Live recipient count */}
            <div className="mt-4 flex items-center gap-2 text-sm">
              <Users size={14} className="text-slate-400" />
              {countLoading ? (
                <span className="text-slate-400">סופר מכשירים...</span>
              ) : recipientCount !== null ? (
                <span className={recipientCount === 0 ? 'text-red-500 font-semibold' : 'text-slate-600'}>
                  <span className="font-bold text-slate-800">{recipientCount}</span> מכשירים יקבלו את ההודעה
                </span>
              ) : null}
            </div>
          </div>

          {/* Target screen */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
            <label className="text-sm font-semibold text-slate-700 mb-2 block">פתיחת מסך בלחיצה על ההודעה</label>
            <select
              value={targetScreen}
              onChange={e => setTargetScreen(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            >
              <option value="">ללא (פתיחת האפליקציה בלבד)</option>
              <option value="Home">🏠 בית</option>
              <option value="Eruv">🛡️ עירוב</option>
              <option value="Events">📅 אירועים</option>
              <option value="Restaurants">🍽️ כשרות</option>
              <option value="Synagogues">🕍 בתי כנסת</option>
              <option value="Mikveh">💧 מקווה</option>
              <option value="Gemach">🎁 גמ"ח</option>
              <option value="KashrutUpdates">✅ עדכוני כשרות</option>
            </select>
          </div>

          {/* Message */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 space-y-3">
            <label className="text-sm font-semibold text-slate-700 block">ההודעה</label>
            <div>
              <input
                value={title}
                onChange={e => setTitle(e.target.value)}
                maxLength={60}
                placeholder="כותרת (עד 60 תווים)"
                className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm placeholder:text-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
              />
              <div className="text-xs text-slate-400 mt-1 text-left">{title.length}/60</div>
            </div>
            <div>
              <textarea
                value={body}
                onChange={e => setBody(e.target.value)}
                maxLength={200}
                rows={3}
                placeholder="תוכן ההודעה (עד 200 תווים)"
                className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm placeholder:text-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500/30 resize-none"
              />
              <div className="text-xs text-slate-400 mt-1 text-left">{body.length}/200</div>
            </div>
          </div>

          {/* Result banner */}
          {result && (
            <div className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium ${
              result.ok
                ? 'bg-green-50 text-green-700 border border-green-200'
                : 'bg-red-50 text-red-700 border border-red-200'
            }`}>
              {result.ok
                ? <CheckCircle2 size={16} className="flex-shrink-0" />
                : <AlertCircle   size={16} className="flex-shrink-0" />}
              {result.msg}
            </div>
          )}

          {/* Send button */}
          <button
            onClick={handleSend}
            disabled={!canSend}
            className="w-full flex items-center justify-center gap-2 bg-[#1B3A6B] hover:bg-[#152d55] disabled:bg-slate-200 disabled:text-slate-400 text-white font-bold py-3 rounded-xl transition-colors text-sm"
          >
            <Send size={16} />
            {sending ? 'שולח...' : 'שלח התראה'}
          </button>
        </div>

        {/* ── Preview card ── */}
        <div className="lg:col-span-2">
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 sticky top-6">
            <div className="text-xs font-semibold text-slate-400 mb-3 uppercase tracking-wide">תצוגה מקדימה</div>
            <div className="bg-slate-800 rounded-2xl p-4 shadow-lg">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-[#1B3A6B] flex items-center justify-center flex-shrink-0">
                  <Bell size={14} className="text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-white text-sm font-bold truncate">
                    {title || 'כותרת ההודעה'}
                  </div>
                  <div className="text-slate-300 text-xs mt-0.5 leading-relaxed line-clamp-3">
                    {body || 'תוכן ההודעה יופיע כאן...'}
                  </div>
                </div>
              </div>
            </div>
            <p className="text-xs text-slate-400 mt-3 text-center">כך ההודעה תיראה בטלפון</p>
          </div>
        </div>
      </div>

      {/* ── History ── */}
      <div className="mt-8">
        <h2 className="font-bold text-slate-700 mb-3">הודעות שנשלחו לאחרונה</h2>
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          {historyLoading ? (
            <div className="py-10 text-center text-slate-400 text-sm">טוען היסטוריה...</div>
          ) : history.length === 0 ? (
            <div className="py-10 text-center text-slate-400 text-sm">עדיין לא נשלחו הודעות</div>
          ) : (
            <table className="w-full text-sm" dir="rtl">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500">תאריך</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500">עיר</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500">שולח</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500">סוג</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500">כותרת</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500">הודעה</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-slate-500">מכשירים</th>
                </tr>
              </thead>
              <tbody>
                {history.map((n, i) => (
                  <tr key={n.id} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}>
                    <td className="px-4 py-3 text-xs text-slate-400 whitespace-nowrap">{formatTs(n.sentAt)}</td>
                    <td className="px-4 py-3 font-medium text-slate-700 whitespace-nowrap">{n.cityName}</td>
                    <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{senderNames[n.sentBy] ?? '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${n.channel === 'eruv' ? 'bg-blue-50 text-blue-700' : 'bg-slate-100 text-slate-600'}`}>
                        {n.channel === 'eruv' ? '🕍 עירוב' : '📢 כללי'}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-semibold text-slate-800 max-w-[140px] truncate">{n.title}</td>
                    <td className="px-4 py-3 text-slate-500 max-w-[200px] truncate">{n.body}</td>
                    <td className="px-4 py-3 text-center font-bold text-[#1B3A6B]">{n.recipientCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
