// Address → coordinates via Nominatim, OpenStreetMap's geocoder.
//
// Nominatim is used rather than Google because the admin already renders OSM
// tiles (CityMapPanel), so results come from the same dataset the user sees on
// the map, and it needs no API key or billing account.
//
// Nominatim's usage policy caps this at ~1 request/second and forbids bulk or
// automated querying, so callers MUST trigger it from an explicit user action
// (a button press) — never from an onChange/keystroke handler.
// https://operations.osmfoundation.org/policies/nominatim/

export interface GeocodeResult {
  latitude: number;
  longitude: number;
  /** Full formatted address as Nominatim resolved it, for confirming the hit. */
  label: string;
}

export interface GeocodeBias {
  /** City name, appended to the query so "רחוב הרצל 5" resolves in the right town. */
  cityName?: string;
  /** City centre. Used to prefer nearby hits — see note on country below. */
  latitude?: number;
  longitude?: number;
}

/**
 * Hits further than this from the city centre are discarded outright.
 *
 * Not a nicety — without it the geocoder silently returns the WRONG TOWN.
 * Measured against live Nominatim for מעלה אדומים:
 *   "הר הלבונה 18"                 → הלולב 18, גבעת זאב  (~15 km away)
 *   "הר הלבונה 18, מעלה אדומים"    → same, the city name is simply ignored
 *   unbounded                       → "Ligne 18", a railway outside Paris
 * Those coordinates get saved and then navigation sends people to another town,
 * which is far worse than reporting "not found" and asking for a map pin.
 */
export const MAX_DISTANCE_KM = 12;

/** Set to true in the browser console to trace lookups: `localStorage.geocodeDebug = '1'`. */
const debugOn = () => {
  try { return localStorage.getItem('geocodeDebug') === '1'; } catch { return false; }
};

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Deliberately NO country in the query.
 *
 * Appending one breaks the pilot city: OSM files מעלה אדומים under
 * "יהודה ושומרון / الأراضي الفلسطينية", not Israel, so "…, Israel" returns zero
 * results and "…, ישראל" mis-matches the street אחדות ישראל. A viewbox around
 * the city's own coordinates gives the same disambiguation without depending on
 * how OSM happens to classify the territory.
 */
const VIEWBOX_DEGREES = 0.15;

/**
 * Look up an address. Returns the best matches, most confident first — an empty
 * array means Nominatim found nothing rather than that the request failed
 * (failures throw, so the caller can tell "no results" from "network down").
 */
export async function geocodeAddress(
  address: string,
  bias: GeocodeBias = {},
  limit = 5,
): Promise<GeocodeResult[]> {
  if (!address.trim()) return [];
  const q = [address.trim(), bias.cityName].filter(Boolean).join(', ');

  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('q', q);
  url.searchParams.set('format', 'json');
  url.searchParams.set('limit', String(limit));
  // Prefer Hebrew names in the returned label, matching the rest of the UI.
  url.searchParams.set('accept-language', 'he');

  if (Number.isFinite(bias.latitude) && Number.isFinite(bias.longitude)) {
    const lat = bias.latitude as number;
    const lon = bias.longitude as number;
    const d = VIEWBOX_DEGREES;
    url.searchParams.set('viewbox', `${lon - d},${lat + d},${lon + d},${lat - d}`);
    // bounded=0 → prefer results in the box, but still allow ones outside it,
    // so an address just past the city limit is found rather than dropped.
    url.searchParams.set('bounded', '0');
  }

  const debug = debugOn();
  if (debug) console.groupCollapsed(`[geocode] "${q}"`);
  if (debug) console.log('url', url.toString());

  const res = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    if (debug) { console.error('HTTP', res.status); console.groupEnd(); }
    throw new Error(`שגיאת שירות המפות (${res.status})`);
  }

  const rows = (await res.json()) as Array<{ lat: string; lon: string; display_name: string }>;
  if (debug) console.log('raw results', rows.length, rows.map(r => r.display_name));

  const parsed = rows
    .map(r => ({
      latitude: parseFloat(r.lat),
      longitude: parseFloat(r.lon),
      label: r.display_name,
    }))
    .filter(r => Number.isFinite(r.latitude) && Number.isFinite(r.longitude));

  // Without a city centre there's nothing to measure against, so everything
  // passes — the caller should always supply one for the pilot city.
  if (!Number.isFinite(bias.latitude) || !Number.isFinite(bias.longitude)) {
    if (debug) { console.warn('no city centre supplied — distance filter skipped'); console.groupEnd(); }
    return parsed;
  }

  const kept: GeocodeResult[] = [];
  for (const r of parsed) {
    const km = haversineKm(bias.latitude as number, bias.longitude as number, r.latitude, r.longitude);
    if (km <= MAX_DISTANCE_KM) {
      kept.push(r);
      if (debug) console.log(`✓ ${km.toFixed(1)} km — ${r.label}`);
    } else if (debug) {
      console.log(`✗ ${km.toFixed(1)} km (over ${MAX_DISTANCE_KM}) — ${r.label}`);
    }
  }
  if (debug) { console.log('kept', kept.length, 'of', parsed.length); console.groupEnd(); }
  return kept;
}
