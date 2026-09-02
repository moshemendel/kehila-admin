import { useEffect, useState } from 'react';
import { useParams, useNavigate, useLocation, NavLink, Outlet } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import { auth, db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { useCityContext } from '../contexts/CityContext';
import { useRoleCatalogue } from '../utils/roleCatalogue';
import { MapSyncProvider } from '../contexts/MapSyncContext';
import type { City, UserRole } from '../types';
import {
  Building2, Droplets, UtensilsCrossed, CalendarDays,
  Users, LayoutDashboard, Map, LogOut, Store, Shield, Gift,
  BarChart2, Activity, Bell, Settings, Flag,
} from 'lucide-react';

// ─── Tab definitions ──────────────────────────────────────────────────────────

/**
 * Who sees which section, asked of the role catalogue rather than listed.
 *
 * Each tab used to carry an allowedRoles array naming every role that could
 * open it, which meant adding a role was eleven edits in this file alone — and
 * when content_admin arrived, it got none of them. Signing in as the deputy a
 * city_admin had just appointed produced a console with every section missing.
 *
 * Two questions replace the arrays:
 *
 *   access 'authority'  accounts, the city record, the overview — the things a
 *                       content_admin deliberately does NOT get. Mirrors
 *                       isAdminOf() in firestore.rules.
 *   access 'content'    everything the app publishes. Mirrors managesContentIn(),
 *                       so a content_admin sees exactly what they can save.
 *
 * plus `specialist`, the narrow role that gets this one section and nothing
 * else — a gabbai and their shuls, an eruv_manager and the eruv.
 */
const TABS = [
  { sub: '',           label: 'סקירה',      icon: LayoutDashboard, access: 'authority' },
  { sub: 'synagogues', label: 'בתי כנסת',   icon: Building2,       access: 'content', specialist: ['gabbai'] },
  { sub: 'mikvaot',    label: 'מקואות',     icon: Droplets,        access: 'content', specialist: ['mikveh_manager'] },
  { sub: 'kosher',     label: 'כשרות',      icon: UtensilsCrossed, access: 'content', specialist: ['kosher_manager'] },
  { sub: 'businesses', label: 'בתי עסק',    icon: Store,           access: 'content', specialist: ['business_manager'] },
  { sub: 'events',     label: 'אירועים',    icon: CalendarDays,    access: 'content', specialist: ['event_manager'] },
  { sub: 'eruv',       label: 'עירוב',      icon: Shield,          access: 'content', specialist: ['eruv_manager'] },
  { sub: 'gemach',     label: 'גמ"ח',       icon: Gift,            access: 'content' },
  { sub: 'reports',    label: 'דיווחים',     icon: Flag,            access: 'content',
    specialist: ['gabbai','business_manager','kosher_manager','mikveh_manager','event_manager'] },
  { sub: 'users',      label: 'משתמשים',    icon: Users,           access: 'authority' },
  { sub: 'settings',   label: 'הגדרות עיר', icon: Settings,        access: 'authority' },
] as const;

// Insights links — kept inside the city shell so navigating to them never exits the city context
const INSIGHT_LINKS = [
  { sub: 'stats',         label: 'סטטיסטיקות', icon: BarChart2 },
  { sub: 'analytics',     label: 'אנליטיקס',   icon: Activity  },
  { sub: 'notifications', label: 'התראות',      icon: Bell      },
] as const;
// Insights are city-wide numbers, not content — authority only.

// ─── Component ────────────────────────────────────────────────────────────────

export default function CityLayout() {
  const { cityId } = useParams<{ cityId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { appUser } = useAuth();
  const { selectedCityName, setSelectedCity, clearSelectedCity } = useCityContext();
  const [city, setCity] = useState<City | null>(null);

  const role = appUser?.role as UserRole | undefined;
  // A "dev" scoped to one city (has a homeCityId) behaves like city_admin — only truly
  // unscoped super_admin/dev accounts can browse other cities from the map.
  const canPickCity = role === 'super_admin' || (role === 'dev' && !appUser?.homeCityId);
  // A manager can hold several roles at once (e.g. gabbai + kosher_manager) — every
  // question below is asked of the whole set, not just the single primary role.
  const roles = (appUser?.roles ?? (role ? [role] : [])) as UserRole[];
  const cat = useRoleCatalogue();
  const has = (flag: 'authority' | 'content') =>
    roles.some(r => cat.byKey(r)?.[flag]);
  const hasAuthority = has('authority');
  const hasContent   = has('content');
  // Insights are city-wide numbers, not published content — authority only.
  const showInsights = hasAuthority;

  useEffect(() => {
    if (!cityId) return;
    getDoc(doc(db, 'cities', cityId)).then(snap => {
      if (snap.exists()) {
        const c = { id: snap.id, ...snap.data() } as City;
        setCity(c);
        setSelectedCity(c.id, c.name);
      }
    });
  }, [cityId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Managers (city_admin and every other scoped role) are permanently anchored to
  // homeCityId for administration — the app's personal "switch city" browsing
  // preference (cityId) must never grant them a view into another city's data here.
  // Without this guard a manager who switched cityId while browsing the mobile app
  // would land on someone else's city dashboard with an empty (permission-denied) list.
  useEffect(() => {
    if (!cityId || !appUser || canPickCity) return;
    const homeCityId = appUser.homeCityId ?? appUser.cityId;
    if (homeCityId && cityId !== homeCityId) {
      const redirectPath = location.pathname.replace(`/cities/${cityId}`, `/cities/${homeCityId}`);
      navigate(redirectPath, { replace: true });
    }
  }, [cityId, appUser, canPickCity]); // eslint-disable-line react-hooks/exhaustive-deps

  const cityName = selectedCityName ?? city?.name ?? '';

  const matchedTabs = TABS.filter(t =>
    (t.access === 'authority' ? hasAuthority : hasContent) ||
    roles.some(r => ((t as { specialist?: readonly string[] }).specialist ?? []).includes(r)));
  const visibleTabs = matchedTabs.length > 0 ? matchedTabs : [TABS[0]];

  const handleLogout = async () => {
    clearSelectedCity();
    await signOut(auth);
    navigate('/login');
  };

  return (
    <MapSyncProvider>
      <div className="flex h-screen bg-slate-50" dir="rtl">

        {/* ── Sidebar ── */}
        <aside className="w-56 bg-[#1B3A6B] flex flex-col shadow-xl flex-shrink-0">

          {/* Logo */}
          <div className="px-5 py-5 border-b border-white/10">
            <div className="text-white font-bold text-lg">קהילה</div>
            <div className="text-blue-300 text-xs mt-0.5">ניהול</div>
          </div>

          {/* City name + back to map */}
          <div className="px-4 py-3 border-b border-white/10 bg-white/5">
            <div className="text-white text-sm font-bold truncate mb-1">{cityName}</div>
            {canPickCity ? (
              <button
                onClick={() => { clearSelectedCity(); navigate('/cities'); }}
                className="flex items-center gap-1 text-blue-300 hover:text-white text-[11px] transition-colors"
              >
                <Map size={11} />
                מפת ערים
              </button>
            ) : (
              <div className="text-blue-400 text-[11px]">לוח ניהול</div>
            )}
          </div>

          {/* Nav */}
          <nav className="flex-1 py-3 overflow-y-auto">
            {visibleTabs.map(tab => (
              <NavLink
                key={tab.sub}
                to={tab.sub ? `/cities/${cityId}/${tab.sub}` : `/cities/${cityId}`}
                end={tab.sub === ''}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-5 py-3 text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-white/15 text-white'
                      : 'text-blue-200 hover:bg-white/8 hover:text-white'
                  }`
                }
              >
                <tab.icon size={17} />
                {tab.label}
              </NavLink>
            ))}

            {/* Insights — stay inside the city shell, never navigate away from it */}
            {showInsights && (
              <div className="mt-3 pt-3 border-t border-white/10">
                {INSIGHT_LINKS.map(link => (
                  <NavLink
                    key={link.sub}
                    to={`/cities/${cityId}/${link.sub}`}
                    className={({ isActive }) =>
                      `flex items-center gap-3 px-5 py-3 text-sm font-medium transition-colors ${
                        isActive
                          ? 'bg-white/15 text-white'
                          : 'text-blue-300/70 hover:bg-white/8 hover:text-white'
                      }`
                    }
                  >
                    <link.icon size={17} />
                    {link.label}
                  </NavLink>
                ))}
              </div>
            )}
          </nav>

          {/* User + logout */}
          <div className="px-5 py-4 border-t border-white/10">
            <div className="text-blue-200 text-xs mb-0.5 truncate">{appUser?.displayName}</div>
            <div className="text-blue-300 text-xs truncate mb-3">{appUser?.email}</div>
            <button
              onClick={handleLogout}
              className="flex items-center gap-2 text-blue-300 hover:text-white text-xs transition-colors"
            >
              <LogOut size={14} />
              יציאה
            </button>
          </div>
        </aside>

        {/* ── Main content ── */}
        <main className="flex-1 min-h-0 overflow-y-auto">
          <Outlet />
        </main>

      </div>
    </MapSyncProvider>
  );
}
