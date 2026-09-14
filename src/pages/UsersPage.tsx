import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { collection, getDocs, query, where, doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { useParams } from 'react-router-dom';
import type { AppUser, UserRole, City, Synagogue, business, Mikveh } from '../types';
import DataTable, { type Column } from '../components/DataTable';
import Modal from '../components/Modal';
import RolesEditor from '../components/RolesEditor';
import { Plus, Pencil, Shield, Code2, Users, UserCog, UserPlus } from 'lucide-react';
import { createUserWithRole } from '../utils/createUser';
import { useRoleCatalogue, chipClass } from '../utils/roleCatalogue';
import {
  type Catalogue, type RoleDraft, type CityItems, emptyDraft, draftFromUser, missingAssignments, roleUpdates,
} from '../utils/roleLogic';
import { checkPassword, suggestPassword, MIN_LENGTH } from '../utils/passwordPolicy';

// ─── Shared ───────────────────────────────────────────────────────────────────

/** Every role the signed-in account holds — each question below is asked of
 *  the set, never of the single primary role. */
function useActorRoles(): UserRole[] {
  const { appUser } = useAuth();
  return useMemo(() => (appUser?.roles ?? (appUser?.role ? [appUser.role] : [])) as UserRole[], [appUser]);
}

const cityItems = (all: { synagogues: Synagogue[]; businesses: business[]; mikvaot: Mikveh[] }, cityId: string): CityItems => ({
  synagogues: all.synagogues.filter((s) => s.cityId === cityId),
  businesses: all.businesses.filter((b) => b.cityId === cityId),
  mikvaot:    all.mikvaot.filter((m) => m.cityId === cityId),
});

/** The one sentence under a blocked save button. */
function missingMessage(cat: Catalogue, draft: RoleDraft, actorRoles: UserRole[]): string | null {
  const missing = missingAssignments(draft, cat, actorRoles);
  if (missing.length === 0) return null;
  const what = { synagogues: 'בית כנסת', businesses: 'עסק', mikvaot: 'מקווה' } as const;
  return missing.map((r) => `${r.label}: יש לבחור לפחות ${what[r.manages!]} אחד`).join(' · ');
}

// ─── Add-user form ────────────────────────────────────────────────────────────

function AddUserModal({ open, onClose, onCreated, currentCityId, cities, all }: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  currentCityId: string;
  cities: City[];
  all: { synagogues: Synagogue[]; businesses: business[]; mikvaot: Mikveh[] };
}) {
  const [email, setEmail]           = useState('');
  const [password, setPassword]     = useState('');
  const [displayName, setName]      = useState('');
  const [draft, setDraft]           = useState<RoleDraft>(emptyDraft());
  const [cityId, setCityId]         = useState(currentCityId);
  const [saving, setSaving]         = useState(false);
  const [error, setError]           = useState('');

  const pwCheck = checkPassword(password, { name: displayName, email });
  const actorRoles = useActorRoles();
  const isSuperAdmin = actorRoles.includes('super_admin') || actorRoles.includes('dev');
  const cat = useRoleCatalogue();

  useEffect(() => {
    if (open) { setEmail(''); setPassword(''); setName(''); setDraft(emptyDraft()); setCityId(currentCityId); setError(''); }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const targetCity = isSuperAdmin ? cityId : currentCityId;
  const blocked = missingMessage(cat, draft, actorRoles);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!email || !password || !displayName || blocked) return;
    if (!pwCheck.ok) {
      setError(pwCheck.error ?? `הסיסמה אינה עומדת בדרישות: ${pwCheck.rules.find(r => !r.met)?.label}`);
      return;
    }
    setSaving(true);
    setError('');
    try {
      const roles = draft.roles;
      await createUserWithRole({
        email, password, displayName, cityId: targetCity,
        roles,
        primaryRole: cat.computePrimaryRole(roles.length ? roles : ['user']),
        assignments: {
          managedSynagogueIds:   draft.managedSynagogueIds,
          managedRestaurantIds:  draft.managedRestaurantIds,
          managedMikvehIds:      draft.managedMikvehIds,
          supervisedBusinessIds: draft.supervisedBusinessIds,
        },
      });
      onCreated();
      onClose();
    } catch (err: any) {
      setError(
        err.code === 'auth/email-already-in-use' ? 'כתובת אימייל כבר בשימוש'
        : err.code === 'auth/weak-password'      ? `הסיסמה חלשה מדי (מינימום ${MIN_LENGTH} תווים)`
        : `שגיאה: ${err.message}`
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} title="הוספת משתמש חדש" onClose={onClose} size="md">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div>
          <label className={lbl}>שם מלא *</label>
          <input value={displayName} onChange={e => setName(e.target.value)} required className={inp} placeholder="ישראל ישראלי" />
        </div>
        <div>
          <label className={lbl}>אימייל *</label>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} required className={inp} placeholder="user@example.com" />
        </div>
        <div>
          <div className="flex items-center justify-between">
            <label className={lbl}>סיסמה זמנית *</label>
            <button type="button" onClick={() => setPassword(suggestPassword())}
              className="text-xs font-semibold text-[#1B3A6B] hover:underline mb-1.5">
              הצע סיסמה
            </button>
          </div>
          <input type="text" value={password} onChange={e => setPassword(e.target.value)} required
            minLength={MIN_LENGTH} autoComplete="off" className={inp}
            placeholder={`מינימום ${MIN_LENGTH} תווים`} />
          {/* Plain text, not type="password": the admin has to read this out to
              the new manager, and a masked field they can't see is worse than a
              value already visible on their own screen. */}
          {password.length > 0 && (
            <ul className="mt-2 space-y-0.5">
              {pwCheck.rules.map(r => (
                <li key={r.key} className={`text-xs flex items-center gap-1.5 ${r.met ? 'text-emerald-600' : 'text-slate-400'}`}>
                  <span>{r.met ? '✓' : '○'}</span>{r.label}
                </li>
              ))}
              {pwCheck.error && <li className="text-xs text-red-600 flex items-center gap-1.5"><span>!</span>{pwCheck.error}</li>}
            </ul>
          )}
          <p className="text-xs text-slate-400 mt-1.5">המשתמש יוכל לשנות את הסיסמה לאחר הכניסה הראשונה.</p>
        </div>

        {isSuperAdmin && (
          <div>
            <label className={lbl}>עיר</label>
            <select value={cityId} onChange={e => setCityId(e.target.value)} className={inp}>
              <option value="">— כללי —</option>
              {cities.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        )}

        <div>
          <label className={lbl}>תפקידים</label>
          {cat.failed
            ? <p className="text-sm text-red-600">רשימת התפקידים לא נטענה — לא ניתן להקצות תפקיד.</p>
            : <RolesEditor cat={cat} draft={draft} onChange={setDraft} actorRoles={actorRoles} items={cityItems(all, targetCity)} />}
        </div>

        {blocked && <div className="bg-amber-50 text-amber-700 text-xs px-4 py-2.5 rounded-xl border border-amber-100">{blocked}</div>}
        {error && <div className="bg-red-50 text-red-600 text-sm px-4 py-2.5 rounded-xl border border-red-100">{error}</div>}

        <div className="flex gap-3 pt-2">
          <button type="submit" disabled={saving || !email || !displayName || !pwCheck.ok || !!blocked || cat.failed}
            className="flex-1 bg-[#1B3A6B] text-white py-2.5 rounded-xl font-semibold text-sm hover:bg-[#15306a] disabled:opacity-50">
            {saving ? 'יוצר משתמש...' : 'צור משתמש'}
          </button>
          <button type="button" onClick={onClose} className="px-5 py-2.5 border border-slate-200 rounded-xl text-sm hover:bg-slate-50">ביטול</button>
        </div>
      </form>
    </Modal>
  );
}

// ─── Edit role modal ──────────────────────────────────────────────────────────

function EditRoleModal({ open, user, onSave, onClose, cities, all, appointOnly }: {
  open: boolean;
  user: AppUser | null;
  onSave: (user: AppUser, draft: RoleDraft, cityId: string) => Promise<void>;
  onClose: () => void;
  cities: City[];
  all: { synagogues: Synagogue[]; businesses: business[]; mikvaot: Mikveh[] };
  /** A domain manager appointing, rather than an admin editing. */
  appointOnly: boolean;
}) {
  const [draft, setDraft]   = useState<RoleDraft>(emptyDraft());
  const [cityId, setCityId] = useState('');
  const [saving, setSaving] = useState(false);
  const actorRoles = useActorRoles();
  const isSuperAdmin = actorRoles.includes('super_admin') || actorRoles.includes('dev');
  const cat = useRoleCatalogue();

  useEffect(() => {
    if (user) { setDraft(draftFromUser(user)); setCityId(user.homeCityId ?? user.cityId ?? ''); }
  }, [user]);

  const blocked = missingMessage(cat, draft, actorRoles);

  const handleSave = async () => {
    if (!user || blocked) return;
    setSaving(true);
    try {
      await onSave(user, draft, cityId);
      onClose();
    } catch (e: any) {
      alert(e?.message ?? 'שגיאה בשמירה');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} title={appointOnly ? 'מינוי לתפקיד' : 'עריכת תפקידים'} onClose={onClose} size="md">
      {user && (
        <>
          <div className="mb-5 p-3 bg-slate-50 rounded-xl">
            <div className="font-semibold text-slate-800">{user.displayName}</div>
            <div className="text-sm text-slate-400">{user.email}</div>
          </div>

          {/* The city picker assigns a city_admin's administrative scope. Shown
              only to a super_admin and only for that role — a city_admin's own
              homeCityId is their jurisdiction and the rule refuses to let anyone
              but a super_admin move it. */}
          {isSuperAdmin && draft.roles.includes('city_admin') && (
            <div className="mb-5">
              <label className={lbl}>עיר</label>
              <select value={cityId} onChange={e => setCityId(e.target.value)} className={inp}>
                <option value="">— בחר עיר —</option>
                {cities.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          )}

          <div className="mb-5">
            {cat.failed
              ? <p className="text-sm text-red-600">רשימת התפקידים לא נטענה.</p>
              : <RolesEditor cat={cat} draft={draft} onChange={setDraft} actorRoles={actorRoles} items={cityItems(all, cityId)} />}
          </div>

          {blocked && <div className="mb-4 bg-amber-50 text-amber-700 text-xs px-4 py-2.5 rounded-xl border border-amber-100">{blocked}</div>}

          <div className="flex gap-3">
            <button onClick={handleSave} disabled={saving || !!blocked || cat.failed}
              className="flex-1 bg-[#1B3A6B] text-white py-2.5 rounded-xl font-semibold text-sm hover:bg-[#15306a] disabled:opacity-50">
              {saving ? 'שומר...' : 'שמור'}
            </button>
            <button onClick={onClose} className="px-5 py-2.5 border border-slate-200 rounded-xl text-sm hover:bg-slate-50">ביטול</button>
          </div>
        </>
      )}
    </Modal>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

type TabKey = 'managers' | 'regular' | 'dev';

export default function UsersPage() {
  const cat = useRoleCatalogue();
  const { appUser } = useAuth();
  const actorRoles = useActorRoles();
  const isSuperAdmin = actorRoles.includes('super_admin') || actorRoles.includes('dev');
  // Two different things happen on this page, and they are separated by who
  // is here.
  //
  // ACCOUNTS are the city_admin's (and super_admin's): creating them, and
  // editing every role on them. content_admin has no authority over accounts
  // by design and gets none of this — the catalogue grants it nothing, so it
  // never reaches this page.
  //
  // APPOINTING is what a domain manager comes for: a synagogue_manager,
  // mikveh_manager or kosher_manager finding an EXISTING account and giving
  // it their domain's operator role. They see the list read-only, and the one
  // action on a row is that appointment. They do not create accounts — not
  // because the rules could stop it (a new account writes its own profile,
  // as any self-registration does) but because it is not their job, and a
  // manager who made an account "to appoint later" left an ordinary user
  // behind that nobody asked for.
  const fullWriter = isSuperAdmin || actorRoles.includes('city_admin');
  const appointer  = !fullWriter && cat.isDelegator(actorRoles);
  const canCreate  = fullWriter;
  // What an appointer may confer, by label, for the header.
  const appointsTo = cat.grantableBy(actorRoles).map((r) => r.label).join(' / ');
  const { cityId = '' } = useParams<{ cityId: string }>();

  const [allUsers, setAllUsers]     = useState<AppUser[]>([]);
  const [cities, setCities]         = useState<City[]>([]);
  const [synagogues, setSynagogues] = useState<Synagogue[]>([]);
  const [businesses, setBusinesses] = useState<business[]>([]);
  const [mikvaot, setMikvaot]       = useState<Mikveh[]>([]);
  const [loading, setLoading]       = useState(true);
  const [tab, setTab]               = useState<TabKey>('managers');
  const [addOpen, setAddOpen]       = useState(false);
  const [editUser, setEditUser]     = useState<AppUser | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      // super_admin loads all users; everyone else is scoped to their permanent
      // homeCityId — never the URL's cityId, which is just whatever city they
      // (or the user being managed) happen to be personally browsing right now.
      // The same query serves a domain manager: the users read rule admits them
      // for their own city.
      const usersQuery = isSuperAdmin
        ? query(collection(db, 'users'))
        : query(collection(db, 'users'), where('homeCityId', '==', appUser?.homeCityId ?? ''));

      const [usersSnap, citiesSnap, synagoguesSnap, businessesSnap, mikvaotSnap] = await Promise.all([
        getDocs(usersQuery),
        getDocs(collection(db, 'cities')),
        getDocs(collection(db, 'synagogues')),
        getDocs(collection(db, 'businesses')),
        getDocs(collection(db, 'mikvaot')),
      ]);

      setAllUsers(usersSnap.docs.map(d => ({ uid: d.id, ...d.data() }) as AppUser));
      setCities(citiesSnap.docs.map(d => ({ id: d.id, ...d.data() }) as City));
      setSynagogues(synagoguesSnap.docs.map(d => ({ id: d.id, ...d.data() }) as Synagogue));
      setBusinesses(businessesSnap.docs.map(d => ({ id: d.id, ...d.data() }) as business));
      setMikvaot(mikvaotSnap.docs.map(d => ({ id: d.id, ...d.data() }) as Mikveh));
    } catch (err) {
      console.error('Error loading users:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [appUser?.homeCityId, isSuperAdmin]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRoleSave = async (user: AppUser, draft: RoleDraft, pickedCityId: string) => {
    // One write for a city_admin or super_admin; one write PER CHILD ROLE for a
    // domain manager, because the delegation rule accepts exactly one role per
    // write. See roleUpdates().
    const updates = roleUpdates(user, draft, cat, actorRoles);
    if (fullWriter && updates.length === 1) {
      // The city picker only assigns a city_admin's administrative scope — it
      // must not overwrite an existing manager's homeCityId when unrelated role
      // fields are being edited.
      const homeCityId = draft.roles.includes('city_admin') && isSuperAdmin
        ? pickedCityId
        : (user.homeCityId ?? user.cityId);
      updates[0] = { ...updates[0], homeCityId };
    }
    for (const payload of updates) await updateDoc(doc(db, 'users', user.uid), payload);
    const merged = updates.reduce((acc, p) => ({ ...acc, ...p }), {} as Record<string, unknown>);
    setAllUsers(prev => prev.map(u => u.uid === user.uid ? { ...u, ...merged } as AppUser : u));
  };

  // Partition users
  const devUsers      = allUsers.filter(u => u.role === 'dev' || u.role === 'super_admin');
  const visibleUsers  = isSuperAdmin
    ? allUsers.filter(u => u.role !== 'dev' && u.role !== 'super_admin')
    // Global-scope roles (super_admin, dev) are not about this city, so a
    // city_admin never sees them. Asked of the catalogue rather than listed,
    // so a future cross-city role is hidden the day it is added.
    : allUsers.filter(u => cat.byKey(u.role)?.scope !== 'global');

  const managerUsersAll = visibleUsers.filter(u => u.role !== 'user');
  const regularUsersAll = visibleUsers.filter(u => u.role === 'user');

  // An appointer's list is curated down to accounts they could sensibly act
  // on: never themselves, and never anyone who already holds a `blanket`
  // role (city_admin, content_admin, super_admin, dev — the ones that
  // "subsume the roles below" per the catalogue). This is a UI curation
  // choice, not the security boundary: the users rules would in fact let a
  // domain manager add their child role to a content_admin's account (it
  // carries no `authority`), and self-edits are refused by the rules'
  // profile-only branch regardless of what this filters. Showing either
  // anyway is just noise — an appointment option nobody would sensibly take.
  const appointableTarget = (u: AppUser) =>
    u.uid !== appUser?.uid && !(u.roles ?? [u.role]).some((r) => cat.byKey(r)?.blanket);

  const managerUsers = appointer ? managerUsersAll.filter(appointableTarget) : managerUsersAll;
  const regularUsers = appointer ? regularUsersAll.filter(appointableTarget) : regularUsersAll;

  const cityName = (cid: string) => cities.find(c => c.id === cid)?.name ?? cid;

  const columns = (showCity = false): Column<AppUser & { id: string }>[] => [
    { key: 'displayName', header: 'שם',     sortable: true },
    { key: 'email',       header: 'אימייל', sortable: true },
    {
      key: 'role', header: 'תפקידים',
      render: r => (
        <div className="flex flex-wrap gap-1">
          {(r.roles ?? [r.role]).map(role => (
            <span key={role} className={`text-xs px-2.5 py-1 rounded-full font-semibold ${chipClass(cat.byKey(role))}`}>{cat.labelOf(role)}</span>
          ))}
        </div>
      ),
    },
    ...(showCity ? [{ key: 'cityId', header: 'עיר', render: (r: any) => cityName(r.cityId) || '—' } as Column<any>] : []),
  ];

  const withId = (arr: AppUser[]) => arr.map(u => ({ ...u, id: u.uid }));

  const TABS: { key: TabKey; label: string; icon: typeof Users; count: number; hidden?: boolean }[] = [
    { key: 'managers', label: 'מנהלים ורכזים', icon: UserCog,  count: managerUsers.length },
    { key: 'regular',  label: 'משתמשים',        icon: Users,    count: regularUsers.length },
    { key: 'dev',      label: 'צוות פיתוח',     icon: Code2,    count: devUsers.length, hidden: !isSuperAdmin },
  ];

  // No rule branch lets an account touch its own role fields outside the
  // narrow self-edit clause (profile fields only) — so an action here would
  // always fail on save. Checked before anything else, for every actor.
  const isSelf = (u: AppUser) => u.uid === appUser?.uid;
  // A peer who already holds authority (another city_admin, in the same
  // city) — the plain-city_admin update branch explicitly excludes editing
  // an account that already grants it. super_admin has no such carve-out and
  // may edit any account but its own.
  const holdsAuthority = (u: AppUser) =>
    (u.roles ?? [u.role]).some((r) => cat.byKey(r)?.authority);

  const rowAction = (row: AppUser) => {
    if (isSelf(row)) return null;
    if (isSuperAdmin) return (
      <button onClick={() => setEditUser(row)} title="עריכת תפקידים"
        className="p-1.5 rounded-lg hover:bg-blue-50 text-slate-400 hover:text-blue-600 transition-colors">
        <Pencil size={14} />
      </button>
    );
    if (actorRoles.includes('city_admin')) return holdsAuthority(row) ? null : (
      <button onClick={() => setEditUser(row)} title="עריכת תפקידים"
        className="p-1.5 rounded-lg hover:bg-blue-50 text-slate-400 hover:text-blue-600 transition-colors">
        <Pencil size={14} />
      </button>
    );
    // appointer: the list (managerUsers/regularUsers above) is already
    // curated by appointableTarget, so every row reaching here is fair game.
    if (appointer) return (
      <button onClick={() => setEditUser(row)} title={`מינוי ל${appointsTo}`}
        className="p-1.5 rounded-lg hover:bg-blue-50 text-slate-400 hover:text-blue-600 transition-colors">
        <UserPlus size={14} />
      </button>
    );
    return null;
  };

  const all = { synagogues, businesses, mikvaot };

  return (
    <div className="p-8" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">משתמשים</h1>
          <p className="text-slate-400 text-sm mt-0.5">
            {appointer
              ? `בחר משתמש קיים כדי למנות אותו ל${appointsTo}`
              : `${visibleUsers.length} משתמשים ${isSuperAdmin ? 'במערכת' : 'בעיר'}`}
          </p>
        </div>
        {canCreate && (
          <button onClick={() => setAddOpen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-[#1B3A6B] text-white rounded-xl text-sm font-semibold hover:bg-[#15306a] transition-colors">
            <Plus size={15} /> הוסף משתמש
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-100 rounded-xl p-1 w-fit mb-5">
        {TABS.filter(t => !t.hidden).map(({ key, label, icon: Icon, count }) => (
          <button key={key} onClick={() => setTab(key)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${tab === key ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}>
            <Icon size={14} />
            {label}
            <span className={`text-xs px-1.5 py-0.5 rounded-full ${tab === key ? 'bg-slate-100 text-slate-600' : 'bg-slate-200/60 text-slate-400'}`}>{count}</span>
          </button>
        ))}
      </div>

      {/* Table */}
      {loading ? <div className="text-center py-16 text-slate-400">טוען...</div> : (
        <>
          {tab === 'managers' && (
            <DataTable data={withId(managerUsers)} columns={columns(isSuperAdmin)} searchKeys={['displayName', 'email']} actions={rowAction} />
          )}
          {tab === 'regular' && (
            <DataTable data={withId(regularUsers)} columns={columns(isSuperAdmin)} searchKeys={['displayName', 'email']} actions={rowAction} />
          )}
          {tab === 'dev' && isSuperAdmin && (
            <div>
              <div className="flex items-center gap-2 mb-4 text-sm text-zinc-500">
                <Shield size={14} /> משתמשים אלו מוסתרים ממנהלי ערים
              </div>
              <DataTable data={withId(devUsers)} columns={columns(true)} searchKeys={['displayName', 'email']} actions={rowAction} />
            </div>
          )}
        </>
      )}

      {/* Add user */}
      <AddUserModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onCreated={load}
        currentCityId={appUser?.homeCityId ?? cityId}
        cities={cities}
        all={all}
      />

      {/* Edit role */}
      <EditRoleModal
        open={!!editUser}
        user={editUser}
        onSave={handleRoleSave}
        onClose={() => setEditUser(null)}
        cities={cities}
        all={all}
        appointOnly={appointer}
      />
    </div>
  );
}

const inp = 'w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 bg-white';
const lbl = 'block text-xs font-semibold text-slate-600 mb-1.5';
