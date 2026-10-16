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
  /** Set when a preset is hand-edited (presetKey becomes 'custom'): the preset it started from. */
  basedOn?: string;
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
  // The Or HaChaim calendar's own definition (calendar.2net.co.il/About.aspx):
  // 6 zmaniyot minutes after alot. Until this was added the app used a third of
  // the way from alot to netz, ~23 minutes after it in October.
  misheyakir:    { method: 'afterAlotProportional', value: 6 },
  // The Magen Avraham's day, for shma and tefila, is kept symmetric as the
  // calendar prints it: 72 zmaniyot minutes before sunrise to 72 after sunset
  // (Rabbeinu Tam's tzeit). The app used to end it at 13.5, ~15 minutes earlier.
  mgaDay:        { alot: { method: 'proportional', value: 72 }, tzet: { method: 'proportional', value: 72 } },
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

/**
 * Settings saved before a preset gained a definition lack it, and would keep the
 * old behaviour forever. Fills in Or HaChaim's misheyakir and MGA day for a
 * settings object that is that preset and never set its own.
 */
export function withPresetDefaults(s: ZmanimSettings): ZmanimSettings {
  if (s.presetKey !== 'maran') return s;
  return {
    ...s,
    ...(s.misheyakir ? {} : { misheyakir: PRESET_RAV_OVADIA.misheyakir }),
    ...(s.mgaDay ? {} : { mgaDay: PRESET_RAV_OVADIA.mgaDay }),
  };
}

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
  plagHamincha:     number; // GRA: netz + 10.75 sha'ot GRA
  plagHaminchaMga:  number; // MGA (Rav Ovadia, Ben Ish Chai): alot + 10.75 sha'ot MGA (over the method's mgaDay)
  plagHaminchaBeforeTzet: number; // Or HaChaim calendar: 1.25 GRA sha'ot before the method's tzet hakochavim
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

/**
 * "HH:MM" (or "HH:MM:SS") for a time in minutes since midnight.
 *
 * Whole minutes round UP by default, as the printed calendars (2net) do: 05:34:17
 * reads 05:35. A zman that must not be late — candle lighting — passes 'down'.
 */
export function minToStr(minutes: number, withSec = false, round: 'up' | 'down' = 'up'): string {
  if (minutes < 0) return withSec ? '--:--:--' : '--:--';
  const totalSec = Math.round(minutes * 60);
  if (withSec) {
    const h   = Math.floor(totalSec / 3600) % 24;
    const m   = Math.floor((totalSec % 3600) / 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(totalSec % 60).padStart(2, '0')}`;
  }
  const totalMin = round === 'up' ? Math.ceil(totalSec / 60) : Math.floor(totalSec / 60);
  return `${String(Math.floor(totalMin / 60) % 24).padStart(2, '0')}:${String(totalMin % 60).padStart(2, '0')}`;
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
      chatzot: -1, minchaGedola: -1, minchaKetana: -1, plagHamincha: -1, plagHaminchaMga: -1, plagHaminchaBeforeTzet: -1,
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
    plagHaminchaMga:  alotProp72 ? m(offset(alotProp72, 10.75 * shaahMgaMs)) : -1,
    plagHaminchaBeforeTzet: tzet ? m(offset(tzet, -1.25 * shaahGraMs)) : -1,
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

// ─── Explaining a method to the person choosing it ───────────────────────────

export interface PresetAbout {
  /** A plain-language paragraph: whose method this is and what is distinctive about it. */
  about:   string;
  source?: { label: string; url?: string };
}

const TWO_NET = { label: 'לוח 2net — עמוד About', url: 'https://calendar.2net.co.il/About.aspx' };

export const PRESET_ABOUT: Record<string, PresetAbout> = {
  maran: {
    about: 'הלוח שנערך לפי פסקי מרן הרב עובדיה יוסף זצ"ל ("אור החיים"). עלות השחר וצאת הכוכבים נמדדים בדקות זמניות, כלומר לפי אורך היום: בקיץ העלות מוקדמת יותר והצאת מאוחרת יותר מאשר בחורף. השעות הזמניות נמנות מהנץ עד השקיעה (שיטת הגר"א), והנץ והשקיעה נמדדים בגובה פני הים. יום המג"א נשמר סימטרי, 72 דקות זמניות לפני הנץ ו-72 אחרי השקיעה (כרבנו תם). פלג המנחה: שעה ורבע זמנית לפני צאת הכוכבים.',
    source: TWO_NET,
  },
  gra: {
    about: 'שיטת הגאון מוילנה: היום ההלכתי מהנץ החמה עד השקיעה, ועלות השחר וצאת הכוכבים נמדדים בדקות קבועות (72 ו-13.5) שאינן משתנות בין עונות השנה.',
  },
  mga: {
    about: 'שיטת המגן אברהם: היום ההלכתי מתחיל בעלות השחר ומסתיים בצאת הכוכבים, ולכן סוף זמן קריאת שמע ותפילה מוקדם יותר מאשר לפי הגר"א. העלות 72 דקות קבועות לפני הנץ והצאת 45 דקות קבועות אחרי השקיעה.',
  },
  rabbenu_tam: {
    about: 'שיטת רבנו תם לצאת הכוכבים: 72 דקות זמניות אחרי השקיעה. נהוג להשתמש בה בעיקר לסיום שבת ולחומרות, ולא כזמן הצאת הרגיל.',
  },
  chazon_ish: {
    about: 'שיטת החזון איש: עלות השחר כשהשמש 16.1° מתחת לאופק, וצאת הכוכבים 40 דקות קבועות אחרי השקיעה.',
  },
  chazon_shamayim: {
    about: 'ברירות המחדל האשכנזיות של תוכנת "חזון שמים" כפי שהן מוגדרות באתר 2net. הזמנים נמדדים בעיקר במעלות מתחת לאופק ולא בדקות, כך שהם מתאימים לכל מקום ועונה: עלות 16.013°, צאת הכוכבים 4.9°, וצאת השבת 8.5° (שיטת החתם סופר). סוף זמן קריאת שמע לפי המג"א נמדד מ-19.75° בבוקר עד 19.75° בערב.',
    source: TWO_NET,
  },
  tzikuni: {
    about: 'ההצעה של הרב איתן צקוני ל"לוח אחיד" (שנה בשנה תשס"ג): שיטה ממוצעת לכל העולם, שבה העלות נמדדת ב"72 דקות במעלות" (כ-16°) כדי שתתאים לכל מקום ועונה. צאת הכוכבים 13.5 דקות נקבעת רק לחומרה, ובמוצאי שבת וחג נמדדת ב-8.5° (החתם סופר). משיכיר ב-11.5°.',
    source: { label: 'הרב איתן צקוני — זמני היום (דעת)', url: 'https://www.daat.ac.il/daat/kitveyet/shana/tsikoni-1.htm' },
  },
  melamed: {
    about: 'עקרונות החישוב באתר ישיבה, לפי הכרעת הרב זלמן ברוך מלמד. עלות השחר 72 דקות קבועות, כי זמן הילוך מיל אינו משתנה בין קיץ לחורף. צאת הכוכבים 18 דקות: בקיץ זמניות ובחורף קבועות, כך שלעולם אינה פחות מ-18 דקות אחרי השקיעה. מנחה גדולה 30 דקות, בקיץ זמניות ובחורף קבועות. השקיעה אסטרונומית, כי הסתרת הרים יכולה להזיז אותה בשעה שלמה.',
    source: { label: 'עקרונות זמני היום — אתר ישיבה', url: 'https://www.yeshiva.org.il/calendar/timeprinciples' },
  },
};

function ruleText(method: RuleMethod, value: number): string {
  switch (method) {
    case 'degrees':      return `${value}° מתחת לאופק`;
    case 'proportional': return `${value} דק' זמניות`;
    case 'longer':       return `${value} דק' — זמניות בקיץ, קבועות בחורף`;
    default:             return `${value} דק' קבועות`;
  }
}

/**
 * Every definition in a settings object, spelled out as label/text pairs — what a
 * method *is*, generated from the numbers calcZmanim actually runs on so the
 * explanation cannot drift from the times.
 */
export function describeSettings(s: ZmanimSettings): { label: string; text: string }[] {
  const mish = s.misheyakir;
  const mishText = !mish || mish.method === 'third' ? 'שליש מהדרך בין עלות השחר להנץ'
    : mish.method === 'degrees' ? `${mish.value}° מתחת לאופק`
    : mish.method === 'fixed' ? `${mish.value} דק' קבועות לפני הנץ`
    : `${mish.value} דק' זמניות אחרי עלות השחר`;
  const mga = s.mgaDay
    ? `מעלות ${ruleText(s.mgaDay.alot.method, s.mgaDay.alot.value)} עד צאת ${ruleText(s.mgaDay.tzet.method, s.mgaDay.tzet.value)}`
    : "מעלות 72 דק' זמניות עד צאת 13.5 דק' זמניות";
  const mg = s.minchaGedola ?? { method: 'proportional' as RuleMethod, value: 30 };
  const rt = s.rabbenuTam ?? { method: 'proportional' as RuleMethod, value: 72 };
  return [
    { label: 'עלות השחר',        text: `${ruleText(s.alotMethod, s.alotValue)}${s.alotMethod === 'degrees' ? '' : ' לפני הנץ'}` },
    { label: 'זמן טלית ותפילין', text: mishText },
    { label: 'הנץ והשקיעה',      text: 'אסטרונומיים, בגובה פני הים' },
    { label: 'שעה זמנית (גר"א)', text: 'מהנץ עד השקיעה, חלקי 12' },
    { label: 'שעה זמנית (מג"א)', text: mga },
    { label: 'מנחה גדולה',       text: `חצות + ${ruleText(mg.method, mg.value)}` },
    { label: 'פלג המנחה (גר"א)', text: '10.75 שעות זמניות מהנץ (שעה ורבע זמנית לפני השקיעה)' },
    { label: 'פלג המנחה (מג"א)', text: '10.75 שעות זמניות של המג"א, מעלות השחר עד צאת הכוכבים של יום המג"א (שיטת הרב עובדיה והבן איש חי)' },
    { label: 'פלג המנחה (אור החיים)', text: 'שעה ורבע זמנית של הגר"א (הנץ–שקיעה) לפני צאת הכוכבים, כפי שהוגדר בשיטה' },
    { label: 'צאת הכוכבים',      text: `${ruleText(s.tzetMethod, s.tzetMinutes)}${s.tzetMethod === 'degrees' ? '' : ' אחרי השקיעה'}` },
    { label: 'צאת השבת',         text: s.shabbatExit ? `${ruleText(s.shabbatExit.method, s.shabbatExit.value)}${s.shabbatExit.method === 'degrees' ? '' : ' אחרי השקיעה'}` : 'כמו צאת הכוכבים' },
    { label: 'רבנו תם',          text: `${ruleText(rt.method, rt.value)}${rt.method === 'degrees' ? '' : ' אחרי השקיעה'}` },
    { label: 'הדלקת נרות',       text: `${s.candleLightingMin ?? 20} דק' לפני השקיעה (לנוהגים להקדים: ${s.candleLightingAltMin ?? 40})` },
  ];
}

// ─── Which zmanim a method has, and which residents are shown ────────────────

export interface CatalogZman {
  /** The ZmanimResult field it reads. */
  key:     keyof ZmanimResult;
  label:   string;
  group:   'morning' | 'shma' | 'day' | 'night' | 'shabbat';
}

/** Every time the app can compute, in the order it shows them. */
export const ZMANIM_CATALOG: CatalogZman[] = [
  { key: 'alot',              label: 'עלות השחר',               group: 'morning' },
  { key: 'misheyakir',        label: 'זמן טלית ותפילין',        group: 'morning' },
  { key: 'netz',              label: 'הנץ החמה',                group: 'morning' },
  { key: 'sofZmanShmaMga',    label: 'סוף זמן ק"ש (מג"א)',      group: 'shma' },
  { key: 'sofZmanShma',       label: 'סוף זמן ק"ש (גר"א)',      group: 'shma' },
  { key: 'sofZmanTfilaMga',   label: 'סוף זמן תפילה (מג"א)',    group: 'shma' },
  { key: 'sofZmanTfila',      label: 'סוף זמן תפילה (גר"א)',    group: 'shma' },
  { key: 'chatzot',           label: 'חצות',                    group: 'day' },
  { key: 'minchaGedola',      label: 'מנחה גדולה',              group: 'day' },
  { key: 'minchaKetana',      label: 'מנחה קטנה',               group: 'day' },
  { key: 'plagHamincha',      label: 'פלג המנחה (גר"א)',        group: 'day' },
  { key: 'plagHaminchaMga',   label: 'פלג המנחה (מג"א)',        group: 'day' },
  { key: 'plagHaminchaBeforeTzet', label: 'פלג המנחה (אור החיים)', group: 'day' },
  { key: 'shkia',             label: 'שקיעה',                   group: 'day' },
  { key: 'tzetHakochavim',    label: 'צאת הכוכבים',             group: 'night' },
  { key: 'tzetHakochavim18',  label: "צאת הכוכבים — 18 דק' זמניות", group: 'night' },
  { key: 'tzetRabbenuTam',    label: 'רבנו תם',                 group: 'night' },
  { key: 'candleLighting',    label: 'הדלקת נרות',              group: 'shabbat' },
  { key: 'tzetShabbat',       label: 'צאת השבת',                group: 'shabbat' },
];

export const ZMANIM_GROUP_LABEL: Record<CatalogZman['group'], string> = {
  morning: 'בוקר', shma: 'קריאת שמע ותפילה', day: 'יום', night: 'לילה', shabbat: 'שבת',
};

// A method only has the times it defines: a GRA calendar has no MGA shma and
// no "plag before tzeit", the Or HaChaim calendar's plag is its own. Each list
// is the times that method's own authority publishes.
type Zkey = CatalogZman['key'];
const GRA_DAY: Zkey[] = [
  'alot', 'misheyakir', 'netz', 'sofZmanShma', 'sofZmanTfila', 'chatzot', 'minchaGedola', 'minchaKetana',
  'plagHamincha', 'shkia', 'tzetHakochavim', 'tzetRabbenuTam', 'candleLighting', 'tzetShabbat',
];
const MGA_DAY: Zkey[] = [
  'alot', 'misheyakir', 'netz', 'sofZmanShmaMga', 'sofZmanTfilaMga', 'chatzot', 'minchaGedola', 'minchaKetana',
  'plagHaminchaMga', 'shkia', 'tzetHakochavim', 'tzetRabbenuTam', 'candleLighting', 'tzetShabbat',
];
// Calendars that publish both the GRA's and the MGA's shma/tefila, with the GRA's plag.
const BOTH: Zkey[] = [
  'alot', 'misheyakir', 'netz', 'sofZmanShmaMga', 'sofZmanShma', 'sofZmanTfilaMga', 'sofZmanTfila', 'chatzot',
  'minchaGedola', 'minchaKetana', 'plagHamincha', 'shkia', 'tzetHakochavim', 'tzetRabbenuTam', 'candleLighting', 'tzetShabbat',
];
// Or HaChaim: both, its own plag (1.25 GRA hours before tzeit), and the 18-minute tzeit its calendar also prints.
const OR_HACHAIM: Zkey[] = BOTH.flatMap((k) => (k === 'plagHamincha'
  ? ['plagHaminchaBeforeTzet' as Zkey]
  : k === 'tzetHakochavim' ? ['tzetHakochavim' as Zkey, 'tzetHakochavim18' as Zkey] : [k]));

const PRESET_ZMANIM: Record<string, Zkey[]> = {
  maran: OR_HACHAIM, gra: GRA_DAY, mga: MGA_DAY, rabbenu_tam: GRA_DAY, chazon_ish: GRA_DAY,
  chazon_shamayim: BOTH, tzikuni: BOTH, melamed: BOTH,
};

/** The preset a settings object is (or, once hand-edited, was started from); undefined if unknown. */
export function methodKey(s: ZmanimSettings): string | undefined {
  return s.presetKey === 'custom' ? s.basedOn : s.presetKey;
}

/** The times this method has. A hand-built method with no known origin has them all. */
export function relevantKeys(s: ZmanimSettings): Set<string> {
  const k = methodKey(s);
  return new Set((k && PRESET_ZMANIM[k]) || ZMANIM_CATALOG.map((z) => z.key));
}

/** The ticked set for a city: its saved list, else everything its method has. */
export function shownZmanim(saved: string[] | null | undefined, s: ZmanimSettings): Set<string> {
  return saved && saved.length ? new Set(saved) : relevantKeys(s);
}

/**
 * What a resident's zmanim screen lists: the times their method has, narrowed
 * to the city's ticked list — but only while they are on the city's own method,
 * since that list was ticked against it.
 */
export function visibleZmanim(
  s: ZmanimSettings,
  city?: { zmanimSettings?: ZmanimSettings | null; zmanimShown?: string[] | null } | null,
): CatalogZman[] {
  const rel = relevantKeys(s);
  const saved = city?.zmanimShown;
  const cityMethod = methodKey(city?.zmanimSettings ?? PRESET_RAV_OVADIA);
  const useSaved = !!saved?.length && methodKey(s) === cityMethod;
  return ZMANIM_CATALOG.filter((z) => rel.has(z.key) && (!useSaved || saved!.includes(z.key)));
}
