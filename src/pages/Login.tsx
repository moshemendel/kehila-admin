import { useState, type FormEvent } from 'react';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import { auth, db } from '../firebase';
import type { UserRole } from '../types';

/**
 * Who may open the console: anyone holding a role other than plain `user`.
 *
 * This was a list of the nine roles that existed when it was written, and it
 * aged exactly as you would expect — content_admin was added to the app and the
 * rules, and the one person a city_admin would delegate to was silently locked
 * out of the tool they were delegated to use, with "אין הרשאה" and no clue why.
 *
 * Asked as a question instead of kept as a list, it cannot go stale: a new role
 * is by definition not `user`, so it is admitted the day it is created. The
 * gate here is only "is this an ordinary member" — what each role may actually
 * do once inside is decided by firestore.rules on every read and write.
 */
function mayOpenConsole(roles: UserRole[]): boolean {
  return roles.some((r) => r && r !== 'user');
}

export default function Login() {
  const [email, setEmail]     = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]     = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const cred = await signInWithEmailAndPassword(auth, email, password);
      const snap = await getDoc(doc(db, 'users', cred.user.uid));
      if (!snap.exists()) { setError('משתמש לא נמצא במערכת'); auth.signOut(); return; }
      // A user can hold several roles at once — check the full array (falling
      // back to the singular primary role for accounts saved before roles[]
      // existed), same as every role check elsewhere in this app. Checking
      // only the primary role would incorrectly lock out e.g. a gabbai who's
      // also a mikveh_manager but not primarily one.
      const data = snap.data();
      const roles = (data.roles as UserRole[] | undefined) ?? [data.role as UserRole];
      if (!mayOpenConsole(roles)) { setError('אין הרשאה לגשת לממשק הניהול'); auth.signOut(); return; }
      navigate('/');
    } catch (err: any) {
      setError(err.code === 'auth/invalid-credential' ? 'אימייל או סיסמה שגויים' : 'שגיאה בהתחברות');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#1B3A6B] to-[#0f2347] flex items-center justify-center p-4" dir="rtl">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-8">
        <div className="text-center mb-8">
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
        </form>
      </div>
    </div>
  );
}
