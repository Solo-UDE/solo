/**
 * Skills system for Solo IDE Agent.
 *
 * Discovers, parses, and formats skill instruction files from:
 *   - User-scoped:    ~/.solo/skills/
 *   - Project-scoped: {cwd}/.solo/skills/
 *
 * Skill files are markdown with optional YAML-like frontmatter.
 * Project skills override user skills by name.
 */

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, basename, extname } from 'node:path';
import { homedir } from 'node:os';
import { createLogger } from './logger.js';

const logger = createLogger('Skills');

// ── Types ────────────────────────────────────────────────────────────

export interface SkillMetadata {
  name: string;
  description: string;
  enabled: boolean;
  priority: number;
}

export interface LoadedSkill {
  metadata: SkillMetadata;
  content: string;
  source: 'user' | 'project';
  filePath: string;
}

// ── Frontmatter Parsing ─────────────────────────────────────────────

const FRONTMATTER_RE = /^---\s*\n([\s\S]*?)\n---\s*\n?/;

/**
 * Parse YAML-like frontmatter from a skill file.
 * No external YAML dependency — simple key: value line parsing.
 */
export function parseFrontmatter(raw: string): { metadata: Partial<SkillMetadata>; body: string } {
  const match = raw.match(FRONTMATTER_RE);
  if (!match) {
    return { metadata: {}, body: raw.trim() };
  }

  const frontmatterBlock = match[1];
  const body = raw.slice(match[0].length).trim();
  const metadata: Record<string, string | boolean | number> = {};

  for (const line of frontmatterBlock.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    if (!key) continue;

    // Type coercion for known fields
    if (value === 'true') metadata[key] = true;
    else if (value === 'false') metadata[key] = false;
    else if (/^\d+$/.test(value)) metadata[key] = parseInt(value, 10);
    else metadata[key] = value;
  }

  return { metadata: metadata as unknown as Partial<SkillMetadata>, body };
}

// ── Directory Discovery ─────────────────────────────────────────────

/**
 * Discover skill files in a directory.
 * Supports:
 *   - Flat files: my-skill.md
 *   - Directory-based: my-skill/SKILL.md
 */
export function discoverSkillsFromDir(
  dirPath: string,
  scope: 'user' | 'project'
): LoadedSkill[] {
  if (!existsSync(dirPath)) return [];

  const skills: LoadedSkill[] = [];
  let entries: string[];

  try {
    entries = readdirSync(dirPath);
  } catch {
    return [];
  }

  for (const entry of entries) {
    const fullPath = join(dirPath, entry);
    let raw: string;
    let skillFilePath: string;
    let derivedName: string;

    try {
      const stat = statSync(fullPath);

      if (stat.isFile() && extname(entry) === '.md') {
        // Flat file: my-skill.md
        raw = readFileSync(fullPath, 'utf-8');
        skillFilePath = fullPath;
        derivedName = basename(entry, '.md');
      } else if (stat.isDirectory()) {
        // Directory-based: my-skill/SKILL.md
        const skillMd = join(fullPath, 'SKILL.md');
        if (!existsSync(skillMd)) continue;
        raw = readFileSync(skillMd, 'utf-8');
        skillFilePath = skillMd;
        derivedName = entry;
      } else {
        continue;
      }
    } catch {
      continue;
    }

    const { metadata, body } = parseFrontmatter(raw);

    skills.push({
      metadata: {
        name: typeof metadata.name === 'string' ? metadata.name : derivedName,
        description: typeof metadata.description === 'string' ? metadata.description : '',
        enabled: metadata.enabled !== false, // default true
        priority: typeof metadata.priority === 'number' ? metadata.priority : 0,
      },
      content: body,
      source: scope,
      filePath: skillFilePath,
    });
  }

  return skills;
}

// ── Merging ─────────────────────────────────────────────────────────

/**
 * Merge user and project skills. Project skills override user skills by name.
 * Filters disabled skills. Sorts by priority (desc), then name (asc).
 */
export function mergeSkills(
  userSkills: LoadedSkill[],
  projectSkills: LoadedSkill[]
): LoadedSkill[] {
  const map = new Map<string, LoadedSkill>();

  // User skills first
  for (const skill of userSkills) {
    map.set(skill.metadata.name, skill);
  }

  // Project skills overwrite
  for (const skill of projectSkills) {
    map.set(skill.metadata.name, skill);
  }

  return Array.from(map.values())
    .filter((s) => s.metadata.enabled)
    .sort((a, b) => {
      const pDiff = b.metadata.priority - a.metadata.priority;
      if (pDiff !== 0) return pDiff;
      return a.metadata.name.localeCompare(b.metadata.name);
    });
}

// ── Prompt Formatting ───────────────────────────────────────────────

/**
 * Format loaded skills as a plain markdown string for injection into
 * the agent system prompt. Provider-agnostic.
 */
export function formatSkillsForPrompt(skills: LoadedSkill[]): string {
  if (skills.length === 0) return '';

  const sections = skills.map(
    (s) => `### ${s.metadata.name}\n\n${s.content}`
  );

  return `\n## Active Skills\n\nThe following skill instructions are loaded from .solo/skills/:\n\n${sections.join('\n\n---\n\n')}`;
}

// ── Main Entry ──────────────────────────────────────────────────────

/**
 * Load all skills from user and project directories.
 * Returns merged, filtered, sorted skills ready for prompt injection.
 */
export function loadSkills(cwd: string): LoadedSkill[] {
  const userDir = join(homedir(), '.solo', 'skills');
  const projectDir = join(cwd, '.solo', 'skills');

  const userSkills = discoverSkillsFromDir(userDir, 'user');
  const projectSkills = discoverSkillsFromDir(projectDir, 'project');
  const merged = mergeSkills(userSkills, projectSkills);

  if (merged.length > 0) {
    logger.info(
      { count: merged.length, names: merged.map((s) => s.metadata.name) },
      'Skills loaded'
    );
  } else {
    logger.debug('No skills found');
  }

  return merged;
}
