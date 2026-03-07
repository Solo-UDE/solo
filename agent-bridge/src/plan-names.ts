/**
 * Random plan name generator for plan mode.
 * Generates adjective-verb-noun plan file names (e.g., "cozy-stirring-hopper.md").
 * Plans are stored in ~/.solo/plans/.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
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

export function getPlanFilePath(name: string): string {
  return path.join(os.homedir(), '.solo', 'plans', `${name}.md`);
}

/**
 * Ensure the ~/.solo/plans/ directory exists.
 */
export function ensurePlanDirectory(): void {
  const dir = path.join(os.homedir(), '.solo', 'plans');
  fs.mkdirSync(dir, { recursive: true });
}
