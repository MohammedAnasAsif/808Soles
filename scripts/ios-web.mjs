// Copies the built web app (dist/) into the iOS project, where Package.swift
// bundles it as a resource. Run `npm run ios:web` before `xtool dev`.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const dest = path.join(root, 'ios', 'Sources', 'Soles808', 'Web');

if (!fs.existsSync(path.join(dist, 'index.html'))) {
  console.error('dist/ is missing: run `npm run build` first.');
  process.exit(1);
}
fs.rmSync(dest, { recursive: true, force: true });
fs.cpSync(dist, dest, { recursive: true });
console.log(`Copied the web app to ${path.relative(root, dest)}`);
