/**
 * Post-processor for the manual dev-console dump.
 *
 * When `--remote-debugging-port` can't attach (signed-app entitlement issue),
 * the user pastes `.solo/skills/design/dev-console-snippet.js` into Codex's
 * DevTools console, saves `codex-dump-*.json`, and drops it in
 * `packages/ui/design-dump/codex/manual/`. This script splits that single
 * JSON file into the same per-category layout as the automated CDP run, so
 * downstream distillation doesn't need to branch on extraction mode.
 *
 * Usage:
 *   bun scripts/codex-extract/post-process.ts
 *   bun scripts/codex-extract/post-process.ts --in path/to/codex-dump.json
 */

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { RunManifest } from './types';

interface ManualDump {
  meta: {
    extractedAt: string;
    url: string;
    userAgent: string;
    viewport: { width: number; height: number; dpr: number };
    colorScheme: 'light' | 'dark';
    durationMs: number;
  };
  stylesheets: Array<{ index: number; href: string; media: string; disabled: boolean; rules: string | null; error: string | null }>;
  fonts: Array<{ family: string; weight: string; style: string; display: string; stretch: string; unicodeRange: string; status: string }>;
  customProperties: Array<{ name: string; value: string; scope: string }>;
  keyframes: Record<string, string>;
}

async function findLatestDump(manualDir: string): Promise<string> {
  const files = (await readdir(manualDir)).filter((f) => f.endsWith('.json'));
  if (files.length === 0) throw new Error(`no *.json dump found in ${manualDir}`);
  // Pick the alphabetically-last one (timestamped filenames sort naturally)
  files.sort();
  return join(manualDir, files.at(-1)!);
}

async function main() {
  const argv = process.argv.slice(2);
  const outDir = join(process.cwd(), 'packages/ui/design-dump/codex');
  const manualDir = join(outDir, 'manual');
  await mkdir(manualDir, { recursive: true });

  let inputPath: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--in') inputPath = argv[++i];
  }
  if (!inputPath) inputPath = await findLatestDump(manualDir);

  console.log(`[post-process] reading ${inputPath}`);
  const dump: ManualDump = JSON.parse(await readFile(inputPath, 'utf8'));

  // Stylesheets → stylesheets/*.css + _index.json
  const sheetsDir = join(outDir, 'stylesheets');
  await mkdir(sheetsDir, { recursive: true });
  const indexSummary: Array<{ index: number; origin: string; href: string; bytes: number; textError: string | null }> = [];
  for (const s of dump.stylesheets) {
    if (!s.rules) {
      indexSummary.push({ index: s.index, origin: 'regular', href: s.href, bytes: 0, textError: s.error });
      continue;
    }
    const hash = createHash('sha1').update(s.rules).digest('hex').slice(0, 8);
    const pad = String(s.index).padStart(2, '0');
    const header = `/*\n * source: ${s.href}\n * origin: regular\n * index:  ${s.index}\n * extracted (manual): ${dump.meta.extractedAt}\n */\n`;
    await writeFile(join(sheetsDir, `${pad}-${hash}.css`), header + s.rules, 'utf8');
    indexSummary.push({ index: s.index, origin: 'regular', href: s.href, bytes: s.rules.length, textError: null });
  }
  await writeFile(join(sheetsDir, '_index.json'), JSON.stringify(indexSummary, null, 2), 'utf8');

  // Fonts → fonts.json
  await writeFile(join(outDir, 'fonts.json'), JSON.stringify(dump.fonts, null, 2), 'utf8');

  // Custom properties → tokens.json
  await writeFile(join(outDir, 'tokens.json'), JSON.stringify(dump.customProperties, null, 2), 'utf8');

  // Keyframes: manual dump has them as { name: definition }. Promote to full record shape.
  const keyframesOut: Record<string, { name: string; definition: string; consumers: string[] }> = {};
  for (const [name, definition] of Object.entries(dump.keyframes)) {
    keyframesOut[name] = { name, definition, consumers: [] };
  }
  await writeFile(join(outDir, 'keyframes.json'), JSON.stringify(keyframesOut, null, 2), 'utf8');

  // Manifest
  const manifest: RunManifest = {
    extractedAt: dump.meta.extractedAt,
    mode: 'manual',
    url: dump.meta.url,
    archetypes: { total: 0, matched: 0, missing: [] }, // manual mode doesn't do archetype matching
    counts: {
      stylesheets: dump.stylesheets.filter((s) => s.rules).length,
      tokens: dump.customProperties.length,
      fonts: dump.fonts.length,
      keyframes: Object.keys(dump.keyframes).length,
      assets: 0,
    },
    warnings: dump.stylesheets.filter((s) => s.error).map((s) => `stylesheet ${s.href}: ${s.error}`),
    durationMs: dump.meta.durationMs,
  };
  await writeFile(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

  console.log('[post-process] done:', JSON.stringify(manifest.counts));
  console.log(
    '[post-process] note: manual mode skips computed-styles.json (no DOM traversal). ' +
    'Run automated mode via launch.ts for archetype-level capture.',
  );
}

if (import.meta.main) {
  main().catch((err) => {
    console.error('[post-process] failed:', err);
    process.exit(1);
  });
}
