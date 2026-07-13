import { createContext, useContext, useState, type ReactNode } from 'react';

export interface MapMarker {
  id: string;
  lat: number;
  lng: number;
  label: string;
  type?: 'synagogue' | 'mikveh' | 'restaurant' | 'event';
}

interface MapSyncType {
  markers: MapMarker[];
  setMarkers: (m: MapMarker[]) => void;
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
}

const MapSyncCtx = createContext<MapSyncType>({
  markers: [],
  setMarkers: () => {},
  selectedId: null,
  setSelectedId: () => {},
});

export function MapSyncProvider({ children }: { children: ReactNode }) {
  const [markers, setMarkers]     = useState<MapMarker[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  return (
    <MapSyncCtx.Provider value={{ markers, setMarkers, selectedId, setSelectedId }}>
      {children}
    </MapSyncCtx.Provider>
  );
}

export const useMapSync = () => useContext(MapSyncCtx);
