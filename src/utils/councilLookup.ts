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
 * Best-effort coordinates for a SETTLEMENT NAME (not a street address) — tries
 * each Hebrew candidate form in turn, keeping only Nominatim hits classed
 * 'place' (a street/POI that happens to share the settlement's name is
 * rejected outright, not silently geocoded to the wrong kind of thing — a
 * search for "עמק הירדן" itself returns a valley and two roads before
 * anything place-classed). Sequential, ~1.1s between requests, per
 * Nominatim's usage policy — callers geocoding a list should await this one
 * row at a time, not in parallel.
 */
export async function geocodeSettlement(
  name: string,
  centre: { latitude: number; longitude: number },
  maxDistanceKm = 40,
): Promise<SettlementGeocodeResult | null> {
  for (const q of queryCandidates(name)) {
    let hits: GeocodeResult[] = [];
    try {
      hits = await geocodeAddress(q, { latitude: centre.latitude, longitude: centre.longitude }, 5, maxDistanceKm);
    } catch {
      // this candidate failed on the network — try the next form rather than aborting the row
    }
    await sleep(NOMINATIM_DELAY_MS);
    const place = hits.find(h => h.class === 'place');
    if (place) return { ...place, matchedQuery: q };
  }
  return null;
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
