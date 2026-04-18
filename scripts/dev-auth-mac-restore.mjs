import fs from "node:fs";
import { spawnSync } from "node:child_process";

const liveAppPath = "/Applications/Solo.app";
const backupAppPath = "/Applications/Solo (Production Backup).app";
const launchServicesPath =
  "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    ...options,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

if (process.platform !== "darwin") {
  console.error("`bun run dev:auth:mac:restore` is only supported on macOS.");
  process.exit(1);
}

if (!fs.existsSync(backupAppPath)) {
  console.error(`No backup app found at ${backupAppPath}`);
  process.exit(1);
}

console.log(`Restoring ${backupAppPath} to ${liveAppPath}`);
fs.rmSync(liveAppPath, { recursive: true, force: true });
run("/usr/bin/ditto", [backupAppPath, liveAppPath]);
fs.rmSync(backupAppPath, { recursive: true, force: true });

console.log("Refreshing Launch Services for soloide://");
run(launchServicesPath, ["-f", liveAppPath]);

console.log("Opening restored app");
run("/usr/bin/open", [liveAppPath]);
