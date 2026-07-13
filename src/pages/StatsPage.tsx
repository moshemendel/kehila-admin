import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  collection, getDocs, query, where, orderBy, limit,
  Timestamp, getCountFromServer,
} from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import type { City } from '../types';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts';
import { ChevronDown } from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface CityStats {
  cityId: string; cityName: string;
  synagogues: number; restaurants: number; mikvaot: number; users: number; pushTokens: number;
}

interface GlobalStats {
  totalCities: number; totalUsers: number; totalSynagogues: number; totalRestaurants: number;
  totalMikvaot: number; totalEvents: number; totalPushTokens: number;
  eruvReportsOpen: number; eruvReportsResolved: number;
}

interface CityDetailStats {
  cityId: string; cityName: string;
  users: number; pushTokens: number; synagogues: number;
  businesses: number; mikvaot: number; events: number;
  eruvOpen: number; eruvResolved: number;
  roles: { name: string; value: number }[];
}

const ROLE_LABELS: Record<string, string> = {
  user: 'משתמש', gabbai: 'גבאי', business_manager: 'מנהל עסק',
  kosher_manager: 'מנהל כשרות', event_manager: 'מנהל אירועים',
  eruv_manager: 'מנהל עירוב', city_admin: 'מנהל עיר', dev: 'פיתוח', super_admin: 'מנהל על',
};

const ROLE_COLORS  = ['#1B3A6B','#3B82F6','#10B981','#F59E0B','#8B5CF6','#EF4444','#06B6D4','#64748B','#F97316'];
const CITY_COLORS  = ['#1B3A6B','#2563EB','#0891B2','#059669','#7C3AED','#DC2626','#D97706','#0D9488'];

// ─── Shared components ────────────────────────────────────────────────────────

function StatCard({ label, value, sub, color }: { label: string; value: number | string; sub?: string; color: string }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
      <div className={`text-xs font-semibold mb-1 ${color}`}>{label}</div>
      <div className="text-3xl font-black text-slate-800">{value}</div>
      {sub && <div className="text-xs text-slate-400 mt-0.5">{sub}</div>}
    </div>
  );
}

function HebTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-slate-200 rounded-xl px-3 py-2 shadow-lg text-sm" dir="rtl">
      <div className="font-semibold text-slate-700 mb-1">{label}</div>
      {payload.map((p: any, i: number) => (
        <div key={i} className="text-slate-600">{p.name}: <span className="font-bold">{p.value}</span></div>
      ))}
    </div>
  );
}

function RolePie({ data }: { data: { name: string; value: number }[] }) {
  return (
    <div className="flex gap-4 items-center">
      <PieChart width={170} height={170}>
        <Pie data={data} cx={85} cy={85} outerRadius={75} dataKey="value" nameKey="name">
          {data.map((_, i) => <Cell key={i} fill={ROLE_COLORS[i % ROLE_COLORS.length]} />)}
        </Pie>
        <Tooltip content={<HebTooltip />} />
      </PieChart>
      <div className="flex flex-col gap-1.5 flex-1 text-sm overflow-y-auto max-h-40">
        {data.map((r, i) => (
          <div key={r.name} className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: ROLE_COLORS[i % ROLE_COLORS.length] }} />
              <span className="text-slate-600 text-xs">{r.name}</span>
            </div>
            <span className="font-bold text-slate-800 text-xs">{r.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function EruvBar({ open, resolved }: { open: number; resolved: number }) {
  const total = open + resolved;
  return (
    <div className="flex gap-4 items-center">
      <div className="text-center">
        <div className="text-2xl font-black text-orange-500">{open}</div>
        <div className="text-xs text-slate-400">פתוחים</div>
      </div>
      <div className="text-center">
        <div className="text-2xl font-black text-green-500">{resolved}</div>
        <div className="text-xs text-slate-400">טופלו</div>
      </div>
      {total > 0 && (
        <div className="flex-1 flex items-center">
          <div className="w-full bg-slate-100 rounded-full h-3 overflow-hidden">
            <div className="bg-green-400 h-3 rounded-full" style={{ width: `${(resolved / total) * 100}%` }} />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function StatsPage() {
  const { appUser } = useAuth();
  const { cityId: routeCityId } = useParams<{ cityId?: string }>();
  // A "dev" scoped to one city behaves like city_admin — locked to that city, no picker/tabs.
  const canPickCity = appUser?.role === 'super_admin' || (appUser?.role === 'dev' && !appUser?.cityId);
  const lockedCityId = routeCityId ?? appUser?.cityId ?? '';

  const [tab, setTab]                   = useState<'global' | 'city'>(canPickCity && !routeCityId ? 'global' : 'city');
  const [cities, setCities]             = useState<City[]>([]);
  const [selectedCityId, setSelectedCityId] = useState<string>(canPickCity ? (routeCityId ?? '') : lockedCityId);

  // Global stats state
  const [global, setGlobal]             = useState<GlobalStats | null>(null);
  const [cityStats, setCityStats]       = useState<CityStats[]>([]);
  const [roleCounts, setRoleCounts]     = useState<{ name: string; value: number }[]>([]);
  const [recentEvents, setRecentEvents] = useState<{ name: string; count: number }[]>([]);
  const [globalLoading, setGlobalLoading] = useState(canPickCity);

  // City detail state
  const [cityDetail, setCityDetail]     = useState<CityDetailStats | null>(null);
  const [cityLoading, setCityLoading]   = useState(false);

  // ── Load cities list ────────────────────────────────────────────────────────
  useEffect(() => {
    getDocs(collection(db, 'cities')).then(snap => {
      setCities(snap.docs.map(d => ({ id: d.id, ...d.data() } as City)).sort((a, b) => a.name.localeCompare(b.name, 'he')));
    });
  }, []);

  // ── Load global stats (multi-city accounts only) ────────────────────────────
  useEffect(() => {
    if (!canPickCity) return;

    (async () => {
      const citiesSnap = await getDocs(collection(db, 'cities'));
      const allCities  = citiesSnap.docs.map(d => ({ id: d.id, ...d.data() } as City));

      const perCity: CityStats[] = await Promise.all(
        allCities.map(async city => {
          const cid = city.id;
          const cnt = (col: string) =>
            getCountFromServer(query(collection(db, col), where('cityId', '==', cid))).then(s => s.data().count);
          const [s, r, m, u, pt] = await Promise.all([
            cnt('synagogues'), cnt('businesses'), cnt('mikvaot'), cnt('users'), cnt('pushTokens'),
          ]);
          return { cityId: cid, cityName: city.name, synagogues: s, restaurants: r, mikvaot: m, users: u, pushTokens: pt };
        })
      );
      setCityStats(perCity.sort((a, b) => b.users - a.users));

      const allUsersSnap = await getDocs(collection(db, 'users'));
      const roleCount: Record<string, number> = {};
      allUsersSnap.docs.forEach(d => {
        const role = (d.data().role as string) ?? 'user';
        roleCount[role] = (roleCount[role] ?? 0) + 1;
      });
      setRoleCounts(
        Object.entries(roleCount)
          .map(([name, value]) => ({ name: ROLE_LABELS[name] ?? name, value }))
          .sort((a, b) => b.value - a.value)
      );

      const thirtyDaysAgo = Timestamp.fromDate(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
      const eventsSnap = await getDocs(
        query(collection(db, 'events'), where('createdAt', '>=', thirtyDaysAgo), orderBy('createdAt', 'desc'), limit(200))
      );
      const eventByCityRaw: Record<string, number> = {};
      eventsSnap.docs.forEach(d => {
        const cid = d.data().cityId as string;
        if (cid) eventByCityRaw[cid] = (eventByCityRaw[cid] ?? 0) + 1;
      });
      setRecentEvents(
        Object.entries(eventByCityRaw)
          .map(([cid, count]) => ({ name: allCities.find(c => c.id === cid)?.name ?? cid, count }))
          .sort((a, b) => b.count - a.count)
      );

      const [openEruv, resolvedEruv] = await Promise.all([
        getDocs(query(collection(db, 'eruvReports'), where('status', '==', 'open'))),
        getDocs(query(collection(db, 'eruvReports'), where('status', '==', 'resolved'))),
      ]);

      setGlobal({
        totalCities:         allCities.length,
        totalUsers:          perCity.reduce((a, c) => a + c.users, 0),
        totalSynagogues:     perCity.reduce((a, c) => a + c.synagogues, 0),
        totalRestaurants:    perCity.reduce((a, c) => a + c.restaurants, 0),
        totalMikvaot:        perCity.reduce((a, c) => a + c.mikvaot, 0),
        totalEvents:         eventsSnap.size,
        totalPushTokens:     perCity.reduce((a, c) => a + c.pushTokens, 0),
        eruvReportsOpen:     openEruv.size,
        eruvReportsResolved: resolvedEruv.size,
      });
      setGlobalLoading(false);
    })();
  }, [canPickCity]);

  // ── Load single-city detail stats ───────────────────────────────────────────
  useEffect(() => {
    if (!selectedCityId) return;
    let cancelled = false;

    (async () => {
      setCityLoading(true);
      setCityDetail(null);

      const cnt = (col: string) =>
        getCountFromServer(query(collection(db, col), where('cityId', '==', selectedCityId))).then(s => s.data().count);

      const [syn, biz, mik, push, evts] = await Promise.all([
        cnt('synagogues'), cnt('businesses'), cnt('mikvaot'), cnt('pushTokens'), cnt('events'),
      ]);

      const usersSnap = await getDocs(query(collection(db, 'users'), where('cityId', '==', selectedCityId)));
      const roleCount: Record<string, number> = {};
      usersSnap.docs.forEach(d => {
        const role = (d.data().role as string) ?? 'user';
        roleCount[role] = (roleCount[role] ?? 0) + 1;
      });

      const eruvSnap = await getDocs(query(collection(db, 'eruvReports'), where('cityId', '==', selectedCityId)));
      const eruvOpen     = eruvSnap.docs.filter(d => d.data().status === 'open').length;
      const eruvResolved = eruvSnap.docs.filter(d => d.data().status === 'resolved').length;

      const cityName = cities.find(c => c.id === selectedCityId)?.name ?? selectedCityId;

      if (!cancelled) {
        setCityDetail({
          cityId: selectedCityId, cityName,
          users: usersSnap.size, pushTokens: push,
          synagogues: syn, businesses: biz, mikvaot: mik, events: evts,
          eruvOpen, eruvResolved,
          roles: Object.entries(roleCount)
            .map(([name, value]) => ({ name: ROLE_LABELS[name] ?? name, value }))
            .sort((a, b) => b.value - a.value),
        });
        setCityLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [selectedCityId, cities]);

  // ── Derived ────────────────────────────────────────────────────────────────
  const totalPushRate = global && global.totalUsers > 0
    ? Math.round((global.totalPushTokens / global.totalUsers) * 100) : 0;
  const cityUsersData = cityStats.map(c => ({ name: c.cityName, משתמשים: c.users, 'Push': c.pushTokens }));
  const citySynData   = cityStats.map(c => ({ name: c.cityName, 'בתי כנסת': c.synagogues, כשרות: c.restaurants, מקואות: c.mikvaot }));
  const cityPushRate  = cityDetail && cityDetail.users > 0
    ? Math.round((cityDetail.pushTokens / cityDetail.users) * 100) : 0;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="p-8" dir="rtl">

      {/* Header + tabs */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">סטטיסטיקות</h1>
          <p className="text-slate-400 text-sm mt-0.5">
            {tab === 'city' ? (cities.find(c => c.id === selectedCityId)?.name ?? '') : 'נתונים כלל-מערכתיים'}
          </p>
        </div>
        {canPickCity && (
          <div className="flex gap-1 bg-slate-100 rounded-xl p-1">
            {(['global', 'city'] as const).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-4 py-2 text-sm font-semibold rounded-lg transition-colors ${
                  tab === t ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {t === 'global' ? 'כללי' : 'לפי עיר'}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Tab: Global ── */}
      {tab === 'global' && canPickCity && (
        globalLoading ? (
          <div className="grid grid-cols-4 gap-4">
            {[1,2,3,4].map(i => <div key={i} className="bg-white rounded-2xl border border-slate-100 h-28 animate-pulse" />)}
            <div className="col-span-4 text-center text-slate-400 text-sm py-8">טוען נתונים...</div>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3 mb-6">
              <StatCard label="ערים"        value={global?.totalCities ?? 0}      color="text-blue-600" />
              <StatCard label="משתמשים"     value={global?.totalUsers ?? 0}        color="text-purple-600" />
              <StatCard label="בתי כנסת"    value={global?.totalSynagogues ?? 0}  color="text-blue-600" />
              <StatCard label="עסקים כשרים" value={global?.totalRestaurants ?? 0} color="text-green-600" />
              <StatCard label="מקואות"      value={global?.totalMikvaot ?? 0}     color="text-cyan-600" />
              <StatCard label="Push רשומים" value={`${totalPushRate}%`} sub={`${global?.totalPushTokens} מכשירים`} color="text-orange-600" />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
              <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
                <h2 className="font-bold text-slate-700 mb-4">משתמשים לפי עיר</h2>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={cityUsersData} layout="vertical" margin={{ right: 16, left: 8 }}>
                    <XAxis type="number" tick={{ fontSize: 11 }} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 12 }} width={80} />
                    <Tooltip content={<HebTooltip />} />
                    <Legend iconSize={10} wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="משתמשים" fill="#1B3A6B" radius={[0, 4, 4, 0]} />
                    <Bar dataKey="Push"     fill="#93C5FD" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
                <h2 className="font-bold text-slate-700 mb-4">התפלגות תפקידים</h2>
                <RolePie data={roleCounts} />
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
              <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
                <h2 className="font-bold text-slate-700 mb-4">תוכן לפי עיר</h2>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={citySynData} layout="vertical" margin={{ right: 16, left: 8 }}>
                    <XAxis type="number" tick={{ fontSize: 11 }} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 12 }} width={80} />
                    <Tooltip content={<HebTooltip />} />
                    <Legend iconSize={10} wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="בתי כנסת" fill="#1B3A6B" radius={[0, 4, 4, 0]} />
                    <Bar dataKey="כשרות"    fill="#10B981" radius={[0, 4, 4, 0]} />
                    <Bar dataKey="מקואות"   fill="#06B6D4" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="flex flex-col gap-4">
                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 flex-1">
                  <h2 className="font-bold text-slate-700 mb-3">אירועים — 30 יום ({global?.totalEvents ?? 0})</h2>
                  {recentEvents.length === 0
                    ? <p className="text-slate-400 text-sm">אין אירועים</p>
                    : (
                      <div className="flex flex-col gap-2">
                        {recentEvents.slice(0, 5).map(({ name, count }, i) => {
                          const max = recentEvents[0]?.count ?? 1;
                          return (
                            <div key={name} className="flex items-center gap-3">
                              <span className="text-xs text-slate-500 w-24 text-right flex-shrink-0">{name}</span>
                              <div className="flex-1 bg-slate-100 rounded-full h-2">
                                <div className="h-2 rounded-full" style={{ width: `${(count / max) * 100}%`, backgroundColor: CITY_COLORS[i % CITY_COLORS.length] }} />
                              </div>
                              <span className="text-xs font-bold text-slate-700 w-4">{count}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                </div>
                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
                  <h2 className="font-bold text-slate-700 mb-3">דיווחי עירוב</h2>
                  <EruvBar open={global?.eruvReportsOpen ?? 0} resolved={global?.eruvReportsResolved ?? 0} />
                </div>
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100 font-bold text-slate-700">פירוט לפי עיר</div>
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-100">
                  <tr>
                    {['עיר','משתמשים','Push','בתי כנסת','כשרות','מקואות'].map(h => (
                      <th key={h} className="text-right px-4 py-2.5 font-semibold text-slate-500 text-xs">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {cityStats.map((c, i) => {
                    const pushRate = c.users > 0 ? Math.round((c.pushTokens / c.users) * 100) : 0;
                    return (
                      <tr key={c.cityId} className={`border-b border-slate-50 ${i % 2 === 0 ? '' : 'bg-slate-50/40'}`}>
                        <td className="px-4 py-2.5 font-medium text-slate-800">{c.cityName}</td>
                        <td className="px-4 py-2.5 text-slate-600">{c.users}</td>
                        <td className="px-4 py-2.5">
                          <span className="flex items-center gap-1.5">
                            <span className="text-slate-600">{c.pushTokens}</span>
                            <span className="text-xs text-slate-400">({pushRate}%)</span>
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-slate-600">{c.synagogues}</td>
                        <td className="px-4 py-2.5 text-slate-600">{c.restaurants}</td>
                        <td className="px-4 py-2.5 text-slate-600">{c.mikvaot}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )
      )}

      {/* ── Tab: City ── */}
      {tab === 'city' && (
        <>
          {/* City picker (multi-city accounts only) */}
          {canPickCity && (
            <div className="mb-6">
              <label className="block text-xs font-semibold text-slate-500 mb-1.5">בחר עיר</label>
              <div className="relative w-64">
                <select
                  value={selectedCityId}
                  onChange={e => setSelectedCityId(e.target.value)}
                  className="w-full appearance-none bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-medium text-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 cursor-pointer"
                >
                  <option value="">— בחר עיר —</option>
                  {cities.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <ChevronDown size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              </div>
            </div>
          )}

          {/* No city selected */}
          {!selectedCityId && (
            <div className="flex items-center justify-center h-48 text-slate-400 text-sm">
              יש לבחור עיר להצגת הנתונים
            </div>
          )}

          {/* Loading */}
          {selectedCityId && cityLoading && (
            <div className="grid grid-cols-3 gap-4">
              {[1,2,3,4,5,6].map(i => <div key={i} className="bg-white rounded-2xl border border-slate-100 h-28 animate-pulse" />)}
              <div className="col-span-3 text-center text-slate-400 text-sm py-4">טוען נתונים...</div>
            </div>
          )}

          {/* City stats */}
          {selectedCityId && !cityLoading && cityDetail && (
            <>
              {/* KPI cards */}
              <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3 mb-6">
                <StatCard label="משתמשים"    value={cityDetail.users}       color="text-purple-600" />
                <StatCard label="Push רשומים" value={`${cityPushRate}%`} sub={`${cityDetail.pushTokens} מכשירים`} color="text-orange-600" />
                <StatCard label="בתי כנסת"   value={cityDetail.synagogues}  color="text-blue-600" />
                <StatCard label="עסקים כשרים" value={cityDetail.businesses}  color="text-green-600" />
                <StatCard label="מקואות"     value={cityDetail.mikvaot}     color="text-cyan-600" />
                <StatCard label="אירועים"    value={cityDetail.events}      color="text-indigo-600" />
              </div>

              {/* Role breakdown + Eruv */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
                  <h2 className="font-bold text-slate-700 mb-4">התפלגות תפקידים</h2>
                  {cityDetail.roles.length === 0
                    ? <p className="text-slate-400 text-sm">אין משתמשים</p>
                    : <RolePie data={cityDetail.roles} />
                  }
                </div>
                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
                  <h2 className="font-bold text-slate-700 mb-3">דיווחי עירוב</h2>
                  {cityDetail.eruvOpen + cityDetail.eruvResolved === 0
                    ? <p className="text-slate-400 text-sm">אין דיווחים</p>
                    : <EruvBar open={cityDetail.eruvOpen} resolved={cityDetail.eruvResolved} />
                  }
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
