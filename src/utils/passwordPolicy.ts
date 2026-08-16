/**
 * Password rules for manager accounts.
 *
 * Mirrors `src/utils/passwordPolicy.ts` in kehila-app — the two repos share no
 * package, so this is a deliberate copy. Change one, change the other; a
 * congregant held to eight characters while a gabbai with edit rights over the
 * whole city gets six is backwards.
 *
 * Enforced in the browser only (Firebase Auth's own floor is 6 characters), so
 * treat it as a guard against weak choices, not against a determined attacker.
 *
 * ENGLISH ONLY (printable ASCII). It matters most here: this is the field an
 * admin dictates over the phone, and a Hebrew character in it can't survive the
 * trip to the new manager's phone keyboard.
 */

export const MIN_LENGTH = 8;
export const MAX_LENGTH = 64;

export interface PasswordRule {
  key: string;
  label: string;
  test: (pw: string) => boolean;
}

export const RULES: PasswordRule[] = [
  { key: 'length', label: `לפחות ${MIN_LENGTH} תווים`,        test: (pw) => pw.length >= MIN_LENGTH },
  { key: 'letter', label: 'אות באנגלית (a-z)',                  test: (pw) => /[A-Za-z]/.test(pw) },
  { key: 'digit',  label: 'ספרה אחת לפחות (0-9)',              test: (pw) => /\d/.test(pw) },
  // ASCII punctuation only, so it can't pass a character the english rule rejects.
  { key: 'symbol',  label: 'תו מיוחד אחד לפחות (!@#$…)',        test: (pw) => /[!-\/:-@[-`{-~]/.test(pw) },
  { key: 'english', label: 'אנגלית בלבד (ללא עברית ורווחים)',   test: (pw) => /^[!-~]+$/.test(pw) },
];

const BLOCKLIST = [
  'password1!', 'password123!', 'passw0rd!', 'qwerty123!', 'abcd1234!',
  'aaaaaaa1!', '1qaz2wsx!', 'admin123!', 'welcome1!', 'kehila123!',
];

export interface PasswordCheck {
  rules: { key: string; label: string; met: boolean }[];
  ok: boolean;
  score: number;
  error?: string;
}

export function checkPassword(
  pw: string,
  who: { name?: string; email?: string } = {},
): PasswordCheck {
  const rules = RULES.map((r) => ({ key: r.key, label: r.label, met: r.test(pw) }));
  const allMet = rules.every((r) => r.met);

  let error: string | undefined;
  const lower = pw.toLowerCase();

  if (pw.length > MAX_LENGTH) {
    error = `הסיסמה ארוכה מדי (עד ${MAX_LENGTH} תווים)`;
  } else if (BLOCKLIST.includes(lower)) {
    error = 'הסיסמה נפוצה מדי — יש לבחור צירוף אחר';
  } else if (/^(.)\1+$/.test(pw)) {
    error = 'הסיסמה מורכבת מתו אחד חוזר';
  } else {
    const parts = [
      ...(who.name ?? '').split(/\s+/),
      (who.email ?? '').split('@')[0],
    ].map((v) => v.trim().toLowerCase()).filter((v) => v.length >= 3);
    if (parts.some((v) => lower.includes(v))) {
      error = 'הסיסמה לא יכולה להכיל את השם או האימייל של המשתמש';
    }
  }

  const met = rules.filter((r) => r.met).length;
  let score = Math.round((met / rules.length) * 4);
  if (pw.length >= 12 && allMet) score = 4;
  if (error) score = Math.min(score, 1);

  return { rules, ok: allMet && !error, score: Math.max(0, Math.min(4, score)), error };
}

export const STRENGTH_LABELS = ['חלשה מאוד', 'חלשה', 'בינונית', 'טובה', 'חזקה'];

/** Suggestion for the "סיסמה זמנית" field — the manager passes it on and the user changes it. */
export function suggestPassword(): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';   // no I/O — misread when dictated by phone
  const lowerC = 'abcdefghijkmnpqrstuvwxyz';  // no l
  const digits = '23456789';                  // no 0/1
  const symbols = '!@#$%&*';
  // crypto, not Math.random — this is the opening password on an account that
  // can edit a whole city's data.
  const rand = (n: number) => crypto.getRandomValues(new Uint32Array(1))[0] % n;
  const pick = (set: string) => set[rand(set.length)];
  const chars = [pick(upper), pick(lowerC), pick(digits), pick(symbols)];
  const all = upper + lowerC + digits + symbols;
  while (chars.length < 12) chars.push(pick(all));
  // Fisher–Yates, so the guaranteed characters aren't always in the same slots.
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = rand(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}
