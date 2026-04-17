/**
 * TypeScript mirror of `solo-core::permissions::check`.
 *
 * The Rust side is the authoritative reference implementation (see
 * `crates/solo-core/src/permissions.rs` — 14 unit tests). This file is a
 * byte-for-byte equivalent translation so the agent-bridge can make the
 * decision in-process (Node has no Tauri invoke) without an IPC round-trip
 * per tool call.
 *
 * Keep the two implementations in sync: any change here needs a matching
 * change in `permissions.rs` (and vice versa).
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { createLogger } from './logger.js';

const logger = createLogger('PermissionPipeline');

// =============================================================================
// Types — mirror of the ts-rs generated bindings
// =============================================================================

export type PermissionMode = 'default' | 'plan' | 'accept' | 'debug';
export type ToolTier = 'read' | 'mutate' | 'destructive';
export type SettingsScope = 'user' | 'project' | 'local';

export interface PermissionsConfig {
  defaultMode?: PermissionMode | null;
  allow: string[];
  deny: string[];
  ask: string[];
  additionalDirectories: string[];
  disableAcceptMode: boolean;
}

export interface DebugModeConfig {
  reviewInterval: number;
  initialGoalCapture: 'firstMessage' | 'explicit';
}

export interface ModesConfig {
  debug: DebugModeConfig;
}

export interface SoloSettings {
  permissions: PermissionsConfig;
  modes: ModesConfig;
}

export type PermissionDecision =
  | { behavior: 'allow'; reason?: string }
  | { behavior: 'ask'; message: string; tier?: ToolTier }
  | { behavior: 'deny'; message: string };

// =============================================================================
// Tool-tier table (mirror of DEFAULT_TOOL_TIERS in Rust)
// =============================================================================

const DEFAULT_TOOL_TIERS: ReadonlyMap<string, ToolTier> = new Map([
  // Read-only
  ['Read', 'read'],
  ['Glob', 'read'],
  ['Grep', 'read'],
  ['WebSearch', 'read'],
  ['WebFetch', 'read'],
  ['BashOutput', 'read'],
  ['AskUserQuestion', 'read'],
  ['TodoWrite', 'read'],
  ['ExitPlanMode', 'read'],
  ['Task', 'read'],
  ['ToolSearch', 'read'],
  ['Skill', 'read'],
  ['ListMcpResourcesTool', 'read'],
  ['ReadMcpResourceTool', 'read'],
  // Mutating
  ['Write', 'mutate'],
  ['Edit', 'mutate'],
  ['NotebookEdit', 'mutate'],
  ['Bash', 'mutate'],
  ['KillShell', 'mutate'],
] as const);

export function defaultTier(toolName: string): ToolTier {
  return DEFAULT_TOOL_TIERS.get(toolName) ?? 'mutate';
}

// =============================================================================
// Rule parsing + matching
// =============================================================================

interface ParsedRule {
  tool: string;
  content: string | null;
  matcher: ((input: string) => boolean) | null;
}

/** Reverse of Claude Code's `escapeRuleContent`. Turns `\(` into `(` etc. */
function unescape(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\' && i + 1 < s.length) {
      const next = s[i + 1];
      if (next === '(' || next === ')' || next === '\\') {
        out += next;
        i++;
        continue;
      }
    }
    out += c;
  }
  return out;
}

/** Compile a glob-like pattern to a predicate. Supports `*` and `?`; no brace/range. */
function compileGlob(pattern: string): (input: string) => boolean {
  let re = '^';
  for (const c of pattern) {
    if (c === '*') re += '.*';
    else if (c === '?') re += '.';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  re += '$';
  const compiled = new RegExp(re);
  return (input) => compiled.test(input);
}

function parseRule(raw: string): ParsedRule {
  const trimmed = raw.trim();
  const open = trimmed.indexOf('(');
  if (open > 0 && trimmed.endsWith(')')) {
    const tool = trimmed.slice(0, open);
    const content = unescape(trimmed.slice(open + 1, trimmed.length - 1));
    let matcher: ((input: string) => boolean) | null = null;
    try {
      matcher = compileGlob(content);
    } catch {
      matcher = null;
    }
    return { tool, content, matcher };
  }
  return { tool: trimmed, content: null, matcher: null };
}

function ruleMatches(rule: ParsedRule, toolName: string, content: string): boolean {
  if (rule.tool !== toolName) return false;
  if (rule.content === null) return true;
  if (rule.matcher) return rule.matcher(content);
  return false;
}

function formatRule(rule: ParsedRule): string {
  return rule.content === null ? rule.tool : `${rule.tool}(${rule.content})`;
}

// =============================================================================
// Content projection per tool (mirror of Rust `content_for`)
// =============================================================================

export function contentFor(toolName: string, input: Record<string, unknown>): string {
  const key = (() => {
    switch (toolName) {
      case 'Bash':
        return 'command';
      case 'BashOutput':
        return 'bash_id';
      case 'Write':
      case 'Edit':
      case 'Read':
        return 'file_path';
      case 'NotebookEdit':
        return 'notebook_path';
      case 'WebFetch':
        return 'url';
      case 'WebSearch':
        return 'query';
      case 'Glob':
      case 'Grep':
        return 'pattern';
      default:
        return null;
    }
  })();
  if (key === null) return '';
  const value = input[key];
  return typeof value === 'string' ? value : '';
}

// =============================================================================
// The decision pipeline
// =============================================================================

export function checkPermission(
  toolName: string,
  toolInput: Record<string, unknown>,
  mode: PermissionMode,
  config: PermissionsConfig
): PermissionDecision {
  const content = contentFor(toolName, toolInput);
  const tier = defaultTier(toolName);

  const denyRules = config.deny.map(parseRule);
  const askRules = config.ask.map(parseRule);
  const allowRules = config.allow.map(parseRule);

  // 1. Deny rules — bypass-immune.
  for (const r of denyRules) {
    if (ruleMatches(r, toolName, content)) {
      return {
        behavior: 'deny',
        message: `Tool '${toolName}' is denied by rule '${formatRule(r)}'.`,
      };
    }
  }

  // 2. Ask rules — bypass-immune under Accept mode.
  for (const r of askRules) {
    if (ruleMatches(r, toolName, content)) {
      return {
        behavior: 'ask',
        message: `Tool '${toolName}' requires approval (rule '${formatRule(r)}').`,
        tier,
      };
    }
  }

  // 3. Destructive tier — always prompt, bypass-immune.
  if (tier === 'destructive') {
    return {
      behavior: 'ask',
      message: `'${toolName}' is a destructive operation and requires approval.`,
      tier,
    };
  }

  // 4. Plan mode: block any mutation.
  if (mode === 'plan' && tier === 'mutate') {
    return {
      behavior: 'deny',
      message: `Plan mode is active. '${toolName}' mutates state; write a plan and call ExitPlanMode to proceed.`,
    };
  }

  // 5. Accept mode: auto-approve everything still here.
  if (mode === 'accept' && !config.disableAcceptMode) {
    return {
      behavior: 'allow',
      reason: 'Accept mode (bypass permissions).',
    };
  }

  // 6. Allow rules.
  for (const r of allowRules) {
    if (ruleMatches(r, toolName, content)) {
      return {
        behavior: 'allow',
        reason: `Allowed by rule '${formatRule(r)}'.`,
      };
    }
  }

  // 7. Read tier — always allow.
  if (tier === 'read') {
    return { behavior: 'allow', reason: 'Read-only tool.' };
  }

  // 8. Fall-through — prompt.
  return { behavior: 'ask', message: `Approval required for '${toolName}'.`, tier };
}

// =============================================================================
// Settings loader (mirror of solo-core::settings::load_merged)
// =============================================================================

const SETTINGS_DIR = '.solo';
const SETTINGS_FILE = 'settings.json';
const LOCAL_SETTINGS_FILE = 'settings.local.json';

const EMPTY_SETTINGS: SoloSettings = Object.freeze({
  permissions: {
    defaultMode: null,
    allow: [],
    deny: [],
    ask: [],
    additionalDirectories: [],
    disableAcceptMode: false,
  },
  modes: {
    debug: { reviewInterval: 3, initialGoalCapture: 'firstMessage' },
  },
}) as SoloSettings;

function readJsonOr<T>(file: string, fallback: T): T {
  try {
    if (!fs.existsSync(file)) return fallback;
    const raw = fs.readFileSync(file, 'utf-8').trim();
    if (raw.length === 0) return fallback;
    return JSON.parse(raw) as T;
  } catch (err) {
    logger.warn({ file, err }, 'Failed to read settings file — falling back to defaults');
    return fallback;
  }
}

function union(a: string[], b: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of a) {
    if (!seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  for (const v of b) {
    if (!seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

function mergeInto(dst: SoloSettings, src: Partial<SoloSettings>): void {
  if (src.permissions) {
    if (src.permissions.defaultMode !== undefined && src.permissions.defaultMode !== null) {
      dst.permissions.defaultMode = src.permissions.defaultMode;
    }
    dst.permissions.allow = union(dst.permissions.allow, src.permissions.allow ?? []);
    dst.permissions.deny = union(dst.permissions.deny, src.permissions.deny ?? []);
    dst.permissions.ask = union(dst.permissions.ask, src.permissions.ask ?? []);
    dst.permissions.additionalDirectories = union(
      dst.permissions.additionalDirectories,
      src.permissions.additionalDirectories ?? []
    );
    if (src.permissions.disableAcceptMode) {
      dst.permissions.disableAcceptMode = true;
    }
  }
  if (src.modes?.debug) {
    if (src.modes.debug.reviewInterval && src.modes.debug.reviewInterval > 0) {
      dst.modes.debug.reviewInterval = src.modes.debug.reviewInterval;
    }
    if (src.modes.debug.initialGoalCapture) {
      dst.modes.debug.initialGoalCapture = src.modes.debug.initialGoalCapture;
    }
  }
}

/** Load user → project → local settings and merge. Missing files become defaults. */
export function loadMergedSettings(workspace: string): SoloSettings {
  const userPath = path.join(os.homedir(), SETTINGS_DIR, SETTINGS_FILE);
  const projectPath = path.join(workspace, SETTINGS_DIR, SETTINGS_FILE);
  const localPath = path.join(workspace, SETTINGS_DIR, LOCAL_SETTINGS_FILE);

  // Deep-clone EMPTY_SETTINGS so mutations don't bleed.
  const merged: SoloSettings = JSON.parse(JSON.stringify(EMPTY_SETTINGS));

  mergeInto(merged, readJsonOr<Partial<SoloSettings>>(userPath, {}));
  mergeInto(merged, readJsonOr<Partial<SoloSettings>>(projectPath, {}));
  mergeInto(merged, readJsonOr<Partial<SoloSettings>>(localPath, {}));

  return merged;
}
