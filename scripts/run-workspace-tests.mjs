import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const workspaceRoots = ["apps", "packages"];

let foundTestScript = false;

for (const workspaceRoot of workspaceRoots) {
  const rootPath = path.join(repoRoot, workspaceRoot);

  if (!existsSync(rootPath)) {
    continue;
  }

  for (const entry of readdirSync(rootPath, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }

    const packageDir = path.join(rootPath, entry.name);
    const packageJsonPath = path.join(packageDir, "package.json");

    if (!existsSync(packageJsonPath)) {
      continue;
    }

    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));

    if (!packageJson.scripts?.test) {
      console.log(`Skipping ${path.relative(repoRoot, packageDir)} (no test script)`);
      continue;
    }

    foundTestScript = true;
    console.log(`Running workspace tests in ${path.relative(repoRoot, packageDir)}`);

    const result = spawnSync("bun", ["run", "test"], {
      cwd: packageDir,
      stdio: "inherit",
    });

    if (result.status !== 0) {
      process.exit(result.status ?? 1);
    }
  }
}

if (!foundTestScript) {
  console.log("No workspace test scripts were found under apps/ or packages/.");
}
