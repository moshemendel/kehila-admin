// Official street/neighborhood names per locality, from data.gov.il's
// national street registry (רשות האוכלוסין וההגירה, dataset d2581732-…,
// resource 9ad3862c-… "רשימת רחובות בישראל - מתעדכן" — self-updating). Keyed
// by סמל_ישוב, the same CBS locality code already stored as Area.cbsCode
// (importAreas.mjs pulls both from the same government registry family, so
// they agree exactly — verified against Ma'ale Adumim, code 3616, and
// several Emek HaYarden areas).
//
// This exists because geocoding an address (utils/geocode.ts, Nominatim) only
// ever answers "where is this text on a map", and for a settlement OSM has
// never indexed — common among Emek HaYarden's newer streets, per
// AddressGeocodeField's own note — the answer is "nowhere", with no way to
// tell a typo from a real street OSM simply hasn't mapped yet. This answers a
// different, prior question: is this even a real, correctly-spelled street
// in this locality at all. A kibbutz with no named internal streets gets
// back exactly one street option — its own name, which is also the correct
// address text for it (see the "אפיקים / אפיקים" case in fetchOfficialStreets).
//
// No coordinates in this dataset, deliberately not conflated with geocoding:
// picking a street here fills in the text; pressing אתר (or the map pin)
// still finds the point, same as always.
//
// שם_רחוב also carries NEIGHBORHOODS, prefixed "שכ " — not a typo of a street
// name, an actual different kind of row. Ma'ale Adumim's own list has 9 of
// them (שכ נופי הסלע, שכ צמח השדה, …) and some are already live as this
// app's own neighborhood values elsewhere (syn-1's neighborhood is literally
// "נופי סלע (07)"). Offering "שכ נופי הסלע" in a STREET picker would be
// wrong — it isn't one — so this splits the two apart at the source rather
// than leaving each caller to notice and filter it out itself.

const API = 'https://data.gov.il/api/3/action/datastore_search';
const RESOURCE_ID = '9ad3862c-8391-4b2f-84a4-2d4c68625f4b';
const NEIGHBORHOOD_PREFIX = 'שכ ';

interface StreetRecord {
  שם_רחוב: string;
  סמל_רחוב: number;
}

interface LocalityNames {
  streets: string[];
  neighborhoods: string[];
}

const cache = new Map<string, LocalityNames>();
const inFlight = new Map<string, Promise<LocalityNames>>();

const PAGE_SIZE = 1000;
const MAX_PAGES = 20; // 20k streets/locality is far past any real Israeli city; guards a runaway loop, not a real cap

// A single request caps at PAGE_SIZE records. Jerusalem alone has 4383 street
// rows (total from the API's own response) — a plain one-shot limit=1000
// silently truncated to the first page, which for Jerusalem happened to be
// ALL streets and ZERO of its 93 שכ-prefixed neighborhoods (they sort later
// in the registry), so the neighborhood picker came back empty for exactly
// the cities that most need it. Paginate by the API's own `total` instead of
// assuming any fixed size fits in one call.
async function fetchAllRecords(cbsCode: string | number): Promise<StreetRecord[]> {
  const filters = encodeURIComponent(JSON.stringify({ סמל_ישוב: Number(cbsCode) }));
  const records: StreetRecord[] = [];
  let total = Infinity;
  for (let page = 0; records.length < total && page < MAX_PAGES; page++) {
    const res = await fetch(`${API}?resource_id=${RESOURCE_ID}&filters=${filters}&limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`);
    const json = await res.json();
    const batch = (json?.result?.records ?? []) as StreetRecord[];
    if (batch.length === 0) break;
    records.push(...batch);
    total = json?.result?.total ?? records.length;
  }
  return records;
}

function load(cbsCode: string | number): Promise<LocalityNames> {
  const key = String(cbsCode);
  const hit = cache.get(key);
  if (hit) return Promise.resolve(hit);
  let p = inFlight.get(key);
  if (!p) {
    p = fetchAllRecords(cbsCode)
      .then((records) => {
        // Same street code can appear more than once in the raw registry
        // (historical re-imports); names collide on that far more than the
        // API's own dedup handles.
        const rawNames = [...new Set(records.map((r) => r['שם_רחוב']).filter(Boolean))];
        const streets: string[] = [];
        const neighborhoods: string[] = [];
        for (const n of rawNames) {
          if (n.startsWith(NEIGHBORHOOD_PREFIX)) neighborhoods.push(n.slice(NEIGHBORHOOD_PREFIX.length));
          else streets.push(n);
        }
        const collator = (a: string, b: string) => a.localeCompare(b, 'he');
        streets.sort(collator);
        neighborhoods.sort(collator);
        const result = { streets, neighborhoods };
        cache.set(key, result);
        return result;
      })
      .catch(() => ({ streets: [], neighborhoods: [] }))
      .finally(() => { inFlight.delete(key); });
    inFlight.set(key, p);
  }
  return p;
}

/**
 * Every official STREET name for one locality, alphabetised — neighborhoods
 * (שכ-prefixed rows) excluded, see fetchOfficialNeighborhoods. A kibbutz or
 * small settlement with no internally-named streets — the common case
 * across Emek HaYarden's 22 — comes back as a single-item list: the
 * settlement's own name, which doubles as the correct address text
 * ("אפיקים", not a street within it) for anything located there.
 */
export async function fetchOfficialStreets(cbsCode: string | number): Promise<string[]> {
  return (await load(cbsCode)).streets;
}

/**
 * Every official NEIGHBORHOOD name for one locality (the שכ-prefixed rows,
 * prefix stripped), alphabetised. Most localities have none — a plain city
 * with real neighborhoods, Ma'ale Adumim among them, is the case this is
 * actually for.
 */
export async function fetchOfficialNeighborhoods(cbsCode: string | number): Promise<string[]> {
  return (await load(cbsCode)).neighborhoods;
}
