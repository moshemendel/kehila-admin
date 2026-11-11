import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { storage } from '../firebase';
import { nanoid } from './nanoid';

export const LOGO_MAX_BYTES = 5 * 1024 * 1024;
/** Longest edge of the stored logo. It is drawn at <=90px (x3 density) in the app. */
const MAX_EDGE = 512;
const ACCEPTED = ['image/png', 'image/jpeg', 'image/webp'];

/** Hebrew error for a file that must not be uploaded, or null when it is fine. */
export function validateLogoFile(file: File): string | null {
  if (!ACCEPTED.includes(file.type)) return 'סוג הקובץ אינו נתמך. יש לבחור תמונה בפורמט PNG, JPG או WebP.';
  if (file.size > LOGO_MAX_BYTES) return 'הקובץ גדול מדי. הגודל המרבי הוא 5MB.';
  return null;
}

/**
 * Resizes to MAX_EDGE and re-encodes. PNG and WebP stay PNG so transparency
 * survives (the app draws the logo on a white disc and the emblems are
 * transparent); only a JPEG, which has no alpha to lose, goes back out as JPEG.
 */
async function reencode(file: File): Promise<{ blob: Blob; ext: 'png' | 'jpg' }> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas');
  const jpeg = file.type === 'image/jpeg';
  if (jpeg) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); }
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const blob: Blob | null = await new Promise(res =>
    canvas.toBlob(res, jpeg ? 'image/jpeg' : 'image/png', 0.9));
  if (!blob) throw new Error('encode');
  return { blob, ext: jpeg ? 'jpg' : 'png' };
}

/** Uploads to cities/{cityId}/logo/<unique>.<ext> and returns the download URL. */
export async function uploadCityLogo(cityId: string, file: File): Promise<string> {
  const { blob, ext } = await reencode(file);
  // Unique name per upload: a replaced logo gets a new URL, so no cache keeps showing the old one.
  const sRef = ref(storage, `cities/${cityId}/logo/${nanoid()}.${ext}`);
  await uploadBytes(sRef, blob, { contentType: blob.type });
  return getDownloadURL(sRef);
}

/** Best-effort delete of a logo we uploaded earlier; ignores URLs hosted elsewhere. */
export async function deleteCityLogoByUrl(url: string): Promise<void> {
  if (!url.includes('firebasestorage.googleapis.com') && !url.includes('firebasestorage.app')) return;
  try { await deleteObject(ref(storage, url)); } catch { /* already gone or not ours */ }
}
