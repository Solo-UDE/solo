/**
 * Skills system for the Solo IDE agent bridge.
 *
 * Solo's canonical directories are `~/.solo/skills/` (user) and
 * `{cwd}/.solo/skills/` (project). On top of that, the bridge reads
 * compatibility adapters so users keep skills they already authored for
 * other tools — Claude Code (personal + plugin marketplace + project
 * ancestors) and Codex (forward-compat).
 *
 * Adapter toggles live in `~/.solo/settings.json` under the `skills`
 * section. Defaults: all adapters on. Skills collide → highest-priority
 * source wins (project > user > claude_project > claude_user > claude_plugin > codex).
 *
 * Provider-agnostic: the merged list is formatted as plain markdown and
 * injected into the agent system prompt by `agent.ts`.
 */

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, basename, extname, resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import { createLogger } from './logger.js';

const logger = createLogger('Skills');

// ── Types ────────────────────────────────────────────────────────────

export type SkillSource =
  | 'user'
  | 'project'
  | 'claude_user'
  | 'claude_plugin'
  | 'claude_project'
  | 'codex';

export interface SkillMetadata {
  name: string;
  description: string;
  enabled: boolean;
  priority: number;
}

export interface LoadedSkill {
  metadata: SkillMetadata;
  content: string;
  source: SkillSource;
  filePath: string;
}

interface SkillsConfig {
  importClaudeUser: boolean;
  importClaudePlugins: boolean;
  importClaudeProject: boolean;
  importCodex: boolean;
  onboardingShown: boolean;
}

const DEFAULT_CONFIG: SkillsConfig = {
  importClaudeUser: true,
  importClaudePlugins: true,
  importClaudeProject: true,
  importCodex: true,
  onboardingShown: false,
};

const SOURCE_PRIORITY: Record<SkillSource, number> = {
  project: 60,
  user: 50,
  claude_project: 40,
  claude_user: 30,
  claude_plugin: 20,
  codex: 10,
};

// ── Frontmatter Parsing ─────────────────────────────────────────────

const FRONTMATTER_RE = /^---\s*\n([\s\S]*?)\n---\s*\n?/;

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

    if (value === 'true') metadata[key] = true;
    else if (value === 'false') metadata[key] = false;
    else if (/^\d+$/.test(value)) metadata[key] = parseInt(value, 10);
    else metadata[key] = value;
  }

  return { metadata: metadata as unknown as Partial<SkillMetadata>, body };
}

// ── Directory Discovery ─────────────────────────────────────────────

export function discoverSkillsFromDir(dirPath: string, source: SkillSource): LoadedSkill[] {
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
        raw = readFileSync(fullPath, 'utf-8');
        skillFilePath = fullPath;
        derivedName = basename(entry, '.md');
      } else if (stat.isDirectory()) {
        // Prefer AGENTS.md (the open standard adopted by Cursor/Codex/Windsurf)
        // but fall back to SKILL.md for drop-in compatibility with Claude Code
        // skill folders.
        const agentsMd = join(fullPath, 'AGENTS.md');
        const skillMd = join(fullPath, 'SKILL.md');
        const chosen = existsSync(agentsMd)
          ? agentsMd
          : existsSync(skillMd)
            ? skillMd
            : null;
        if (!chosen) continue;
        raw = readFileSync(chosen, 'utf-8');
        skillFilePath = chosen;
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
        enabled: metadata.enabled !== false,
        priority: typeof metadata.priority === 'number' ? metadata.priority : 0,
      },
      content: body,
      source,
      filePath: skillFilePath,
    });
  }

  return skills;
}

// ── Adapter Sources ─────────────────────────────────────────────────

function loadSkillsConfig(): SkillsConfig {
  const settingsPath = join(homedir(), '.solo', 'settings.json');
  if (!existsSync(settingsPath)) return DEFAULT_CONFIG;
  try {
    const raw = readFileSync(settingsPath, 'utf-8');
    const parsed = JSON.parse(raw) as { skills?: Partial<SkillsConfig> };
    return { ...DEFAULT_CONFIG, ...(parsed.skills ?? {}) };
  } catch (err) {
    logger.warn({ err }, 'skills settings parse failed, using defaults');
    return DEFAULT_CONFIG;
  }
}

function discoverClaudePlugins(): LoadedSkill[] {
  const manifestPath = join(homedir(), '.claude', 'plugins', 'installed_plugins.json');
  if (!existsSync(manifestPath)) return [];
  let parsed: { plugins?: Record<string, Array<{ installPath?: string }>> };
  try {
    parsed = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  } catch (err) {
    logger.warn({ err }, 'claude plugins manifest parse failed');
    return [];
  }

  const out: LoadedSkill[] = [];
  const plugins = parsed.plugins ?? {};
  for (const installs of Object.values(plugins)) {
    for (const install of installs) {
      if (!install.installPath) continue;
      const skillsDir = join(install.installPath, 'skills');
      out.push(...discoverSkillsFromDir(skillsDir, 'claude_plugin'));
    }
  }
  return out;
}

/**
 * Walk from `cwd` up to `$HOME`, at most 12 hops, collecting any
 * `.claude/skills/` directories encountered. Lets users who keep skills
 * at a monorepo root (`Orbit_Main/.claude/skills/`) have them show up
 * inside any sub-project.
 */
function discoverClaudeProjectAncestors(cwd: string): LoadedSkill[] {
  const home = homedir();
  const out: LoadedSkill[] = [];
  let current = resolve(cwd);
  let hops = 0;
  while (hops < 12) {
    if (current === home) break;
    const candidate = join(current, '.claude', 'skills');
    if (existsSync(candidate)) {
      out.push(...discoverSkillsFromDir(candidate, 'claude_project'));
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
    hops += 1;
  }
  return out;
}

// ── Merging ─────────────────────────────────────────────────────────

/**
 * Collapse name collisions by keeping the highest-priority source, then
 * drop disabled entries and sort: priority desc, name asc.
 */
export function mergeSkills(all: LoadedSkill[]): LoadedSkill[] {
  const map = new Map<string, LoadedSkill>();
  for (const skill of all) {
    const existing = map.get(skill.metadata.name);
    if (!existing || SOURCE_PRIORITY[skill.source] > SOURCE_PRIORITY[existing.source]) {
      map.set(skill.metadata.name, skill);
    }
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

export function formatSkillsForPrompt(skills: LoadedSkill[]): string {
  if (skills.length === 0) return '';
  const sections = skills.map((s) => `### ${s.metadata.name}\n\n${s.content}`);
  return `\n## Active Skills\n\nThe following skill instructions are loaded from .solo/skills/ and imported sources:\n\n${sections.join(
    '\n\n---\n\n'
  )}`;
}

// ── Main Entry ──────────────────────────────────────────────────────

export function loadSkills(cwd: string): LoadedSkill[] {
  const config = loadSkillsConfig();
  const all: LoadedSkill[] = [];

  // Solo-native (always on)
  all.push(...discoverSkillsFromDir(join(homedir(), '.solo', 'skills'), 'user'));
  all.push(...discoverSkillsFromDir(join(cwd, '.solo', 'skills'), 'project'));

  // Compatibility adapters (toggleable)
  if (config.importClaudeUser) {
    all.push(...discoverSkillsFromDir(join(homedir(), '.claude', 'skills'), 'claude_user'));
  }
  if (config.importClaudeProject) {
    all.push(...discoverClaudeProjectAncestors(cwd));
  }
  if (config.importClaudePlugins) {
    all.push(...discoverClaudePlugins());
  }
  if (config.importCodex) {
    all.push(...discoverSkillsFromDir(join(homedir(), '.codex', 'skills'), 'codex'));
  }

  const merged = mergeSkills(all);

  if (merged.length > 0) {
    logger.info(
      {
        count: merged.length,
        bySource: merged.reduce<Record<string, number>>((acc, s) => {
          acc[s.source] = (acc[s.source] ?? 0) + 1;
          return acc;
        }, {}),
      },
      'Skills loaded'
    );
  } else {
    logger.debug('No skills found');
  }

  return merged;
}
