import { NavLink, useNavigate } from 'react-router-dom';
import { signOut } from 'firebase/auth';
import { auth } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import type { AppUser } from '../types';
import { LogOut, MapPin, BarChart2, Activity, Bell } from 'lucide-react';
import type { ReactNode } from 'react';

// city_admin (and dev accounts scoped to a single city) never land here — they reach
// stats/analytics/notifications through the persistent links inside their city dashboard,
// so this global sidebar only needs to serve truly unscoped multi-city accounts.
const NAV_ALL = [
  { to: '/cities',        icon: MapPin,    label: 'ערים',        show: (u: AppUser | null) => u?.role === 'super_admin' || u?.role === 'dev' },
  { to: '/stats',         icon: BarChart2, label: 'סטטיסטיקות', show: (u: AppUser | null) => u?.role === 'super_admin' || (u?.role === 'dev' && !u?.cityId) },
  { to: '/analytics',     icon: Activity,  label: 'אנליטיקס',   show: (u: AppUser | null) => u?.role === 'super_admin' || (u?.role === 'dev' && !u?.cityId) },
  { to: '/notifications', icon: Bell,      label: 'התראות',      show: (u: AppUser | null) => u?.role === 'super_admin' || (u?.role === 'dev' && !u?.cityId) },
];

export default function Layout({ children }: { children: ReactNode }) {
  const { appUser } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await signOut(auth);
    navigate('/login');
  };

  const NAV = NAV_ALL.filter(n => n.show(appUser));

  return (
    <div className="flex h-screen bg-slate-50" dir="rtl">
      {/* Sidebar */}
      <aside className="w-56 bg-[#1B3A6B] flex flex-col shadow-xl flex-shrink-0">
        {/* Logo */}
        <div className="px-5 py-5 border-b border-white/10">
          <div className="text-white font-bold text-lg">קהילה</div>
          <div className="text-blue-300 text-xs mt-0.5">ניהול</div>
        </div>

        {/* Nav */}
        <nav className="flex-1 py-4 overflow-y-auto">
          {NAV.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-5 py-3 text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-white/15 text-white'
                    : 'text-blue-200 hover:bg-white/8 hover:text-white'
                }`
              }
            >
              <Icon size={18} />
              {label}
            </NavLink>
          ))}
        </nav>

        {/* User + logout */}
        <div className="px-5 py-4 border-t border-white/10">
          <div className="text-blue-200 text-xs mb-1 truncate">{appUser?.displayName}</div>
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

      {/* Main */}
      <main className="flex-1 min-h-0 overflow-y-auto flex flex-col">
        {children}
      </main>
    </div>
  );
}
