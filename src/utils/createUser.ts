import { initializeApp, getApps } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword, updateProfile, signOut } from 'firebase/auth';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
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
function getSecondaryAuth() {
  const existing = getApps().find(a => a.name === 'admin-create');
  const app = existing ?? initializeApp(firebaseConfig, 'admin-create');
  return getAuth(app);
}

export async function createUserWithRole(params: {
  email: string;
  password: string;
  displayName: string;
  role: UserRole;
  cityId: string;
}): Promise<void> {
  const auth = getSecondaryAuth();
  const { user } = await createUserWithEmailAndPassword(auth, params.email, params.password);
  await updateProfile(user, { displayName: params.displayName });
  await setDoc(doc(db, 'users', user.uid), {
    email: params.email,
    displayName: params.displayName,
    role: params.role,
    cityId: params.cityId,
    homeCityId: params.cityId,
    createdAt: serverTimestamp(),
  });
  await signOut(auth);
}
