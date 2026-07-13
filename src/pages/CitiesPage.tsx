import { useEffect, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { getCountFromServer } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import { db } from '../firebase';
import type { City } from '../types';
import { Building2, Droplets, UtensilsCrossed, Users, ChevronLeft, MapPin } from 'lucide-react';

interface CityStats {
  synagogues: number;
  mikvaot: number;
  restaurants: number;
  users: number;
}

interface CityCard extends City {
  stats?: CityStats;
  loading: boolean;
}

async function loadCityStats(cityId: string): Promise<CityStats> {
  const q = (col: string) => getCountFromServer(query(collection(db, col), where('cityId', '==', cityId)));
  const [s, m, r, u] = await Promise.all([q('synagogues'), q('mikvaot'), q('businesses'), q('users')]);
  return {
    synagogues:  s.data().count,
    mikvaot:     m.data().count,
    restaurants: r.data().count,
    users:       u.data().count,
  };
}

export default function CitiesPage() {
  const navigate = useNavigate();
  const [cities, setCities] = useState<CityCard[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getDocs(collection(db, 'cities')).then(snap => {
      const list: CityCard[] = snap.docs.map(d => ({ id: d.id, ...d.data(), loading: true } as CityCard));
      setCities(list);
      setLoading(false);

      // Load stats for each city in parallel
      list.forEach(city => {
        loadCityStats(city.id).then(stats => {
          setCities(prev => prev.map(c => c.id === city.id ? { ...c, stats, loading: false } : c));
        }).catch(() => {
          setCities(prev => prev.map(c => c.id === city.id ? { ...c, loading: false } : c));
        });
      });
    });
  }, []);

  if (loading) return <div className="flex items-center justify-center h-64 text-slate-400">טוען ערים...</div>;

  const totalUsers      = cities.reduce((acc, c) => acc + (c.stats?.users ?? 0), 0);
  const totalSynagogues = cities.reduce((acc, c) => acc + (c.stats?.synagogues ?? 0), 0);

  return (
    <div className="p-8" dir="rtl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-800">ערים</h1>
        <p className="text-slate-400 text-sm mt-0.5">
          {cities.length} ערים · {totalUsers} משתמשים · {totalSynagogues} בתי כנסת
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {cities.map(city => (
          <button
            key={city.id}
            onClick={() => navigate(`/cities/${city.id}`)}
            className="text-right bg-white rounded-2xl border border-slate-100 shadow-sm p-5 hover:shadow-md hover:border-blue-200 transition-all group"
          >
            <div className="flex items-start justify-between mb-4">
              <div>
                <div className="text-lg font-bold text-slate-800">{city.name}</div>
                <div className="flex items-center gap-1 text-slate-400 text-xs mt-0.5">
                  <MapPin size={11} /> {city.country}
                </div>
              </div>
              <ChevronLeft size={18} className="text-slate-300 group-hover:text-blue-500 transition-colors mt-0.5" />
            </div>

            {city.loading ? (
              <div className="grid grid-cols-4 gap-2">
                {[1,2,3,4].map(i => (
                  <div key={i} className="bg-slate-100 rounded-xl h-14 animate-pulse" />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-4 gap-2">
                <StatChip icon={<Building2 size={13} />} value={city.stats?.synagogues ?? 0} label="בתי כנסת" color="blue" />
                <StatChip icon={<Droplets size={13} />}  value={city.stats?.mikvaot ?? 0}    label="מקואות"   color="cyan" />
                <StatChip icon={<UtensilsCrossed size={13} />} value={city.stats?.restaurants ?? 0} label="כשרות" color="green" />
                <StatChip icon={<Users size={13} />}     value={city.stats?.users ?? 0}       label="משתמשים" color="purple" />
              </div>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

const COLOR_MAP: Record<string, string> = {
  blue:   'bg-blue-50 text-blue-600',
  cyan:   'bg-cyan-50 text-cyan-600',
  green:  'bg-green-50 text-green-600',
  purple: 'bg-purple-50 text-purple-600',
};

function StatChip({ icon, value, label, color }: { icon: React.ReactNode; value: number; label: string; color: string }) {
  return (
    <div className={`${COLOR_MAP[color]} rounded-xl px-2 py-2.5 flex flex-col items-center gap-1`}>
      {icon}
      <span className="text-lg font-black leading-none">{value}</span>
      <span className="text-[10px] font-medium opacity-70 text-center leading-tight">{label}</span>
    </div>
  );
}
