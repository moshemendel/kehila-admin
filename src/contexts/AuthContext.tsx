import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';
import type { AppUser } from '../types';
import { mayOpenConsole, rolesOf } from '../utils/consoleAccess';

interface AuthCtx {
  firebaseUser: User | null;
  appUser: AppUser | null;
  loading: boolean;
}

const Ctx = createContext<AuthCtx>({ firebaseUser: null, appUser: null, loading: true });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [appUser, setAppUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    return onAuthStateChanged(auth, async (u) => {
      setFirebaseUser(u);
      if (u) {
        const snap = await getDoc(doc(db, 'users', u.uid));
        // The console's own door, enforced here and not only on the login form:
        // a signed-in account without a staff role is treated as signed out, so
        // no route can render for it however the session was established.
        const data = snap.exists() ? ({ uid: u.uid, ...snap.data() } as AppUser) : null;
        setAppUser(data && mayOpenConsole(rolesOf(data)) ? data : null);
      } else {
        setAppUser(null);
      }
      setLoading(false);
    });
  }, []);

  return <Ctx.Provider value={{ firebaseUser, appUser, loading }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
