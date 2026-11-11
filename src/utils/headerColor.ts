// Home-screen header colour rules. The app implements the same algorithm; keep both in sync.

export const DEFAULT_HEADER_TOP = '#1B4E8A';
export const DEFAULT_HEADER_BOTTOM = '#2E6DB4';
export const MIN_LOGO_SCALE = 0.6;
export const MAX_LOGO_SCALE = 1.3;
export const LOGO_SCALE_STEP = 0.05;
export const MIN_CONTRAST_WITH_WHITE = 4.5;

const HEX6 = /^#[0-9a-fA-F]{6}$/;

export function isHex6(v: string): boolean { return HEX6.test(v); }

function channels(hex: string): [number, number, number] {
  return [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

/** WCAG 2.x relative luminance of a #RRGGBB colour. */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = channels(hex).map(v => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Contrast ratio of white text on the given colour. */
export function contrastWithWhite(hex: string): number {
  return 1.05 / (relativeLuminance(hex) + 0.05);
}

/** Hebrew error, or null when the colour may be used as a header background. */
export function validateHeaderColor(hex: string): string | null {
  if (!isHex6(hex)) return 'יש להזין צבע בפורמט #RRGGBB (שש ספרות הקסדצימליות).';
  if (contrastWithWhite(hex) < MIN_CONTRAST_WITH_WHITE) {
    return 'הצבע בהיר מדי — הטקסט הלבן בכותרת לא יהיה קריא. בחרו צבע כהה יותר.';
  }
  return null;
}

/** Top gradient colour: each channel x0.75, rounded. */
export function headerTopColor(bottom: string): string {
  return '#' + channels(bottom)
    .map(v => Math.round(v * 0.75).toString(16).padStart(2, '0'))
    .join('').toUpperCase();
}

export const HEADER_PRESETS: { label: string; color: string }[] = [
  { label: 'כחול (ברירת מחדל)', color: '#2E6DB4' },
  { label: 'כחול כהה', color: '#1B3A6B' },
  { label: 'טורקיז', color: '#0F766E' },
  { label: 'ירוק', color: '#1F7A4D' },
  { label: 'בורדו', color: '#8B2252' },
  { label: 'סגול', color: '#5B3A93' },
  { label: 'חום', color: '#7A4B2A' },
  { label: 'פחם', color: '#374151' },
].filter(p => contrastWithWhite(p.color) >= MIN_CONTRAST_WITH_WHITE);
