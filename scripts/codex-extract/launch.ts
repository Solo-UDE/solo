/**
 * Launcher — spawns Codex.app with --remote-debugging-port, waits for the CDP
 * HTTP endpoint to become reachable, then hands off to extract.ts.
 *
 * Usage:
 *   bun scripts/codex-extract/launch.ts                    # default
 *   bun scripts/codex-extract/launch.ts --dry-run          # plan only
 *   bun scripts/codex-extract/launch.ts --port 9223        # alternate port
 *   bun scripts/codex-extract/launch.ts --codex-path /Applications/Codex.app
 *   bun scripts/codex-extract/launch.ts --keep-open        # don't kill Codex after run
 */

import { readFile, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { runExtraction } from './extract';

interface LaunchArgs {
  port: number;
  codexPath: string;
  profileDir: string;
  dryRun: boolean;
  keepOpen: boolean;
  outDir: string;
}

function parseLaunchArgs(argv: string[]): LaunchArgs {
  const args: LaunchArgs = {
    port: 9222,
    codexPath: '/Applications/Codex.app',
    profileDir: join(process.cwd(), 'scripts/codex-extract/.tmp-profile'),
    dryRun: false,
    keepOpen: false,
    outDir: join(process.cwd(), 'packages/ui/design-dump/codex'),
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port') args.port = Number(argv[++i]);
    else if (a === '--codex-path') args.codexPath = argv[++i];
    else if (a === '--profile-dir') args.profileDir = argv[++i];
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--keep-open') args.keepOpen = true;
    else if (a === '--out-dir') args.outDir = argv[++i];
  }
  return args;
}

async function readCodexVersion(appPath: string): Promise<string | undefined> {
  const plistPath = join(appPath, 'Contents/Info.plist');
  if (!existsSync(plistPath)) return undefined;
  try {
    const text = await readFile(plistPath, 'utf8');
    // Info.plist may be XML or binary — try a simple regex pass for the XML case.
    const m = text.match(/<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/);
    return m?.[1];
  } catch {
    return undefined;
  }
}

async function waitForCdp(httpUrl: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${httpUrl}/json/version`);
      if (r.ok) return;
    } catch { /* keep polling */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`CDP endpoint never became reachable at ${httpUrl} (${timeoutMs}ms)`);
}

async function main() {
  const args = parseLaunchArgs(process.argv.slice(2));

  const codexBinary = join(args.codexPath, 'Contents/MacOS/Codex');
  const codexVersion = await readCodexVersion(args.codexPath);
  const httpUrl = `http://127.0.0.1:${args.port}`;

  console.log('[launch] plan:');
  console.log(`  codex binary : ${codexBinary}`);
  console.log(`  codex version: ${codexVersion ?? '(unknown)'}`);
  console.log(`  port         : ${args.port}`);
  console.log(`  profile dir  : ${args.profileDir} (will be cleared)`);
  console.log(`  out dir      : ${args.outDir}`);

  if (args.dryRun) {
    console.log('[launch] --dry-run: exiting before spawning Codex');
    return;
  }

  if (!existsSync(codexBinary)) {
    throw new Error(`Codex binary not found at ${codexBinary}. Pass --codex-path <app>.`);
  }

  // Clean profile dir
  try { await rm(args.profileDir, { recursive: true, force: true }); } catch { /* ignore */ }
  await mkdir(args.profileDir, { recursive: true });

  console.log('[launch] spawning Codex...');
  const proc = Bun.spawn({
    cmd: [
      codexBinary,
      `--remote-debugging-port=${args.port}`,
      `--user-data-dir=${args.profileDir}`,
    ],
    stdout: 'inherit',
    stderr: 'inherit',
  });

  try {
    console.log(`[launch] waiting for CDP at ${httpUrl} ...`);
    await waitForCdp(httpUrl, 15_000);
    console.log('[launch] CDP ready — running extraction');

    await runExtraction({
      cdpHttp: httpUrl,
      outDir: args.outDir,
      mode: 'automated',
      codexVersion,
    });
  } finally {
    if (!args.keepOpen) {
      console.log('[launch] terminating Codex');
      proc.kill();
      await proc.exited.catch(() => undefined);
    } else {
      console.log('[launch] --keep-open: leaving Codex running');
    }
  }
}

if (import.meta.main) {
  main().catch((err) => {
    console.error('[launch] failed:', err);
    process.exit(1);
  });
}
