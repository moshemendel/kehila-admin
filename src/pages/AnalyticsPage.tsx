import { useEffect, useState, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { collection, query, where, orderBy, limit, getDocs, Timestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import type { City } from '../types';
import {
  BarChart, Bar, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer,
  LineChart, Line, CartesianGrid, Legend,
} from 'recharts';

// ─── Constants ────────────────────────────────────────────────────────────────

const FEATURE_LABELS: Record<string, string> = {
  home:             'בית',
  zmanim:           'זמנים',
  prayer_times:     'זמני תפילה',
  eruv:             'עירוב',
  kosher:           'כשרות',
  mikveh:           'מקווה',
  synagogues:       'בתי כנסת',
  events:           'אירועים',
  kashrut_updates:  'עדכוני כשרות',
};

const FEATURE_COLORS: Record<string, string> = {
  home:             '#64748B',
  zmanim:           '#1B3A6B',
  prayer_times:     '#2563EB',
  eruv:             '#7C3AED',
  kosher:           '#10B981',
  mikveh:           '#06B6D4',
  synagogues:       '#F59E0B',
  events:           '#EF4444',
  kashrut_updates:  '#F97316',
};

const DAY_LABELS    = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const BLOCK_LABELS  = ['לילה\n22–06', 'בוקר מוקדם\n06–09', 'בוקר\n09–12', 'צהריים\n12–15', 'אחה"צ\n15–18', 'ערב\n18–22'];

function hourToBlock(h: number): number {
  if (h >= 22 || h < 6)  return 0;
  if (h < 9)              return 1;
  if (h < 12)             return 2;
  if (h < 15)             return 3;
  if (h < 18)             return 4;
  return 5;
}

// ─── Raw event type ───────────────────────────────────────────────────────────

interface RawEvent {
  feature:   string;
  cityId:    string;
  uid:       string;
  hour:      number;
  dayOfWeek: number;
  date:      string;
}

// ─── Tooltip ─────────────────────────────────────────────────────────────────

function HebTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-slate-200 rounded-xl px-3 py-2 shadow-lg text-sm" dir="rtl">
      <div className="font-semibold text-slate-700 mb-1">{label}</div>
      {payload.map((p: any, i: number) => (
        <div key={i} style={{ color: p.color }}>{p.name}: <span className="font-bold text-slate-800">{p.value}</span></div>
      ))}
    </div>
  );
}

// ─── Heatmap cell ─────────────────────────────────────────────────────────────

function HeatCell({ value, max }: { value: number; max: number }) {
  const intensity = max > 0 ? value / max : 0;
  const bg = intensity === 0
    ? '#f8fafc'
    : `rgba(27,58,107,${0.08 + intensity * 0.82})`;
  const color = intensity > 0.5 ? 'white' : '#1e293b';
  return (
    <div
      className="flex items-center justify-center rounded-lg text-xs font-semibold transition-colors"
      style={{ backgroundColor: bg, color, height: 36 }}
    >
      {value > 0 ? value : ''}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function AnalyticsPage() {
  const { appUser } = useAuth();
  const { cityId: routeCityId } = useParams<{ cityId?: string }>();
  // A "dev" scoped to one city behaves like city_admin — locked to that city.
  const canPickCity = appUser?.role === 'super_admin' || (appUser?.role === 'dev' && !appUser?.cityId);
  const lockedCityId = routeCityId ?? appUser?.cityId ?? '';

  const [days, setDays]           = useState<7 | 30 | 90>(30);
  const [filterCity, setFilterCity] = useState<string>(canPickCity && routeCityId ? routeCityId : 'all');
  const [cities, setCities]       = useState<City[]>([]);
  const [events, setEvents]       = useState<RawEvent[]>([]);
  const [loading, setLoading]     = useState(true);

  // Load cities list for filter
  useEffect(() => {
    getDocs(collection(db, 'cities')).then(snap => {
      setCities(snap.docs.map(d => ({ id: d.id, ...d.data() } as City)).sort((a, b) => a.name.localeCompare(b.name, 'he')));
    });
  }, []);

  // Load events when range or city changes
  useEffect(() => {
    setLoading(true);
    const startTs = Timestamp.fromDate(new Date(Date.now() - days * 24 * 60 * 60 * 1000));
    getDocs(
      query(
        collection(db, 'analyticsEvents'),
        where('ts', '>=', startTs),
        orderBy('ts', 'desc'),
        limit(10000),
      )
    ).then(snap => {
      const raw = snap.docs.map(d => d.data() as RawEvent);
      setEvents(raw);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [days]);

  // ── Derived data ───────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    if (!canPickCity) return events.filter(e => e.cityId === lockedCityId);
    if (filterCity !== 'all') return events.filter(e => e.cityId === filterCity);
    return events;
  }, [events, filterCity, canPickCity, lockedCityId]);

  const stats = useMemo(() => {
    const featureCounts: Record<string, number>          = {};
    const hourCounts    = new Array(24).fill(0);
    const dayCounts     = new Array(7).fill(0);
    const dateCounts:   Record<string, number>           = {};
    const heatmap:      Record<string, number[]>         = {};
    const uniqueUsers   = new Set<string>();
    const cityBreakdown: Record<string, Record<string, number>> = {};

    for (const e of filtered) {
      featureCounts[e.feature] = (featureCounts[e.feature] ?? 0) + 1;
      hourCounts[e.hour]++;
      dayCounts[e.dayOfWeek]++;
      dateCounts[e.date] = (dateCounts[e.date] ?? 0) + 1;
      uniqueUsers.add(e.uid);

      if (!heatmap[e.feature]) heatmap[e.feature] = new Array(6).fill(0);
      heatmap[e.feature][hourToBlock(e.hour)]++;

      if (!cityBreakdown[e.cityId]) cityBreakdown[e.cityId] = {};
      cityBreakdown[e.cityId][e.feature] = (cityBreakdown[e.cityId][e.feature] ?? 0) + 1;
    }

    // Build sorted date list for trend chart
    const sortedDates = Array.from({ length: days }, (_, i) => {
      const d = new Date(Date.now() - (days - 1 - i) * 86400000);
      return d.toISOString().slice(0, 10);
    });
    const trendData = sortedDates.map(date => ({ date: date.slice(5), events: dateCounts[date] ?? 0 }));

    const featureList = Object.entries(featureCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => ({ feature: k, label: FEATURE_LABELS[k] ?? k, count: v }));

    const topFeature  = featureList[0];
    const peakHour    = hourCounts.indexOf(Math.max(...hourCounts));
    const peakDay     = dayCounts.indexOf(Math.max(...dayCounts));

    return { featureCounts, featureList, hourCounts, dayCounts, dateCounts, trendData, heatmap, uniqueUsers, cityBreakdown, topFeature, peakHour, peakDay };
  }, [filtered, days]);

  // Chart data
  const hourData = stats.hourCounts.map((v, h) => ({ hour: `${h}:00`, אירועים: v }));
  const dayData  = stats.dayCounts.map((v, d) => ({ day: DAY_LABELS[d], אירועים: v }));
  const heatmaxVal = Math.max(1, ...Object.values(stats.heatmap).flat());

  const cityChartData = useMemo(() => {
    if (!canPickCity) return [];
    return cities
      .filter(c => stats.cityBreakdown[c.id])
      .map(c => ({
        name: c.name,
        ...Object.fromEntries(
          Object.entries(stats.cityBreakdown[c.id]).map(([k, v]) => [FEATURE_LABELS[k] ?? k, v])
        ),
      }))
      .sort((a: any, b: any) => {
        const sumA = Object.values(a).filter(v => typeof v === 'number').reduce((s: number, v: any) => s + v, 0);
        const sumB = Object.values(b).filter(v => typeof v === 'number').reduce((s: number, v: any) => s + v, 0);
        return (sumB as number) - (sumA as number);
      });
  }, [cities, stats.cityBreakdown, canPickCity]);

  const cityFeatureKeys = useMemo(() => {
    const keys = new Set<string>();
    Object.values(stats.cityBreakdown).forEach(cb => Object.keys(cb).forEach(k => keys.add(FEATURE_LABELS[k] ?? k)));
    return Array.from(keys);
  }, [stats.cityBreakdown]);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="p-8" dir="rtl">

      {/* Header */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">אנליטיקס שימוש</h1>
          <p className="text-slate-400 text-sm mt-0.5">
            {loading ? 'טוען...' : `${filtered.length.toLocaleString()} אירועים · ${stats.uniqueUsers.size} משתמשים פעילים`}
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {/* City filter (multi-city accounts only) */}
          {canPickCity && (
            <select
              value={filterCity}
              onChange={e => setFilterCity(e.target.value)}
              className="bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            >
              <option value="all">כל הערים</option>
              {cities.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
          {/* Time range */}
          <div className="flex gap-1 bg-slate-100 rounded-xl p-1">
            {([7, 30, 90] as const).map(d => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={`px-3 py-1.5 text-sm font-semibold rounded-lg transition-colors ${
                  days === d ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {d} ימים
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-4 gap-4">
          {[1,2,3,4].map(i => <div key={i} className="bg-white rounded-2xl border border-slate-100 h-28 animate-pulse" />)}
          <div className="col-span-4 text-center text-slate-400 text-sm py-16">טוען נתונים...</div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64 text-slate-400">
          <div className="text-4xl mb-3">📊</div>
          <div className="font-semibold">אין נתונים עדיין</div>
          <div className="text-sm mt-1">נתוני שימוש יופיעו לאחר שמשתמשים יתחילו להשתמש באפליקציה</div>
        </div>
      ) : (
        <>
          {/* ── KPI cards ── */}
          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3 mb-6">
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
              <div className="text-xs font-semibold text-purple-600 mb-1">סה"כ אירועים</div>
              <div className="text-3xl font-black text-slate-800">{filtered.length.toLocaleString()}</div>
              <div className="text-xs text-slate-400 mt-0.5">{days} ימים אחרונים</div>
            </div>
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
              <div className="text-xs font-semibold text-blue-600 mb-1">משתמשים פעילים</div>
              <div className="text-3xl font-black text-slate-800">{stats.uniqueUsers.size}</div>
              <div className="text-xs text-slate-400 mt-0.5">משתמשים ייחודיים</div>
            </div>
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
              <div className="text-xs font-semibold text-green-600 mb-1">פיצ'ר מוביל</div>
              <div className="text-2xl font-black text-slate-800">{FEATURE_LABELS[stats.topFeature?.feature ?? ''] ?? '—'}</div>
              <div className="text-xs text-slate-400 mt-0.5">{stats.topFeature?.count ?? 0} פעמים</div>
            </div>
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
              <div className="text-xs font-semibold text-orange-600 mb-1">שעת שיא</div>
              <div className="text-3xl font-black text-slate-800">{stats.peakHour}:00</div>
              <div className="text-xs text-slate-400 mt-0.5">{stats.hourCounts[stats.peakHour]} אירועים</div>
            </div>
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
              <div className="text-xs font-semibold text-cyan-600 mb-1">יום שיא</div>
              <div className="text-2xl font-black text-slate-800">{DAY_LABELS[stats.peakDay]}</div>
              <div className="text-xs text-slate-400 mt-0.5">{stats.dayCounts[stats.peakDay]} אירועים</div>
            </div>
          </div>

          {/* ── Feature popularity + Trend ── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
              <h2 className="font-bold text-slate-700 mb-4">פופולריות פיצ'רים</h2>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={stats.featureList} layout="vertical" margin={{ right: 16, left: 8 }}>
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="label" tick={{ fontSize: 12 }} width={90} />
                  <Tooltip content={<HebTooltip />} />
                  <Bar dataKey="count" name="פעמים" radius={[0, 4, 4, 0]}>
                    {stats.featureList.map((f, i) => (
                      <Cell key={i} fill={FEATURE_COLORS[f.feature] ?? '#1B3A6B'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
              <h2 className="font-bold text-slate-700 mb-4">מגמה יומית ({days} ימים)</h2>
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={stats.trendData} margin={{ right: 16, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} interval={days <= 7 ? 0 : Math.floor(days / 7)} />
                  <YAxis tick={{ fontSize: 11 }} width={35} />
                  <Tooltip content={<HebTooltip />} />
                  <Line type="monotone" dataKey="events" name="אירועים" stroke="#1B3A6B" strokeWidth={2} dot={days <= 7} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* ── Hour of day + Day of week ── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
              <h2 className="font-bold text-slate-700 mb-4">פעילות לפי שעה</h2>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={hourData} margin={{ right: 8, left: 8 }}>
                  <XAxis dataKey="hour" tick={{ fontSize: 9 }} interval={2} />
                  <YAxis tick={{ fontSize: 10 }} width={30} />
                  <Tooltip content={<HebTooltip />} />
                  <Bar dataKey="אירועים" fill="#1B3A6B" radius={[2, 2, 0, 0]}>
                    {hourData.map((_, i) => (
                      <Cell key={i} fill={i === stats.peakHour ? '#E07B00' : '#1B3A6B'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
              <h2 className="font-bold text-slate-700 mb-4">פעילות לפי יום בשבוע</h2>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={dayData} margin={{ right: 8, left: 8 }}>
                  <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 10 }} width={30} />
                  <Tooltip content={<HebTooltip />} />
                  <Bar dataKey="אירועים" fill="#1B3A6B" radius={[2, 2, 0, 0]}>
                    {dayData.map((_, i) => (
                      <Cell key={i} fill={i === stats.peakDay ? '#E07B00' : (i === 5 ? '#7C3AED' : '#1B3A6B')} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <p className="text-xs text-slate-400 mt-2 text-center">שישי מוצג בסגול — ערב שבת</p>
            </div>
          </div>

          {/* ── Feature × Time block heatmap ── */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 mb-4">
            <h2 className="font-bold text-slate-700 mb-4">מפת חום — פיצ'ר × שעה ביום</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-xs" dir="rtl">
                <thead>
                  <tr>
                    <th className="text-right px-3 py-2 text-slate-400 font-medium w-28">פיצ'ר</th>
                    {BLOCK_LABELS.map((b, i) => (
                      <th key={i} className="text-center px-2 py-2 text-slate-500 font-medium whitespace-pre-line leading-tight">{b}</th>
                    ))}
                    <th className="text-center px-2 py-2 text-slate-400 font-medium">סה"כ</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.featureList.map(({ feature, label }) => {
                    const row = stats.heatmap[feature] ?? new Array(6).fill(0);
                    const total = row.reduce((s, v) => s + v, 0);
                    return (
                      <tr key={feature}>
                        <td className="px-3 py-1 font-semibold text-slate-700 text-xs">{label}</td>
                        {row.map((val, bi) => (
                          <td key={bi} className="px-1 py-1">
                            <HeatCell value={val} max={heatmaxVal} />
                          </td>
                        ))}
                        <td className="px-2 py-1 text-center font-bold text-slate-600">{total}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── City breakdown (multi-city accounts only) ── */}
          {canPickCity && cityChartData.length > 0 && (
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
              <h2 className="font-bold text-slate-700 mb-4">פעילות לפי עיר ופיצ'ר</h2>
              <ResponsiveContainer width="100%" height={Math.max(200, cityChartData.length * 44)}>
                <BarChart data={cityChartData} layout="vertical" margin={{ right: 16, left: 8 }}>
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 12 }} width={80} />
                  <Tooltip content={<HebTooltip />} />
                  <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
                  {cityFeatureKeys.map((fLabel, i) => {
                    const featureKey = Object.entries(FEATURE_LABELS).find(([, v]) => v === fLabel)?.[0] ?? fLabel;
                    return (
                      <Bar key={fLabel} dataKey={fLabel} stackId="a"
                        fill={FEATURE_COLORS[featureKey] ?? `hsl(${i * 37},60%,50%)`}
                        radius={i === cityFeatureKeys.length - 1 ? [0, 4, 4, 0] : [0, 0, 0, 0]}
                      />
                    );
                  })}
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </>
      )}
    </div>
  );
}
