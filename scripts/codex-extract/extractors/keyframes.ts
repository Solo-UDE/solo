import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ExtractorContext, KeyframesDump } from '../types';

/**
 * Keyframes are extracted from the already-dumped stylesheets (re-reading from
 * disk keeps this extractor independent of stylesheet in-memory state).
 * We also scan for `animation-name` declarations to populate `consumers`.
 */
export async function extractKeyframes(ctx: ExtractorContext): Promise<Record<string, KeyframesDump>> {
  const log = ctx.logger.child('keyframes');
  const sheetsDir = join(ctx.outDir, 'stylesheets');

  let files: string[] = [];
  try {
    files = (await readdir(sheetsDir)).filter((f) => f.endsWith('.css'));
  } catch {
    log.warn('no stylesheets/ directory — keyframes extractor needs stylesheets.ts to run first');
    return {};
  }

  const keyframes: Record<string, KeyframesDump> = {};
  const animationUsages = new Map<string, Set<string>>(); // name → selectors

  for (const file of files) {
    const text = await readFile(join(sheetsDir, file), 'utf8');
    collectKeyframes(text, keyframes);
    collectAnimationUsages(text, animationUsages);
  }

  // Fold consumers into keyframes records
  for (const [name, record] of Object.entries(keyframes)) {
    record.consumers = [...(animationUsages.get(name) ?? [])];
  }

  await writeFile(join(ctx.outDir, 'keyframes.json'), JSON.stringify(keyframes, null, 2), 'utf8');
  log.info(`wrote ${Object.keys(keyframes).length} keyframe record(s)`);
  return keyframes;
}

function collectKeyframes(text: string, out: Record<string, KeyframesDump>) {
  let idx = 0;
  while ((idx = text.indexOf('@keyframes', idx)) !== -1) {
    const afterKw = idx + '@keyframes'.length;
    const braceStart = text.indexOf('{', afterKw);
    if (braceStart === -1) break;
    const name = text.slice(afterKw, braceStart).trim();
    let depth = 1;
    let i = braceStart + 1;
    while (i < text.length && depth > 0) {
      if (text[i] === '{') depth++;
      else if (text[i] === '}') depth--;
      i++;
    }
    const definition = text.slice(idx, i);
    if (!out[name]) out[name] = { name, definition, consumers: [] };
    idx = i;
  }
}

function collectAnimationUsages(text: string, out: Map<string, Set<string>>) {
  // Coarse heuristic: find `animation: <name>` or `animation-name: <name>`
  // and associate with the preceding selector block.
  const rules = text.match(/([^{}]+)\{([^{}]*)\}/g) ?? [];
  for (const rule of rules) {
    const braceIdx = rule.indexOf('{');
    const selector = rule.slice(0, braceIdx).trim();
    const body = rule.slice(braceIdx + 1, -1);
    const nameMatch =
      body.match(/animation-name\s*:\s*([\w-]+)/) ??
      body.match(/animation\s*:\s*([\w-]+)/);
    if (!nameMatch) continue;
    const name = nameMatch[1];
    if (!out.has(name)) out.set(name, new Set());
    out.get(name)!.add(selector.slice(0, 200));
  }
}
