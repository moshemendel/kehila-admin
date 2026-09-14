import { initializeApp, getApps } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword, updateProfile, signOut } from 'firebase/auth';
import { doc, setDoc, updateDoc, serverTimestamp, getFirestore } from 'firebase/firestore';
import { db } from '../firebase';
import type { UserRole } from '../types';

const firebaseConfig = {
  apiKey: "AIzaSyC65pFWSyXz7vZrTdHQRLGXh3fg_Prov5g",
  authDomain: "kehila-app-386ab.firebaseapp.com",
  projectId: "kehila-app-386ab",
  storageBucket: "kehila-app-386ab.firebasestorage.app",
  messagingSenderId: "991729726938",
  appId: "1:991729726938:web:929b7f639020bf3cf5bce3",
};

// Secondary app so creating a user doesn't sign out the current admin
function getSecondaryApp() {
  return getApps().find(a => a.name === 'admin-create')
      ?? initializeApp(firebaseConfig, 'admin-create');
}

/**
 * Creates an account and gives it a role, in two writes.
 *
 * It has to be two, because `users` create and `users` update are guarded by
 * different rules and no single caller satisfies both. Create demands
 * request.auth.uid == userId — nobody may mint a profile for someone else — and
 * it pins the new profile to role 'user', so a self-registration cannot come
 * with privileges attached. Assigning the real role is an update, and update is
 * the rule that lets an admin act on another account.
 *
 * This used to be one write, issued through the ADMIN's Firestore handle for
 * the NEW user's uid, which satisfies neither rule: the uid did not match, so
 * every attempt failed with permission-denied. And it failed after
 * createUserWithEmailAndPassword had already succeeded, so each try left an
 * orphaned Auth account behind with no profile to go with it, and showed the
 * admin a raw "Missing or insufficient permissions".
 *
 * So the profile is written by the new user, over their own uid, from the
 * secondary app they are momentarily signed into — and only then does the admin
 * set the role from their own session.
 *
 * homeCityId is written in the FIRST step and never touched in the second. It
 * is a city_admin's jurisdiction, and the update rule refuses to let it change;
 * were it set later the whole update would be rejected.
 *
 * If the second write fails, the account exists as an ordinary user and the
 * roles editor can finish the job. That is a recoverable half-state, unlike the
 * orphaned Auth record this replaces.
 */
export async function createUserWithRole(params: {
  email: string;
  password: string;
  displayName: string;
  cityId: string;
  /** Held roles, excluding the 'user' placeholder — empty for an ordinary member. */
  roles: UserRole[];
  /** computePrimaryRole(roles), passed in because the catalogue lives in a hook. */
  primaryRole: UserRole;
  /** Per-object assignments for the tier-3 roles among `roles`. */
  assignments?: Partial<Record<
    'managedSynagogueIds' | 'managedRestaurantIds' | 'managedMikvehIds' | 'supervisedBusinessIds',
    string[]>>;
}): Promise<void> {
  const secondaryApp  = getSecondaryApp();
  const secondaryAuth = getAuth(secondaryApp);
  const { user } = await createUserWithEmailAndPassword(secondaryAuth, params.email, params.password);

  try {
    await updateProfile(user, { displayName: params.displayName });
    // Written through the secondary app's own Firestore handle, so the request
    // carries the NEW user's token rather than the admin's. Same shape the
    // mobile app's createUserDoc() writes, so a console-made account and a
    // self-registered one are indistinguishable afterwards.
    await setDoc(doc(getFirestore(secondaryApp), 'users', user.uid), {
      uid: user.uid,
      email: params.email,
      displayName: params.displayName,
      photoURL: null,
      cityId: params.cityId,
      homeCityId: params.cityId,
      role: 'user',
      roles: ['user'],
      managedSynagogueIds: [],
      managedRestaurantIds: [],
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    // Roll the account back. Without this, a failure here leaves exactly the
    // orphaned Auth record this function used to produce on every single call —
    // an address that can sign in, has no profile, and blocks the same email
    // from being used again with "email already in use". The user was created
    // moments ago, so the token is fresh enough for delete() to be allowed.
    await user.delete().catch(() => {});
    throw err;
  } finally {
    // Before the role update, so the admin's own session is the one making it.
    await signOut(secondaryAuth).catch(() => {});
  }

  // The second write: the roles the admin chose, and their assignments. Only
  // non-empty arrays are written — an empty one adds nothing, and for a domain
  // manager creating an operator it would be a key outside their remit, which
  // delegates() refuses. A city_admin's branch would accept it either way.
  if (params.roles.length > 0) {
    const payload: Record<string, unknown> = { role: params.primaryRole, roles: params.roles };
    for (const [field, ids] of Object.entries(params.assignments ?? {})) {
      if (ids && ids.length > 0) payload[field] = ids;
    }
    await updateDoc(doc(db, 'users', user.uid), payload);
  }
}
