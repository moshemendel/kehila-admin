/**
 * Google satellite tiles for Leaflet, via the official Map Tiles API.
 *
 * Why Google and not Esri: Esri's high-res imagery over מעלה אדומים was captured
 * 2024-07-27 (checked against Esri's own capture-date service), so neighbourhoods
 * built since — הר הלבונה among them — show as bare ground. That is precisely
 * where a gabbai needs to drop a pin, since those streets are missing from the
 * vector map and the geocoder too. Google's imagery is current there.
 *
 * NOT the undocumented mt{n}.google.com/vt endpoint. It works and needs no key,
 * but Google's terms forbid it and it can change or start blocking without
 * notice — not something to build a municipality's data entry on.
 *
 * SETUP:
 *   1. Google Cloud console → enable "Map Tiles API"
 *   2. Create an API key restricted by HTTP referrer to the admin's domain,
 *      and by API to Map Tiles only
 *   3. Put it in kehila-admin/.env as  VITE_GOOGLE_MAPS_KEY=...
 * Without the key everything still works — the map falls back to Esri.
 *
 * This key is WEB-ONLY. The mobile app needs a SEPARATE key from the same
 * project: a Google key carries one application restriction type, so a key
 * locked to a website cannot also be locked to an Android package. Reusing this
 * one there would force it unrestricted — and it ships inside the JS bundle,
 * where anyone can read it. See app.config.js / GOOGLE_MAPS_API_KEY.
 */

const KEY: string | undefined = import.meta.env.VITE_GOOGLE_MAPS_KEY;

export const hasGoogleTiles = () => !!KEY;

/** Google's attribution. Required whenever their tiles are displayed. */
export const GOOGLE_ATTR = `Imagery &copy;${new Date().getFullYear()} Google`;

interface Session { session: string; expiry: number }

const CACHE_KEY = 'googleTileSession';

/**
 * Session tokens are reusable for about two weeks, so they are cached rather
 * than minted per map mount — every createSession call is a billable request.
 */
function readCache(): Session | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Session;
    // Expire an hour early so a token can't lapse mid-session.
    return s.expiry * 1000 > Date.now() + 3600_000 ? s : null;
  } catch {
    return null;
  }
}

let inFlight: Promise<string | null> | null = null;

/**
 * A usable session token, or null if tiles aren't available (no key, API not
 * enabled, quota, offline). Null is not an error state — the caller falls back
 * to Esri, which is stale but never absent.
 */
export async function getGoogleSession(): Promise<string | null> {
  if (!KEY) return null;

  const cached = readCache();
  if (cached) return cached.session;

  // One request even if several maps mount at once.
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const res = await fetch(`https://tile.googleapis.com/v1/createSession?key=${KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mapType: 'satellite',
          language: 'he-IL',
          region: 'IL',
        }),
      });
      if (!res.ok) {
        console.warn(
          `[googleTiles] createSession failed (${res.status}) — falling back to Esri imagery. ` +
          'Check that the Map Tiles API is enabled and the key allows this origin.',
        );
        return null;
      }
      const data = (await res.json()) as { session: string; expiry: string };
      const s: Session = { session: data.session, expiry: Number(data.expiry) };
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(s)); } catch { /* private mode */ }
      return s.session;
    } catch (e) {
      console.warn('[googleTiles] createSession threw — falling back to Esri imagery.', e);
      return null;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

export const googleTileUrl = (session: string) =>
  `https://tile.googleapis.com/v1/2dtiles/{z}/{x}/{y}?session=${session}&key=${KEY}`;
