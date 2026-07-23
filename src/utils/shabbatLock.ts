/**
 * Determines whether the admin console should be "closed" right now because
 * it is Shabbat or Yom Tov, from the *admin's own computer clock* — not any
 * city's data. There's no real location for an admin's machine, so sunset/
 * tzeit timing uses a fixed Jerusalem reference point; the browser's own
 * detected timezone is used for "what time is it right now." Whether today
 * is Shabbat/Yom Tov itself (JewishCalendar.isAssurBemelacha()) only depends
 * on the date, not on location at all.
 *
 * Ported from kehila-app/src/utils/shabbatLock.ts's window logic — same
 * shkia→tzeit lock window, same multi-day Yom Tov handling.
 */

import { GeoLocation, ComplexZmanimCalendar, AstronomicalCalendar, JewishCalendar } from 'kosher-zmanim';
import type { DateTime } from 'luxon';

// No real coordinates for "the admin's computer" — Jerusalem is a reasonable
// fixed reference for sunset/tzeit timing (differences across Israel are
// only a few minutes either way).
const JERUSALEM = { lat: 31.7683, lon: 35.2137 };

export interface ConsoleLockState {
  locked: boolean;
  kind?: 'shabbat' | 'yomtov';
  title?: string;
  reopenAt?: string; // "HH:MM"
}

function jcal(date: Date): JewishCalendar {
  const c = new JewishCalendar(date);
  c.setInIsrael(true);
  return c;
}

function isAssur(date: Date): boolean {
  try {
    return jcal(date).isAssurBemelacha();
  } catch {
    return false;
  }
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(d.getDate() + n);
  return x;
}

function toMin(dt: DateTime | null, tzId: string): number {
  if (!dt) return -1;
  const local = dt.setZone(tzId, { keepLocalTime: false });
  return local.hour * 60 + local.minute + local.second / 60;
}

function minToStr(minutes: number): string {
  if (minutes < 0) return '--:--';
  const total = Math.round(minutes);
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Sunset + tzeit (13.5 min proportional — same default as the mobile app's Rav Ovadia preset). */
function shkiaAndTzeit(date: Date, tzId: string): { shkia: number; tzeit: number } {
  const geo = new GeoLocation('', JERUSALEM.lat, JERUSALEM.lon, 0, tzId);
  const cal = new ComplexZmanimCalendar(geo);
  cal.setDate(date);
  cal.setUseElevation(false);

  const shkiaDt = cal.getSunset();
  if (!shkiaDt) return { shkia: -1, tzeit: -1 };

  const shaahGraMs = cal.getShaahZmanisGra() ?? 0;
  const tzeitDt = AstronomicalCalendar.getTimeOffset(shkiaDt, (13.5 / 60) * shaahGraMs);

  return { shkia: toMin(shkiaDt, tzId), tzeit: toMin(tzeitDt, tzId) };
}

/** now's minutes-from-midnight in the given IANA timezone. */
function nowMinutesInTz(now: Date, tz: string): number {
  try {
    const p = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(now);
    const h = Number(p.find((x) => x.type === 'hour')?.value ?? '0');
    const m = Number(p.find((x) => x.type === 'minute')?.value ?? '0');
    return (h % 24) * 60 + m;
  } catch {
    return now.getHours() * 60 + now.getMinutes();
  }
}

export function getConsoleLock(now: Date = new Date()): ConsoleLockState {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Jerusalem';
  const { shkia: lockStart, tzeit } = shkiaAndTzeit(now, tz);
  if (lockStart < 0 || tzeit < 0) return { locked: false };

  const nowMin = nowMinutesInTz(now, tz);

  const todayAssur    = isAssur(now);
  const tomorrow      = addDays(now, 1);
  const tomorrowAssur = isAssur(tomorrow);

  let locked = false;
  let activeDate: Date | null = null;

  if (nowMin < lockStart) {
    if (todayAssur && nowMin < tzeit) { locked = true; activeDate = now; }
  } else if (nowMin < tzeit) {
    if (todayAssur)         { locked = true; activeDate = now; }
    else if (tomorrowAssur) { locked = true; activeDate = tomorrow; }
  } else {
    if (tomorrowAssur)      { locked = true; activeDate = tomorrow; }
  }

  if (!locked || !activeDate) return { locked: false };

  // Reopen at tzeit of the LAST consecutive assur day (2-day Yom Tov, Yom Tov
  // adjacent to Shabbat, etc.)
  let last = activeDate;
  while (isAssur(addDays(last, 1))) last = addDays(last, 1);
  const { tzeit: lastTzeit } = shkiaAndTzeit(last, tz);
  const reopenAt = minToStr(lastTzeit);

  const isShabbatDay = activeDate.getDay() === 6; // JS: Saturday = 6
  if (isShabbatDay) return { locked: true, kind: 'shabbat', title: 'שבת שלום', reopenAt };
  return { locked: true, kind: 'yomtov', title: 'חג שמח', reopenAt };
}
