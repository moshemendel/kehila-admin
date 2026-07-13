/**
 * One-time migration: copies all documents from `restaurants` → `businesses` in Firestore.
 *
 * Prerequisites:
 *   1. Go to Firebase Console → Project Settings → Service Accounts → Generate new private key
 *   2. Save the downloaded JSON as  kehila-admin/scripts/serviceAccount.json
 *   3. npm install -D firebase-admin   (inside kehila-admin/)
 *   4. node scripts/migrate-to-businesses.mjs
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const __dir = dirname(fileURLToPath(import.meta.url));
const saPath = resolve(__dir, 'serviceAccount.json');

let serviceAccount;
try {
  serviceAccount = JSON.parse(readFileSync(saPath, 'utf8'));
} catch {
  console.error('❌  serviceAccount.json not found at', saPath);
  console.error('   Download it from Firebase Console → Project Settings → Service Accounts');
  process.exit(1);
}

initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

async function migrate() {
  const srcCol  = 'restaurants';
  const destCol = 'businesses';

  console.log(`\nReading "${srcCol}" collection...`);
  const snap = await db.collection(srcCol).get();

  if (snap.empty) {
    console.log(`"${srcCol}" is empty — nothing to migrate.`);
    return;
  }

  console.log(`Found ${snap.size} document(s). Copying to "${destCol}"...`);

  let copied = 0;
  for (const docSnap of snap.docs) {
    await db.collection(destCol).doc(docSnap.id).set(docSnap.data());
    copied++;
    process.stdout.write(`\r  ${copied}/${snap.size}  ${docSnap.id}`);
  }

  console.log(`\n\n✅  Done — ${copied} document(s) copied to "${destCol}".`);
  console.log('   You can now delete the "restaurants" collection from Firebase Console.');
  console.log('   (Firestore Console → restaurants → ⋮ → Delete collection)');
}

migrate().catch(err => { console.error('\n❌  Migration failed:', err.message); process.exit(1); });
