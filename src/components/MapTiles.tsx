import { useState, useEffect } from 'react';
import { TileLayer } from 'react-leaflet';
import { Layers } from 'lucide-react';
import { getGoogleSession, googleTileUrl, hasGoogleTiles, GOOGLE_ATTR } from '../utils/googleTiles';

/**
 * Tile layer with an OSM ⇄ satellite switch.
 *
 * Satellite matters more here than it looks. OpenStreetMap's street data for
 * the pilot city is incomplete — newer neighbourhoods (e.g. הר הלבונה) have no
 * mapped roads at all, so the vector map shows empty ground exactly where a
 * gabbai needs to drop a pin, and the address geocoder can't resolve them
 * either (see utils/geocode.ts). Imagery has no such gap: the buildings are
 * plainly visible, so placing the pin by eye is the reliable path, and the
 * coordinates it produces are what navigation actually uses.
 *
 * Two imagery sources, in preference order:
 *
 *   Google  — current, but needs VITE_GOOGLE_MAPS_KEY (see utils/googleTiles.ts)
 *   Esri    — free and keyless, but its capture over מעלה אדומים is 2024-07-27,
 *             which predates the neighbourhoods this feature exists for
 *
 * Google is used whenever a session can be obtained and Esri otherwise, so the
 * map degrades to stale-but-present rather than blank if the key is missing,
 * the API isn't enabled, or quota runs out.
 */

const OSM_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const OSM_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

const SAT_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const SAT_ATTR = 'Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics';

// No labels overlay on purpose. Stamen's free label tiles were retired (the old
// fastly endpoint now answers 503), and Esri's own Reference layers return blank
// tiles over מעלה אדומים — checked directly, 872-byte empty PNGs. Anything that
// could label these streets is exactly the data that is missing, so imagery goes
// out bare and the admin recognises the spot by the buildings, as in Waze.

interface Props {
  defaultSatellite?: boolean;
  /**
   * Whether to render the switch at all.
   *
   * Off for the country-wide city chooser: satellite buys nothing when you're
   * picking between towns, and that map has no free corner left — verified in
   * the browser, top-right lost the hit test to the search box, bottom-right
   * overlapped "הוסף עיר", and top-20 ran into the city chips.
   */
  showToggle?: boolean;
  /** Tailwind position utilities for the switch, if a host map needs it moved. */
  positionClass?: string;
}

export default function MapTiles({
  defaultSatellite = false, showToggle = true, positionClass = 'top-2.5 right-2.5',
}: Props) {
  const [sat, setSat] = useState(defaultSatellite);
  const [gSession, setGSession] = useState<string | null>(null);

  // Only once the user actually asks for imagery — createSession is a billable
  // request, and most visits to the street map never need it.
  useEffect(() => {
    if (!sat || gSession || !hasGoogleTiles()) return;
    let live = true;
    getGoogleSession().then(s => { if (live) setGSession(s); });
    return () => { live = false; };
  }, [sat, gSession]);

  return (
    <>
      {sat ? (
        gSession ? (
          // key= forces Leaflet to swap layers rather than reuse the Esri one
          // when the session resolves a moment after the toggle.
          <TileLayer key="google" url={googleTileUrl(gSession)} attribution={GOOGLE_ATTR} maxZoom={20} />
        ) : (
          <TileLayer key="esri" url={SAT_URL} attribution={SAT_ATTR} maxZoom={19} />
        )
      ) : (
        <TileLayer key="osm" url={OSM_URL} attribution={OSM_ATTR} />
      )}

      {/* z-[1200] clears Leaflet's marker pane (600) and its controls (1000). */}
      {showToggle && <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setSat(v => !v); }}
        title={sat ? 'עבור למפת רחובות' : 'עבור לתצלום לוויין'}
        className={`absolute ${positionClass} z-[1200] flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/95 shadow border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-white`}
      >
        <Layers size={13} />
        {sat ? 'רחובות' : 'לוויין'}
      </button>}
    </>
  );
}
