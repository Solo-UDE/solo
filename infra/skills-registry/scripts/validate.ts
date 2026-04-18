#!/usr/bin/env bun
/**
 * Validate every skill folder in `skills/`. Exits non-zero on first failure.
 *
 * Checks:
 *   - `AGENTS.md` (or `SKILL.md`) exists
 *   - YAML frontmatter parseable, has required fields (`name`, `description`)
 *   - `name` matches folder name
 *   - Skill dir size ≤ 5 MB
 *   - No executable files (`.sh .py .js .ts .exe`, ELF/Mach-O/PE magic bytes)
 *   - `name` is unique across the registry (case-insensitive)
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOT = new URL('../skills', import.meta.url).pathname;
const MAX_SKILL_BYTES = 5 * 1024 * 1024;
const BANNED_EXT = new Set(['.sh', '.py', '.js', '.ts', '.exe', '.bin', '.so', '.dll', '.dylib']);

interface Frontmatter {
  name?: string;
  description?: string;
  version?: string;
}

const errors: string[] = [];
const seenNames = new Set<string>();

function fail(msg: string): void {
  errors.push(msg);
}

function parseFrontmatter(raw: string): Frontmatter | null {
  const match = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  if (!match) return null;
  const out: Frontmatter = {};
  for (const line of match[1].split('\n')) {
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    if (key === 'name' || key === 'description' || key === 'version') {
      (out as Record<string, string>)[key] = value;
    }
  }
  return out;
}

function dirSize(path: string): number {
  let total = 0;
  for (const entry of readdirSync(path)) {
    const full = join(path, entry);
    const st = statSync(full);
    total += st.isDirectory() ? dirSize(full) : st.size;
  }
  return total;
}

function hasExecutableMagic(bytes: Uint8Array): boolean {
  // ELF: 7f 45 4c 46
  if (bytes[0] === 0x7f && bytes[1] === 0x45 && bytes[2] === 0x4c && bytes[3] === 0x46) return true;
  // Mach-O 32: feedface / Mach-O 64: feedfacf / both-reversed
  const magic = (bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3];
  if (magic === 0xfeedface || magic === 0xfeedfacf) return true;
  if (magic === 0xcefaedfe || magic === 0xcffaedfe) return true;
  // PE: 4d 5a ("MZ")
  if (bytes[0] === 0x4d && bytes[1] === 0x5a) return true;
  return false;
}

function scanForExecutables(dir: string): void {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      scanForExecutables(full);
      continue;
    }
    const ext = extname(entry).toLowerCase();
    if (BANNED_EXT.has(ext)) {
      fail(`${full}: banned file extension ${ext}`);
      continue;
    }
    if (st.size > 0) {
      const fd = readFileSync(full);
      if (fd.length >= 4 && hasExecutableMagic(new Uint8Array(fd.subarray(0, 4)))) {
        fail(`${full}: binary magic bytes detected`);
      }
    }
  }
}

for (const entry of readdirSync(ROOT)) {
  const dir = join(ROOT, entry);
  if (!statSync(dir).isDirectory()) continue;

  const agentsMd = join(dir, 'AGENTS.md');
  const skillMd = join(dir, 'SKILL.md');
  let raw: string;
  try {
    raw = readFileSync(agentsMd, 'utf-8');
  } catch {
    try {
      raw = readFileSync(skillMd, 'utf-8');
    } catch {
      fail(`${entry}: missing AGENTS.md (or SKILL.md fallback)`);
      continue;
    }
  }

  const fm = parseFrontmatter(raw);
  if (!fm) {
    fail(`${entry}: missing or malformed frontmatter`);
    continue;
  }
  if (!fm.name) fail(`${entry}: frontmatter missing 'name'`);
  if (!fm.description) fail(`${entry}: frontmatter missing 'description'`);
  if (fm.name && fm.name !== entry) {
    fail(`${entry}: frontmatter name '${fm.name}' does not match folder name`);
  }
  if (fm.name) {
    const key = fm.name.toLowerCase();
    if (seenNames.has(key)) fail(`${entry}: duplicate name '${fm.name}'`);
    seenNames.add(key);
  }

  const size = dirSize(dir);
  if (size > MAX_SKILL_BYTES) {
    fail(`${entry}: size ${size} exceeds 5 MB limit`);
  }

  scanForExecutables(dir);
}

if (errors.length > 0) {
  console.error('❌ validation failed:');
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log(`✅ all skills valid (${seenNames.size} skills)`);
