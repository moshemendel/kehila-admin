// Council/settlement discovery for the "create council" wizard, from the same
// data.gov.il locality registry (רשות האוכלוסין וההגירה) importAreas.mjs
// already queries from the CLI — ported to run client-side (CORS is wide
// open: verified live against datastore_search).
//
// A regional council's member settlements share one שם_מועצה value; a plain
// city/local council/municipality has none, so searching by that field comes
// back empty and the caller should fall back to a direct שם_ישוב match to at
// least recover that locality's own cbsCode (see searchLocalityByName).

import { geocodeAddress, type GeocodeResult } from './geocode';

const CKAN = 'https://data.gov.il/api/3/action/datastore_search';
export const LOCALITIES_RESOURCE = '5c78e9fa-c2e2-4771-93ff-7f400a12f7ba';
const NOMINATIM_DELAY_MS = 1100; // Nominatim's usage policy: ~1 req/s

interface LocalityRecord {
  'שם_מועצה'?: string;
  'שם_ישוב': string;
  'סמל_ישוב': string | number;
}

export interface CouncilSettlement {
  cbsCode: string;
  name: string;
}

async function ckanFilterSearch(field: 'שם_מועצה' | 'שם_ישוב', value: string): Promise<CouncilSettlement[]> {
  const url = `${CKAN}?resource_id=${LOCALITIES_RESOURCE}&limit=1000`
    + `&filters=${encodeURIComponent(JSON.stringify({ [field]: value }))}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`שגיאת data.gov.il (${res.status})`);
  const json = await res.json();
  if (!json?.success) throw new Error('data.gov.il החזיר שגיאה');
  const records = (json.result?.records ?? []) as LocalityRecord[];
  return records
    // filters= is already an exact match server-side; re-checking costs nothing.
    .filter(r => String(r[field]).trim() === value)
    .map(r => ({ cbsCode: String(r['סמל_ישוב']).trim(), name: String(r['שם_ישוב']).trim() }))
    .sort((a, b) => a.name.localeCompare(b.name, 'he'));
}

/** Every locality belonging to a regional council, by שם_מועצה exact match. Empty for a plain city. */
export async function searchCouncilSettlements(councilName: string): Promise<CouncilSettlement[]> {
  const name = councilName.trim();
  return name ? ckanFilterSearch('שם_מועצה', name) : [];
}

/** One locality by its own שם_ישוב exact match — recovers a plain city's own cbsCode. */
export async function searchLocalityByName(name: string): Promise<CouncilSettlement | null> {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const hits = await ckanFilterSearch('שם_ישוב', trimmed);
  return hits[0] ?? null;
}

export interface LocalityEntry {
  /** CBS locality code — set for a standalone city/local council. Absent for
   *  a regional council entry, which has no locality row of its own to carry
   *  one (see fetchAllLocalities). */
  cbsCode?: string;
  name: string;
  /** True for a regional council (a derived entry — see fetchAllLocalities),
   *  a standalone city/local council otherwise. */
  isCouncil?: boolean;
}

let localitiesCache: LocalityEntry[] | null = null;
let localitiesInFlight: Promise<LocalityEntry[]> | null = null;

/**
 * Every top-level authority a new tenant could be — a standalone city/local
 * council, or a regional council itself — for a live-narrowing name picker.
 * Deliberately excludes the ~1,080 individual member settlements (קיבוצים,
 * מושבים, כפרים, ...): creating a new top-level tenant is never "אפיקים",
 * it's "עמק הירדן" (the regional council it belongs to) or a plain
 * standalone city — those are two different questions, and only the first
 * is what step 1 is asking.
 *
 * The registry has no separate "is this a council" field, so this is built
 * from what it does have: a locality row with no שם_מועצה is a standalone
 * city/local council; a regional council is never a row of its own (checked
 * live — "עמק הירדן" appears nowhere as a שם_ישוב) but always the שם_מועצה
 * value shared by its member rows, so the distinct set of those names IS the
 * list of councils. Checked live against the full registry (1,316 rows):
 * 233 standalone + 54 distinct council names — the 54 matches Israel's
 * actual count of regional councils exactly.
 */
export async function fetchAllLocalities(): Promise<LocalityEntry[]> {
  if (localitiesCache) return localitiesCache;
  if (localitiesInFlight) return localitiesInFlight;
  localitiesInFlight = (async () => {
    const records: LocalityRecord[] = [];
    let total = Infinity;
    for (let page = 0; records.length < total && page < 20; page++) {
      const res = await fetch(`${CKAN}?resource_id=${LOCALITIES_RESOURCE}&limit=1000&offset=${page * 1000}`);
      const json = await res.json();
      const batch = (json?.result?.records ?? []) as LocalityRecord[];
      if (batch.length === 0) break;
      records.push(...batch);
      total = json?.result?.total ?? records.length;
    }
    const standalone: LocalityEntry[] = records
      .filter(r => !r['שם_מועצה'])
      .map(r => ({ cbsCode: String(r['סמל_ישוב']).trim(), name: String(r['שם_ישוב']).trim() }));
    const councilNames = new Set(records.map(r => r['שם_מועצה']).filter(Boolean) as string[]);
    const councils: LocalityEntry[] = [...councilNames].map(name => ({ name: name.trim(), isCouncil: true }));
    const list = [...standalone, ...councils].sort((a, b) => a.name.localeCompare(b.name, 'he'));
    localitiesCache = list;
    return list;
  })().finally(() => { localitiesInFlight = null; });
  return localitiesInFlight;
}

// ── Hebrew construct-state candidates (ported from importAreas.mjs) ──────────
// "X (קבוצה)" needs to be searched as "קבוצת X" to resolve on Nominatim, same
// for מושבה→מושבת; a plain bracket-qualified or punctuated name usually needs
// flattening too. Tried in order, first 'place'-classed hit wins.
const CONSTRUCT: Record<string, string> = { 'קבוצה': 'קבוצת', 'מושבה': 'מושבת' };

function queryCandidates(name: string): string[] {
  const out = [name];
  const qualified = name.match(/^(.*?)\s*\((.+?)\)\s*$/);
  const construct = qualified && CONSTRUCT[qualified[2].trim()];
  if (construct) out.push(`${construct} ${qualified[1].trim()}`);
  const flattened = name.replace(/[()]/g, '').replace(/\s*-\s*/g, ' ').replace(/\s+/g, ' ').trim();
  if (!out.includes(flattened)) out.push(flattened);
  const base = name.replace(/\s*\(.*?\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
  if (base && !out.includes(base)) out.push(base);
  return out;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export interface SettlementGeocodeResult extends GeocodeResult {
  matchedQuery: string;
}

/**
 * A hit that's actually a settlement rather than a street/POI/valley that
 * happens to share its name — a search for "עמק הירדן" itself returns a
 * valley and two roads before anything settlement-like. Most settlements are
 * class 'place'; some (checked live: מעלות-תרשיחא, a real municipality) have
 * no 'place' node in OSM at all and are only mapped as their administrative
 * boundary polygon — rejecting those too would fail a real, correctly-named
 * locality, so both are accepted. Neither "עמק הירדן" result is either kind
 * (natural/valley, highway/*), so this stays exactly as selective for that
 * case while no longer rejecting a legitimate boundary-only place.
 */
function isSettlementHit(h: GeocodeResult): boolean {
  return h.class === 'place' || (h.class === 'boundary' && h.type === 'administrative');
}

/**
 * Tries each Hebrew candidate form of `name` in turn against Nominatim,
 * keeping only a settlement-classed hit (see isSettlementHit). Sequential,
 * ~1.1s between requests, per Nominatim's usage policy.
 */
async function geocodePlaceName(
  name: string,
  bias: { latitude: number; longitude: number } | null,
  maxDistanceKm = 40,
): Promise<SettlementGeocodeResult | null> {
  for (const q of queryCandidates(name)) {
    let hits: GeocodeResult[] = [];
    try {
      hits = bias
        ? await geocodeAddress(q, { latitude: bias.latitude, longitude: bias.longitude }, 5, maxDistanceKm)
        : await geocodeAddress(q, {}, 5);
    } catch {
      // this candidate failed on the network — try the next form rather than aborting the row
    }
    await sleep(NOMINATIM_DELAY_MS);
    const place = hits.find(isSettlementHit);
    if (place) return { ...place, matchedQuery: q };
  }
  return null;
}

/**
 * Best-effort coordinates for a SETTLEMENT NAME once a council centre is
 * known — see geocodePlaceName. `centre` is nullable for the case where no
 * centre exists yet (a regional council picked before any of its
 * settlements are geocoded — see AddCouncilWizard's proceedToCouncilSettlements,
 * which computes the centre as their centroid only once they're resolved).
 */
export async function geocodeSettlement(
  name: string,
  centre: { latitude: number; longitude: number } | null,
  maxDistanceKm = 40,
): Promise<SettlementGeocodeResult | null> {
  return geocodePlaceName(name, centre, maxDistanceKm);
}

/**
 * Best-effort coordinates for a STANDALONE locality NAME with no reference
 * point yet — step 1 of the wizard, before any centre exists to bias
 * against. A regional council never reaches this: the wizard already knows
 * from the same top-level list the picker uses, and skips straight to its
 * settlements instead — a geometric centroid of the council's real member
 * settlements turned out simpler and more meaningful than geocoding the
 * council itself (checked live: a bare council name almost never resolves
 * to anything but a same-named natural feature).
 *
 * Checks the government registry first (confirms it's real and recovers its
 * official spelling), then geocodes that name nationwide via Nominatim.
 */
export async function geocodeLocality(name: string): Promise<SettlementGeocodeResult | null> {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const official = await searchLocalityByName(trimmed).catch(() => null);
  return geocodePlaceName(official?.name ?? trimmed, null);
}

/** One open-meteo request for every point — matched back to callers by array index. */
export async function batchElevations(points: { latitude: number; longitude: number }[]): Promise<(number | null)[]> {
  if (!points.length) return [];
  const lat = points.map(p => p.latitude).join(',');
  const lon = points.map(p => p.longitude).join(',');
  const res = await fetch(`https://api.open-meteo.com/v1/elevation?latitude=${lat}&longitude=${lon}`);
  if (!res.ok) return points.map(() => null);
  const json = await res.json();
  const elevs = Array.isArray(json?.elevation) ? json.elevation : [];
  return points.map((_, i) => typeof elevs[i] === 'number' ? Math.round(elevs[i]) : null);
}
