import 'leaflet/dist/leaflet.css';
import { useEffect, useRef } from 'react';
import { MapContainer, Marker, Tooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import { useMapSync, type MapMarker } from '../contexts/MapSyncContext';
import MapTiles from './MapTiles';

// ─── Icon factory ─────────────────────────────────────────────────────────────

const TYPE_COLORS: Record<string, string> = {
  synagogue:  '#2563EB',
  mikveh:     '#0891B2',
  restaurant: '#059669',
  event:      '#EA580C',
};

const makeIcon = (color: string, size: number, selected: boolean) =>
  L.divIcon({
    className: '',
    html: `
      <div style="position:relative;width:${size}px;height:${size * 1.3}px;filter:${selected ? 'drop-shadow(0 0 6px ' + color + ')' : 'none'}">
        <div style="
          width:${size}px;height:${size}px;
          background:${color};
          border-radius:50% 50% 50% 0;
          transform:rotate(-45deg);
          border:${selected ? '3px' : '2px'} solid white;
          box-shadow:0 2px 8px rgba(0,0,0,0.3);
          position:absolute;top:0;left:0;
        "></div>
        <div style="
          position:absolute;top:${size * 0.18}px;left:${size * 0.18}px;
          width:${size * 0.64}px;height:${size * 0.64}px;
          background:white;border-radius:50%;opacity:${selected ? 1 : 0.85};
        "></div>
      </div>`,
    iconSize:    [size, size * 1.3],
    iconAnchor:  [size / 2, size * 1.3],
    popupAnchor: [0, -(size * 1.3 + 4)],
  });

// ─── Map controller ───────────────────────────────────────────────────────────

function MapController({
  cityCenter,
  selectedId,
  markers,
}: {
  cityCenter: [number, number] | null;
  selectedId: string | null;
  markers: MapMarker[];
}) {
  const map = useMap();
  const centeredRef = useRef(false);

  // Fly to city on initial load
  useEffect(() => {
    if (cityCenter && !centeredRef.current) {
      map.setView(cityCenter, 14);
      centeredRef.current = true;
    }
  }, [cityCenter, map]);

  // Fly to selected marker
  useEffect(() => {
    if (!selectedId) return;
    const m = markers.find(x => x.id === selectedId);
    if (m) map.flyTo([m.lat, m.lng], 16, { duration: 0.7 });
  }, [selectedId, markers, map]);

  return null;
}

// ─── Zoom buttons ─────────────────────────────────────────────────────────────

function ZoomButtons() {
  const map = useMap();
  return (
    <div className="absolute bottom-4 left-4 z-[1000] flex flex-col gap-1">
      {(['+', '−'] as const).map((label, i) => (
        <button
          key={label}
          onClick={() => i === 0 ? map.zoomIn() : map.zoomOut()}
          className="w-8 h-8 bg-white border border-slate-200 rounded-lg shadow text-slate-600 font-bold text-base flex items-center justify-center hover:bg-slate-50 transition-colors"
        >
          {label}
        </button>
      ))}
    </div>
  );
}

// ─── Empty state overlay ──────────────────────────────────────────────────────

function EmptyOverlay({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <div className="absolute bottom-4 right-4 z-[1000] bg-white/90 backdrop-blur-sm rounded-xl px-4 py-2 text-xs text-slate-400 shadow border border-slate-100" dir="rtl">
      אין מיקומים זמינים למפה
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function CityMapPanel({
  cityLat,
  cityLng,
}: {
  cityLat?: number;
  cityLng?: number;
}) {
  const { markers, selectedId, setSelectedId } = useMapSync();

  const cityCenter: [number, number] | null =
    cityLat != null && cityLng != null ? [cityLat, cityLng] : null;

  const defaultCenter: [number, number] = cityCenter ?? [31.5, 34.9];

  return (
    <div className="relative h-full w-full">
      <MapContainer
        center={defaultCenter}
        zoom={cityCenter ? 14 : 8}
        className="h-full w-full"
        zoomControl={false}
      >
        <MapTiles />
        <MapController cityCenter={cityCenter} selectedId={selectedId} markers={markers} />
        <ZoomButtons />
        <EmptyOverlay show={markers.length === 0} />

        {markers.map(m => {
          const isSelected = m.id === selectedId;
          const color = TYPE_COLORS[m.type ?? 'synagogue'];
          const size = isSelected ? 36 : 28;
          return (
            <Marker
              key={m.id}
              position={[m.lat, m.lng]}
              icon={makeIcon(color, size, isSelected)}
              zIndexOffset={isSelected ? 1000 : 0}
              eventHandlers={{
                click: () => setSelectedId(isSelected ? null : m.id),
              }}
            >
              <Tooltip direction="top" offset={[0, -size * 1.2]} opacity={1} permanent={isSelected}>
                <span style={{ fontSize: 12, fontWeight: isSelected ? 700 : 500, color: isSelected ? color : '#334155' }}>
                  {m.label}
                </span>
              </Tooltip>
            </Marker>
          );
        })}
      </MapContainer>
    </div>
  );
}
