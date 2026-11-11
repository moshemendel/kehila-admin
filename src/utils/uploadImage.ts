import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { storage } from '../firebase';
import { nanoid } from './nanoid';

/** Largest source file accepted. storage.rules caps the stored object at 10MB; we re-encode below that. */
export const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
/** Longest edge of a stored picture; matches the crop modal and the app's uploadImage (1280px). */
const MAX_EDGE = 1280;
export const IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp';
const ACCEPTED = ['image/png', 'image/jpeg', 'image/webp'];

/** Hebrew error for a file that must not be uploaded, or null when it is fine. */
export function validateImageFile(file: File): string | null {
  if (!ACCEPTED.includes(file.type)) return 'סוג הקובץ אינו נתמך. יש לבחור תמונה בפורמט PNG, JPG או WebP.';
  if (file.size > IMAGE_MAX_BYTES) return 'הקובץ גדול מדי. הגודל המרבי הוא 10MB.';
  return null;
}

/**
 * Resizes to MAX_EDGE and re-encodes. PNG stays PNG so transparency survives; photos
 * (JPEG/WebP) go out as JPEG, which is far smaller.
 */
async function reencode(file: Blob, keepPng: boolean): Promise<{ blob: Blob; ext: 'png' | 'jpg' }> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas');
  if (!keepPng) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); }
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const blob: Blob | null = await new Promise(res =>
    canvas.toBlob(res, keepPng ? 'image/png' : 'image/jpeg', 0.85));
  if (!blob) throw new Error('encode');
  return { blob, ext: keepPng ? 'png' : 'jpg' };
}

/**
 * Uploads to `<dir>/<unique>.<ext>` and returns the download URL. `dir` must be one of the
 * folders storage.rules grants (e.g. `synagogues/<id>/gallery`). A blob from the crop modal
 * is already a resized JPEG and is sent as is; a raw file ("upload without cropping") is
 * resized first.
 */
export async function uploadImage(dir: string, input: File | Blob, opts: { cropped?: boolean } = {}): Promise<string> {
  let blob: Blob = input;
  let ext = 'jpg';
  if (!opts.cropped) {
    const r = await reencode(input, input.type === 'image/png');
    blob = r.blob; ext = r.ext;
  }
  // Unique name per upload: a replaced picture gets a new URL, so no cache keeps showing the old one.
  const sRef = ref(storage, `${dir}/${nanoid()}.${ext}`);
  await uploadBytes(sRef, blob, { contentType: blob.type || 'image/jpeg' });
  return getDownloadURL(sRef);
}

/** Best-effort delete of a file we uploaded earlier; ignores URLs hosted elsewhere. */
export async function deleteImageByUrl(url: string): Promise<void> {
  if (!url || (!url.includes('firebasestorage.googleapis.com') && !url.includes('firebasestorage.app'))) return;
  try { await deleteObject(ref(storage, url)); } catch { /* already gone, not ours, or rules refused */ }
}
