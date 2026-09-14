/**
 * Exercises the roles-editor logic against the app's real catalogue, without
 * React or Firestore. Run with:  npx tsx scripts/check-roles-logic.ts
 *
 * What it pins down is the part that meets the security rules: which roles an
 * actor may grant (the three branches of the users update rule), which roles a
 * held set already covers, and — the delicate one — that a domain manager's
 * save is split into writes the delegates() branch will accept: one child role
 * per write, that role's array and nothing else, no absent array materialised.
 */
import { readFileSync } from 'node:fs';
import { catalogueOf, draftFromUser, missingAssignments, roleUpdates, emptyDraft, type RoleEntry } from '../src/utils/roleLogic';
import type { AppUser } from '../src/types';

const roles = JSON.parse(readFileSync('../kehila-app/src/utils/roleCatalogue.json', 'utf8')) as RoleEntry[];
const cat = catalogueOf(roles);

let failures = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}`);
  if (!ok) { failures++; console.log('      got :', JSON.stringify(got)); console.log('      want:', JSON.stringify(want)); }
}
const keys = (es: RoleEntry[]) => es.map((e) => e.key);
const user = (over: Partial<AppUser>): AppUser =>
  ({ uid: 'u1', email: 'x@y', displayName: 'x', cityId: 'city-1', homeCityId: 'city-1', role: 'user', roles: ['user'], ...over });

// ── grantableBy: the three rule branches ─────────────────────────────────────
check('super_admin grants everything', keys(cat.grantableBy(['super_admin'])).length, roles.length);
check('city_admin grants every city role but authority',
  keys(cat.grantableBy(['city_admin'])),
  keys(roles.filter((r) => r.assignableBy === 'city_admin')));
check('synagogue_manager grants only gabbai', keys(cat.grantableBy(['synagogue_manager'])), ['gabbai']);
check('mikveh_manager grants only mikveh_attendant', keys(cat.grantableBy(['mikveh_manager'])), ['mikveh_attendant']);
check('kosher_manager grants only mashgiach', keys(cat.grantableBy(['kosher_manager'])), ['mashgiach']);
check('content_admin grants nothing (no authority over accounts)', keys(cat.grantableBy(['content_admin'])), []);
check('event_manager grants nothing', keys(cat.grantableBy(['event_manager'])), []);
check('gabbai grants nothing', keys(cat.grantableBy(['gabbai'])), []);
check('two domain roles grant both children',
  keys(cat.grantableBy(['synagogue_manager', 'mikveh_manager'])), ['mikveh_attendant', 'gabbai']);
check('city_admin + domain role = the city_admin set', keys(cat.grantableBy(['city_admin', 'mikveh_manager'])),
  keys(roles.filter((r) => r.assignableBy === 'city_admin')));

// ── subsumedBy: בכלל מאתיים מנה ──────────────────────────────────────────────
check('city_admin covers everything below it', [...cat.subsumedBy(['city_admin'])],
  keys(roles.slice(roles.findIndex((r) => r.key === 'city_admin') + 1)));
check('content_admin covers everything below it', [...cat.subsumedBy(['content_admin'])],
  keys(roles.slice(roles.findIndex((r) => r.key === 'content_admin') + 1)));
check('synagogue_manager covers gabbai only', [...cat.subsumedBy(['synagogue_manager'])], ['gabbai']);
check('mikveh_manager covers mikveh_attendant only', [...cat.subsumedBy(['mikveh_manager'])], ['mikveh_attendant']);
check('kosher_manager covers mashgiach only', [...cat.subsumedBy(['kosher_manager'])], ['mashgiach']);
check('event_manager covers nothing', [...cat.subsumedBy(['event_manager'])], []);
check('gabbai + mikveh_manager: attendant covered, gabbai not', [...cat.subsumedBy(['gabbai', 'mikveh_manager'])], ['mikveh_attendant']);

// ── missingAssignments ───────────────────────────────────────────────────────
check('gabbai with no shul is missing',
  keys(missingAssignments({ ...emptyDraft(), roles: ['gabbai'] }, cat, ['city_admin'])), ['gabbai']);
check('gabbai with a shul is fine',
  keys(missingAssignments({ ...emptyDraft(), roles: ['gabbai'], managedSynagogueIds: ['s1'] }, cat, ['city_admin'])), []);
check('gabbai under synagogue_manager needs no shul (covered)',
  keys(missingAssignments({ ...emptyDraft(), roles: ['synagogue_manager', 'gabbai'] }, cat, ['city_admin'])), []);
check('mashgiach + attendant both empty → both missing',
  keys(missingAssignments({ ...emptyDraft(), roles: ['mashgiach', 'mikveh_attendant'] }, cat, ['city_admin'])),
  ['mashgiach', 'mikveh_attendant']);
check('a delegator is only blocked on their own child',
  keys(missingAssignments({ ...emptyDraft(), roles: ['gabbai', 'mashgiach'] }, cat, ['kosher_manager'])), ['mashgiach']);
check('event_manager needs nothing', keys(missingAssignments({ ...emptyDraft(), roles: ['event_manager'] }, cat, ['city_admin'])), []);

// ── roleUpdates: what reaches Firestore ──────────────────────────────────────
// city_admin: one write, every field.
{
  const u = user({ roles: ['user'] });
  const d = { ...emptyDraft(), roles: ['gabbai', 'event_manager'], managedSynagogueIds: ['s1'] };
  const w = roleUpdates(u, d, cat, ['city_admin']);
  check('city_admin: single write', w.length, 1);
  check('city_admin: primary role is the higher of the two', w[0].role, 'event_manager');
  check('city_admin: writes all four arrays', Object.keys(w[0]).sort(),
    ['managedMikvehIds', 'managedRestaurantIds', 'managedSynagogueIds', 'role', 'roles', 'supervisedBusinessIds']);
}
// city_admin clearing every role → the 'user' placeholder.
{
  const u = user({ roles: ['gabbai'], role: 'gabbai', managedSynagogueIds: ['s1'] });
  const w = roleUpdates(u, emptyDraft(), cat, ['city_admin']);
  check('clearing all roles writes roles:["user"]', w[0].roles, ['user']);
  check('…and role:"user"', w[0].role, 'user');
}
// synagogue_manager appointing a gabbai: exactly what delegates() accepts.
{
  const u = user({ roles: ['user'] });
  const d = { ...emptyDraft(), roles: ['gabbai'], managedSynagogueIds: ['s1', 's2'] };
  const w = roleUpdates(u, d, cat, ['synagogue_manager']);
  check('delegator: single write for one child', w.length, 1);
  check('delegator: keys ⊆ {role, roles, managedSynagogueIds}', Object.keys(w[0]).sort(), ['managedSynagogueIds', 'role', 'roles']);
  check('delegator: roles = [gabbai]', w[0].roles, ['gabbai']);
  check('delegator: role = gabbai', w[0].role, 'gabbai');
}
// synagogue_manager on an account that is ALSO an event_manager: the other role rides along unchanged.
{
  const u = user({ roles: ['event_manager'], role: 'event_manager' });
  const d = { ...emptyDraft(), roles: ['event_manager', 'gabbai'], managedSynagogueIds: ['s1'] };
  const w = roleUpdates(u, d, cat, ['synagogue_manager']);
  check('delegator: roles minus gabbai unchanged', (w[0].roles as string[]).filter((r) => r !== 'gabbai'), ['event_manager']);
  check('delegator: primary stays event_manager (higher)', w[0].role, 'event_manager');
  check('delegator: no other array touched', Object.keys(w[0]).sort(), ['managedSynagogueIds', 'role', 'roles']);
}
// A delegator cannot be tricked into writing an absent array as [].
{
  const u = user({ roles: ['gabbai'], role: 'gabbai', managedSynagogueIds: ['s1'] }); // no managedMikvehIds key at all
  const d = { ...draftFromUser(u) };
  const w = roleUpdates(u, d, cat, ['mikveh_manager']);
  check('delegator with nothing changed: no writes at all', w.length, 0);
}
// Dismissing: synagogue_manager removes the gabbai role and its shuls.
{
  const u = user({ roles: ['gabbai', 'event_manager'], role: 'event_manager', managedSynagogueIds: ['s1'] });
  const d = { ...draftFromUser(u), roles: ['event_manager'], managedSynagogueIds: [] };
  const w = roleUpdates(u, d, cat, ['synagogue_manager']);
  check('dismiss: one write', w.length, 1);
  check('dismiss: roles = [event_manager]', w[0].roles, ['event_manager']);
  check('dismiss: array emptied', w[0].managedSynagogueIds, []);
}
// Two domain roles, two children changed → two writes, each valid on its own.
{
  const u = user({ roles: ['user'] });
  const d = { ...emptyDraft(), roles: ['gabbai', 'mikveh_attendant'], managedSynagogueIds: ['s1'], managedMikvehIds: ['m1'] };
  const w = roleUpdates(u, d, cat, ['synagogue_manager', 'mikveh_manager']);
  check('two children: two writes', w.length, 2);
  check('two children: first touches one array', Object.keys(w[0]).filter((k) => k.endsWith('Ids')).length, 1);
  check('two children: second touches one array', Object.keys(w[1]).filter((k) => k.endsWith('Ids')).length, 1);
  check('two children: second write carries both roles', (w[1].roles as string[]).sort(), ['gabbai', 'mikveh_attendant']);
}
// Primary-role collapse honours catalogue order.
check('primary of [gabbai, mashgiach] is mashgiach', cat.computePrimaryRole(['gabbai', 'mashgiach']), 'mashgiach');
check('primary of [] is user', cat.computePrimaryRole([]), 'user');

console.log(failures ? `\n${failures} FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);
