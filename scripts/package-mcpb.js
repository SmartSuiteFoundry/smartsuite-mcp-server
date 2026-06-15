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

// The bundle is ESM but ships as `index.js`. Without an explicit module type, whether it
// loads depends on the host Node's module detection: Node ≥20.19/22 auto-detects ESM, but a
// CommonJS-resolving runtime hard-crashes at the first top-level `import` (server never starts).
// Ship a package.json beside it so the module type is unambiguous on every Node version.
const serverPkg = path.join(path.dirname(dest), 'package.json');
fs.writeFileSync(serverPkg, JSON.stringify({ type: 'module' }, null, 2) + '\n');
console.log(`Wrote mcpb/server/package.json ({"type":"module"})`);

// Keep the MCPB manifest version in sync with package.json so a version bump
// can't drift out of date (the upload endpoint rejects a stale version).
const pkgPath      = path.join(root, 'package.json');
const manifestPath = path.join(root, 'mcpb', 'manifest.json');
const pkgVersion   = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version;
const manifest     = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
if (manifest.version !== pkgVersion) {
  manifest.version = pkgVersion;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`Synced manifest version → ${pkgVersion}`);
} else {
  console.log(`Manifest version already ${pkgVersion}`);
}
