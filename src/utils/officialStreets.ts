// Official street names per locality, from data.gov.il's national street
// registry (רשות האוכלוסין וההגירה, dataset d2581732-…, resource 9ad3862c-…
// "רשימת רחובות בישראל - מתעדכן" — self-updating). Keyed by סמל_ישוב, the same
// CBS locality code already stored as Area.cbsCode (importAreas.mjs pulls
// both from the same government registry family, so they agree exactly —
// verified against Ma'ale Adumim, code 3616, and several Emek HaYarden areas).
//
// This exists because geocoding an address (utils/geocode.ts, Nominatim) only
// ever answers "where is this text on a map", and for a settlement OSM has
// never indexed — common among Emek HaYarden's newer streets, per
// AddressGeocodeField's own note — the answer is "nowhere", with no way to
// tell a typo from a real street OSM simply hasn't mapped yet. This answers a
// different, prior question: is this even a real, correctly-spelled street
// in this locality at all. A kibbutz with no named internal streets gets
// back exactly one option — its own name, which is also the correct address
// text for it (see the AFIKIM_STYLE note below).
//
// No coordinates in this dataset, deliberately not conflated with geocoding:
// picking a street here fills in the text; pressing אתר (or the map pin)
// still finds the point, same as always.

const API = 'https://data.gov.il/api/3/action/datastore_search';
const RESOURCE_ID = '9ad3862c-8391-4b2f-84a4-2d4c68625f4b';

interface StreetRecord {
  שם_רחוב: string;
  סמל_רחוב: number;
}

const cache = new Map<string, string[]>();
const inFlight = new Map<string, Promise<string[]>>();

/**
 * Every official street name for one locality, alphabetised. A kibbutz or
 * small settlement with no internally-named streets — the common case
 * across Emek HaYarden's 22 (see the "אפיקים / אפיקים" self-named-street
 * pattern) — comes back as a single-item list: the settlement's own name,
 * which doubles as the correct address text ("אפיקים", not a street within
 * it) for anything located there.
 */
export async function fetchOfficialStreets(cbsCode: string | number): Promise<string[]> {
  const key = String(cbsCode);
  const hit = cache.get(key);
  if (hit) return hit;
  let p = inFlight.get(key);
  if (!p) {
    const filters = encodeURIComponent(JSON.stringify({ סמל_ישוב: Number(cbsCode) }));
    p = fetch(`${API}?resource_id=${RESOURCE_ID}&filters=${filters}&limit=1000`)
      .then((res) => res.json())
      .then((json) => {
        const records = (json?.result?.records ?? []) as StreetRecord[];
        // Same street code can appear more than once in the raw registry
        // (historical re-imports); names collide on that far more than the
        // API's own dedup handles.
        const names = [...new Set(records.map((r) => r['שם_רחוב']).filter(Boolean))];
        names.sort((a, b) => a.localeCompare(b, 'he'));
        cache.set(key, names);
        return names;
      })
      .catch(() => [])
      .finally(() => { inFlight.delete(key); });
    inFlight.set(key, p);
  }
  return p;
}
