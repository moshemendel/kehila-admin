import { useEffect, useState, type FormEvent } from 'react';
import { collection, getDocs, query, where, doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { useParams } from 'react-router-dom';
import type { AppUser, UserRole, City, Synagogue, business } from '../types';
import DataTable, { type Column } from '../components/DataTable';
import Modal from '../components/Modal';
import { Plus, Pencil, Shield, Code2, Users, UserCog, ChevronDown, ChevronUp } from 'lucide-react';
import { createUserWithRole } from '../utils/createUser';

// ─── Role metadata ────────────────────────────────────────────────────────────

const ROLE_LABELS: Record<UserRole, string> = {
  user:             'משתמש',
  gabbai:           'גבאי',
  business_manager: 'מנהל עסק',
  kosher_manager:   'מנהל כשרות',
  mikveh_manager:   'מנהל מקוואות',
  event_manager:    'מנהל אירועים',
  eruv_manager:     'מנהל עירוב',
  city_admin:       'מנהל עיר',
  dev:              'צוות פיתוח',
  super_admin:      'מנהל על',
};

const ROLE_COLORS: Record<UserRole, string> = {
  user:             'bg-slate-100 text-slate-500',
  gabbai:           'bg-blue-50 text-blue-700',
  business_manager: 'bg-green-50 text-green-700',
  kosher_manager:   'bg-emerald-50 text-emerald-700',
  mikveh_manager:   'bg-cyan-50 text-cyan-700',
  event_manager:    'bg-orange-50 text-orange-700',
  eruv_manager:     'bg-purple-50 text-purple-700',
  city_admin:       'bg-red-50 text-red-700',
  dev:              'bg-zinc-800 text-zinc-100',
  super_admin:      'bg-yellow-50 text-yellow-700 font-bold',
};

// Roles a given actor can assign to others
const ASSIGNABLE_BY: Record<string, UserRole[]> = {
  super_admin: ['user', 'gabbai', 'business_manager', 'kosher_manager', 'mikveh_manager', 'event_manager', 'eruv_manager', 'city_admin', 'dev', 'super_admin'],
  city_admin:       ['user', 'gabbai', 'business_manager', 'kosher_manager', 'mikveh_manager', 'event_manager', 'eruv_manager'],
};

// Roles that are hidden from admin (city manager) — only super_admin sees them
const HIDDEN_FROM_ADMIN: UserRole[] = ['dev', 'super_admin'];

// ─── Add-user form ────────────────────────────────────────────────────────────

function AddUserModal({ open, onClose, onCreated, currentUserRole, currentCityId, cities }: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  currentUserRole: UserRole;
  currentCityId: string;
  cities: City[];
}) {
  const [email, setEmail]           = useState('');
  const [password, setPassword]     = useState('');
  const [displayName, setName]      = useState('');
  const [role, setRole]             = useState<UserRole>('gabbai');
  const [cityId, setCityId]         = useState(currentCityId);
  const [saving, setSaving]         = useState(false);
  const [error, setError]           = useState('');

  const isSuperAdmin = currentUserRole === 'super_admin';
  const assignable = ASSIGNABLE_BY[currentUserRole] ?? ASSIGNABLE_BY.city_admin;

  useEffect(() => { if (open) { setEmail(''); setPassword(''); setName(''); setRole('gabbai'); setCityId(currentCityId); setError(''); } }, [open]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!email || !password || !displayName) return;
    setSaving(true);
    setError('');
    try {
      await createUserWithRole({ email, password, displayName, role, cityId: isSuperAdmin ? cityId : currentCityId });
      onCreated();
      onClose();
    } catch (err: any) {
      setError(
        err.code === 'auth/email-already-in-use' ? 'כתובת אימייל כבר בשימוש'
        : err.code === 'auth/weak-password'      ? 'הסיסמה חלשה מדי (מינימום 6 תווים)'
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
          <label className={lbl}>סיסמה זמנית *</label>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={6} className={inp} placeholder="מינימום 6 תווים" />
        </div>
        <div className={isSuperAdmin ? 'grid grid-cols-2 gap-3' : ''}>
          <div>
            <label className={lbl}>תפקיד *</label>
            <select value={role} onChange={e => setRole(e.target.value as UserRole)} className={inp}>
              {assignable.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
            </select>
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
        </div>

        {error && <div className="bg-red-50 text-red-600 text-sm px-4 py-2.5 rounded-xl border border-red-100">{error}</div>}

        <div className="flex gap-3 pt-2">
          <button type="submit" disabled={saving || !email || !password || !displayName}
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

// Priority for computing the single `role` field kept for auth checks (mirrors the app)
const ROLE_PRIORITY: UserRole[] = [
  'super_admin', 'dev', 'city_admin', 'event_manager',
  'kosher_manager', 'mikveh_manager', 'eruv_manager', 'business_manager', 'gabbai', 'user',
];

function computePrimaryRole(roles: UserRole[]): UserRole {
  for (const r of ROLE_PRIORITY) {
    if (roles.includes(r)) return r;
  }
  return 'user';
}

type RoleDraft = {
  roles: UserRole[];
  managedSynagogueIds: string[];
  managedRestaurantIds: string[];
  cityId: string;
};

// Roles that require assigning specific managed items (mirrors the mobile app)
const LIST_ROLES = new Set<UserRole>(['gabbai', 'business_manager']);

type SubListState = { syn: boolean; rest: boolean };

function EditRoleModal({ open, user, onSave, onClose, currentUserRole, synagogues, businesses, cities }: {
  open: boolean;
  user: AppUser | null;
  onSave: (uid: string, draft: RoleDraft, primaryRole: UserRole, homeCityId: string) => Promise<void>;
  onClose: () => void;
  currentUserRole: UserRole;
  synagogues: Synagogue[];
  businesses: business[];
  cities: City[];
}) {
  const [draft, setDraft] = useState<RoleDraft>({ roles: ['user'], managedSynagogueIds: [], managedRestaurantIds: [], cityId: '' });
  const [subLists, setSubLists] = useState<SubListState>({ syn: false, rest: false });
  const [saving, setSaving] = useState(false);
  const assignable = ASSIGNABLE_BY[currentUserRole] ?? ASSIGNABLE_BY.city_admin;
  const isSuperAdmin = currentUserRole === 'super_admin';

  useEffect(() => {
    if (user) {
      const roles = user.roles ?? [user.role];
      setDraft({
        roles,
        managedSynagogueIds: user.managedSynagogueIds ?? [],
        managedRestaurantIds: user.managedRestaurantIds ?? [],
        cityId: user.cityId ?? '',
      });
      setSubLists({ syn: roles.includes('gabbai'), rest: roles.includes('business_manager') });
    }
  }, [user]);

  // Clicking a list-role chip while it still has assigned items must NOT silently
  // drop the role (that orphans the assignment with no visible trace) — it just
  // toggles the section open/closed instead. Only removes the role once it's empty.
  const toggleRole = (role: UserRole) => {
    const isListRole = LIST_ROLES.has(role);
    const wasOn = draft.roles.includes(role);

    if (isListRole && wasOn) {
      const hasItems = role === 'gabbai'
        ? draft.managedSynagogueIds.length > 0
        : draft.managedRestaurantIds.length > 0;
      if (hasItems) {
        const key = role === 'gabbai' ? 'syn' : 'rest';
        setSubLists(prev => ({ ...prev, [key]: !prev[key] }));
        return;
      }
    }

    setDraft(d => {
      const has = d.roles.includes(role);
      if (has && d.roles.length === 1) return { ...d, roles: ['user'] };
      return { ...d, roles: has ? d.roles.filter(r => r !== role) : [...d.roles, role] };
    });

    if (isListRole) {
      const key = role === 'gabbai' ? 'syn' : 'rest';
      setSubLists(prev => ({ ...prev, [key]: !wasOn }));
    }
  };

  const toggleSynagogue = (id: string) => setDraft(d => ({
    ...d,
    managedSynagogueIds: d.managedSynagogueIds.includes(id)
      ? d.managedSynagogueIds.filter(x => x !== id)
      : [...d.managedSynagogueIds, id],
  }));

  const toggleBusiness = (id: string) => setDraft(d => ({
    ...d,
    managedRestaurantIds: d.managedRestaurantIds.includes(id)
      ? d.managedRestaurantIds.filter(x => x !== id)
      : [...d.managedRestaurantIds, id],
  }));

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
    // The city picker above only assigns a city_admin's administrative scope —
    // it must not overwrite an existing manager's homeCityId when unrelated
    // role fields are being edited.
    const homeCityId = draft.roles.includes('city_admin')
      ? draft.cityId
      : (user.homeCityId ?? user.cityId);
    await onSave(user.uid, draft, computePrimaryRole(draft.roles), homeCityId);
    setSaving(false);
    onClose();
  };

  const citySynagogues = synagogues.filter(s => s.cityId === draft.cityId);
  const cityBusinesses = businesses.filter(b => b.cityId === draft.cityId);

  return (
    <Modal open={open} title="עריכת תפקידים" onClose={onClose} size="md">
      {user && (
        <>
          <div className="mb-5 p-3 bg-slate-50 rounded-xl">
            <div className="font-semibold text-slate-800">{user.displayName}</div>
            <div className="text-sm text-slate-400">{user.email}</div>
          </div>

          <div className="mb-5">
            <label className={lbl}>תפקידים (ניתן לבחור מספר)</label>
            <div className="flex flex-wrap gap-2">
              {assignable.map(r => {
                const active     = draft.roles.includes(r);
                const isListRole = LIST_ROLES.has(r);
                const itemCount  = r === 'gabbai' ? draft.managedSynagogueIds.length
                  : r === 'business_manager' ? draft.managedRestaurantIds.length : 0;
                const hasItems   = itemCount > 0;

                // Three states for list-roles: inactive / active-no-items (border only) / active-with-items (filled)
                const fullFill   = active && (!isListRole || hasItems);
                const borderOnly = active && isListRole && !hasItems;

                return (
                  <div key={r} className="relative">
                    <button type="button" onClick={() => toggleRole(r)}
                      className={`px-3 py-1.5 text-xs rounded-full border font-medium transition-colors ${
                        fullFill   ? 'bg-[#1B3A6B] text-white border-[#1B3A6B]'
                        : borderOnly ? 'border-2 border-[#1B3A6B] text-[#1B3A6B] bg-[#1B3A6B]/10'
                        : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                      }`}>
                      {ROLE_LABELS[r]}
                    </button>
                    {isListRole && active && hasItems && (
                      <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[9px] font-bold rounded-full min-w-[16px] h-4 flex items-center justify-center px-1 border border-white">
                        {itemCount}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
            {!draft.roles.some(r => assignable.includes(r)) && (
              <p className="text-xs text-amber-600 mt-1.5">
                אף אחד מהתפקידים הנוכחיים אינו ברשימה — שמירה תוריד את ההרשאות.
              </p>
            )}
          </div>

          {isSuperAdmin && draft.roles.includes('city_admin') && (
            <div className="mb-5">
              <label className={lbl}>עיר</label>
              <select value={draft.cityId} onChange={e => setDraft(d => ({ ...d, cityId: e.target.value }))} className={inp}>
                <option value="">— בחר עיר —</option>
                {cities.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          )}

          {draft.roles.includes('gabbai') && (
            <div className="mb-5">
              <button type="button" onClick={() => setSubLists(prev => ({ ...prev, syn: !prev.syn }))}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm font-semibold text-slate-700 hover:bg-slate-100">
                <span className="flex-1 text-right">בתי כנסת מנוהלים</span>
                <span className="text-xs font-normal text-slate-400">
                  {draft.managedSynagogueIds.length > 0 ? `${draft.managedSynagogueIds.length} נבחרו` : 'לא נבחר'}
                </span>
                {subLists.syn ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>
              {subLists.syn && (
                <div className="max-h-40 overflow-y-auto border border-t-0 border-slate-200 rounded-b-xl divide-y divide-slate-100">
                  {citySynagogues.length === 0 && <p className="text-xs text-slate-400 px-3 py-2">אין בתי כנסת בעיר זו</p>}
                  {citySynagogues.map(s => (
                    <label key={s.id} className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-slate-50">
                      <input type="checkbox" checked={draft.managedSynagogueIds.includes(s.id)}
                        onChange={() => toggleSynagogue(s.id)} className="w-4 h-4 accent-blue-600" />
                      {s.name}
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}

          {draft.roles.includes('business_manager') && (
            <div className="mb-5">
              <button type="button" onClick={() => setSubLists(prev => ({ ...prev, rest: !prev.rest }))}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm font-semibold text-slate-700 hover:bg-slate-100">
                <span className="flex-1 text-right">עסקים מנוהלים</span>
                <span className="text-xs font-normal text-slate-400">
                  {draft.managedRestaurantIds.length > 0 ? `${draft.managedRestaurantIds.length} נבחרו` : 'לא נבחר'}
                </span>
                {subLists.rest ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>
              {subLists.rest && (
                <div className="max-h-40 overflow-y-auto border border-t-0 border-slate-200 rounded-b-xl divide-y divide-slate-100">
                  {cityBusinesses.length === 0 && <p className="text-xs text-slate-400 px-3 py-2">אין עסקים בעיר זו</p>}
                  {cityBusinesses.map(b => (
                    <label key={b.id} className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-slate-50">
                      <input type="checkbox" checked={draft.managedRestaurantIds.includes(b.id)}
                        onChange={() => toggleBusiness(b.id)} className="w-4 h-4 accent-blue-600" />
                      {b.name}
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="flex gap-3">
            <button onClick={handleSave} disabled={saving}
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
  const { appUser } = useAuth();
  const isSuperAdmin = appUser?.role === 'super_admin';
  const isAdmin      = appUser?.role === 'city_admin' || isSuperAdmin;
  const { cityId = '' } = useParams<{ cityId: string }>();

  const [allUsers, setAllUsers]     = useState<AppUser[]>([]);
  const [cities, setCities]         = useState<City[]>([]);
  const [synagogues, setSynagogues] = useState<Synagogue[]>([]);
  const [businesses, setBusinesses] = useState<business[]>([]);
  const [loading, setLoading]       = useState(true);
  const [tab, setTab]               = useState<TabKey>('managers');
  const [addOpen, setAddOpen]       = useState(false);
  const [editUser, setEditUser]     = useState<AppUser | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      // super_admin loads all users; a city_admin is scoped to their permanent
      // homeCityId — never the URL's cityId, which is just whatever city they
      // (or the user being managed) happen to be personally browsing right now.
      const usersQuery = isSuperAdmin
        ? query(collection(db, 'users'))
        : query(collection(db, 'users'), where('homeCityId', '==', appUser?.homeCityId ?? ''));

      const [usersSnap, citiesSnap, synagoguesSnap, businessesSnap] = await Promise.all([
        getDocs(usersQuery),
        getDocs(collection(db, 'cities')),
        getDocs(collection(db, 'synagogues')),
        getDocs(collection(db, 'businesses')),
      ]);

      setAllUsers(usersSnap.docs.map(d => ({ uid: d.id, ...d.data() }) as AppUser));
      setCities(citiesSnap.docs.map(d => ({ id: d.id, ...d.data() }) as City));
      setSynagogues(synagoguesSnap.docs.map(d => ({ id: d.id, ...d.data() }) as Synagogue));
      setBusinesses(businessesSnap.docs.map(d => ({ id: d.id, ...d.data() }) as business));
    } catch (err) {
      console.error('Error loading users:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [appUser?.homeCityId, isSuperAdmin]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRoleSave = async (uid: string, draft: RoleDraft, primaryRole: UserRole, homeCityId: string) => {
    await updateDoc(doc(db, 'users', uid), {
      roles: draft.roles,
      role: primaryRole,
      managedSynagogueIds: draft.managedSynagogueIds,
      managedRestaurantIds: draft.managedRestaurantIds,
      cityId: draft.cityId,
      homeCityId,
    });
    setAllUsers(prev => prev.map(u => u.uid === uid
      ? { ...u, roles: draft.roles, role: primaryRole, managedSynagogueIds: draft.managedSynagogueIds, managedRestaurantIds: draft.managedRestaurantIds, cityId: draft.cityId, homeCityId }
      : u
    ));
  };

  // Partition users
  const devUsers      = allUsers.filter(u => u.role === 'dev' || u.role === 'super_admin');
  const visibleUsers  = isSuperAdmin
    ? allUsers.filter(u => u.role !== 'dev' && u.role !== 'super_admin')
    : allUsers.filter(u => !HIDDEN_FROM_ADMIN.includes(u.role));

  const managerUsers  = visibleUsers.filter(u => u.role !== 'user');
  const regularUsers  = visibleUsers.filter(u => u.role === 'user');

  const cityName = (cid: string) => cities.find(c => c.id === cid)?.name ?? cid;

  const columns = (showCity = false): Column<AppUser & { id: string }>[] => [
    { key: 'displayName', header: 'שם',     sortable: true },
    { key: 'email',       header: 'אימייל', sortable: true },
    {
      key: 'role', header: 'תפקידים',
      render: r => (
        <div className="flex flex-wrap gap-1">
          {(r.roles ?? [r.role]).map(role => (
            <span key={role} className={`text-xs px-2.5 py-1 rounded-full font-semibold ${ROLE_COLORS[role]}`}>{ROLE_LABELS[role]}</span>
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

  return (
    <div className="p-8" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">משתמשים</h1>
          <p className="text-slate-400 text-sm mt-0.5">{visibleUsers.length} משתמשים {isSuperAdmin ? 'במערכת' : 'בעיר'}</p>
        </div>
        {isAdmin && (
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
            <DataTable
              data={withId(managerUsers)}
              columns={columns(isSuperAdmin)}
              searchKeys={['displayName', 'email']}
              actions={row => isAdmin ? (
                <button onClick={() => setEditUser(row)} className="p-1.5 rounded-lg hover:bg-blue-50 text-slate-400 hover:text-blue-600 transition-colors">
                  <Pencil size={14} />
                </button>
              ) : null}
            />
          )}
          {tab === 'regular' && (
            <DataTable
              data={withId(regularUsers)}
              columns={columns(isSuperAdmin)}
              searchKeys={['displayName', 'email']}
              actions={row => isAdmin ? (
                <button onClick={() => setEditUser(row)} className="p-1.5 rounded-lg hover:bg-blue-50 text-slate-400 hover:text-blue-600 transition-colors">
                  <Pencil size={14} />
                </button>
              ) : null}
            />
          )}
          {tab === 'dev' && isSuperAdmin && (
            <div>
              <div className="flex items-center gap-2 mb-4 text-sm text-zinc-500">
                <Shield size={14} /> משתמשים אלו מוסתרים ממנהלי ערים
              </div>
              <DataTable
                data={withId(devUsers)}
                columns={columns(true)}
                searchKeys={['displayName', 'email']}
                actions={row => (
                  <button onClick={() => setEditUser(row)} className="p-1.5 rounded-lg hover:bg-blue-50 text-slate-400 hover:text-blue-600 transition-colors">
                    <Pencil size={14} />
                  </button>
                )}
              />
            </div>
          )}
        </>
      )}

      {/* Add user */}
      <AddUserModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onCreated={load}
        currentUserRole={appUser?.role ?? 'city_admin'}
        currentCityId={appUser?.homeCityId ?? cityId}
        cities={cities}
      />

      {/* Edit role */}
      <EditRoleModal
        open={!!editUser}
        user={editUser}
        onSave={handleRoleSave}
        onClose={() => setEditUser(null)}
        currentUserRole={appUser?.role ?? 'city_admin'}
        synagogues={synagogues}
        businesses={businesses}
        cities={cities}
      />
    </div>
  );
}

const inp = 'w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 bg-white';
const lbl = 'block text-xs font-semibold text-slate-600 mb-1.5';
