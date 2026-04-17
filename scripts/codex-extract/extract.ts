/**
 * Orchestrator — connects to a CDP endpoint, enables required domains, and
 * runs every extractor in sequence against the single active page target.
 *
 * Usage:
 *   bun scripts/codex-extract/extract.ts --attach ws://127.0.0.1:9222/devtools/page/...
 *   bun scripts/codex-extract/extract.ts --cdp-http http://127.0.0.1:9222  (resolves first page target)
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { connectCdp } from './cdp';
import type { Archetype, ExtractorContext, Logger, RunManifest } from './types';
import { extractStylesheets } from './extractors/stylesheets';
import { extractComputedStyles } from './extractors/computed';
import { extractFonts } from './extractors/fonts';
import { extractTokens } from './extractors/tokens';
import { extractKeyframes } from './extractors/keyframes';
import { extractAssets } from './extractors/assets';

interface Args {
  attach?: string;
  cdpHttp?: string;
  outDir: string;
  mode: 'automated' | 'attached';
  codexVersion?: string;
}

function makeLogger(prefix = 'codex-extract'): Logger {
  const base = (level: 'info' | 'warn' | 'error', p: string, msg: string, rest: unknown[]) => {
    const line = `[${new Date().toISOString()}] ${level.toUpperCase()} ${p} ${msg}`;
    if (level === 'error') console.error(line, ...rest);
    else if (level === 'warn') console.warn(line, ...rest);
    else console.log(line, ...rest);
  };
  return {
    info: (msg, ...rest) => base('info', prefix, msg, rest),
    warn: (msg, ...rest) => base('warn', prefix, msg, rest),
    error: (msg, ...rest) => base('error', prefix, msg, rest),
    child: (p: string) => makeLogger(`${prefix}:${p}`),
  };
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    outDir: join(process.cwd(), 'packages/ui/design-dump/codex'),
    mode: 'attached',
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--attach') args.attach = argv[++i];
    else if (a === '--cdp-http') args.cdpHttp = argv[++i];
    else if (a === '--out-dir') args.outDir = argv[++i];
    else if (a === '--mode') args.mode = argv[++i] as Args['mode'];
    else if (a === '--codex-version') args.codexVersion = argv[++i];
  }
  return args;
}

async function resolvePageTarget(httpUrl: string, log: Logger): Promise<string> {
  log.info(`resolving page target from ${httpUrl}/json`);
  const deadline = Date.now() + 10_000;
  let lastErr: unknown = null;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${httpUrl}/json`);
      if (r.ok) {
        const targets = (await r.json()) as Array<{ type: string; webSocketDebuggerUrl: string; url: string }>;
        const page = targets.find((t) => t.type === 'page');
        if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
      }
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`failed to resolve page target at ${httpUrl}/json: ${lastErr}`);
}

export async function runExtraction(args: Args): Promise<RunManifest> {
  const start = Date.now();
  const log = makeLogger();

  await mkdir(args.outDir, { recursive: true });

  const archetypesPath = join(import.meta.dir, 'archetypes.json');
  const archetypesFile = JSON.parse(await readFile(archetypesPath, 'utf8')) as { archetypes: Archetype[] };
  const archetypes = archetypesFile.archetypes;

  const wsUrl = args.attach ?? (args.cdpHttp ? await resolvePageTarget(args.cdpHttp, log) : null);
  if (!wsUrl) throw new Error('either --attach <ws://...> or --cdp-http <http://...> is required');

  const cdp = await connectCdp(wsUrl, log);

  // Enable domains we rely on
  await cdp.send('DOM.enable');
  await cdp.send('CSS.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable').catch(() => { /* some targets reject */ });

  // Let fonts settle
  await new Promise((r) => setTimeout(r, 500));

  const pageUrl = await cdp
    .send<{ result: { value: string } }>('Runtime.evaluate', {
      expression: 'location.href',
      returnByValue: true,
    })
    .then((r) => (typeof r.result.value === 'string' ? r.result.value : undefined))
    .catch(() => undefined);

  const ctx: ExtractorContext = { cdp, outDir: args.outDir, logger: log, archetypes };

  const warnings: string[] = [];
  const safe = async <T,>(name: string, fn: () => Promise<T>): Promise<T | null> => {
    try { return await fn(); }
    catch (err) {
      warnings.push(`${name}: ${err}`);
      log.error(`extractor ${name} failed`, err);
      return null;
    }
  };

  const sheets = await safe('stylesheets', () => extractStylesheets(ctx));
  const computed = await safe('computed', () => extractComputedStyles(ctx));
  const fonts = await safe('fonts', () => extractFonts(ctx));
  const tokens = await safe('tokens', () => extractTokens(ctx));
  const keyframes = await safe('keyframes', () => extractKeyframes(ctx));
  const assets = await safe('assets', () => extractAssets(ctx));

  await cdp.close();

  const manifest: RunManifest = {
    extractedAt: new Date().toISOString(),
    codexVersion: args.codexVersion,
    mode: args.mode,
    url: pageUrl,
    archetypes: {
      total: archetypes.length,
      matched: computed ? computed.filter((c) => !c.missing).length : 0,
      missing: computed ? computed.filter((c) => c.missing).map((c) => c.archetype) : [],
    },
    counts: {
      stylesheets: sheets?.filter((s) => s.text).length ?? 0,
      tokens: tokens?.length ?? 0,
      fonts: fonts?.length ?? 0,
      keyframes: keyframes ? Object.keys(keyframes).length : 0,
      assets: assets?.length ?? 0,
    },
    warnings,
    durationMs: Date.now() - start,
  };

  await writeFile(join(args.outDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  await writeFile(
    join(args.outDir, 'README.md'),
    renderReadme(manifest),
    'utf8',
  );

  log.info(`done in ${manifest.durationMs}ms: ${JSON.stringify(manifest.counts)}`);
  return manifest;
}

function renderReadme(m: RunManifest): string {
  return [
    '# Codex design dump',
    '',
    `- **extracted:** ${m.extractedAt}`,
    `- **Codex version:** ${m.codexVersion ?? '(unknown — pass --codex-version)'}`,
    `- **mode:** ${m.mode}`,
    `- **source URL:** ${m.url ?? '(unknown)'}`,
    `- **duration:** ${m.durationMs}ms`,
    '',
    '## Counts',
    '',
    `- stylesheets: ${m.counts.stylesheets}`,
    `- tokens: ${m.counts.tokens}`,
    `- fonts: ${m.counts.fonts}`,
    `- keyframes: ${m.counts.keyframes}`,
    `- assets: ${m.counts.assets}`,
    '',
    '## Archetypes',
    '',
    `- matched: ${m.archetypes.matched} / ${m.archetypes.total}`,
    ...(m.archetypes.missing.length
      ? ['- missing:', ...m.archetypes.missing.map((a) => `  - ${a}`)]
      : ['- all matched']),
    '',
    '## Warnings',
    '',
    ...(m.warnings.length ? m.warnings.map((w) => `- ${w}`) : ['- none']),
    '',
    '## Regenerate',
    '',
    '```bash',
    'cd solo && bun scripts/codex-extract/launch.ts',
    '```',
    '',
  ].join('\n');
}

// CLI entry
if (import.meta.main) {
  const args = parseArgs(process.argv.slice(2));
  runExtraction(args).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
