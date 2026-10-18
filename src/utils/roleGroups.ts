/**
 * "All the gabbaim" means the per-shul gabbai AND the account that holds every
 * shul (synagogue_manager) — both run synagogues and both are who a message about
 * prayer times is for. Likewise the mikveh attendants and the account over all
 * mikvaot. Used to pick both at once in the users filter and the notification
 * audience; each member is still an ordinary role chip on its own.
 */
export const ROLE_GROUPS: { label: string; roles: string[] }[] = [
  { label: 'כל הגבאים',    roles: ['gabbai', 'synagogue_manager'] },
  { label: 'כל הבלנים',    roles: ['mikveh_attendant', 'mikveh_manager'] },
  { label: 'כל המשגיחים',  roles: ['mashgiach', 'kosher_manager'] },
];
