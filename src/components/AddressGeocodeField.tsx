import { useState } from 'react';
import { MapPin, Loader2 } from 'lucide-react';
import { geocodeAddress, type GeocodeResult } from '../utils/geocode';

interface Props {
  /** Current address text. */
  value: string;
  onChange: (address: string) => void;
  /** Called when the user accepts a looked-up location. */
  onPick: (r: GeocodeResult) => void;
  /** Appended to the query so a street name resolves in the right town. */
  cityName?: string;
  /** City centre, used to prefer nearby results (see utils/geocode.ts). */
  cityLat?: number;
  cityLon?: number;
  inputClassName?: string;
  disabled?: boolean;
}

/**
 * Address input with an "אתר" button that resolves the typed address to
 * coordinates, so the user doesn't have to hunt for the spot on a map.
 *
 * The lookup only ever runs on an explicit button press — Nominatim's usage
 * policy forbids automated/per-keystroke querying (see utils/geocode.ts).
 */
export default function AddressGeocodeField({
  value, onChange, onPick, cityName, cityLat, cityLon, inputClassName = '', disabled,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<GeocodeResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (!value.trim() || busy) return;
    setBusy(true);
    setError(null);
    setResults(null);
    try {
      const hits = await geocodeAddress(value, { cityName, latitude: cityLat, longitude: cityLon });
      if (hits.length === 0) {
        setError('לא נמצאה כתובת תואמת. נסה לנסח אחרת או לבחור מהמפה.');
      } else if (hits.length === 1) {
        onPick(hits[0]);
        setResults(hits); // keep it visible so the user can confirm the match
      } else {
        setResults(hits);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'שגיאה באיתור הכתובת');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="flex gap-1.5">
        <input
          value={value}
          onChange={e => { onChange(e.target.value); setResults(null); setError(null); }}
          // Enter would otherwise submit/close the surrounding modal form.
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); run(); } }}
          className={`${inputClassName} flex-1`}
          disabled={disabled}
        />
        <button
          type="button"
          onClick={run}
          disabled={disabled || busy || !value.trim()}
          title="אתר את הכתובת על המפה"
          className="flex items-center gap-1.5 px-3 py-2 border border-slate-200 rounded-lg text-sm text-blue-600 hover:bg-blue-50 disabled:opacity-40 disabled:hover:bg-transparent whitespace-nowrap"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <MapPin size={14} />}
          {busy ? 'מאתר...' : 'אתר'}
        </button>
      </div>

      {error && <p className="mt-1 text-xs text-amber-600">{error}</p>}

      {results && results.length === 1 && (
        <p className="mt-1 text-xs text-emerald-600">
          נמצא: {results[0].label}
        </p>
      )}

      {results && results.length > 1 && (
        <div className="mt-1.5 border border-slate-200 rounded-lg overflow-hidden">
          <p className="px-3 py-1.5 text-xs text-slate-500 bg-slate-50">נמצאו כמה תוצאות — בחר את הנכונה:</p>
          {results.map((r, i) => (
            <button
              key={i}
              type="button"
              onClick={() => { onPick(r); setResults([r]); }}
              className="w-full text-right px-3 py-2 text-xs text-slate-700 hover:bg-blue-50 border-t border-slate-100"
            >
              {r.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
