#!/usr/bin/env bun
/**
 * Regenerate `registry.json` from `skills/*/AGENTS.md` frontmatter.
 * Run by CI on merge to `main`.
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, extname } from 'node:path';

const SKILLS_DIR = new URL('../skills', import.meta.url).pathname;
const OUT_PATH = new URL('../registry.json', import.meta.url).pathname;

interface Frontmatter {
  name?: string;
  version?: string;
  description?: string;
  author?: string;
  license?: string;
  categories?: string[];
  tags?: string[];
}

function parseFrontmatter(raw: string): Frontmatter {
  const match = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  if (!match) return {};
  const out: Record<string, unknown> = {};
  for (const line of match[1].split('\n')) {
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    if (!key) continue;
    if (value.startsWith('[') && value.endsWith(']')) {
      out[key] = value
        .slice(1, -1)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    } else {
      out[key] = value;
    }
  }
  return out as Frontmatter;
}

function dirHash(path: string): string {
  const hash = createHash('sha256');
  const walk = (d: string): void => {
    for (const entry of readdirSync(d).sort()) {
      const full = join(d, entry);
      if (statSync(full).isDirectory()) {
        hash.update(entry);
        walk(full);
      } else if (extname(entry).toLowerCase() === '.md') {
        hash.update(entry);
        hash.update(readFileSync(full));
      }
    }
  };
  walk(path);
  return hash.digest('hex');
}

interface RegistryEntry {
  id: string;
  name: string;
  version: string;
  description: string;
  categories: string[];
  author: string;
  license: string;
  tarball_url: string;
  sha256: string;
  tags: string[];
  updated_at: string;
}

const skills: RegistryEntry[] = [];
const today = new Date().toISOString().slice(0, 10);

for (const entry of readdirSync(SKILLS_DIR)) {
  const dir = join(SKILLS_DIR, entry);
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
      continue;
    }
  }

  const fm = parseFrontmatter(raw);
  if (!fm.name || !fm.description) continue;

  skills.push({
    id: entry,
    name: fm.name,
    version: fm.version ?? '1.0.0',
    description: fm.description,
    categories: fm.categories ?? [],
    author: fm.author ?? 'community',
    license: fm.license ?? 'MIT',
    tarball_url: `https://codeload.github.com/solo/skills-registry/tar.gz/refs/heads/main?path=skills/${entry}`,
    sha256: dirHash(dir),
    tags: fm.tags ?? [],
    updated_at: today,
  });
}

skills.sort((a, b) => a.id.localeCompare(b.id));

const registry = {
  version: 1,
  generated_at: new Date().toISOString(),
  skills,
};

writeFileSync(OUT_PATH, `${JSON.stringify(registry, null, 2)}\n`);
console.log(`✅ regenerated registry.json with ${skills.length} skills`);
