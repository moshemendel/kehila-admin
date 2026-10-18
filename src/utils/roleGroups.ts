/**
 * The hands-on roles — the ones an account is appointed to by a domain manager
 * (a gabbai of one shul, a mikveh attendant, a mashgiach) — are listed apart from
 * the managers over them, and named in the plural for a list of people. A manager
 * such as synagogue_manager is a different role even though it covers every
 * shul: it is never folded into "the gabbaim".
 */
export const FIELD_ROLE_PLURAL: Record<string, string> = {
  gabbai: 'גבאים',
  mikveh_attendant: 'בלנים',
  mashgiach: 'משגיחים',
};

export const isFieldRole = (key: string) => key in FIELD_ROLE_PLURAL;
export const fieldRoleLabel = (key: string, fallback: string) => FIELD_ROLE_PLURAL[key] ?? fallback;
