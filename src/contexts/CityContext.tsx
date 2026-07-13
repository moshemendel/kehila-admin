import { createContext, useContext, useState, type ReactNode } from 'react';

interface CityContextType {
  selectedCityId: string | null;
  selectedCityName: string | null;
  setSelectedCity: (id: string, name: string) => void;
  clearSelectedCity: () => void;
}

const CityCtx = createContext<CityContextType>({
  selectedCityId: null,
  selectedCityName: null,
  setSelectedCity: () => {},
  clearSelectedCity: () => {},
});

export function CityProvider({ children }: { children: ReactNode }) {
  const [selectedCityId, setId]     = useState<string | null>(null);
  const [selectedCityName, setName] = useState<string | null>(null);

  const setSelectedCity = (id: string, name: string) => { setId(id); setName(name); };
  const clearSelectedCity = () => { setId(null); setName(null); };

  return (
    <CityCtx.Provider value={{ selectedCityId, selectedCityName, setSelectedCity, clearSelectedCity }}>
      {children}
    </CityCtx.Provider>
  );
}

export const useCityContext = () => useContext(CityCtx);
