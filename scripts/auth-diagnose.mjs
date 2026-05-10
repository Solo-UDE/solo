#!/usr/bin/env bun
/**
 * Standalone auth diagnostic — runs from the terminal when the GUI is broken.
 * Checks env resolution, AWS Cognito live deployment state, URL reachability,
 * and flags drift between local env and deployed stack.
 *
 * Run:  bun run auth:diagnose
 */

import { spawnSync } from "node:child_process";
import {
  resolveAuthStage,
  resolveDesktopAuthEnv,
  CALLBACK_URI,
  SIGNOUT_URI,
} from "./desktop-auth-env.mjs";

const profile = process.env.AWS_PROFILE ?? "solo";
const region = process.env.AWS_REGION ?? "us-east-1";
const requestedStage =
  process.argv[2] === "prod" || process.argv[2] === "dev"
    ? process.argv[2]
    : resolveAuthStage(process.env);
const AUTH_PROVIDERS = ["GitHub", "Google"];

function section(title) {
  console.log("");
  console.log(`═══ ${title} ═══`);
}

function fmt(label, value) {
  console.log(`  ${label.padEnd(28)} ${value}`);
}

function runAws(args) {
  const result = spawnSync("aws", ["--profile", profile, "--region", region, ...args], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    return { ok: false, error: (result.stderr || result.stdout).trim() };
  }
  try {
    return { ok: true, data: JSON.parse(result.stdout) };
  } catch (e) {
    return { ok: false, error: `JSON parse failed: ${e.message}` };
  }
}

async function probe(url, label) {
  try {
    const res = await fetch(url, { redirect: "manual" });
    const location = res.headers.get("location");
    const body = res.status >= 300 && res.status < 400 ? "" : (await res.text()).slice(0, 200);
    fmt(label, `HTTP ${res.status}${location ? ` -> ${location.slice(0, 100)}${location.length > 100 ? "..." : ""}` : ""}`);
    if (body) fmt("  body[:200]", body);
    return { status: res.status, location, body };
  } catch (e) {
    fmt(label, `ERR: ${e.message}`);
    return { error: e.message };
  }
}

function authorizeUrlForProvider(domain, clientId, provider) {
  return `https://${domain}/oauth2/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(CALLBACK_URI)}&scope=${encodeURIComponent("openid email profile")}&identity_provider=${encodeURIComponent(provider)}&state=diagnostic&code_challenge=XXXdiagnosticXXX&code_challenge_method=S256`;
}

function describeProviderDetails(details = {}) {
  return Object.entries(details)
    .map(([key, value]) => {
      if (/secret/i.test(key)) {
        return `${key}=${value ? "[present]" : "[missing]"}`;
      }
      if (/client_id/i.test(key)) {
        return `${key}=${value ? "[present]" : "[missing]"}`;
      }
      return key;
    })
    .join(", ");
}

// 1. Local env
section("LOCAL ENV (resolved by desktop-auth-env.mjs)");
const { effective, sources, missing, loadedFiles } = resolveDesktopAuthEnv({
  ...process.env,
  SOLO_AUTH_STAGE: requestedStage,
});
fmt("requested stage", requestedStage);
if (loadedFiles.length === 0) {
  console.log("  (no env files found)");
}
for (const file of loadedFiles) fmt("  file", file);
for (const [key, value] of Object.entries(effective)) {
  fmt(key, value || "(missing)");
}
if (missing.length) {
  console.log(`  ⚠ Missing: ${missing.join(", ")}`);
}
fmt("CALLBACK_URI", CALLBACK_URI);
fmt("SIGNOUT_URI", SIGNOUT_URI);
for (const [key, src] of Object.entries(sources)) {
  if (effective[key]) fmt(`  source[${key}]`, src);
}

// 2. AWS live state
section("AWS COGNITO LIVE STATE");
const stack = runAws([
  "cloudformation", "describe-stacks",
  "--stack-name", `SoloAuth-${requestedStage}`,
  "--query", "Stacks[0].Outputs",
  "--output", "json",
]);

let livePoolId, liveClientId, liveDomain;
if (stack.ok) {
  const outs = Object.fromEntries(stack.data.map((o) => [o.OutputKey, o.OutputValue]));
  livePoolId = outs.UserPoolId;
  liveClientId = outs.UserPoolClientId;
  liveDomain = outs.CognitoDomain;
  fmt("UserPoolId (live)", livePoolId);
  fmt("UserPoolClientId (live)", liveClientId);
  fmt("CognitoDomain (live)", liveDomain);
} else {
  fmt("CloudFormation", `ERR: ${stack.error}`);
}

// 3. Drift check
section("DRIFT CHECK (local vs deployed)");
const drift = [];
if (livePoolId && effective.SOLO_COGNITO_USER_POOL_ID && livePoolId !== effective.SOLO_COGNITO_USER_POOL_ID) {
  drift.push(`UserPoolId: local=${effective.SOLO_COGNITO_USER_POOL_ID} live=${livePoolId}`);
}
if (liveClientId && effective.SOLO_COGNITO_CLIENT_ID && liveClientId !== effective.SOLO_COGNITO_CLIENT_ID) {
  drift.push(`ClientId: local=${effective.SOLO_COGNITO_CLIENT_ID} live=${liveClientId}`);
}
if (liveDomain && effective.SOLO_COGNITO_DOMAIN && liveDomain !== effective.SOLO_COGNITO_DOMAIN) {
  drift.push(`Domain: local=${effective.SOLO_COGNITO_DOMAIN} live=${liveDomain}`);
}
if (drift.length === 0) {
  console.log("  ✓ no drift — local env matches deployed stack");
} else {
  for (const d of drift) console.log(`  ⚠ ${d}`);
  console.log(`\n  Fix: bun infra/scripts/sync-env.mjs ${requestedStage}`);
}

// 4. Deployed URL allowlist
section("DEPLOYED URL ALLOWLIST");
if (livePoolId && liveClientId) {
  const client = runAws([
    "cognito-idp", "describe-user-pool-client",
    "--user-pool-id", livePoolId,
    "--client-id", liveClientId,
    "--query", "UserPoolClient.{CallbackURLs:CallbackURLs,LogoutURLs:LogoutURLs,SupportedIdentityProviders:SupportedIdentityProviders}",
    "--output", "json",
  ]);
  if (client.ok) {
    fmt("SupportedIdentityProviders", client.data.SupportedIdentityProviders.join(", "));
    console.log(`  CallbackURLs:`);
    for (const u of client.data.CallbackURLs) console.log(`    - ${u}`);
    console.log(`  LogoutURLs:`);
    for (const u of client.data.LogoutURLs) console.log(`    - ${u}`);
    if (!client.data.CallbackURLs.includes(CALLBACK_URI)) {
      console.log(`  ⚠ ${CALLBACK_URI} NOT in CallbackURLs`);
    }
    if (!client.data.LogoutURLs.includes(SIGNOUT_URI)) {
      console.log(`  ⚠ ${SIGNOUT_URI} NOT in LogoutURLs`);
    }
  } else {
    fmt("describe-user-pool-client", `ERR: ${client.error}`);
  }

  const pool = runAws([
    "cognito-idp", "describe-user-pool",
    "--user-pool-id", livePoolId,
    "--query", "UserPool.LambdaConfig",
    "--output", "json",
  ]);
  if (pool.ok) {
    fmt("PreSignUp trigger", pool.data?.PreSignUp ? "attached" : "MISSING");
    fmt("PostAuthentication trigger", pool.data?.PostAuthentication ? "attached" : "MISSING");
  } else {
    fmt("describe-user-pool", `ERR: ${pool.error}`);
  }
}

// 5. Identity provider config
section("IDENTITY PROVIDERS");
if (livePoolId) {
  for (const provider of AUTH_PROVIDERS) {
    const idp = runAws([
      "cognito-idp", "describe-identity-provider",
      "--user-pool-id", livePoolId,
      "--provider-name", provider,
      "--query", "IdentityProvider.{ProviderName:ProviderName,ProviderType:ProviderType,ProviderDetails:ProviderDetails,AttributeMapping:AttributeMapping}",
      "--output", "json",
    ]);
    if (idp.ok) {
      fmt(`${provider} type`, idp.data.ProviderType);
      fmt(`${provider} provider details`, describeProviderDetails(idp.data.ProviderDetails));
      fmt(`${provider} mapped attrs`, Object.keys(idp.data.AttributeMapping ?? {}).join(", ") || "(none)");
    } else {
      fmt(provider, `ERR: ${idp.error}`);
    }
  }
}

// 6. Live URL probe
section("COGNITO URL PROBE (exact URLs the desktop app would build)");
const domain = effective.SOLO_COGNITO_DOMAIN || liveDomain;
const clientId = effective.SOLO_COGNITO_CLIENT_ID || liveClientId;
if (domain && clientId) {
  const authorizeUrls = AUTH_PROVIDERS.map((provider) => [
    provider,
    authorizeUrlForProvider(domain, clientId, provider),
  ]);
  for (const [provider, authorizeUrl] of authorizeUrls) {
    await probe(authorizeUrl, `authorize ${provider}`);
  }
  const logoutUrl = `https://${domain}/logout?client_id=${clientId}&logout_uri=${encodeURIComponent(SIGNOUT_URI)}`;
  await probe(logoutUrl, "logout");
  console.log("");
  for (const [provider, authorizeUrl] of authorizeUrls) {
    console.log(`  sample ${provider} authorize URL:\n    ${authorizeUrl}`);
  }
  console.log(`  sample logout URL:\n    ${logoutUrl}`);
}

// 7. Default browser
section("MAC DEFAULT BROWSER");
const duti = spawnSync("duti", ["-x", "html"], { encoding: "utf8" });
if (duti.status === 0) {
  console.log("  " + duti.stdout.trim().replace(/\n/g, "\n  "));
} else {
  const lsreg = spawnSync(
    "/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister",
    ["-dump"],
    { encoding: "utf8" },
  );
  if (lsreg.status === 0) {
    const match = lsreg.stdout.match(/http:\s*\n.*?bundle id:\s*([^\n]+)/s);
    fmt("http handler bundle id", match ? match[1].trim() : "(unknown)");
  } else {
    fmt("lookup", "duti not installed; run `brew install duti` for browser detection");
  }
}

console.log("");
console.log("Diagnostic complete.");
