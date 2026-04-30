import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const WORKSPACE_ROOT = path.resolve(SCRIPT_DIR, "..");

export const DESKTOP_AUTH_ENV_KEYS = [
  "SOLO_COGNITO_DOMAIN",
  "SOLO_COGNITO_CLIENT_ID",
  "SOLO_AWS_REGION",
  "SOLO_API_ENDPOINT",
];

export const CALLBACK_URI = "soloide://auth/callback";
export const SIGNOUT_URI = "soloide://auth/signout";

export function resolveAuthStage(baseEnv = process.env) {
  const stage = baseEnv.SOLO_AUTH_STAGE ?? baseEnv.SOLO_STAGE ?? "dev";
  return stage === "prod" ? "prod" : "dev";
}

export function candidateEnvFilesForStage(stage = resolveAuthStage()) {
  return [
    path.join(WORKSPACE_ROOT, "infra/.env"),
    path.join(WORKSPACE_ROOT, `infra/.env.${stage}`),
    path.join(WORKSPACE_ROOT, ".env"),
    path.join(WORKSPACE_ROOT, ".env.local"),
  ];
}

function parseEnvLine(rawLine) {
  const match = rawLine.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (!match) return null;

  let [, key, value] = match;
  value = value.trim();

  const quoted =
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"));
  if (quoted) {
    value = value.slice(1, -1);
  } else {
    value = value.replace(/\s+#.*$/, "").trim();
  }

  return [key, value];
}

function parseEnvFile(contents) {
  const parsed = {};
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const entry = parseEnvLine(rawLine);
    if (!entry) continue;
    const [key, value] = entry;
    parsed[key] = value;
  }
  return parsed;
}

export function resolveDesktopAuthEnv(baseEnv = process.env) {
  const stage = resolveAuthStage(baseEnv);
  const envFromFiles = {};
  const sources = {};
  const loadedFiles = [];

  for (const filePath of candidateEnvFilesForStage(stage)) {
    if (!fs.existsSync(filePath)) continue;
    loadedFiles.push(filePath);
    const parsed = parseEnvFile(fs.readFileSync(filePath, "utf8"));
    for (const [key, value] of Object.entries(parsed)) {
      envFromFiles[key] = value;
      sources[key] = filePath;
    }
  }

  // For auth-critical keys the .env file is authoritative — direnv/shell-cached
  // values drift after a CDK redeploy and cargo then bakes the stale value into
  // the binary via option_env!. Prefer file values for these keys; everything
  // else still honours the shell env.
  const AUTH_FILE_WINS = new Set([
    "SOLO_COGNITO_DOMAIN",
    "SOLO_COGNITO_USER_POOL_ID",
    "SOLO_COGNITO_CLIENT_ID",
    "SOLO_COGNITO_IDENTITY_POOL_ID",
    "SOLO_AWS_REGION",
    "SOLO_API_ENDPOINT",
    "SOLO_GITHUB_OIDC_ISSUER",
    "SOLO_GITHUB_CALLBACK",
  ]);

  const env = {};
  for (const [key, value] of Object.entries({ ...baseEnv, ...envFromFiles })) {
    env[key] = value;
  }
  for (const [key, value] of Object.entries(baseEnv)) {
    if (typeof value === "string" && value.trim().length > 0) {
      sources[key] = "process";
    }
  }
  for (const [key, fileValue] of Object.entries(envFromFiles)) {
    if (AUTH_FILE_WINS.has(key)) {
      const shellValue = baseEnv[key];
      if (
        typeof shellValue === "string" &&
        shellValue.trim().length > 0 &&
        shellValue !== fileValue
      ) {
        console.warn(
          `[desktop-auth-env] shell env ${key}=${shellValue} ` +
            `disagrees with file ${fileValue} — preferring file. ` +
            `Run \`direnv reload\` to refresh your shell.`,
        );
      }
      env[key] = fileValue;
      sources[key] = sources[key] ?? "file";
    }
  }

  const effective = Object.fromEntries(
    DESKTOP_AUTH_ENV_KEYS.map((key) => [key, env[key] ?? ""])
  );
  const missing = DESKTOP_AUTH_ENV_KEYS.filter((key) => {
    const value = env[key];
    return typeof value !== "string" || value.trim().length === 0;
  });

  return { env, effective, sources, missing, loadedFiles };
}

export function inferDesktopAuthStage(effective) {
  const domain = effective.SOLO_COGNITO_DOMAIN ?? "";
  if (domain.includes("solo-ide-dev.")) return "dev";
  if (domain.includes("solo-ide-prod.")) return "prod";
  return "custom";
}
