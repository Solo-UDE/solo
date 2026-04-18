import { spawn, spawnSync } from "node:child_process";

import {
  CALLBACK_URI,
  resolveDesktopAuthEnv,
  WORKSPACE_ROOT,
} from "./desktop-auth-env.mjs";

const bunExecutable = process.versions.bun ? process.execPath : "bun";

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

console.log("Launching Solo desktop auth flow in dev mode.");
console.log(`- Cognito domain: ${effective.SOLO_COGNITO_DOMAIN}`);
console.log(`- API endpoint: ${effective.SOLO_API_ENDPOINT}`);
console.log(`- Callback URI: ${CALLBACK_URI}`);
console.log("- AuthGuard: enabled");
if (loadedFiles.length > 0) {
  console.log(`- Loaded env files: ${loadedFiles.join(", ")}`);
}

const bridgeBuild = spawnSync(bunExecutable, ["run", "bridge:build"], {
  cwd: WORKSPACE_ROOT,
  stdio: "inherit",
});

if (bridgeBuild.status !== 0) {
  process.exit(bridgeBuild.status ?? 1);
}

const child = spawn(bunExecutable, ["run", "--filter", "@solo/desktop", "dev"], {
  cwd: WORKSPACE_ROOT,
  env: {
    ...env,
    VITE_AUTH_ENABLED: "1",
  },
  stdio: "inherit",
});

child.on("error", (error) => {
  console.error("Failed to launch `bun run --filter @solo/desktop dev`:", error);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  } else {
    process.exit(code ?? 1);
  }
});
