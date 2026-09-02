import { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import type { UserRole } from '../types';

/**
 * The roles an account can hold — read from the app, never listed here.
 *
 * THE LIST COMES FROM THE APP. A role is not a name, it is a set of security
 * rules: adding "מנהל בית עלמין" to a document grants nothing, so only the app
 * repo, which owns firestore.rules, can say what exists. It declares them in
 * src/utils/roleCatalogue.json and publishes that to config/roles
 * (scripts/sync-catalogue.mjs); this renders whatever it finds there.
 *
 * WHY THIS EXISTS AT ALL. This console kept its own copy of the list, and it
 * went stale in four separate places at once, each failing differently and none
 * of them loudly:
 *
 *   ROLE_LABELS      content_admin rendered with no label
 *   ASSIGNABLE_BY    a city_admin could not delegate it — the whole point of it
 *   ROLE_PRIORITY    commented "mirrors the app", and no longer did: saving a
 *                    content_admin would have collapsed them to a lower role
 *   Login            content_admin could not sign in here at all
 *
 * Every one of those was a copy of a list that had moved on. So this keeps no
 * list — not even a fallback, which is only a stale list that waits for a bad
 * network before it lies to you.
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
  manages?: 'synagogues' | 'businesses';
}

/** Colour token → chip classes. The catalogue names a colour; each app owns
 *  what that colour looks like, so the two palettes can differ without the
 *  list having to. */
const CHIP: Record<string, string> = {
  slate:        'bg-slate-100 text-slate-500',
  primaryLight: 'bg-blue-50 text-blue-700',
  warning:      'bg-amber-50 text-amber-700',
  success:      'bg-emerald-50 text-emerald-700',
  kosher:       'bg-green-50 text-green-700',
  mikveh:       'bg-cyan-50 text-cyan-700',
  events:       'bg-purple-50 text-purple-700',
  gold:         'bg-yellow-50 text-yellow-700',
  danger:       'bg-red-50 text-red-700',
};

export function chipClass(entry: RoleEntry | undefined): string {
  return (entry && CHIP[entry.color]) ?? 'bg-slate-100 text-slate-500';
}

// One fetch per page load, shared by every component that asks.
let cached: RoleEntry[] | null = null;
let inFlight: Promise<RoleEntry[] | null> | null = null;

function load(): Promise<RoleEntry[] | null> {
  if (cached) return Promise.resolve(cached);
  inFlight ??= getDoc(doc(db, 'config', 'roles'))
    .then((snap) => {
      const list = snap.exists() ? (snap.data().roles as RoleEntry[]) : null;
      if (list?.length) cached = list;
      return cached;
    })
    .catch(() => null)
    .finally(() => { inFlight = null; });
  return inFlight;
}

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
  /** What this actor may grant, mirroring grantsAuthority() in the rules. */
  assignableBy: (isSuperAdmin: boolean) => RoleEntry[];
}

export function useRoleCatalogue(): Catalogue {
  const [roles, setRoles] = useState<RoleEntry[]>(cached ?? []);
  const [loading, setLoading] = useState(!cached);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (cached) return;
    let live = true;
    load().then((list) => {
      if (!live) return;
      if (list) setRoles(list); else setFailed(true);
      setLoading(false);
    });
    return () => { live = false; };
  }, []);

  const byKey = (key: UserRole) => roles.find((r) => r.key === key);

  return {
    roles,
    loading,
    failed,
    byKey,
    // A key with no catalogue entry is shown as itself rather than as blank —
    // an unknown role is worth seeing, and an empty chip is not.
    labelOf: (key) => byKey(key)?.label ?? key,
    computePrimaryRole: (held) => roles.find((r) => held.includes(r.key))?.key ?? 'user',
    assignableBy: (isSuperAdmin) =>
      roles.filter((r) => isSuperAdmin || r.assignableBy === 'city_admin'),
  };
}
