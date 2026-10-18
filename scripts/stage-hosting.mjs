/**
 * Lays the Vite build out the way the console is served: at /app-admin.
 *
 *   dist/            (vite build, asset URLs already prefixed /app-admin/)
 *   hosting/app-admin/  ← copied here, the Firebase Hosting public dir
 *
 * Firebase Hosting serves files by their path, so the build has to sit under
 * app-admin for /app-admin/assets/… to resolve. Run by firebase.json's
 * predeploy, after `npm run build`.
 */
import { cpSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const target = join(root, 'hosting', 'app-admin');

if (!existsSync(join(dist, 'index.html'))) {
  console.error('dist/index.html missing — run `npm run build` first');
  process.exit(1);
}
rmSync(join(root, 'hosting'), { recursive: true, force: true });
mkdirSync(target, { recursive: true });
cpSync(dist, target, { recursive: true });
console.log(`staged ${dist} → ${target}`);
