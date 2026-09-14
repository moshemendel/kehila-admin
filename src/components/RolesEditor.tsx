import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { UserRole } from '../types';
import {
  type Catalogue, type RoleEntry, type AssignmentField, type RoleDraft, type CityItems,
} from '../utils/roleLogic';
import Modal from './Modal';

/**
 * The one roles picker, for creating an account and for editing one.
 *
 * They used to differ: creation offered a single-choice <select>, editing a
 * multi-select of pills — so a gabbai who was also a kosher_manager could only
 * be made in two steps, and a gabbai could be created with no synagogue at
 * all, which is a role that grants nothing and looks like it grants something.
 *
 * What it expresses, all read from the catalogue rather than listed here:
 *
 *   ROWS BY TIER      city authority, then domain managers, then per-object
 *                     operators (global roles above, super_admin only). The
 *                     hierarchy is the layout.
 *   COVERED ROLES     greyed, not cleared — בכלל מאתיים מנה. A city_admin
 *                     already reaches every synagogue; ticking gabbai for them
 *                     changes nothing, so it is shown as already included. Same
 *                     one tier down: a synagogue_manager covers gabbai. Greyed
 *                     rather than removed so demoting them out of the covering
 *                     role brings back what they held underneath.
 *   NO "USER" PILL    every manager is also a user; an empty selection IS the
 *                     ordinary member, and the save layer writes it as such.
 *   REQUIRED ITEMS    a role with `manages` must have at least one item before
 *                     the form may be saved. missingAssignments() is the check;
 *                     the pill and the list both show the gap.
 *   WHAT THE ACTOR MAY GRANT
 *                     cat.grantableBy(actorRoles). A domain manager sees only
 *                     their own tier-3 children as live choices; anything else
 *                     the account holds is shown read-only, so they see the
 *                     whole picture and can change only their part — which is
 *                     exactly what the delegation rule will accept.
 */

const TIER_LABEL: Record<RoleEntry['tier'], string> = {
  0: 'גלובלי', 1: 'ניהול העיר', 2: 'מנהלי תחום', 3: 'מפעילים',
};
const LIST_TITLE: Record<NonNullable<RoleEntry['manages']>, string> = {
  synagogues: 'בתי כנסת', businesses: 'עסקים', mikvaot: 'מקוואות',
};
const LIST_EMPTY: Record<NonNullable<RoleEntry['manages']>, string> = {
  synagogues: 'אין בתי כנסת בעיר זו', businesses: 'אין עסקים בעיר זו', mikvaot: 'אין מקוואות בעיר זו',
};

export default function RolesEditor({ cat, draft, onChange, actorRoles, items }: {
  cat: Catalogue;
  draft: RoleDraft;
  onChange: (d: RoleDraft) => void;
  actorRoles: UserRole[];
  /** Already filtered to the city the account belongs to. */
  items: CityItems;
}) {
  const [openLists, setOpenLists] = useState<Partial<Record<AssignmentField, boolean>>>({});
  // The role pending confirmation before its removal actually applies — see
  // toggleRole. A styled Modal, not window.confirm(): every other destructive
  // action in this app (delete synagogue, delete gemach, …) confirms this way,
  // and a native browser dialog was the one thing here that didn't match.
  const [pendingRemoval, setPendingRemoval] = useState<RoleEntry | null>(null);

  const grantable   = cat.grantableBy(actorRoles).filter((r) => r.key !== 'user');
  const grantableKs = new Set(grantable.map((r) => r.key));
  const subsumed    = cat.subsumedBy(draft.roles);
  const coveredBy   = (key: UserRole): string => {
    // The highest-priority held role that covers this one, for the tooltip.
    const entry = cat.byKey(key);
    const byParent = entry?.parent && draft.roles.includes(entry.parent) ? entry.parent : undefined;
    const top = cat.roles.find((r) => draft.roles.includes(r.key) && r.blanket)?.key;
    return cat.labelOf(byParent ?? top ?? key);
  };
  // Held roles the actor may not change — shown, not offered.
  const readOnly = draft.roles.filter((r) => !grantableKs.has(r));

  const toggleRole = (entry: RoleEntry) => {
    const wasOn = draft.roles.includes(entry.key);
    // Clicking an active list-role that still has items used to just toggle
    // the (already-open-by-default) list open/closed instead of removing the
    // role — silently, with nothing on screen explaining why the pill
    // "wouldn't turn off". A city_admin appointing gabbai/attendant/mashgiach
    // could dismiss one only by first unchecking every item below, one at a
    // time, with no indication that was the required step. Reported as "אני
    // מנסה לבטל משתמש מלהיות בלן וזה לא נותן" against exactly this button.
    //
    // Now the pill removes the role directly — after one confirm, since doing
    // so also clears the assignment array in the same stroke. That pairing is
    // still required, not just convenient: a role dropped from `roles` while
    // its array keeps its old contents is an orphan — re-adding the role
    // later would silently restore an assignment (a mikveh, say) nobody
    // meant to still associate with this account.
    if (wasOn && entry.field && draft[entry.field].length > 0) {
      setPendingRemoval(entry);
      return;
    }
    onChange({ ...draft, roles: wasOn ? draft.roles.filter((r) => r !== entry.key) : [...draft.roles, entry.key] });
    if (entry.field) setOpenLists((o) => ({ ...o, [entry.field!]: !wasOn }));
  };

  const confirmRemoval = () => {
    if (!pendingRemoval?.field) return;
    onChange({ ...draft, roles: draft.roles.filter((r) => r !== pendingRemoval.key), [pendingRemoval.field]: [] });
    setPendingRemoval(null);
  };

  const toggleItem = (field: AssignmentField, id: string) => {
    const cur = draft[field];
    onChange({ ...draft, [field]: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] });
  };

  const tiers = ([0, 1, 2, 3] as const).map((t) => ({ tier: t, roles: grantable.filter((r) => r.tier === t) }))
    .filter((g) => g.roles.length > 0);

  // One list per active, editable, uncovered list-role — in catalogue order.
  const lists = grantable.filter((r) =>
    r.manages && r.field && draft.roles.includes(r.key) && !subsumed.has(r.key));

  const itemsFor = (manages: NonNullable<RoleEntry['manages']>): { id: string; name: string }[] =>
    manages === 'synagogues' ? items.synagogues
    : manages === 'businesses' ? items.businesses
    : items.mikvaot;

  return (
    <div className="flex flex-col gap-4">
      {tiers.map(({ tier, roles }) => (
        <div key={tier}>
          <div className="text-[11px] font-semibold text-slate-400 mb-1.5">{TIER_LABEL[tier]}</div>
          <div className="flex flex-wrap gap-2">
            {roles.map((entry) => {
              const active  = draft.roles.includes(entry.key);
              const covered = subsumed.has(entry.key);
              const needs   = !!entry.field;
              const count   = entry.field ? draft[entry.field].length : 0;
              const missing = active && needs && !covered && count === 0;
              const cls = covered
                ? 'border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed line-through decoration-slate-300'
                : missing
                ? 'border-2 border-red-400 text-red-700 bg-red-50'
                : active
                ? 'bg-[#1B3A6B] text-white border-[#1B3A6B]'
                : 'border-slate-200 text-slate-600 hover:bg-slate-50';
              return (
                <div key={entry.key} className="relative">
                  <button type="button" disabled={covered} onClick={() => toggleRole(entry)}
                    title={covered ? `כלול בתפקיד ${coveredBy(entry.key)}` : undefined}
                    className={`px-3 py-1.5 text-xs rounded-full border font-medium transition-colors ${cls}`}>
                    {entry.label}
                  </button>
                  {active && needs && !covered && count > 0 && (
                    <span className="absolute -top-1.5 -right-1.5 bg-[#1B3A6B] text-white text-[9px] font-bold rounded-full min-w-[16px] h-4 flex items-center justify-center px-1 border border-white">
                      {count}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {readOnly.length > 0 && (
        <div>
          <div className="text-[11px] font-semibold text-slate-400 mb-1.5">תפקידים נוספים (לא ניתנים לשינוי על ידך)</div>
          <div className="flex flex-wrap gap-2">
            {readOnly.map((r) => (
              <span key={r} className="px-3 py-1.5 text-xs rounded-full border border-dashed border-slate-300 text-slate-500 bg-slate-50">
                {cat.labelOf(r)}
              </span>
            ))}
          </div>
        </div>
      )}

      {draft.roles.length === 0 && (
        <p className="text-xs text-slate-400">ללא תפקיד — משתמש רגיל.</p>
      )}

      {lists.map((entry) => {
        const field = entry.field!;
        const manages = entry.manages!;
        const chosen = draft[field];
        const open = openLists[field] ?? true;
        const all = itemsFor(manages);
        return (
          <div key={field}>
            <button type="button" onClick={() => setOpenLists((o) => ({ ...o, [field]: !open }))}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-xl border text-sm font-semibold hover:bg-slate-100 ${
                chosen.length === 0 ? 'border-red-300 bg-red-50 text-red-700' : 'border-slate-200 bg-slate-50 text-slate-700'}`}>
              <span className="flex-1 text-right">{LIST_TITLE[manages]} — {entry.label}</span>
              <span className={`text-xs font-normal ${chosen.length === 0 ? 'text-red-600' : 'text-slate-400'}`}>
                {chosen.length > 0 ? `${chosen.length} נבחרו` : 'חובה לבחור לפחות אחד'}
              </span>
              {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
            {open && (
              <div className="max-h-40 overflow-y-auto border border-t-0 border-slate-200 rounded-b-xl divide-y divide-slate-100">
                {all.length === 0 && <p className="text-xs text-slate-400 px-3 py-2">{LIST_EMPTY[manages]}</p>}
                {all.map((it) => (
                  <label key={it.id} className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-slate-50">
                    <input type="checkbox" checked={chosen.includes(it.id)} onChange={() => toggleItem(field, it.id)}
                      className="w-4 h-4 accent-blue-600" />
                    {it.name}
                  </label>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {/* Confirm before a role removal that also clears its assignment —
          styled to match every other destructive confirm in this app
          (delete synagogue, delete gemach, …), not a native browser dialog. */}
      <Modal open={!!pendingRemoval} title="הסרת תפקיד" onClose={() => setPendingRemoval(null)} size="md">
        {pendingRemoval && (
          <>
            <p className="text-sm text-slate-600 mb-6">
              הסרת התפקיד "{pendingRemoval.label}" תבטל גם את השיוך ל-
              {pendingRemoval.field ? draft[pendingRemoval.field].length : 0}{' '}
              {pendingRemoval.manages ? LIST_TITLE[pendingRemoval.manages] : ''}.
              ניתן למנות מחדש בהמשך, אך יהיה צורך לבחור את השיוך שוב.
            </p>
            <div className="flex gap-3">
              <button onClick={confirmRemoval}
                className="flex-1 bg-red-500 text-white py-2.5 rounded-xl font-semibold text-sm hover:bg-red-600">
                הסר תפקיד
              </button>
              <button onClick={() => setPendingRemoval(null)}
                className="px-5 py-2.5 border border-slate-200 rounded-xl text-sm hover:bg-slate-50">
                ביטול
              </button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
