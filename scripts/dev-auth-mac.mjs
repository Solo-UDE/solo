import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { resolveDesktopAuthEnv, WORKSPACE_ROOT } from "./desktop-auth-env.mjs";

const bunExecutable = process.versions.bun ? process.execPath : "bun";
const bunBinDir = path.dirname(bunExecutable);
const desktopDir = path.join(WORKSPACE_ROOT, "apps/desktop");
const builtAppPath = path.join(WORKSPACE_ROOT, "target/debug/bundle/macos/Solo.app");
const liveAppPath = "/Applications/Solo.app";
const backupAppPath = "/Applications/Solo (Production Backup).app";
const launchServicesPath =
  "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";
const installMarkerPath = path.join(
  liveAppPath,
  "Contents/Resources/solo-local-auth-install.json",
);

function fail(message, exitCode = 1) {
  console.error(message);
  process.exit(exitCode);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    ...options,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function exists(targetPath) {
  return fs.existsSync(targetPath);
}

function isManagedInstall(appPath = liveAppPath) {
  return exists(path.join(appPath, "Contents/Resources/solo-local-auth-install.json"));
}

function ensureBackupIfNeeded() {
  if (!exists(liveAppPath)) {
    return;
  }

  if (isManagedInstall(liveAppPath)) {
    console.log(`Replacing existing local auth install at ${liveAppPath}`);
    return;
  }

  if (!exists(backupAppPath)) {
    console.log(`Backing up existing app to ${backupAppPath}`);
    run("/usr/bin/ditto", [liveAppPath, backupAppPath]);
    return;
  }

  console.log(`Keeping existing backup at ${backupAppPath}`);
}

function writeInstallMarker() {
  fs.mkdirSync(path.dirname(installMarkerPath), { recursive: true });
  fs.writeFileSync(
    installMarkerPath,
    `${JSON.stringify(
      {
        workspaceRoot: WORKSPACE_ROOT,
        installedAt: new Date().toISOString(),
        backupAppPath: exists(backupAppPath) ? backupAppPath : null,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

if (process.platform !== "darwin") {
  fail("`bun run dev:auth:mac` is only supported on macOS.");
}

const { env, effective, missing, loadedFiles } = resolveDesktopAuthEnv();
if (missing.length > 0) {
  console.error("Desktop auth config is incomplete.");
  for (const key of missing) {
    console.error(`- Missing ${key}`);
  }
  if (loadedFiles.length > 0) {
    console.error("\nLoaded env files:");
    for (const filePath of loadedFiles) {
      console.error(`- ${filePath}`);
    }
  }
  console.error("\nRun `bun run auth:doctor` for a full report.");
  process.exit(1);
}

const commandEnv = {
  ...env,
  PATH: `${bunBinDir}:${process.env.PATH ?? ""}`,
};

console.log("Building local macOS auth test app.");
console.log(`- Cognito domain: ${effective.SOLO_COGNITO_DOMAIN}`);
console.log(`- API endpoint: ${effective.SOLO_API_ENDPOINT}`);
if (loadedFiles.length > 0) {
  console.log(`- Loaded env files: ${loadedFiles.join(", ")}`);
}

run(bunExecutable, ["run", "bridge:build"], {
  cwd: WORKSPACE_ROOT,
  env: commandEnv,
});

run(
  bunExecutable,
  [
    "x",
    "tauri",
    "build",
    "--debug",
    "--bundles",
    "app",
    "--config",
    '{"bundle":{"createUpdaterArtifacts":false}}',
  ],
  {
    cwd: desktopDir,
    env: commandEnv,
  },
);

if (!exists(builtAppPath)) {
  fail(`Expected built app bundle at ${builtAppPath}`);
}

ensureBackupIfNeeded();

console.log(`Installing local debug app to ${liveAppPath}`);
fs.rmSync(liveAppPath, { recursive: true, force: true });
run("/usr/bin/ditto", [builtAppPath, liveAppPath]);
writeInstallMarker();

console.log("Refreshing Launch Services for soloide://");
run(launchServicesPath, ["-f", liveAppPath]);

console.log("Opening installed app");
run("/usr/bin/open", [liveAppPath]);

console.log("");
console.log("Local macOS auth build is installed.");
console.log(`- Active app: ${liveAppPath}`);
if (exists(backupAppPath)) {
  console.log(`- Backup app: ${backupAppPath}`);
  console.log("- Restore with: bun run dev:auth:mac:restore");
}
