import { GeoLocation, ComplexZmanimCalendar, AstronomicalCalendar } from 'kosher-zmanim';
import type { DateTime } from 'luxon';

export type AlotMethod    = 'proportional' | 'fixed' | 'degrees';
export type PrimaryMethod = 'gra' | 'mga';
export type TzetMethod    = RuleMethod;

/**
 * How a time is measured from sunrise or sunset:
 *  - 'fixed'        `value` clock minutes.
 *  - 'proportional' `value` sha'ot-zmaniyot minutes (1/60 of a GRA hour), so longer in summer.
 *  - 'degrees'      the sun is `value` degrees below the horizon.
 *  - 'longer'       the longer of `value` fixed and `value` proportional minutes —
 *                   "זמניות בקיץ, קבועות בחורף".
 */
export type RuleMethod = 'fixed' | 'proportional' | 'degrees' | 'longer';

export interface ZmanimRule {
  method: RuleMethod;
  value:  number;
}

export type MisheyakirMethod = 'third' | 'degrees' | 'fixed' | 'afterAlotProportional';

export interface ZmanimSettings {
  primaryMethod: PrimaryMethod;
  alotMethod:    AlotMethod;
  alotValue:     number;
  tzetMinutes:   number;
  tzetMethod:    TzetMethod;
  presetKey?:    string;
  /** Days before a fast to show the fast-day card on the home screen. Default 1. */
  taanisLookAheadDays?: number;

  // ── Optional refinements. Absent on every settings object saved before they
  //    existed, and each one's absence means exactly the behaviour those
  //    objects always had — so nothing here changes an existing user's times.

  /** Tallit and tefillin. Absent = a third of the way from alot to netz. 'fixed'
   *  is minutes before netz, 'afterAlotProportional' zmaniyot minutes after alot. */
  misheyakir?: { method: MisheyakirMethod; value: number };
  /** Mincha gedola, measured after chatzot. Absent = 30 zmaniyot minutes. */
  minchaGedola?: ZmanimRule;
  /** The day the Magen Avraham counts hours over. Absent = alot 72 zmaniyot to
   *  tzet 13.5 zmaniyot. */
  mgaDay?: { alot: ZmanimRule; tzet: ZmanimRule };
  /** Minutes before sunset the Shabbat candles are lit. Absent = 20. */
  candleLightingMin?: number;
  /** The second, stricter minhag shown beside it (Jerusalem's 40). Absent = 40. */
  candleLightingAltMin?: number;
  /** Motzei Shabbat. Absent = the same rule as tzet hakochavim. */
  shabbatExit?: ZmanimRule;
  /** Rabbeinu Tam. Absent = 72 zmaniyot minutes after sunset. */
  rabbenuTam?: ZmanimRule;
}

export interface ZmanimPreset {
  key:         string;
  label:       string;
  posek:       string;
  description: string;
  settings:    ZmanimSettings;
}

export const PRESET_RAV_OVADIA: ZmanimSettings = {
  primaryMethod: 'gra',
  alotMethod:    'proportional',
  alotValue:     72,
  tzetMinutes:   13.5,
  tzetMethod:    'proportional',
  presetKey:     'maran',
};

export const PRESET_GRA: ZmanimSettings = {
  primaryMethod: 'gra',
  alotMethod:    'fixed',
  alotValue:     72,
  tzetMinutes:   13.5,
  tzetMethod:    'fixed',
  presetKey:     'gra',
};

export const PRESET_MGA: ZmanimSettings = {
  primaryMethod: 'mga',
  alotMethod:    'fixed',
  alotValue:     72,
  tzetMinutes:   45,
  tzetMethod:    'fixed',
  presetKey:     'mga',
};

export const PRESET_RABBENU_TAM: ZmanimSettings = {
  primaryMethod: 'gra',
  alotMethod:    'proportional',
  alotValue:     72,
  tzetMinutes:   72,
  tzetMethod:    'proportional',
  presetKey:     'rabbenu_tam',
};

export const PRESET_CHAZON_ISH: ZmanimSettings = {
  primaryMethod: 'gra',
  alotMethod:    'degrees',
  alotValue:     16.1,
  tzetMinutes:   40,
  tzetMethod:    'fixed',
  presetKey:     'chazon_ish',
};

// The three presets below are built from each authority's own published
// definition: חזון שמים from calendar.2net.co.il/About.aspx, צקוני from his
// "הצעה ללוח אחיד" (שנה בשנה תשס"ג), מלמד from yeshiva.org.il/calendar/timeprinciples.
// Where a source gives a range or says "לחומרה", the value below is the one
// it names for the zman itself.
export const PRESET_CHAZON_SHAMAYIM: ZmanimSettings = {
  primaryMethod: 'gra',
  alotMethod:    'degrees',
  alotValue:     16.013,
  tzetMinutes:   4.9,
  tzetMethod:    'degrees',
  presetKey:     'chazon_shamayim',
  misheyakir:    { method: 'degrees', value: 11.5 },
  minchaGedola:  { method: 'fixed', value: 30 },
  mgaDay:        { alot: { method: 'degrees', value: 19.75 }, tzet: { method: 'degrees', value: 19.75 } },
  candleLightingMin: 30,
  candleLightingAltMin: 40,
  shabbatExit:   { method: 'degrees', value: 8.5 },
  rabbenuTam:    { method: 'fixed', value: 72 },
};

export const PRESET_TZIKUNI: ZmanimSettings = {
  primaryMethod: 'gra',
  alotMethod:    'degrees',
  alotValue:     16.1,
  tzetMinutes:   13.5,
  tzetMethod:    'fixed',
  presetKey:     'tzikuni',
  misheyakir:    { method: 'degrees', value: 11.5 },
  minchaGedola:  { method: 'fixed', value: 30 },
  mgaDay:        { alot: { method: 'degrees', value: 16.1 }, tzet: { method: 'degrees', value: 16.1 } },
  candleLightingMin: 30,
  candleLightingAltMin: 40,
  shabbatExit:   { method: 'degrees', value: 8.5 },
  rabbenuTam:    { method: 'fixed', value: 72 },
};

export const PRESET_MELAMED: ZmanimSettings = {
  primaryMethod: 'gra',
  alotMethod:    'fixed',
  alotValue:     72,
  tzetMinutes:   18,
  tzetMethod:    'longer',
  presetKey:     'melamed',
  misheyakir:    { method: 'fixed', value: 45 },
  minchaGedola:  { method: 'longer', value: 30 },
  mgaDay:        { alot: { method: 'fixed', value: 72 }, tzet: { method: 'fixed', value: 72 } },
  candleLightingMin: 30,
  candleLightingAltMin: 40,
  shabbatExit:   { method: 'degrees', value: 8.5 },
  rabbenuTam:    { method: 'fixed', value: 72 },
};

export const ZMANIM_PRESETS: ZmanimPreset[] = [
  {
    key:         'maran',
    label:       'אור החיים',
    posek:       'הרב עובדיה יוסף זצ"ל',
    description: 'עלות 72 ד׳ זמניות | צאת 13.5 ד׳ זמניות (~16 ד׳ בקיץ) | שיטת הגר"א',
    settings:    PRESET_RAV_OVADIA,
  },
  {
    key:         'gra',
    label:       'הגר"א',
    posek:       'הגאון מוילנה',
    description: 'עלות 72 ד׳ קבועות | צאת 13.5 ד׳ קבועות',
    settings:    PRESET_GRA,
  },
  {
    key:         'mga',
    label:       'מ"א',
    posek:       'מגן אברהם',
    description: 'שעה זמנית מעלות השחר | עלות 72 ד׳ קבועות | צאת 45 ד׳ קבועות',
    settings:    PRESET_MGA,
  },
  {
    key:         'rabbenu_tam',
    label:       'רבנו תם',
    posek:       'רבנו תם',
    description: 'עלות 72 ד׳ זמניות | צאת 72 ד׳ זמניות (~85 ד׳ בקיץ) | לצורך מוצ"ש',
    settings:    PRESET_RABBENU_TAM,
  },
  {
    key:         'chazon_ish',
    label:       'חזון איש',
    posek:       'חזון איש',
    description: 'עלות 16.1° מתחת לאופק | צאת 40 ד׳ קבועות',
    settings:    PRESET_CHAZON_ISH,
  },
  {
    key:         'chazon_shamayim',
    label:       'חזון שמים',
    posek:       'לוח חזון שמים (הרב איתן צקוני)',
    description: 'עלות 16.013° | צאת 4.9° | מוצ"ש 8.5° | מנחה גדולה 30 ד׳ קבועות',
    settings:    PRESET_CHAZON_SHAMAYIM,
  },
  {
    key:         'tzikuni',
    label:       'הרב איתן צקוני',
    posek:       'הצעה ללוח אחיד',
    description: 'עלות ~16° | צאת 13.5 ד׳ קבועות | מוצ"ש 8.5° | משיכיר 11.5°',
    settings:    PRESET_TZIKUNI,
  },
  {
    key:         'melamed',
    label:       'הרב זלמן מלמד',
    posek:       'הרב זלמן ברוך מלמד',
    description: 'עלות 72 ד׳ קבועות | צאת 18 ד׳ (זמניות בקיץ) | מוצ"ש 8.5° | מנחה גדולה 30 ד׳',
    settings:    PRESET_MELAMED,
  },
];

export function presetByKey(key?: string | null): ZmanimPreset | undefined {
  return key ? ZMANIM_PRESETS.find((p) => p.key === key) : undefined;
}

export interface ZmanimResult {
  alot:             number;
  misheyakir:       number;
  netz:             number;
  netzVatikin:      number; // visible/topographic sunrise for ותיקין; -1 when mountainAngle = 0
  sofZmanShma:      number; // GRA: netz + 3 sha'ot GRA
  sofZmanShmaMga:   number; // MGA per Python formula: alot_prop72 + 3 sha'ot MGA
  sofZmanTfila:     number; // GRA: netz + 4 sha'ot GRA
  sofZmanTfilaMga:  number; // MGA per Python formula
  chatzot:          number;
  minchaGedola:     number;
  minchaKetana:     number;
  plagHamincha:     number;
  shkia:            number;
  tzetHakochavim:   number; // per settings.tzetMethod/tzetMinutes
  tzetHakochavim18: number; // always proportional 18 min GRA
  tzetRabbenuTam:   number; // always proportional 72 min GRA (Rabbenu Tam)
  shaahZmanitGra:   number; // minutes
  shaahZmanitMga:   number; // minutes, per Python formula
  candleLighting:    number; // settings.candleLightingMin before sunset
  candleLightingAlt: number; // settings.candleLightingAltMin before sunset
  tzetShabbat:       number; // motzei Shabbat: settings.shabbatExit, else tzetHakochavim
}

export function minToStr(minutes: number, withSec = false): string {
  if (minutes < 0) return withSec ? '--:--:--' : '--:--';
  const totalSec = Math.round(minutes * 60);
  const h   = Math.floor(totalSec / 3600) % 24;
  const m   = Math.floor((totalSec % 3600) / 60);
  const sec = totalSec % 60;
  const hm  = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  return withSec ? `${hm}:${String(sec).padStart(2, '0')}` : hm;
}

function toMin(dt: DateTime | null, tzId: string): number {
  if (!dt) return -1;
  const local = dt.setZone(tzId, { keepLocalTime: false });
  return local.hour * 60 + local.minute + local.second / 60;
}

function offset(dt: DateTime | null, ms: number): DateTime | null {
  return AstronomicalCalendar.getTimeOffset(dt, ms);
}

/**
 * A time `rule` away from sunrise (rise = true, going earlier) or sunset
 * (rise = false, going later). 'degrees' ignores `anchor`: it asks the sun
 * directly, so it follows the real length of twilight at this latitude.
 */
function applyRule(
  cal: ComplexZmanimCalendar,
  anchor: DateTime,
  rule: ZmanimRule,
  rise: boolean,
  shaahMs: number,
): DateTime | null {
  if (rule.method === 'degrees') {
    const zenith = AstronomicalCalendar.GEOMETRIC_ZENITH + rule.value;
    return rise ? cal.getSunriseOffsetByDegrees(zenith) : cal.getSunsetOffsetByDegrees(zenith);
  }
  const fixedMs = rule.value * 60_000;
  const propMs  = (rule.value / 60) * shaahMs;
  const ms = rule.method === 'fixed' ? fixedMs
           : rule.method === 'proportional' ? propMs
           : Math.max(fixedMs, propMs);
  return offset(anchor, rise ? -ms : ms);
}

export function calcZmanim(
  date:           Date,
  lat:            number,
  lon:            number,
  settings:       ZmanimSettings,
  tzId =          'Asia/Jerusalem',
  _elevationMeters = 0, // unused: kept so every caller's argument list still lines up
  mountainAngle =  0, // angular elevation of horizon in sunrise direction (degrees), for ותיקין
): ZmanimResult {
  // Always pass 0 for elevation — the library uses GeoLocation elevation even with
  // setUseElevation(false). Sea-level is correct per Rav Ovadia for all standard times.
  // ותיקין (visible netz) is computed separately via mountainAngle.
  const geo = new GeoLocation('', lat, lon, 0, tzId);
  const cal = new ComplexZmanimCalendar(geo);
  cal.setDate(date);
  cal.setUseElevation(false);

  const m = (dt: DateTime | null) => toMin(dt, tzId);

  const netz    = cal.getSunrise();
  const shkia   = cal.getSunset();
  const chatzot = cal.getSunTransit();
  if (!netz || !shkia || !chatzot) {
    return {
      alot: -1, misheyakir: -1, netz: -1, netzVatikin: -1,
      sofZmanShma: -1, sofZmanShmaMga: -1,
      sofZmanTfila: -1, sofZmanTfilaMga: -1,
      chatzot: -1, minchaGedola: -1, minchaKetana: -1, plagHamincha: -1,
      shkia: -1, tzetHakochavim: -1, tzetHakochavim18: -1, tzetRabbenuTam: -1,
      shaahZmanitGra: 60, shaahZmanitMga: 60,
      candleLighting: -1, candleLightingAlt: -1, tzetShabbat: -1,
    };
  }

  // ── Sha'ah zmanit GRA: (sunset − sunrise) / 12 ───────────────────────────
  const shaahGraMs = cal.getShaahZmanisGra() ?? ((shkia.toMillis() - netz.toMillis()) / 12);

  // ── The Magen Avraham's day, alot to tzeit ───────────────────────────────
  // Default (no settings.mgaDay) matches Python: alos = sunrise − 1.2 × sz_gra;
  // tzeit = sunset + (13.5/60) × sz_gra. A preset that defines its own day
  // (חזון שמים's 19.75°, מלמד's 72 fixed both sides) overrides it.
  const mgaAlotRule = settings.mgaDay?.alot ?? { method: 'proportional' as RuleMethod, value: 72 };
  const mgaTzetRule = settings.mgaDay?.tzet ?? { method: 'proportional' as RuleMethod, value: 13.5 };
  const alotProp72  = applyRule(cal, netz,  mgaAlotRule, true,  shaahGraMs);
  const tzeit13Prop = applyRule(cal, shkia, mgaTzetRule, false, shaahGraMs);

  // MGA sha'ah per Python formula: (tzeit − alot) / 12
  const shaahMgaMs = alotProp72 && tzeit13Prop
    ? (tzeit13Prop.toMillis() - alotProp72.toMillis()) / 12
    : (shkia.toMillis() - netz.toMillis() + (72 + 45) * 60_000) / 12;

  // ── Alot for display (per preset settings) ───────────────────────────────
  let alot: DateTime | null;
  if (settings.alotMethod === 'degrees') {
    alot = cal.getSunriseOffsetByDegrees(AstronomicalCalendar.GEOMETRIC_ZENITH + settings.alotValue);
  } else if (settings.alotMethod === 'proportional') {
    alot = offset(netz, -(settings.alotValue / 60) * shaahGraMs);
  } else {
    alot = offset(netz, -settings.alotValue * 60_000);
  }

  const mish = settings.misheyakir;
  let misheyakir: DateTime | null;
  if (!mish || mish.method === 'third') {
    misheyakir = alot ? offset(alot, (netz.toMillis() - alot.toMillis()) / 3) : null;
  } else if (mish.method === 'degrees') {
    misheyakir = cal.getSunriseOffsetByDegrees(AstronomicalCalendar.GEOMETRIC_ZENITH + mish.value);
  } else if (mish.method === 'fixed') {
    misheyakir = offset(netz, -mish.value * 60_000);
  } else {
    misheyakir = alot ? offset(alot, (mish.value / 60) * shaahGraMs) : null;
  }

  // ── ותיקין: visible sunrise — Python: get_time_min(90.833 − mountainAngle) ─
  // kosher-zmanim equivalent: getSunriseOffsetByDegrees(GEOMETRIC_ZENITH + 0.833 − mountainAngle)
  const netzVatikinDt = mountainAngle > 0
    ? cal.getSunriseOffsetByDegrees(AstronomicalCalendar.GEOMETRIC_ZENITH + 0.833 - mountainAngle)
    : null;

  // ── Tzeit per preset ─────────────────────────────────────────────────────
  const tzetRule: ZmanimRule = { method: settings.tzetMethod, value: settings.tzetMinutes };
  const tzet = applyRule(cal, shkia, tzetRule, false, shaahGraMs);

  // Tzeit 18 — always proportional
  const tzet18 = offset(shkia, (18 / 60) * shaahGraMs);
  // Tzeit Rabbenu Tam — always proportional 72 min
  const tzetRt = applyRule(cal, shkia, settings.rabbenuTam ?? { method: 'proportional', value: 72 }, false, shaahGraMs);
  const tzetShab = settings.shabbatExit ? applyRule(cal, shkia, settings.shabbatExit, false, shaahGraMs) : tzet;
  const mgDef = settings.minchaGedola ?? { method: 'proportional' as RuleMethod, value: 30 };
  const minchaGedola = applyRule(cal, chatzot, mgDef, false, shaahGraMs);
  const candleMs = (settings.candleLightingMin ?? 20) * 60_000;
  const candleAltMs = (settings.candleLightingAltMin ?? 40) * 60_000;

  return {
    alot:             m(alot),
    misheyakir:       m(misheyakir),
    netz:             m(netz),
    netzVatikin:      m(netzVatikinDt),
    // Shema/Tefila: GRA always from netz; MGA from proportional alot per Python formula
    sofZmanShma:      m(offset(netz,       3     * shaahGraMs)),
    sofZmanShmaMga:   alotProp72 ? m(offset(alotProp72, 3 * shaahMgaMs)) : -1,
    sofZmanTfila:     m(offset(netz,       4     * shaahGraMs)),
    sofZmanTfilaMga:  alotProp72 ? m(offset(alotProp72, 4 * shaahMgaMs)) : -1,
    chatzot:          m(chatzot),
    minchaGedola:     m(minchaGedola),
    minchaKetana:     m(offset(netz,     9.5   * shaahGraMs)),
    plagHamincha:     m(offset(netz,     10.75 * shaahGraMs)),
    shkia:            m(shkia),
    tzetHakochavim:   m(tzet),
    tzetHakochavim18: m(tzet18),
    tzetRabbenuTam:   m(tzetRt),
    shaahZmanitGra:   shaahGraMs / 60_000,
    shaahZmanitMga:   shaahMgaMs / 60_000,
    candleLighting:    m(offset(shkia, -candleMs)),
    candleLightingAlt: m(offset(shkia, -candleAltMs)),
    tzetShabbat:       m(tzetShab),
  };
}
