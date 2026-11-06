/**
 * Lays the static site around the console build.
 *
 *   dist/console/   the console (vite build — base and outDir say so)
 *   dist/           ← site/ is copied here: the landing page, /privacy,
 *                     /delete-account
 *
 * kehila-app.com is one Firebase Hosting site serving both, so the console has
 * to live in a subfolder for `/` to be the landing page. Run by `npm run build`
 * after vite, which only empties dist/console and leaves this alone.
 */
import { cpSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

if (!existsSync(join(dist, 'console', 'index.html'))) {
  console.error('dist/console/index.html missing — run `vite build` first');
  process.exit(1);
}
cpSync(join(root, 'site'), dist, { recursive: true });
console.log('staged site/ → dist/');
