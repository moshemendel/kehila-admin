import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

const ROLE_LANDING: Record<string, string> = {
  business_manager: 'businesses',
  kosher_manager:   'kosher',
  event_manager:    'events',
  gabbai:           'synagogues',
  eruv_manager:     'eruv',
};

export default function Dashboard() {
  const { appUser, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (loading) return;
    if (appUser?.role === 'super_admin' || appUser?.role === 'dev') {
      navigate('/cities', { replace: true });
    } else {
      // homeCityId is the manager's permanent admin scope — land them there even
      // if their personal cityId (switch-city browsing preference) points elsewhere.
      const landingCityId = appUser?.homeCityId ?? appUser?.cityId;
      if (landingCityId) {
        const sub = ROLE_LANDING[appUser?.role ?? ''] ?? '';
        const path = sub
          ? `/cities/${landingCityId}/${sub}`
          : `/cities/${landingCityId}`;
        navigate(path, { replace: true });
      }
    }
  }, [appUser, loading]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}
