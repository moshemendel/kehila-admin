import { useState, type FormEvent } from 'react';
import { signInWithEmailAndPassword, signInWithPopup, GoogleAuthProvider, sendPasswordResetEmail, type User } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import { auth, db } from '../firebase';
import type { UserRole } from '../types';
import { mayOpenConsole } from '../utils/consoleAccess';

export default function Login() {
  const [email, setEmail]     = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]     = useState('');
  const [loading, setLoading] = useState(false);
  const [info, setInfo]       = useState('');
  const navigate = useNavigate();

  // Shared by both sign-in methods: the account must have a profile and hold a
  // role other than plain `user`. A user can hold several roles at once — check
  // the full array (falling back to the singular primary role for accounts
  // saved before roles[] existed), same as every role check elsewhere in this
  // app. Checking only the primary role would incorrectly lock out e.g. a
  // gabbai who's also a mikveh_manager but not primarily one.
  const admit = async (user: User) => {
    const snap = await getDoc(doc(db, 'users', user.uid));
    if (!snap.exists()) { setError('משתמש לא נמצא במערכת'); await auth.signOut(); return; }
    const data = snap.data();
    const roles = (data.roles as UserRole[] | undefined) ?? [data.role as UserRole];
    if (!mayOpenConsole(roles)) { setError('אין הרשאה לגשת לממשק הניהול'); await auth.signOut(); return; }
    navigate('/');
  };

  // Same answer whether or not the address has an account, so the form cannot be
  // used to probe which emails are registered.
  const handleForgot = async () => {
    setError(''); setInfo('');
    if (!email.trim()) { setError('הזן את כתובת האימייל למעלה ואז לחץ שוב על "שכחתי סיסמה"'); return; }
    setLoading(true);
    try {
      await sendPasswordResetEmail(auth, email.trim());
    } catch (err: any) {
      if (err.code === 'auth/invalid-email') { setError('כתובת אימייל לא תקינה'); setLoading(false); return; }
      if (err.code === 'auth/too-many-requests') { setError('יותר מדי ניסיונות, נסה שוב מאוחר יותר'); setLoading(false); return; }
    }
    setInfo('אם קיים חשבון עם כתובת זו, נשלח אליה קישור לאיפוס סיסמה');
    setLoading(false);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(''); setInfo('');
    setLoading(true);
    try {
      const cred = await signInWithEmailAndPassword(auth, email, password);
      await admit(cred.user);
    } catch (err: any) {
      setError(err.code === 'auth/invalid-credential' ? 'אימייל או סיסמה שגויים' : 'שגיאה בהתחברות');
    } finally {
      setLoading(false);
    }
  };

  // Google sign-in does not create a console account: a Google identity with no
  // profile in `users` (or only a plain-user one) is turned away exactly like a
  // wrong password would be. An existing email/password account with the same
  // address is the same Firebase user, so its roles apply unchanged.
  const handleGoogle = async () => {
    setError('');
    setLoading(true);
    try {
      const cred = await signInWithPopup(auth, new GoogleAuthProvider());
      await admit(cred.user);
    } catch (err: any) {
      if (err.code === 'auth/popup-closed-by-user' || err.code === 'auth/cancelled-popup-request') return;
      setError(err.code === 'auth/popup-blocked' ? 'החלון נחסם — אפשר חלונות קופצים ונסה שוב'
             : err.code === 'auth/unauthorized-domain' ? 'הדומיין אינו מאושר להתחברות עם Google'
             : 'שגיאה בהתחברות עם Google');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#1B3A6B] to-[#0f2347] flex items-center justify-center p-4" dir="rtl">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-8">
        <div className="text-center mb-8">
          <img src={`${import.meta.env.BASE_URL}logo.png`} alt="קהילה" className="h-20 w-20 rounded-2xl mx-auto mb-3 shadow-md" />
          <div className="text-3xl font-black text-[#1B3A6B] mb-1">קהילה</div>
          <div className="text-slate-400 text-sm">ממשק ניהול</div>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">אימייל</label>
            <input
              type="email" value={email} onChange={e => setEmail(e.target.value)} required
              className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
              placeholder="your@email.com"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">סיסמה</label>
            <input
              type="password" value={password} onChange={e => setPassword(e.target.value)} required
              className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
              placeholder="••••••••"
            />
          </div>

          <button type="button" onClick={handleForgot} disabled={loading}
            className="text-xs text-blue-600 hover:underline self-start -mt-2 disabled:opacity-60">
            שכחתי סיסמה
          </button>

          {info && (
            <div className="bg-green-50 text-green-700 text-sm px-4 py-2.5 rounded-xl border border-green-100">{info}</div>
          )}

          {error && (
            <div className="bg-red-50 text-red-600 text-sm px-4 py-2.5 rounded-xl border border-red-100">
              {error}
            </div>
          )}

          <button
            type="submit" disabled={loading}
            className="w-full bg-[#1B3A6B] text-white py-2.5 rounded-xl font-semibold text-sm hover:bg-[#15306a] disabled:opacity-60 transition-colors mt-2"
          >
            {loading ? 'מתחבר...' : 'כניסה'}
          </button>

          <div className="flex items-center gap-3 text-xs text-slate-400">
            <span className="flex-1 h-px bg-slate-200" />או<span className="flex-1 h-px bg-slate-200" />
          </div>
          <button
            type="button" onClick={handleGoogle} disabled={loading}
            className="w-full flex items-center justify-center gap-2.5 border border-slate-200 text-slate-700 py-2.5 rounded-xl font-semibold text-sm hover:bg-slate-50 disabled:opacity-60 transition-colors"
          >
            <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
              <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z"/>
              <path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.3 5.7c4.3-4 6.9-9.9 6.9-17.1z"/>
              <path fill="#FBBC05" d="M10.5 28.7a14.5 14.5 0 0 1 0-9.4l-7.9-6.1a24 24 0 0 0 0 21.6l7.9-6.1z"/>
              <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.3-5.7c-2 1.4-4.9 2.3-8.6 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z"/>
            </svg>
            כניסה עם Google
          </button>
        </form>
      </div>
    </div>
  );
}
