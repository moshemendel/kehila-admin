import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import { useMapSync } from '../contexts/MapSyncContext';
import type { AppUser } from '../types';
import type { MapMarker } from '../contexts/MapSyncContext';
import { Building2, Droplets, UtensilsCrossed, CalendarDays, Users } from 'lucide-react';

interface Stats {
  synagogues: number;
  mikvaot: number;
  restaurants: number;
  events: number;
  users: number;
  managers: number;
  pushTokens: number;
}

const ROLE_LABELS: Record<string, string> = {
  gabbai: 'גבאי', business_manager: 'מנהל עסק', kosher_manager: 'מנהל כשרות',
  event_manager: 'מנהל אירועים', eruv_manager: 'מנהל עירוב', city_admin: 'מנהל עיר',
};

const safe = (p: Promise<any>) =>
  p.catch(() => ({ size: 0, docs: [], exists: () => false, data: () => ({}) }));

export default function CityDashboard() {
  const { cityId } = useParams<{ cityId: string }>();
  const { setMarkers } = useMapSync();

  const [stats, setStats] = useState<Stats | null>(null);
  const [roleBreakdown, setRoleBreakdown] = useState<{ role: string; count: number }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!cityId) return;
    setLoading(true);

    Promise.all([
      safe(getDocs(query(collection(db, 'synagogues'),  where('cityId', '==', cityId)))),
      safe(getDocs(query(collection(db, 'mikvaot'),     where('cityId', '==', cityId)))),
      safe(getDocs(query(collection(db, 'businesses'), where('cityId', '==', cityId)))),
      safe(getDocs(query(collection(db, 'events'),      where('cityId', '==', cityId)))),
      safe(getDocs(query(collection(db, 'users'),       where('cityId', '==', cityId)))),
      safe(getDocs(query(collection(db, 'pushTokens'),  where('cityId', '==', cityId)))),
    ]).then(([s, m, r, e, u, pt]) => {
      const users = u.docs.map((d: any) => d.data() as AppUser);
      const managers = users.filter((u: AppUser) => u.role !== 'user' && u.role !== 'dev' && u.role !== 'super_admin');

      const roleCounts: Record<string, number> = {};
      managers.forEach((u: AppUser) => { roleCounts[u.role] = (roleCounts[u.role] ?? 0) + 1; });
      setRoleBreakdown(Object.entries(roleCounts).map(([role, count]) => ({ role, count })).sort((a, b) => b.count - a.count));

      setStats({
        synagogues: s.size, mikvaot: m.size, restaurants: r.size,
        events: e.size, users: u.size, managers: managers.length, pushTokens: pt.size,
      });

      // Put all geolocated items on the overview map
      const allMarkers: MapMarker[] = [
        ...s.docs.filter((d: any) => d.data().latitude).map((d: any) => {
          const x = d.data();
          return { id: d.id, lat: x.latitude, lng: x.longitude, label: x.name, type: 'synagogue' as const };
        }),
        ...m.docs.filter((d: any) => d.data().latitude).map((d: any) => {
          const x = d.data();
          return { id: d.id, lat: x.latitude, lng: x.longitude, label: x.name, type: 'mikveh' as const };
        }),
        ...r.docs.filter((d: any) => d.data().latitude).map((d: any) => {
          const x = d.data();
          return { id: d.id, lat: x.latitude, lng: x.longitude, label: x.name, type: 'restaurant' as const };
        }),
      ];
      setMarkers(allMarkers);
      setLoading(false);
    });
  }, [cityId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <div className="flex items-center justify-center h-64 text-slate-400">טוען...</div>;

  const cards = [
    { label: 'בתי כנסת',  value: stats?.synagogues,  icon: Building2,        color: 'bg-blue-500' },
    { label: 'מקואות',    value: stats?.mikvaot,     icon: Droplets,         color: 'bg-cyan-500' },
    { label: 'בתי עסק',     value: stats?.restaurants, icon: UtensilsCrossed,  color: 'bg-green-500' },
    { label: 'אירועים',   value: stats?.events,      icon: CalendarDays,     color: 'bg-orange-500' },
    { label: 'משתמשים',   value: stats?.users,       icon: Users,            color: 'bg-purple-500' },
  ];

  const pushRate = stats && stats.users > 0 ? Math.round((stats.pushTokens / stats.users) * 100) : 0;

  return (
    <div className="p-6" dir="rtl">
      {/* Stats grid */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3 mb-5">
        {cards.map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100">
            <div className={`w-9 h-9 ${color} rounded-xl flex items-center justify-center mb-2.5`}>
              <Icon size={18} className="text-white" />
            </div>
            <div className="text-3xl font-black text-slate-800">{value ?? '–'}</div>
            <div className="text-slate-500 text-xs mt-0.5">{label}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Role breakdown */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
          <h2 className="font-bold text-slate-700 text-sm mb-4">מנהלים ורכזים ({stats?.managers ?? 0})</h2>
          {roleBreakdown.length === 0
            ? <p className="text-slate-400 text-sm">אין מנהלים מוגדרים</p>
            : (
              <div className="flex flex-col gap-2">
                {roleBreakdown.map(({ role, count }) => {
                  const max = roleBreakdown[0]?.count ?? 1;
                  return (
                    <div key={role} className="flex items-center gap-3">
                      <span className="text-xs text-slate-600 w-28 text-right flex-shrink-0">{ROLE_LABELS[role] ?? role}</span>
                      <div className="flex-1 bg-slate-100 rounded-full h-2">
                        <div className="bg-[#1B3A6B] h-2 rounded-full" style={{ width: `${(count / max) * 100}%` }} />
                      </div>
                      <span className="text-xs font-bold text-slate-700 w-4">{count}</span>
                    </div>
                  );
                })}
              </div>
            )
          }
        </div>

        {/* Push notifications */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
          <h2 className="font-bold text-slate-700 text-sm mb-4">התראות Push</h2>
          <div className="flex items-end gap-4 mb-3">
            <div>
              <div className="text-3xl font-black text-slate-800">{stats?.pushTokens ?? 0}</div>
              <div className="text-xs text-slate-400">מכשירים רשומים</div>
            </div>
            <div>
              <div className="text-2xl font-black text-[#1B3A6B]">{pushRate}%</div>
              <div className="text-xs text-slate-400">מהמשתמשים</div>
            </div>
          </div>
          <div className="bg-slate-100 rounded-full h-2.5">
            <div className="bg-[#1B3A6B] h-2.5 rounded-full" style={{ width: `${pushRate}%` }} />
          </div>
          <p className="text-xs text-slate-400 mt-2">
            {stats?.users ?? 0} משתמשים · {stats?.pushTokens ?? 0} הפעילו התראות
          </p>
        </div>
      </div>
    </div>
  );
}
