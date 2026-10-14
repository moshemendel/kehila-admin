import { collection, addDoc, Timestamp } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import app, { db } from '../firebase';

const callSendPush = httpsCallable<
  Record<string, unknown>,
  { targeted: number; sent: number; failReasons: string[] }
>(getFunctions(app, 'europe-west1'), 'sendPush');

export type PushChannel = 'eruv' | 'general';

interface SendOptions {
  cityId: string;
  cityName: string;
  title: string;
  body: string;
  channel: PushChannel;
  roles?: string[] | null; // null = all roles in channel
  sentBy: string;
  auto?: boolean;
  data?: Record<string, unknown>; // extra payload — e.g. { screen: 'Eruv' }
  /**
   * Narrows the send to devices whose owner's homeAreaId is one of these —
   * a regional council's settlement(s), typically. A device with no
   * homeAreaId on record is skipped when this is set, rather than guessed
   * at. Omit (or leave undefined) to send city-wide, as before.
   */
  areaIds?: string[] | null;
}

/**
 * Fetch tokens, send via Expo Push, log to sentNotifications.
 * Returns the number of devices the push was successfully queued for.
 * Stale tokens (DeviceNotRegistered) are removed from Firestore automatically.
 */
export async function sendPush(opts: SendOptions): Promise<number> {
  const { cityId, cityName, title, body, channel, roles = null, sentBy, auto = false, data, areaIds = null } = opts;

  // Sent by the sendPush Cloud Function: the browser cannot POST to exp.host
  // (no CORS headers), and the function does the pushTokens lookup too.
  const res = await callSendPush({
    cityId, title, body, roles, areaIds,
    data: data ?? undefined,
    excludeGuests: channel === 'general',
    channelId: 'default', // Android requires explicit channel
  });
  const { targeted, sent: okCount, failReasons } = res.data;

  if (targeted === 0) return 0;

  // All tokens failed — surface a useful error instead of "no devices found"
  if (okCount === 0 && failReasons.length > 0) {
    const reasons = [...new Set(failReasons)].join(', ');
    throw new Error(`כל ה-${targeted} טוקנים נכשלו (${reasons}). פתח את האפליקציה כדי לרשום מחדש.`);
  }

  await addDoc(collection(db, 'sentNotifications'), {
    cityId, cityName, channel, roles,
    title, body,
    recipientCount: okCount,
    sentAt: Timestamp.now(),
    sentBy,
    auto,
  });

  return okCount;
}

/**
 * Builds and sends the standard eruv status push for one eruv. `label` and
 * `areaIds` come from that eruv's own EruvStatus document — on a tenant with
 * only one eruv, label is normally unset and areaIds covers the whole city,
 * so this behaves exactly as it did before those fields existed. On a
 * regional council with several, passing them is what keeps a settlement's
 * eruv going down from paging every resident of the other 21.
 */
export async function sendEruvStatusPush(
  cityId: string,
  cityName: string,
  status: 'valid' | 'invalid' | 'unknown',
  sentBy: string,
  areaIds?: string[] | null,
  label?: string | null,
): Promise<number> {
  if (status === 'unknown') return 0;

  const name = label || cityName;
  const title = status === 'valid'
    ? `✅ עירוב ${name}`
    : `⚠️ עירוב ${name}`;

  const body = status === 'valid'
    ? 'העירוב כשר — מותר לשאת ברשות הרבים'
    : 'העירוב פסול — אין לשאת ברשות הרבים';

  return sendPush({ cityId, cityName, title, body, channel: 'eruv', sentBy, auto: true, data: { screen: 'Eruv' }, areaIds });
}
