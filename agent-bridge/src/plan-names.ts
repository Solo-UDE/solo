/**
 * Random plan name generator for plan mode.
 *
 * Plans are stored at `<workspace>/.solo/plans/<slug>.md` — project-scoped so
 * they travel with the repo and can be diffed/checked in (or git-ignored).
 *
 * Name format: `adjective-verb-noun` (e.g., `cozy-stirring-hopper.md`).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

const ADJECTIVES = [
  'cozy', 'woolly', 'jazzy', 'sunny', 'misty', 'calm', 'bold', 'crisp',
  'dusty', 'eager', 'frosty', 'gentle', 'happy', 'keen', 'lively', 'mellow',
  'nimble', 'plucky', 'quiet', 'rustic', 'sleek', 'tender', 'vivid', 'warm',
  'zesty', 'amber', 'bright', 'coral', 'dainty', 'elfin', 'fair', 'golden',
  'humble', 'ivory', 'jolly', 'kind', 'lunar', 'mossy', 'noble', 'olive',
  'pastel', 'quaint', 'rosy', 'silver', 'tawny', 'urban', 'velvet', 'wild',
];

const VERBS = [
  'stirring', 'crafting', 'snuggling', 'drifting', 'gliding', 'humming',
  'jumping', 'knitting', 'leaping', 'melting', 'nesting', 'orbiting',
  'pacing', 'quilting', 'roaming', 'sailing', 'ticking', 'unfolding',
  'vaulting', 'winding', 'yielding', 'arching', 'blazing', 'climbing',
  'dancing', 'echoing', 'flowing', 'grazing', 'hiking', 'inching',
  'jogging', 'kicking', 'lacing', 'mapping', 'nudging', 'opening',
  'picking', 'racing', 'shaping', 'tracing', 'turning', 'walking',
  'bending', 'curving', 'diving', 'easing', 'folding', 'growing',
];

const NOUNS = [
  'hopper', 'reef', 'falcon', 'meadow', 'brook', 'canyon', 'delta',
  'ember', 'fjord', 'grove', 'haven', 'inlet', 'jungle', 'knoll',
  'lagoon', 'mesa', 'nexus', 'oasis', 'plume', 'quartz', 'ridge',
  'summit', 'tundra', 'updraft', 'valley', 'whisper', 'zenith',
  'atlas', 'beacon', 'cedar', 'dune', 'echo', 'flint', 'glacier',
  'harbor', 'iris', 'jasper', 'kelp', 'lantern', 'marble', 'nimbus',
  'orchid', 'pebble', 'quill', 'raven', 'spruce', 'timber',
];

export function generatePlanName(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const verb = VERBS[Math.floor(Math.random() * VERBS.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  return `${adj}-${verb}-${noun}`;
}

/**
 * Resolve the plans directory for a workspace: `<workspace>/.solo/plans/`.
 *
 * `workspace` is required and should be the absolute path to the project root.
 * If it's missing we fall back to the user home's `.solo/plans/` — this is
 * strictly for legacy callers that don't have a workspace in hand.
 */
function plansDir(workspace?: string): string {
  if (workspace && workspace.length > 0) {
    return path.join(workspace, '.solo', 'plans');
  }
  // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
  const os = require('node:os');
  return path.join(os.homedir() as string, '.solo', 'plans');
}

export function getPlanFilePath(name: string, workspace?: string): string {
  return path.join(plansDir(workspace), `${name}.md`);
}

/**
 * Ensure the plans directory exists for a workspace.
 */
export function ensurePlanDirectory(workspace?: string): void {
  fs.mkdirSync(plansDir(workspace), { recursive: true });
}
