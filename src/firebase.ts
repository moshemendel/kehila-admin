import { initializeApp, getApps } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { initializeFirestore, getFirestore, type Firestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey: "AIzaSyC65pFWSyXz7vZrTdHQRLGXh3fg_Prov5g",
  authDomain: "kehila-app-386ab.firebaseapp.com",
  projectId: "kehila-app-386ab",
  storageBucket: "kehila-app-386ab.firebasestorage.app",
  messagingSenderId: "991729726938",
  appId: "1:991729726938:web:929b7f639020bf3cf5bce3",
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];

export const auth = getAuth(app);
// ignoreUndefinedProperties: without it, setDoc()/addDoc() calls that spread a form
// object containing undefined-valued keys (e.g. unset latitude/longitude) silently
// neither resolve nor reject — no error, no network request, just a hung save.
// initializeFirestore throws if Firestore was already initialized for this app
// (e.g. on a Vite HMR re-run of this module), so fall back to the existing instance.
let db: Firestore;
try {
  db = initializeFirestore(app, { ignoreUndefinedProperties: true });
} catch {
  db = getFirestore(app);
}
export { db };
export const storage = getStorage(app);
export default app;
