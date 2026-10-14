/**
 * Eruv boundary points to and from a spreadsheet — for a council that already
 * has its eruv poles (עמודי עירוב) surveyed, instead of clicking each one onto
 * the map.
 *
 * One row per point:  polygon | order | latitude | longitude
 *   polygon  which ring (1–5); optional, defaults to 1. An eruv can enclose
 *            areas that do not touch, each its own ring.
 *   order    position along the boundary; optional, file order otherwise.
 *
 * Header names are matched loosely (English or Hebrew, any case), because the
 * file will come out of whatever GIS or Excel the council uses, not ours.
 *
 * Kept free of React so the parsing can be checked on its own.
 */
import * as XLSX from 'xlsx';

export interface LatLng { lat: number; lng: number; }

export const MAX_POLYGONS = 5;

/** Israel, generously: anything outside is a typo, a swapped pair, or ITM. */
const LAT_RANGE: [number, number] = [29.3, 33.5];
const LNG_RANGE: [number, number] = [34.2, 35.95];
/** Points further than this from the city centre are flagged, not dropped. */
export const FAR_KM = 25;

const HEADERS: Record<'polygon' | 'order' | 'lat' | 'lng', string[]> = {
  polygon: ['polygon', 'ring', 'part', 'מצולע', 'אזור', 'טבעת'],
  order:   ['order', 'seq', 'sequence', 'index', 'no', 'num', 'number', 'סדר', 'מספר', 'מס', 'מס\''],
  lat:     ['latitude', 'lat', 'y', 'קו רוחב', 'רוחב'],
  lng:     ['longitude', 'lng', 'lon', 'long', 'x', 'קו אורך', 'אורך'],
};

const norm = (s: string) => s.replace(/^\uFEFF/, '').trim().toLowerCase().replace(/["״]/g, '');

function findColumn(keys: string[], names: string[]): string | null {
  const wanted = names.map(norm);
  return keys.find(k => wanted.includes(norm(k))) ?? null;
}

function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const t = v.trim().replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

const inRange = (v: number, [lo, hi]: [number, number]) => v >= lo && v <= hi;

export function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/**
 * Reorders a ring by walking to the nearest unvisited point each step.
 * For a pole list that came out of a register sorted by pole id rather than
 * along the route. A heuristic: right for a boundary that does not double
 * back on itself, which is most eruvin — the map preview is the check.
 */
export function orderByProximity(points: LatLng[]): LatLng[] {
  if (points.length < 3) return points;
  const left = points.slice(1);
  const out = [points[0]];
  while (left.length) {
    const last = out[out.length - 1];
    let best = 0;
    let bestD = Infinity;
    left.forEach((p, i) => {
      const d = haversineKm(last, p);
      if (d < bestD) { bestD = d; best = i; }
    });
    out.push(left.splice(best, 1)[0]);
  }
  return out;
}

export interface ParseResult {
  polygons: LatLng[][];
  /** Rows that could not be used, with the reason. */
  errors: string[];
  /** Usable, but worth a look before saving. */
  warnings: string[];
  hadOrderColumn: boolean;
}

export function parseEruvRows(
  rows: Record<string, unknown>[],
  centre?: LatLng,
): ParseResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (rows.length === 0) return { polygons: [], errors: ['הקובץ ריק'], warnings, hadOrderColumn: false };

  const keys = Object.keys(rows[0]);
  const latCol = findColumn(keys, HEADERS.lat);
  const lngCol = findColumn(keys, HEADERS.lng);
  const polyCol = findColumn(keys, HEADERS.polygon);
  const orderCol = findColumn(keys, HEADERS.order);
  if (!latCol || !lngCol) {
    return {
      polygons: [],
      errors: [`לא נמצאו עמודות latitude ו-longitude. העמודות בקובץ: ${keys.join(', ')}`],
      warnings, hadOrderColumn: !!orderCol,
    };
  }

  type Row = { line: number; poly: number; order: number; lat: number; lng: number };
  const parsed: Row[] = [];
  rows.forEach((r, i) => {
    const line = i + 2; // header is line 1
    const lat = num(r[latCol]);
    const lng = num(r[lngCol]);
    if (lat === null && lng === null) return; // blank line
    if (lat === null || lng === null) { errors.push(`שורה ${line}: חסר ערך קו רוחב או קו אורך`); return; }
    const poly = polyCol ? (num(r[polyCol]) ?? 1) : 1;
    const order = orderCol ? (num(r[orderCol]) ?? Number.MAX_SAFE_INTEGER) : i;
    parsed.push({ line, poly: Math.round(poly), order, lat, lng });
  });

  if (parsed.length === 0) return { polygons: [], errors, warnings, hadOrderColumn: !!orderCol };

  // Israeli grid (ITM) numbers are in the hundreds of thousands. Converting
  // them needs a projection we do not want to get subtly wrong here.
  if (parsed.some(p => Math.abs(p.lat) > 1000 || Math.abs(p.lng) > 1000)) {
    return {
      polygons: [],
      errors: ['הקואורדינטות נראות כמו רשת ישראל (ITM), למשל 200000 / 630000. יש להמיר אותן ל-WGS84 (מעלות עשרוניות, כמו 31.93 / 34.87) ולטעון שוב.'],
      warnings, hadOrderColumn: !!orderCol,
    };
  }

  // Latitude and longitude swapped: Israel's longitudes (34–36) fall outside
  // its latitudes and vice versa, so the pair is unambiguous.
  const swappedCount = parsed.filter(p => inRange(p.lng, LAT_RANGE) && inRange(p.lat, LNG_RANGE)
    && !(inRange(p.lat, LAT_RANGE) && inRange(p.lng, LNG_RANGE))).length;
  if (swappedCount > parsed.length / 2) {
    parsed.forEach(p => { [p.lat, p.lng] = [p.lng, p.lat]; });
    warnings.push('העמודות latitude ו-longitude נראו הפוכות, והוחלפו.');
  }

  const kept = parsed.filter(p => {
    if (!inRange(p.lat, LAT_RANGE) || !inRange(p.lng, LNG_RANGE)) {
      errors.push(`שורה ${p.line}: ${p.lat}, ${p.lng} מחוץ לישראל`);
      return false;
    }
    return true;
  });

  if (centre) {
    const far = kept.filter(p => haversineKm(centre, p) > FAR_KM);
    if (far.length) {
      warnings.push(`${far.length} נקודות רחוקות יותר מ-${FAR_KM} ק"מ ממרכז העיר (שורות ${far.slice(0, 5).map(p => p.line).join(', ')}${far.length > 5 ? '…' : ''}).`);
    }
  }

  const ids = [...new Set(kept.map(p => p.poly))].sort((a, b) => a - b);
  if (ids.length > MAX_POLYGONS) {
    errors.push(`בקובץ ${ids.length} מצולעים. אפשר עד ${MAX_POLYGONS}; נטענו הראשונים.`);
  }
  const polygons: LatLng[][] = [];
  for (const id of ids.slice(0, MAX_POLYGONS)) {
    const ring = kept.filter(p => p.poly === id).sort((a, b) => a.order - b.order);
    // Drop exact repeats of the previous point, and a closing point that
    // repeats the first: the map closes every ring by itself.
    const pts: LatLng[] = [];
    for (const p of ring) {
      const prev = pts[pts.length - 1];
      if (!prev || prev.lat !== p.lat || prev.lng !== p.lng) pts.push({ lat: p.lat, lng: p.lng });
    }
    if (pts.length > 3 && pts[0].lat === pts[pts.length - 1].lat && pts[0].lng === pts[pts.length - 1].lng) pts.pop();
    if (pts.length < 3) {
      errors.push(`מצולע ${id}: ${pts.length} נקודות. צריך לפחות 3, והוא לא נטען.`);
      continue;
    }
    polygons.push(pts);
  }

  return { polygons, errors, warnings, hadOrderColumn: !!orderCol };
}

/** Rows for export: the same columns the import reads. */
export function polygonsToRows(polygons: LatLng[][]): Record<string, number>[] {
  return polygons.flatMap((ring, i) => ring.map((p, j) => ({
    polygon: i + 1,
    order: j + 1,
    latitude: Number(p.lat.toFixed(7)),
    longitude: Number(p.lng.toFixed(7)),
  })));
}

/** CSV with a BOM, so Excel opens Hebrew file names and headers correctly. */
function downloadCsv(rows: Record<string, unknown>[], header: string[], filename: string) {
  const ws = XLSX.utils.json_to_sheet(rows, { header });
  const csv = '\uFEFF' + XLSX.utils.sheet_to_csv(ws);
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const COLUMNS = ['polygon', 'order', 'latitude', 'longitude'];

export function downloadEruvTemplate() {
  downloadCsv([], COLUMNS, 'eruv_points_template.csv');
}

export function exportEruvPoints(polygons: LatLng[][], name: string) {
  const safe = name.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'eruv';
  downloadCsv(polygonsToRows(polygons), COLUMNS, `${safe}_points.csv`);
}
