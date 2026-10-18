/**
 * Where a grave is, from the register's plot / row / grave numbers.
 *
 * The console outlines each plot (חלקה) on the satellite map and draws one line
 * along its first row, from the first grave towards the last. That line gives the
 * rows' direction; the rows then run away from it, towards the rest of the plot.
 * With the number of rows and of graves in a row (read from the register, or set
 * by hand) every grave is a point: its row picks a line across the plot, its
 * number picks the position along that line.
 *
 * Accuracy is the honest limit: it is as good as the outline and as even as the
 * plot — right to the row, and to within a few graves along it. The app says so
 * and shows the point on the map, so the last steps are by eye.
 *
 * Kept identical in the app (src/utils) and the console (src/utils): the console
 * previews with it and the app navigates with it.
 */

export interface GeoPoint { latitude: number; longitude: number }

export interface PlotShape {
  /** The plot's outline, in order around it. A rectangle is its four corners. */
  polygon: GeoPoint[];
  /** Along the first row, from its first grave (a) to its last (b). */
  axisA: GeoPoint;
  axisB: GeoPoint;
  /** How many rows / graves per row. Absent = taken from the register's numbers. */
  rows?: number;
  graves?: number;
}

// Metres east / north of an origin. Flat-earth is exact enough over a cemetery.
const M_PER_DEG_LAT = 110_574;
const mPerDegLng = (lat: number) => 111_320 * Math.cos((lat * Math.PI) / 180);

interface Frame {
  originLat: number; originLng: number;
  ux: number; uy: number; // along the row, a → b
  vx: number; vy: number; // across the rows, towards the plot
}

const toXY = (f: Frame, p: GeoPoint) => ({
  x: (p.longitude - f.originLng) * mPerDegLng(f.originLat),
  y: (p.latitude - f.originLat) * M_PER_DEG_LAT,
});
const toSt = (f: Frame, p: GeoPoint) => {
  const { x, y } = toXY(f, p);
  return { s: x * f.ux + y * f.uy, t: x * f.vx + y * f.vy };
};
const fromSt = (f: Frame, s: number, t: number): GeoPoint => {
  const x = s * f.ux + t * f.vx;
  const y = s * f.uy + t * f.vy;
  return {
    latitude: f.originLat + y / M_PER_DEG_LAT,
    longitude: f.originLng + x / mPerDegLng(f.originLat),
  };
};

/** The row/grave frame of a plot: origin at the first row's first grave. */
function frameOf(shape: PlotShape): Frame | null {
  const a = shape.axisA;
  const probe: Frame = { originLat: a.latitude, originLng: a.longitude, ux: 1, uy: 0, vx: 0, vy: 1 };
  const b = toXY(probe, shape.axisB);
  const len = Math.hypot(b.x, b.y);
  if (len < 0.5 || shape.polygon.length < 3) return null;
  const ux = b.x / len;
  const uy = b.y / len;
  let vx = -uy;
  let vy = ux;
  // The rows run towards the plot, so the plot's centre is on the positive side.
  const cx = shape.polygon.reduce((n, p) => n + toXY(probe, p).x, 0) / shape.polygon.length;
  const cy = shape.polygon.reduce((n, p) => n + toXY(probe, p).y, 0) / shape.polygon.length;
  if (cx * vx + cy * vy < 0) { vx = -vx; vy = -vy; }
  return { originLat: a.latitude, originLng: a.longitude, ux, uy, vx, vy };
}

/** "12" → 12, "1א" → 1 (the lettered grave is beside the numbered one); no number → null. */
export function registerNumber(s: string | undefined | null): number | null {
  const m = /\d+/.exec(String(s ?? ''));
  return m ? parseInt(m[0], 10) : null;
}

/** The s-extent of the outline along the line t = const, or null where it does not reach. */
function chordAt(f: Frame, polygon: GeoPoint[], t: number): [number, number] | null {
  const pts = polygon.map((p) => toSt(f, p));
  const hits: number[] = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    if ((p.t <= t && q.t > t) || (q.t <= t && p.t > t)) {
      hits.push(p.s + ((t - p.t) / (q.t - p.t)) * (q.s - p.s));
    }
  }
  return hits.length >= 2 ? [Math.min(...hits), Math.max(...hits)] : null;
}

/**
 * The point for a grave, or null when the numbers or the shape cannot place it.
 * `rows` / `graves` are the plot's totals; they stretch the grid over the outline.
 */
export function locateGrave(
  shape: PlotShape,
  row: string | number,
  grave: string | number,
  totals: { rows: number; graves: number },
): GeoPoint | null {
  const f = frameOf(shape);
  const r = typeof row === 'number' ? row : registerNumber(row);
  const g = typeof grave === 'number' ? grave : registerNumber(grave);
  if (!f || r == null || g == null || r < 1 || g < 1) return null;

  const rows = Math.max(shape.rows ?? totals.rows, 1);
  const graves = Math.max(shape.graves ?? totals.graves, 1);

  const ts = shape.polygon.map((p) => toSt(f, p).t);
  const tLast = Math.max(...ts);
  // Row 1 is the axis (t = 0), the last row is the far edge of the outline.
  const t = rows === 1 ? 0 : (Math.min(r, rows) - 1) / (rows - 1) * tLast;

  const chord = chordAt(f, shape.polygon, Math.min(Math.max(t, 0.01), tLast - 0.01));
  const sa = toSt(f, shape.axisA).s;
  const sb = toSt(f, shape.axisB).s;
  const [s0, s1] = chord ?? [Math.min(sa, sb), Math.max(sa, sb)];

  const along = (Math.min(g, graves) - 0.5) / graves; // graves are centred in their slot
  return fromSt(f, s0 + along * (s1 - s0), t);
}

/** The middle of the outline — where to aim when a grave's numbers are unusable. */
export function plotCentre(shape: PlotShape): GeoPoint {
  const n = shape.polygon.length;
  return {
    latitude: shape.polygon.reduce((a, p) => a + p.latitude, 0) / n,
    longitude: shape.polygon.reduce((a, p) => a + p.longitude, 0) / n,
  };
}

/** A rectangle's corners from the row line a→b and a point on the far side that sets its width. */
export function rectangleFromAxis(a: GeoPoint, b: GeoPoint, side: GeoPoint): GeoPoint[] {
  const probe: Frame = { originLat: a.latitude, originLng: a.longitude, ux: 1, uy: 0, vx: 0, vy: 1 };
  const ab = toXY(probe, b);
  const len = Math.hypot(ab.x, ab.y) || 1;
  const ux = ab.x / len;
  const uy = ab.y / len;
  const sp = toXY(probe, side);
  // Width is the click's distance from the line; its sign says which side.
  let vx = -uy;
  let vy = ux;
  let width = sp.x * vx + sp.y * vy;
  if (width < 0) { vx = -vx; vy = -vy; width = -width; }
  const f: Frame = { ...probe, ux, uy, vx, vy };
  return [
    fromSt(f, 0, 0), fromSt(f, len, 0), fromSt(f, len, width), fromSt(f, 0, width),
  ];
}

/** Largest row and grave number among a plot's register records — the grid's size. */
export function totalsFromRegister(records: { row?: string; grave?: string }[]): { rows: number; graves: number } {
  let rows = 1;
  let graves = 1;
  for (const rec of records) {
    rows = Math.max(rows, registerNumber(rec.row) ?? 1);
    graves = Math.max(graves, registerNumber(rec.grave) ?? 1);
  }
  return { rows, graves };
}
