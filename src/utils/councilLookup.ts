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
  cbsCode: string;
  name: string;
  /** The regional council this locality belongs to, shown to disambiguate
   *  same-prefixed places (e.g. "מעלה עמוס" under גוש עציון vs. the several
   *  other "מעלה"-prefixed places). Absent when the locality is itself a
   *  city/local council. */
  council?: string;
}

let localitiesCache: LocalityEntry[] | null = null;
let localitiesInFlight: Promise<LocalityEntry[]> | null = null;

/**
 * Every recognized Israeli locality (~1,300 rows total — small enough to
 * fetch once and cache), for a live-narrowing name picker. Exists because an
 * exact-match lookup (searchLocalityByName) or an unqualified Nominatim
 * search both fail an abbreviated or ambiguous name silently: typing "מעלות"
 * has exactly one real match here ("מעלות-תרשיחא"), but geocoding "מעלות"
 * directly returned an unrelated same-named neighbourhood elsewhere instead
 * — checked live. Substring search against this cached list resolves the
 * name before geocoding ever runs, rather than after it's already guessed
 * wrong.
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
    const list = records
      .map(r => ({
        cbsCode: String(r['סמל_ישוב']).trim(),
        name: String(r['שם_ישוב']).trim(),
        council: r['שם_מועצה']?.trim() || undefined,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'he'));
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

/** Best-effort coordinates for a SETTLEMENT NAME once a council centre is known — see geocodePlaceName. */
export async function geocodeSettlement(
  name: string,
  centre: { latitude: number; longitude: number },
  maxDistanceKm = 40,
): Promise<SettlementGeocodeResult | null> {
  return geocodePlaceName(name, centre, maxDistanceKm);
}

/**
 * Best-effort coordinates for a locality NAME with no reference point yet —
 * step 1 of the wizard, before any centre exists to bias against. Checks the
 * government registry first (confirms it's a real, correctly-spelled
 * locality and recovers its official name), then geocodes that name
 * nationwide via Nominatim, same place-only filter as geocodeSettlement.
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
