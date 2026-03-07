#!/usr/bin/env node

/**
 * Bump version across all three sources:
 * - Cargo.toml (workspace version)
 * - apps/desktop/src-tauri/tauri.conf.json
 * - apps/desktop/package.json
 *
 * Usage: node scripts/bump-version.mjs <version>
 * Example: node scripts/bump-version.mjs 0.2.0
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const version = process.argv[2];

if (!version) {
  console.error('Usage: node scripts/bump-version.mjs <version>');
  console.error('Example: node scripts/bump-version.mjs 0.2.0');
  process.exit(1);
}

// Validate semver format
if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) {
  console.error(`Invalid semver: "${version}"`);
  process.exit(1);
}

const files = [
  {
    path: resolve(root, 'Cargo.toml'),
    update(content) {
      return content.replace(
        /^version\s*=\s*"[^"]+"/m,
        `version = "${version}"`,
      );
    },
  },
  {
    path: resolve(root, 'apps/desktop/src-tauri/tauri.conf.json'),
    update(content) {
      const json = JSON.parse(content);
      json.version = version;
      return JSON.stringify(json, null, 2) + '\n';
    },
  },
  {
    path: resolve(root, 'apps/desktop/package.json'),
    update(content) {
      const json = JSON.parse(content);
      json.version = version;
      return JSON.stringify(json, null, 2) + '\n';
    },
  },
];

for (const file of files) {
  const content = readFileSync(file.path, 'utf-8');
  const updated = file.update(content);
  writeFileSync(file.path, updated);
  const relative = file.path.replace(root + '/', '');
  console.log(`  Updated ${relative}`);
}

console.log(`\nVersion bumped to ${version}`);
console.log('\nNext steps:');
console.log(`  git add Cargo.toml apps/desktop/src-tauri/tauri.conf.json apps/desktop/package.json`);
console.log(`  git commit -m "Release v${version}"`);
console.log(`  git tag v${version}`);
console.log(`  git push origin master --tags`);
