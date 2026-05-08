import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const bun = process.env.BUN ?? "bun";

const defaultRustLog = "solo_desktop_lib=info,solo_voice=warn,tauri=info";
const children = [
  {
    name: "agent-bridge",
    cwd: join(root, "agent-bridge"),
    env: process.env,
  },
  {
    name: "desktop",
    cwd: join(root, "apps", "desktop"),
    env: {
      ...process.env,
      RUST_LOG: process.env.RUST_LOG ?? defaultRustLog,
    },
  },
].map((config) => {
  console.log(`[dev] starting ${config.name}`);
  return {
    ...config,
    child: spawn(bun, ["run", "dev"], {
      cwd: config.cwd,
      env: config.env,
      stdio: "inherit",
    }),
  };
});

let shuttingDown = false;
let remaining = children.length;
let exitCode = 0;

function shutdown(code = 0, signal = "SIGTERM") {
  if (!shuttingDown) {
    shuttingDown = true;
    exitCode = code;
    for (const { child } of children) {
      if (!child.killed && child.exitCode === null) {
        child.kill(signal);
      }
    }
  }
}

for (const { name, child } of children) {
  child.on("exit", (code, signal) => {
    remaining -= 1;
    if (!shuttingDown) {
      console.error(`[dev] ${name} exited${signal ? ` via ${signal}` : ` with code ${code ?? 0}`}`);
      shutdown(code ?? 1);
    }
    if (remaining === 0) {
      process.exit(exitCode);
    }
  });
  child.on("error", (error) => {
    console.error(`[dev] failed to start ${name}: ${error.message}`);
    shutdown(1);
  });
}

process.on("SIGINT", () => shutdown(130, "SIGINT"));
process.on("SIGTERM", () => shutdown(143, "SIGTERM"));
