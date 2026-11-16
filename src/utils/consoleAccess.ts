import type { UserRole } from '../types';

/**
 * Who may open the console: anyone holding a role other than plain `user`.
 *
 * Asked as a question instead of kept as a list, it cannot go stale: a new role
 * is by definition not `user`, so it is admitted the day it is created. What each
 * role may actually do once inside is decided by firestore.rules on every read
 * and write; this is only the "is this an ordinary member" door.
 */
export function mayOpenConsole(roles: UserRole[]): boolean {
  return roles.some((r) => r && r !== 'user');
}

/** Roles of a users/{uid} document, falling back to the singular pre-roles[] field. */
export function rolesOf(data: { roles?: UserRole[]; role?: UserRole }): UserRole[] {
  return data.roles ?? (data.role ? [data.role] : []);
}
