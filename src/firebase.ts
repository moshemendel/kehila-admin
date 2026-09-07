import { initializeApp, getApps } from 'firebase/app';
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check';
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

// ── App Check ─────────────────────────────────────────────────────────────────
// The apiKey above is public — it ships in this bundle and in the mobile app's
// APK — so without App Check the Security Rules are the ONLY thing standing
// between a stranger with a script and the database. App Check adds the second
// question: not just "who are you" but "are you the real client".
//
// Deliberately opt-in via the env var, and a no-op without it, so that pulling
// this file never breaks a checkout that has no key configured. Set it only
// once the web app is registered under Firebase Console → App Check.
//
// IMPORTANT — do NOT switch App Check to "enforced" in the console yet. The
// mobile app cannot produce a token: it runs the firebase JS SDK, whose only
// providers are reCAPTCHA V3/Enterprise, and both are web-only (they reach for
// `document` and throw in React Native). Attestation there needs
// @react-native-firebase/app-check and the native Play Integrity / App Attest
// path. Enforce before that lands and every phone loses the database at once.
// Leave it on "monitoring" until the mobile side can attest too.
//
// For `npm run dev`, register a debug token instead of a real one:
//   self.FIREBASE_APPCHECK_DEBUG_TOKEN = true  (before initializeAppCheck)
// then copy the token the console logs into App Check → Manage debug tokens.
const appCheckSiteKey = import.meta.env.VITE_APPCHECK_RECAPTCHA_KEY;
if (appCheckSiteKey) {
  initializeAppCheck(app, {
    provider: new ReCaptchaV3Provider(appCheckSiteKey),
    isTokenAutoRefreshEnabled: true,
  });
}

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
