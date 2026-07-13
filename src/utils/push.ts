import {
  collection, query, where, getDocs, addDoc, deleteDoc, doc, Timestamp,
} from 'firebase/firestore';
import { db } from '../firebase';

// In dev the Vite proxy avoids CORS; in prod call Expo directly.
const EXPO_PUSH_URL = import.meta.env.DEV
  ? '/api/expo-push'
  : 'https://exp.host/--/api/v2/push/send';

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
}

interface ExpoTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

/**
 * Fetch tokens, send via Expo Push, log to sentNotifications.
 * Returns the number of devices the push was successfully queued for.
 * Stale tokens (DeviceNotRegistered) are removed from Firestore automatically.
 */
export async function sendPush(opts: SendOptions): Promise<number> {
  const { cityId, cityName, title, body, channel, roles = null, sentBy, auto = false, data } = opts;

  const col  = collection(db, 'pushTokens');
  const snap = cityId === 'all'
    ? await getDocs(col)
    : await getDocs(query(col, where('cityId', '==', cityId)));

  // Map token → Firestore doc id (so we can remove stale tokens)
  const entries = snap.docs
    .filter(d => {
      const data       = d.data();
      const singleRole = data.role as string;
      const allRoles   = (data.roles as string[] | undefined) ?? [singleRole];
      if (channel === 'general' && singleRole === 'guest') return false;
      return !roles || allRoles.some(r => roles.includes(r));
    })
    .map(d => ({ docId: d.id, token: d.data().token as string }))
    .filter(e => Boolean(e.token));

  if (entries.length === 0) return 0;

  const tokens = entries.map(e => e.token);
  let okCount   = 0;
  const failReasons: string[] = [];

  for (let i = 0; i < tokens.length; i += 100) {
    const chunkTokens  = tokens.slice(i, i + 100);
    const chunkEntries = entries.slice(i, i + 100);

    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(
        chunkTokens.map(to => ({
          to, title, body, sound: 'default',
          channelId: 'default', // Android requires explicit channel
          ...(data ? { data } : {}),
        })),
      ),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`Expo push HTTP error ${res.status}: ${text}`);
    }

    // Expo always returns 200. Real results are in response body.
    const json = await res.json() as { data: ExpoTicket[] };
    const tickets: ExpoTicket[] = json.data ?? [];

    tickets.forEach((ticket, idx) => {
      if (ticket.status === 'ok') {
        okCount++;
      } else {
        const err = ticket.details?.error ?? ticket.message ?? 'UnknownError';
        failReasons.push(err);
        if (err === 'DeviceNotRegistered') {
          // Token expired/uninstalled — remove from Firestore silently
          const docId = chunkEntries[idx]?.docId;
          if (docId) deleteDoc(doc(db, 'pushTokens', docId)).catch(() => {});
        }
        console.warn('[Push] ticket error:', ticket.message, ticket.details);
      }
    });
  }

  // All tokens failed — surface a useful error instead of "no devices found"
  if (okCount === 0 && failReasons.length > 0) {
    const reasons = [...new Set(failReasons)].join(', ');
    throw new Error(`כל ה-${entries.length} טוקנים נכשלו (${reasons}). פתח את האפליקציה כדי לרשום מחדש.`);
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

/** Builds and sends the standard eruv status push for a city. */
export async function sendEruvStatusPush(
  cityId: string,
  cityName: string,
  status: 'valid' | 'invalid' | 'unknown',
  sentBy: string,
): Promise<number> {
  if (status === 'unknown') return 0;

  const title = status === 'valid'
    ? `✅ עירוב ${cityName}`
    : `⚠️ עירוב ${cityName}`;

  const body = status === 'valid'
    ? 'העירוב כשר — מותר לשאת ברשות הרבים'
    : 'העירוב פסול — אין לשאת ברשות הרבים';

  return sendPush({ cityId, cityName, title, body, channel: 'eruv', sentBy, auto: true, data: { screen: 'Eruv' } });
}
