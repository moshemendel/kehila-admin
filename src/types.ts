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

export type UserRole =
  | 'user' | 'gabbai' | 'business_manager' | 'kosher_manager' | 'mikveh_manager'
  | 'event_manager' | 'eruv_manager' | 'city_admin' | 'dev' | 'super_admin';

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
}

export type NusachType = string[];

export type ZmanimAnchor = 'netz' | 'shkia' | 'chatzot' | 'plagHamincha' | 'minchaGedola' | 'minchaKetana';

export interface PrayerTimeSlot {
  time: string;           // "HH:MM" for fixed; empty string for anchor-relative
  anchor?: ZmanimAnchor;
  offsetMin?: number;     // minutes after anchor (negative = before)
  proportional?: boolean; // if true, offsetMin is in sha'ot zmaniyot / 60 units
  days?: number[];        // 1=Sun … 6=Fri (7=Shabbat only in shabbat schedule)
  notes?: string | null;
}

export interface WeeklySchedule {
  shacharit: PrayerTimeSlot[];
  mincha:    PrayerTimeSlot[];
  maariv:    PrayerTimeSlot[];
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

export interface Mikveh {
  id: string;
  cityId: string;
  name: string;
  type: MikvehType;
  neighborhood?: string;
  address: string;
  phone?: string;
  openingHours: OpeningHours;
  requiresAppointment: boolean;
  appointmentPhone?: string;
  appointmentConfig?: AppointmentConfig;
  contacts?: { name: string; phone?: string }[];
  notes?: string;
  latitude?: number;
  longitude?: number;
  updatedAt?: Date;
}

export type DayKey = 'sunday' | 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday';
export interface DaySlotConfig { enabled: boolean; start: string; end: string; }
export interface AppointmentConfig { slotDurationMin: number; schedule: Partial<Record<DayKey, DaySlotConfig>>; }

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
