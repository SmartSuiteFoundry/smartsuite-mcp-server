#!/usr/bin/env node
// Copies the bundled server into mcpb/server/ so `mcpb pack` can find it.
import fs from 'node:fs';
import path from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const src  = path.join(root, 'build', 'server', 'index.js');
const dest = path.join(root, 'mcpb', 'server', 'index.js');

if (!fs.existsSync(src)) {
  console.error(`Bundle not found at ${src}. Run: npm run bundle`);
  process.exit(1);
}

fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.copyFileSync(src, dest);
console.log(`Copied bundle → mcpb/server/index.js`);
