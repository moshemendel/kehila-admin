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

  const res = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`שגיאת שירות המפות (${res.status})`);

  const rows = (await res.json()) as Array<{ lat: string; lon: string; display_name: string }>;
  return rows
    .map(r => ({
      latitude: parseFloat(r.lat),
      longitude: parseFloat(r.lon),
      label: r.display_name,
    }))
    .filter(r => Number.isFinite(r.latitude) && Number.isFinite(r.longitude));
}
