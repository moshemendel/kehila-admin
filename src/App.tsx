import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { CityProvider } from './contexts/CityContext';
import Layout from './components/Layout';
import CityLayout from './components/CityLayout';
import ShabbatLockGate from './components/ShabbatLockGate';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import CitiesMapPage from './pages/CitiesMapPage';
import CityDashboard from './pages/CityDashboard';
import StatsPage from './pages/StatsPage';
import AnalyticsPage from './pages/AnalyticsPage';
import NotificationsPage from './pages/NotificationsPage';
import SynagoguesPage from './pages/SynagoguesPage';
import SynagogueDetailPage from './pages/SynagogueDetailPage';
import MikvehPage from './pages/MikvehPage';
import BusinessesPage from './pages/businessesPage';
import EventsPage from './pages/EventsPage';
import UsersPage from './pages/UsersPage';
import CitySettingsPage from './pages/CitySettingsPage';
import EruvPage   from './pages/EruvPage';
import GemachPage from './pages/GemachPage';

function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const { firebaseUser, appUser, loading } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center text-slate-400 text-sm">טוען...</div>;
  if (!firebaseUser || !appUser) return <Navigate to="/login" replace />;
  return <Layout>{children}</Layout>;
}

function ProtectedCityLayout() {
  const { firebaseUser, appUser, loading } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center text-slate-400 text-sm">טוען...</div>;
  if (!firebaseUser || !appUser) return <Navigate to="/login" replace />;
  return <CityLayout />;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />

      {/* Global routes (sidebar layout) */}
      <Route path="/"      element={<ProtectedLayout><Dashboard /></ProtectedLayout>} />
      <Route path="/cities" element={<ProtectedLayout><CitiesMapPage /></ProtectedLayout>} />
      <Route path="/stats"      element={<ProtectedLayout><StatsPage /></ProtectedLayout>} />
      <Route path="/analytics"      element={<ProtectedLayout><AnalyticsPage /></ProtectedLayout>} />
      <Route path="/notifications"  element={<ProtectedLayout><NotificationsPage /></ProtectedLayout>} />

      {/* City-scoped routes (split map+content layout) */}
      <Route path="/cities/:cityId" element={<ProtectedCityLayout />}>
        <Route index                element={<CityDashboard />} />
        <Route path="synagogues"    element={<SynagoguesPage />} />
        <Route path="synagogues/:id" element={<SynagogueDetailPage />} />
        <Route path="mikvaot"       element={<MikvehPage />} />
        <Route path="kosher"         element={<BusinessesPage />} />
        <Route path="businesses"    element={<BusinessesPage />} />
        <Route path="events"        element={<EventsPage />} />
        <Route path="eruv"          element={<EruvPage />} />
        <Route path="gemach"        element={<GemachPage />} />
        <Route path="users"         element={<UsersPage />} />
        <Route path="settings"      element={<CitySettingsPage />} />
        <Route path="stats"         element={<StatsPage />} />
        <Route path="analytics"     element={<AnalyticsPage />} />
        <Route path="notifications" element={<NotificationsPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <ShabbatLockGate>
      <BrowserRouter>
        <AuthProvider>
          <CityProvider>
            <AppRoutes />
          </CityProvider>
        </AuthProvider>
      </BrowserRouter>
    </ShabbatLockGate>
  );
}
