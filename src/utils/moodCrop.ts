// Pan/zoom of the main ("mood") picture inside its frame. The app uses the same maths;
// keep both in sync.

export interface MoodCrop { url: string; zoom: number; fx: number; fy: number }

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 4;

export interface Size { w: number; h: number }

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Displayed picture size: cover scale times zoom. */
export function displaySize(frame: Size, nat: Size, zoom: number): Size {
  const s = Math.max(frame.w / nat.w, frame.h / nat.h) * zoom;
  return { w: nat.w * s, h: nat.h * s };
}

/** Clamps zoom to 1..4 and the centre so the frame never shows empty space. */
export function clampCrop(frame: Size, nat: Size, zoom: number, fx: number, fy: number) {
  const z = clamp(zoom, MIN_ZOOM, MAX_ZOOM);
  const d = displaySize(frame, nat, z);
  const fxMin = frame.w / (2 * d.w);
  const fyMin = frame.h / (2 * d.h);
  return {
    zoom: z,
    fx: clamp(fx, fxMin, 1 - fxMin),
    fy: clamp(fy, fyMin, 1 - fyMin),
  };
}

/** Where to draw the (already clamped) picture inside the frame. */
export function cropLayout(frame: Size, nat: Size, zoom: number, fx: number, fy: number) {
  const d = displaySize(frame, nat, zoom);
  return { dw: d.w, dh: d.h, left: frame.w / 2 - fx * d.w, top: frame.h / 2 - fy * d.h };
}

/** Plain centred cover: nothing worth storing. */
export function isDefaultCrop(c: { zoom: number; fx: number; fy: number }): boolean {
  return Math.abs(c.zoom - 1) < 0.001 && Math.abs(c.fx - 0.5) < 0.001 && Math.abs(c.fy - 0.5) < 0.001;
}

/** The crop to store for a document, or null when the field should be deleted.
 *  keepDefault: store a plain centred cover too (businesses only). */
export function cropToStore(crop: MoodCrop | undefined | null, primaryUrl: string | undefined, keepDefault = false): MoodCrop | null {
  if (!crop || !primaryUrl || crop.url !== primaryUrl) return null;
  // Businesses: a default crop means "cover" while no crop means "whole picture", so it must be kept.
  if (!keepDefault && isDefaultCrop(crop)) return null;
  const r = (n: number) => Math.round(n * 10000) / 10000;
  return { url: crop.url, zoom: r(crop.zoom), fx: r(crop.fx), fy: r(crop.fy) };
}
