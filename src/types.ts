export type GemachCategory =
  | 'clothing' | 'baby' | 'medical' | 'food' | 'books'
  | 'wedding' | 'household' | 'tools' | 'other';

export interface Gemach {
  id: string;
  cityId: string;
  name: string;
  category: GemachCategory;
  description?: string;
  neighborhood?: string;
  contactName?: string;
  phone?: string;
  hours?: string;
  isActive: boolean;
  createdAt: any;
  createdBy?: string; // the original submitter — can edit/delete their own gemach
}

export interface PendingGemach {
  id: string;
  cityId: string;
  name: string;
  category: GemachCategory;
  description?: string;
  neighborhood?: string;
  contactName: string;
  phone: string;
  hours?: string;
  submittedBy?: string;
  submittedByName?: string;
  submittedAt: any;
  status: 'pending' | 'approved' | 'rejected';
}

/**
 * A role key. Deliberately not a union here: the authoritative list lives in the
 * app repo (src/utils/roleCatalogue.json, which owns firestore.rules with it)
 * and reaches this console at runtime via config/roles — see
 * utils/roleCatalogue.ts. A union in this file could only ever be a second copy,
 * and the second copy is what went stale and locked content_admin out.
 */
export type UserRole = string;

export interface AppUser {
  uid: string;
  email: string;
  displayName: string;
  cityId: string;
  // The city this account actually administers (for manager roles) — separate from
  // cityId, which is just a personal "what city am I browsing" preference in the
  // mobile app that anyone (including managers) can freely switch without affecting
  // their admin scope here in the dashboard.
  homeCityId?: string;
  role: UserRole;
  roles?: UserRole[];
  managedSynagogueIds?: string[];
  managedRestaurantIds?: string[];
}

export interface NusachOption {
  key: string;
  label: string;
}

export interface City {
  id: string;
  name: string;
  country: string;
  timezone: string;
  latitude: number;
  longitude: number;
  elevation?: number; // meters above sea level — used for daily mountain-angle terrain scan
  nusachOptions?: NusachOption[];
  neighborhoods?: string[];
  /**
   * Which parts of the app this city runs. Mirrors src/utils/modules.ts in the
   * mobile app: absent means live, so the document records only exceptions.
   */
  modules?: CityModules;
}

/**
 * A city can hold a section back or not offer it at all, and those are
 * different things — 'soon' keeps the entry point visible with an explanation,
 * 'off' removes it from the tabs, the shortcuts, the More screen and search.
 * Absent means live.
 */
// Deliberately a plain string, not a union restated from the app.
//
// The app owns the list — a module is a screen, and only its source can say
// which exist — and publishes it to config/modules, which the console renders
// from. A union here would be a second copy that drifts, and the console would
// then offer switches writing keys the app ignores: saved successfully, doing
// nothing, with nothing to say so.
export type ModuleKey = string;

export type ModuleState = 'live' | 'soon' | 'off';

export type CityModules = Partial<Record<ModuleKey, ModuleState>>;

export type NusachType = string[];

export type ZmanimAnchor = 'netz' | 'shkia' | 'tzeit' | 'chatzot' | 'plagHamincha' | 'minchaGedola' | 'minchaKetana';

export interface PrayerTimeSlot {
  time: string;           // "HH:MM" for fixed; empty string for anchor-relative
  anchor?: ZmanimAnchor;
  offsetMin?: number;     // minutes after anchor (negative = before)
  proportional?: boolean; // if true, offsetMin is in sha'ot zmaniyot / 60 units
  days?: number[];
  /** Specific dates "YYYY-MM-DD"; when non-empty the slot happens only on those
   *  and `days` is ignored. See kehila-app/src/types/index.ts for rationale. */
  dates?: string[];        // 1=Sun … 6=Fri (7=Shabbat only in shabbat schedule)
  notes?: string | null;
}

export interface WeeklySchedule {
  shacharit: PrayerTimeSlot[];
  mincha:    PrayerTimeSlot[];
  maariv:    PrayerTimeSlot[];
  /** Selichot minyanim — optional; see kehila-app/src/types/index.ts for why
   *  these are ordinary weekday slots rather than a seasonal structure. */
  selichot?: PrayerTimeSlot[];
  notes?: string;
}

export interface ShabbatSchedule {
  minchaFriday?: PrayerTimeSlot[];
  shacharit?:    PrayerTimeSlot[];
  mincha?:       PrayerTimeSlot[];
  maariv?:       PrayerTimeSlot[];
  notes?: string;
}

export interface Shiur {
  id: string;
  title: string;
  rabbi: string;
  days: number[] | 'daily';
  time: string;
  description?: string;
}

export type SynagogueEventCategory = 'shiur' | 'community' | 'youth' | 'charity' | 'holiday' | 'announcement' | 'alert';

export interface SynagogueAnnouncement {
  id: string;
  title: string;
  description: string;
  category: SynagogueEventCategory;
  startDate: string;
  location?: string;
  isAlert: boolean;
  createdAt: string;
}

export interface Synagogue {
  /** Which custom decides when this shul's selichot begin — re-derived yearly.
   *  See kehila-app/src/types/index.ts. */
  selichotCustom?: 'sephardi' | 'ashkenazi';
  id: string;
  cityId: string;
  name: string;
  nusach: NusachType;
  neighborhood?: string;
  address: { he?: string; en?: string };
  phone?: string;
  rabbi?: string;
  rabbiPhone?: string;
  gabbaiName?: string;
  gabbaiPhone?: string;
  gabbaim?: { name: string; phone?: string }[];
  latitude?: number;
  longitude?: number;
  notes?: string;
  weeklySchedule: WeeklySchedule;
  shabbatSchedule?: ShabbatSchedule;
  shiurim?: Shiur[];
  synagogueEvents?: SynagogueAnnouncement[];
  updatedAt?: Date;
}

export type MikvehType = 'women' | 'men' | 'both';

export interface OpeningHours {
  sunday?: string; monday?: string; tuesday?: string;
  wednesday?: string; thursday?: string; friday?: string; saturday?: string;
}

export type DayKey = 'sunday' | 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday';

// One opening-hours block: a time range that applies to a chosen set of days.
// A day can appear in more than one block (e.g. split morning/evening hours).
// Each boundary can independently be a fixed clock time or anchor-relative
// (e.g. "shkia -30"), mirroring PrayerTimeSlot's anchor/offsetMin/proportional
// convention: the string field ('start'/'end') is '' when the corresponding
// anchor field is set.
export interface HoursBlock {
  id: string;
  days: DayKey[];
  start: string; // "HH:MM"; '' when startAnchor is set
  end: string;   // "HH:MM"; '' when endAnchor is set
  startAnchor?: ZmanimAnchor;
  startOffsetMin?: number;
  startProportional?: boolean;
  endAnchor?: ZmanimAnchor;
  endOffsetMin?: number;
  endProportional?: boolean;
}

// Appointment-specific settings only — the actual schedule lives on Mikveh.hoursSchedule.
export interface AppointmentConfig {
  slotDurationMin: number;
  parallelTracks: number; // concurrent prep rooms/tracks allowed to overlap; default 1
  prepMultiplier: number; // how many base slots a "prep at mikveh" appointment spans (2 or 3); default 2
}

export interface Mikveh {
  id: string;
  cityId: string;
  name: string;
  type: MikvehType;
  neighborhood?: string;
  address: string;
  phone?: string;
  hoursSchedule?: HoursBlock[]; // opening hours — also used to generate appointment slots
  requiresAppointment: boolean;
  appointmentPhone?: string;
  appointmentConfig?: AppointmentConfig;
  contacts?: { name: string; phone?: string }[];
  notes?: string;
  latitude?: number;
  longitude?: number;
  updatedAt?: Date;
}

export type KosherLevel = 'mehadrin' | 'regular' | 'chalav_israel' | 'bishul_israel' | 'glatt';

export interface KosherCertificate {
  id: string;
  issuedBy: string;
  kosherLevel: KosherLevel[];
  validFrom: string;
  validUntil: string;
  isActive: boolean;
  notes?: string;
}

// Mirrors kehila-app's KashrutUpdate — same collection (kashrutUpdates), feeds the
// mobile app's "עדכוני כשרות" screen.
export interface KashrutUpdate {
  id: string;
  cityId: string;
  businessId: string;
  businessName: string;
  direction: 'up' | 'down';
  certType?: 'local_rabbanut' | 'badatz';
  tags: string[];
  note?: string;
  createdAt: any;
  expiresAt?: any;
}

export interface business {
  id: string;
  cityId: string;
  name: string;
  category: string;
  categories?: string[];
  neighborhood?: string;
  address: string;
  phone?: string;
  website?: string;
  description?: string;
  openingHours: OpeningHours;
  kosherCertificates: KosherCertificate[];
  contacts?: { name: string; phone?: string }[];
  latitude?: number;
  longitude?: number;
  isHidden?: boolean;
  imageUrl?: string;
  images?: string[];
  updatedAt?: Date;
}

export type EventCategory = 'shiur' | 'community' | 'youth' | 'charity' | 'holiday' | 'announcement' | 'alert';

export interface CommunityEvent {
  id: string;
  cityId: string;
  title: string;
  description: string;
  category: EventCategory;
  startDate: string;
  endDate?: string;
  location?: string;
  neighborhood?: string;
  organizer?: string;
  synagogueId?: string;
  isAlert: boolean;
  createdBy: string;
  createdAt: Date;
}

export interface PendingCommunityEvent {
  id: string;
  cityId: string;
  synagogueId?: string;
  synagogueName?: string;
  submittedBy: string;
  submittedByName?: string;
  submittedAt: unknown;
  status: 'pending' | 'approved' | 'rejected';
  title: string;
  description: string;
  category: EventCategory;
  startDate: string;
  endDate?: string;
  location?: string;
  organizer?: string;
  isAlert: boolean;
}

// ── Content reports — users flagging wrong info on a public listing ──────────
// Mirrors kehila-app/src/types/index.ts — keep the two in sync.

export type ReportEntityType = 'synagogue' | 'business' | 'mikveh' | 'event' | 'gemach';

export type ReportReason =
  | 'wrong_hours'
  | 'wrong_contact'
  | 'wrong_location'
  | 'closed'
  | 'wrong_details'
  | 'other';

export interface ContentReport {
  id: string;
  cityId: string;
  entityType: ReportEntityType;
  entityId: string;
  entityName: string;
  reason: ReportReason;
  details?: string;
  userId: string;
  userName?: string;
  status: 'open' | 'resolved' | 'dismissed';
  handledBy?: string;
  handledAt?: unknown;
  createdAt?: { seconds: number } | null;
}
