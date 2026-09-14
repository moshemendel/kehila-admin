import type { AppUser, UserRole, Synagogue, business, Mikveh } from '../types';

/**
 * The roles model, with nothing attached: the catalogue entry shape, and the
 * questions the console asks of a loaded list. Every function here mirrors a
 * branch of the users rules in kehila-app/firestore.rules — see each.
 *
 * Kept apart from roleCatalogue.ts, which fetches the list from Firestore and
 * therefore drags firebase.ts (and Vite's import.meta.env) into anything that
 * imports it. This file imports nothing but a type, so the logic can be
 * exercised from a plain node script: scripts/check-roles-logic.ts.
 */
export interface RoleEntry {
  key: UserRole;
  label: string;
  color: string;
  icon: string;
  assignableBy: 'city_admin' | 'super_admin';
  scope: 'city' | 'global';
  blanket: boolean;
  authority: boolean;
  content: boolean;
  /**
   * Where the role sits: 0 global, 1 city authority (city_admin), 2 a
   * city-wide domain manager, 3 a per-object operator. The picker lays roles
   * out in these rows, and a tier-3 role is appointed by its tier-2 `parent`
   * or by the city_admin, and covered by both.
   */
  tier: 0 | 1 | 2 | 3;
  /** Needs specific items assigned before it means anything. */
  manages?: 'synagogues' | 'businesses' | 'mikvaot';
  /**
   * The user-document array holding the assignment. Named explicitly because
   * `manages` does not determine it: mashgiach and business_manager both draw
   * from businesses, into different arrays.
   */
  field?: AssignmentField;
  /** The tier-2 role that may also appoint this one — mirrors the delegates()
   *  branches of the users update rule. Absent on business_manager: a shop
   *  owner is the city_admin's to appoint. */
  parent?: UserRole;
}

export type AssignmentField =
  | 'managedSynagogueIds' | 'managedRestaurantIds' | 'managedMikvehIds' | 'supervisedBusinessIds';

/** Every assignment array the catalogue can name, for code that must handle
 *  "all of them" — a save that writes each, a draft that carries each. */
export const ASSIGNMENT_FIELDS: AssignmentField[] =
  ['managedSynagogueIds', 'managedRestaurantIds', 'managedMikvehIds', 'supervisedBusinessIds'];

export interface Catalogue {
  roles: RoleEntry[];
  loading: boolean;
  /** The catalogue could not be read. Callers must show this rather than
   *  silently rendering an empty role picker, which reads as "no roles exist". */
  failed: boolean;
  byKey: (key: UserRole) => RoleEntry | undefined;
  labelOf: (key: UserRole) => string;
  /** Highest authority first — the published order IS the priority. */
  computePrimaryRole: (roles: UserRole[]) => UserRole;
  /**
   * What an actor holding these roles may grant, mirroring the three branches
   * of the users update rule: super_admin everything; city_admin every city
   * role that is not authority (grantsAuthority); a tier-2 domain manager its
   * own tier-3 children and nothing else (delegates()). Roles are cumulative —
   * a city_admin who is also a mikveh_manager gets the city_admin set.
   */
  grantableBy: (held: UserRole[]) => RoleEntry[];
  /**
   * Roles a set already covers, so offering them alongside is noise — בכלל
   * מאתיים מנה. A blanket role covers everything below it in priority; a
   * tier-2 manager covers the tier-3 roles whose `parent` it is. Greyed in the
   * picker, not cleared: demoting someone out of the covering role brings back
   * whatever they held underneath instead of silently losing it. Mirrors
   * subsumedRoles() in the app's UserManagementScreen.
   */
  subsumedBy: (held: UserRole[]) => Set<UserRole>;
  /** Tier-2 roles that appoint someone: every value some entry names as `parent`. */
  isDelegator: (held: UserRole[]) => boolean;
}

// ── The pure questions, over a loaded list ───────────────────────────────────
// Module-level so they can be exercised without React, and so the hook below
// is only plumbing. Each mirrors a branch of the users rules — see Catalogue.

export function computePrimaryRole(roles: RoleEntry[], held: UserRole[]): UserRole {
  return roles.find((r) => held.includes(r.key))?.key ?? 'user';
}

export function grantableBy(roles: RoleEntry[], held: UserRole[]): RoleEntry[] {
  if (held.some((r) => r === 'super_admin' || r === 'dev')) return roles;
  if (held.includes('city_admin')) return roles.filter((r) => r.assignableBy === 'city_admin');
  return roles.filter((r) => r.parent !== undefined && held.includes(r.parent));
}

export function subsumedBy(roles: RoleEntry[], held: UserRole[]): Set<UserRole> {
  const out = new Set<UserRole>();
  const top = roles.findIndex((r) => held.includes(r.key));
  if (top !== -1 && roles[top].blanket) roles.slice(top + 1).forEach((r) => out.add(r.key));
  roles.forEach((r) => { if (r.parent && held.includes(r.parent)) out.add(r.key); });
  return out;
}

export function isDelegator(roles: RoleEntry[], held: UserRole[]): boolean {
  return roles.some((r) => r.parent !== undefined && held.includes(r.parent));
}

/** A Catalogue over an already-loaded list — for code outside React. */
export function catalogueOf(roles: RoleEntry[]): Catalogue {
  const byKey = (key: UserRole) => roles.find((r) => r.key === key);
  return {
    roles, loading: false, failed: false, byKey,
    labelOf: (key) => byKey(key)?.label ?? key,
    computePrimaryRole: (held) => computePrimaryRole(roles, held),
    grantableBy: (held) => grantableBy(roles, held),
    subsumedBy: (held) => subsumedBy(roles, held),
    isDelegator: (held) => isDelegator(roles, held),
  };
}

// ── The editor's draft, and what a save of it must write ────────────────────

export type CityItems = { synagogues: Synagogue[]; businesses: business[]; mikvaot: Mikveh[] };

export type RoleDraft = {
  /** Roles held, EXCLUDING the 'user' placeholder — empty means ordinary member. */
  roles: UserRole[];
  managedSynagogueIds: string[];
  managedRestaurantIds: string[];
  managedMikvehIds: string[];
  supervisedBusinessIds: string[];
};

export const emptyDraft = (): RoleDraft => ({
  roles: [], managedSynagogueIds: [], managedRestaurantIds: [], managedMikvehIds: [], supervisedBusinessIds: [],
});

export function draftFromUser(u: AppUser): RoleDraft {
  return {
    roles: (u.roles ?? [u.role]).filter((r) => r && r !== 'user'),
    managedSynagogueIds:   u.managedSynagogueIds ?? [],
    managedRestaurantIds:  u.managedRestaurantIds ?? [],
    managedMikvehIds:      u.managedMikvehIds ?? [],
    supervisedBusinessIds: u.supervisedBusinessIds ?? [],
  };
}

/** Active list-roles the actor can edit that have nothing assigned. Non-empty
 *  means the form must not be saved. Covered roles are skipped — a greyed
 *  gabbai under a synagogue_manager needs no shuls of its own. */
export function missingAssignments(draft: RoleDraft, cat: Catalogue, actorRoles: UserRole[]): RoleEntry[] {
  const subsumed  = cat.subsumedBy(draft.roles);
  const grantable = new Set(cat.grantableBy(actorRoles).map((r) => r.key));
  return cat.roles.filter((r) =>
    r.field && draft.roles.includes(r.key) && grantable.has(r.key)
    && !subsumed.has(r.key) && draft[r.field].length === 0);
}

/**
 * The writes a save must issue, given who is saving. Mirrors the users update
 * rule branch by branch.
 *
 * super_admin and city_admin: one write of every role field (their branches
 * accept any non-authority change).
 *
 * A domain manager: delegates() accepts a write that touches ONLY one child
 * role and that role's array — the affected keys are checked, and the roles
 * array may differ by exactly that role. So each changed child becomes its own
 * write, applied in order, each building on the last. Two-role saves are rare
 * (an account holding two domain roles, changing both children at once) but
 * a single write would be refused outright, and refused as a bare
 * permission-denied.
 *
 * Absent arrays are never materialised as [] on a delegator's behalf: to the
 * rule that is a changed key, and one outside their remit.
 */
export function roleUpdates(
  original: AppUser, draft: RoleDraft, cat: Catalogue, actorRoles: UserRole[],
): Record<string, unknown>[] {
  const withUser = (rs: UserRole[]) => (rs.length ? rs : ['user']);
  const full = actorRoles.some((r) => r === 'super_admin' || r === 'dev' || r === 'city_admin');

  if (full) {
    const roles = withUser(draft.roles);
    const payload: Record<string, unknown> = { roles, role: cat.computePrimaryRole(roles) };
    for (const field of ASSIGNMENT_FIELDS) payload[field] = draft[field];
    return [payload];
  }

  const before = draftFromUser(original);
  const out: Record<string, unknown>[] = [];
  let roles = before.roles;
  for (const child of cat.grantableBy(actorRoles)) {
    const hadRole = before.roles.includes(child.key);
    const hasRole = draft.roles.includes(child.key);
    const field = child.field;
    const arrChanged = !!field && (
      before[field].length !== draft[field].length || !before[field].every((x) => draft[field].includes(x)));
    if (hadRole === hasRole && !arrChanged) continue;
    roles = hasRole ? (roles.includes(child.key) ? roles : [...roles, child.key]) : roles.filter((r) => r !== child.key);
    const held = withUser(roles);
    const payload: Record<string, unknown> = { roles: held, role: cat.computePrimaryRole(held) };
    if (field && (arrChanged || field in original)) payload[field] = draft[field];
    out.push(payload);
  }
  return out;
}
