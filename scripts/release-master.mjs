#!/usr/bin/env node

/**
 * Cut a Solo desktop release from master.
 *
 * This script bumps the app version, commits that bump when needed, creates an
 * annotated v* tag, pushes master + the tag, and watches the GitHub Actions
 * Release workflow that publishes artifacts to Solo-UDE/solo-releases.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

process.on("uncaughtException", (error) => {
  console.error(`Error: ${error.message}`);
  process.exit(1);
});

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

function usage() {
  console.error(`Usage:
  bun run release:master <version> [--notes-file <path>] [--notes <text>] [--no-watch]

Examples:
  bun run release:master 0.2.0-beta.2 --notes-file ./release-notes.md
  bun run release:master 0.2.1 --notes "Bug fixes and notarized DMG updates"
`);
}

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  usage();
  process.exit(0);
}

const version = args.shift();
let notesFile = "";
let notes = "";
let watch = true;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === "--notes-file") {
    notesFile = args[++i] ?? "";
  } else if (arg === "--notes") {
    notes = args[++i] ?? "";
  } else if (arg === "--no-watch") {
    watch = false;
  } else {
    usage();
    throw new Error(`Unknown argument: ${arg}`);
  }
}

if (!version || !/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) {
  usage();
  throw new Error(`Invalid or missing semver version: ${version ?? "(missing)"}`);
}

const tag = `v${version}`;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    encoding: "utf8",
  });
  if (result.status !== 0) {
    const stderr = result.stderr?.trim();
    throw new Error(`${command} ${args.join(" ")} failed${stderr ? `\n${stderr}` : ""}`);
  }
  return options.capture ? result.stdout.trim() : "";
}

function hasCommand(command) {
  const result = spawnSync("sh", ["-lc", `command -v ${command}`], {
    cwd: root,
    stdio: "ignore",
  });
  return result.status === 0;
}

function git(args, options) {
  return run("git", args, options);
}

function currentBranch() {
  return git(["branch", "--show-current"], { capture: true });
}

function trackedStatus() {
  return git(["status", "--porcelain", "--untracked-files=no"], { capture: true });
}

function remoteTagExists() {
  const result = spawnSync("git", ["ls-remote", "--exit-code", "--tags", "origin", `refs/tags/${tag}`], {
    cwd: root,
    stdio: "ignore",
  });
  return result.status === 0;
}

function publicReleaseExists() {
  if (!hasCommand("gh")) return false;
  const result = spawnSync("gh", ["release", "view", tag, "--repo", "Solo-UDE/solo-releases"], {
    cwd: root,
    stdio: "ignore",
  });
  return result.status === 0;
}

function localTagExists() {
  const result = spawnSync("git", ["rev-parse", "-q", "--verify", `refs/tags/${tag}`], {
    cwd: root,
    stdio: "ignore",
  });
  return result.status === 0;
}

function releaseNotes() {
  if (notesFile) {
    const filePath = resolve(root, notesFile);
    if (!existsSync(filePath)) throw new Error(`Release notes file does not exist: ${filePath}`);
    return readFileSync(filePath, "utf8");
  }
  if (notes) return `Solo ${tag}\n\n${notes}\n`;
  return `Solo ${tag}\n\nRelease from master.\n`;
}

function changedTrackedFiles() {
  const output = trackedStatus();
  if (!output) return [];
  return output.split("\n").map((line) => line.slice(3));
}

function waitForReleaseRun(headSha) {
  if (!watch) return;
  if (!hasCommand("gh")) {
    console.log("gh is not available; watch the release manually in GitHub Actions.");
    return;
  }

  console.log("Waiting for the Release workflow to appear...");
  for (let attempt = 0; attempt < 24; attempt++) {
    const result = spawnSync(
      "gh",
      [
        "run",
        "list",
        "--repo",
        "Solo-UDE/solo",
        "--workflow",
        "Release",
        "--limit",
        "20",
        "--json",
        "databaseId,headSha,event,status,displayTitle",
      ],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );

    if (result.status === 0) {
      const runs = JSON.parse(result.stdout || "[]");
      const run = runs.find((item) => item.headSha === headSha && item.event === "push");
      if (run) {
        console.log(`Watching Release workflow run ${run.databaseId}...`);
        runCommandForWatch(run.databaseId);
        return;
      }
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5000);
  }

  console.log("Release workflow did not appear yet. Check: https://github.com/Solo-UDE/solo/actions/workflows/release.yml");
}

function runCommandForWatch(runId) {
  const result = spawnSync("gh", ["run", "watch", String(runId), "--repo", "Solo-UDE/solo"], {
    cwd: root,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`gh run watch ${runId} failed`);
  }
}

if (currentBranch() !== "master") {
  throw new Error("Release must be cut from the local master branch.");
}

if (trackedStatus()) {
  throw new Error("Tracked working tree changes exist. Commit or stash them before releasing.");
}

console.log("Fetching origin/master and tags...");
git(["fetch", "origin", "master", "--tags"]);

const localHeadBefore = git(["rev-parse", "HEAD"], { capture: true });
const originMaster = git(["rev-parse", "origin/master"], { capture: true });
if (localHeadBefore !== originMaster) {
  throw new Error("Local master is not exactly origin/master. Pull/rebase before releasing.");
}

if (localTagExists() || remoteTagExists()) {
  throw new Error(`Tag ${tag} already exists locally or on origin.`);
}

if (publicReleaseExists()) {
  throw new Error(`Release ${tag} already exists on Solo-UDE/solo-releases.`);
}

console.log(`Bumping version to ${version}...`);
run("node", ["scripts/bump-version.mjs", version]);

const allowedVersionFiles = new Set([
  "Cargo.toml",
  "apps/desktop/src-tauri/tauri.conf.json",
  "apps/desktop/package.json",
]);
const changed = changedTrackedFiles();
const unexpected = changed.filter((file) => !allowedVersionFiles.has(file));
if (unexpected.length > 0) {
  throw new Error(`Version bump touched unexpected tracked files:\n${unexpected.join("\n")}`);
}

if (changed.length > 0) {
  git(["add", ...allowedVersionFiles]);
  git(["commit", "-m", `release: ${tag}`]);
} else {
  console.log("Version files already match requested version; no version commit needed.");
}

const releaseHead = git(["rev-parse", "HEAD"], { capture: true });
const noteDir = mkdtempSync(resolve(tmpdir(), "solo-release-notes-"));
const notePath = resolve(noteDir, "notes.md");
writeFileSync(notePath, releaseNotes());

try {
  git(["tag", "-a", tag, "-F", notePath]);
} finally {
  rmSync(noteDir, { recursive: true, force: true });
}

console.log(`Pushing master and ${tag}...`);
git(["push", "origin", "master"]);
git(["push", "origin", tag]);

console.log("");
console.log(`Release tag pushed: ${tag}`);
console.log("GitHub Actions will publish artifacts to: https://github.com/Solo-UDE/solo-releases/releases");
waitForReleaseRun(releaseHead);
