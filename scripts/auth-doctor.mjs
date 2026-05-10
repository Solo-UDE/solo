import {
  CALLBACK_URI,
  DESKTOP_AUTH_ENV_KEYS,
  DESKTOP_AUTH_OPTIONAL_ENV_KEYS,
  SIGNOUT_URI,
  inferDesktopAuthStage,
  resolveDesktopAuthEnv,
} from "./desktop-auth-env.mjs";

const { effective, missing, sources, loadedFiles } = resolveDesktopAuthEnv();
const stage = inferDesktopAuthStage(effective);

console.log("Solo desktop auth doctor");
console.log("");
console.log(`Inferred stage: ${stage}`);
console.log(`Callback URI: ${CALLBACK_URI}`);
console.log(`Sign-out URI: ${SIGNOUT_URI}`);
const authEnabled = process.env.VITE_AUTH_ENABLED === "1" || process.env.VITE_AUTH_BYPASS === "0";
console.log(`AuthGuard in dev: ${authEnabled ? "enabled" : "bypassed"}`);
console.log("");

if (loadedFiles.length > 0) {
  console.log("Loaded env files:");
  for (const filePath of loadedFiles) {
    console.log(`- ${filePath}`);
  }
  console.log("");
}

console.log("Effective desktop auth env:");
for (const key of DESKTOP_AUTH_ENV_KEYS) {
  const value = effective[key] || "<missing>";
  const source = sources[key] === "process" ? "process env" : sources[key] ?? "unset";
  console.log(`- ${key}=${value}`);
  console.log(`  source: ${source}`);
}

console.log("");
console.log("Optional deployed auth env:");
for (const key of DESKTOP_AUTH_OPTIONAL_ENV_KEYS) {
  const value = effective[key] || "<unset>";
  const source = sources[key] === "process" ? "process env" : sources[key] ?? "unset";
  console.log(`- ${key}=${value}`);
  console.log(`  source: ${source}`);
}

if (missing.length > 0) {
  console.log("");
  console.log("Missing required desktop auth env:");
  for (const key of missing) {
    console.log(`- ${key}`);
  }
  process.exit(1);
}

console.log("");
console.log("Desktop auth config looks complete.");
