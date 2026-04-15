#!/usr/bin/env node

// src/index.ts
import * as readline from "readline";

// src/logger.ts
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
var LOG_LEVEL_ORDER = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
};
var stderrLevel = "info";
var fileLevel = "debug";
var logFilePath = null;
var logFileStream = null;
var MAX_FILE_SIZE = 10 * 1024 * 1024;
var MAX_ROTATED_FILES = 5;
var debugCallback = null;
var activeCorrelationId;
function configureFileLogging(logDir) {
  const dir = logDir ?? path.join(os.homedir(), ".solo", "logs");
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
  }
  logFilePath = path.join(dir, "agent-bridge.log");
  rotateIfNeeded();
  logFileStream = fs.createWriteStream(logFilePath, { flags: "a" });
  logFileStream.on("error", (err) => {
    process.stderr.write(`[logger] File write error: ${err.message}
`);
    logFileStream = null;
  });
}
function setCorrelationId(id) {
  activeCorrelationId = id;
}
function rotateIfNeeded() {
  if (!logFilePath) return;
  let stat;
  try {
    stat = fs.statSync(logFilePath);
  } catch {
    return;
  }
  if (stat.size < MAX_FILE_SIZE) return;
  if (logFileStream) {
    logFileStream.end();
    logFileStream = null;
  }
  for (let i = MAX_ROTATED_FILES; i >= 1; i--) {
    const from = i === 1 ? logFilePath : `${logFilePath}.${i - 1}`;
    const to = `${logFilePath}.${i}`;
    try {
      if (i === MAX_ROTATED_FILES) {
        fs.unlinkSync(to);
      }
    } catch {
    }
    try {
      fs.renameSync(from, to);
    } catch {
    }
  }
}
function shouldLog(entryLevel, minLevel) {
  return LOG_LEVEL_ORDER[entryLevel] >= LOG_LEVEL_ORDER[minLevel];
}
function writeEntry(entry) {
  if (shouldLog(entry.level, stderrLevel)) {
    const contextStr = entry.context ? ` ${JSON.stringify(entry.context)}` : "";
    const correlStr = entry.correlationId ? ` [${entry.correlationId.slice(0, 8)}]` : "";
    const durationStr = entry.durationMs !== void 0 ? ` (${entry.durationMs}ms)` : "";
    const formatted = `[${entry.timestamp}] [${entry.prefix}] [${entry.level.toUpperCase()}]${correlStr}${contextStr} ${entry.message}${durationStr}`;
    process.stderr.write(formatted + "\n");
  }
  if (logFileStream && shouldLog(entry.level, fileLevel)) {
    const jsonLine = JSON.stringify(entry) + "\n";
    logFileStream.write(jsonLine);
    if (logFilePath) {
      try {
        const stat = fs.statSync(logFilePath);
        if (stat.size >= MAX_FILE_SIZE) {
          rotateIfNeeded();
          logFileStream = fs.createWriteStream(logFilePath, { flags: "a" });
        }
      } catch {
      }
    }
  }
  if (debugCallback) {
    try {
      debugCallback(entry);
    } catch {
    }
  }
}
function createLogger(prefix) {
  const buildEntry = (level, contextOrMessage, message) => {
    const isContextOverload = typeof contextOrMessage !== "string";
    return {
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      level,
      prefix,
      message: isContextOverload ? message ?? "" : contextOrMessage,
      context: isContextOverload ? contextOrMessage : void 0,
      correlationId: activeCorrelationId
    };
  };
  return {
    debug(contextOrMessage, message) {
      writeEntry(buildEntry("debug", contextOrMessage, message));
    },
    info(contextOrMessage, message) {
      writeEntry(buildEntry("info", contextOrMessage, message));
    },
    warn(contextOrMessage, message) {
      writeEntry(buildEntry("warn", contextOrMessage, message));
    },
    error(contextOrMessage, message) {
      writeEntry(buildEntry("error", contextOrMessage, message));
    }
  };
}
function shutdownFileLogging() {
  if (logFileStream) {
    logFileStream.end();
    logFileStream = null;
  }
}

// src/session-manager.ts
import { randomUUID } from "crypto";

// src/agent.ts
import { query } from "@anthropic-ai/claude-agent-sdk";
import * as fs4 from "fs";

// src/credentials.ts
import { execFileSync } from "child_process";
import { readFileSync } from "fs";
import { join as join2 } from "path";
import { homedir as homedir2 } from "os";
var logger = createLogger("ClaudeCredentials");
var CLAUDE_CODE_OAUTH_CLIENT_ID = "claude-desktop";
var CLAUDE_CODE_TOKEN_ENDPOINT = "https://api.anthropic.com/v1/oauth/token";
var EXPIRY_BUFFER_MS = 3e5;
function isClaudeCredentialsFile(value) {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const obj = value;
  if (obj.claudeAiOauth === void 0) {
    return true;
  }
  if (typeof obj.claudeAiOauth !== "object" || obj.claudeAiOauth === null) {
    return false;
  }
  return true;
}
async function refreshOAuthToken(refreshToken) {
  try {
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: CLAUDE_CODE_OAUTH_CLIENT_ID,
      refresh_token: refreshToken
    });
    const resp = await fetch(CLAUDE_CODE_TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(15e3)
    });
    if (!resp.ok) {
      logger.warn({ status: resp.status }, "Claude Code token refresh failed");
      return null;
    }
    const data = await resp.json();
    const accessToken = data.access_token;
    if (typeof accessToken === "string" && accessToken !== "") {
      logger.info("Successfully refreshed Claude Code OAuth token");
      return accessToken;
    }
    logger.warn("Token refresh response missing access_token");
    return null;
  } catch (error) {
    logger.error({ error }, "Error refreshing OAuth token");
    return null;
  }
}
function isTokenExpired(expiryMs) {
  return Date.now() >= expiryMs - EXPIRY_BUFFER_MS;
}
async function resolveOAuthFromParsed(parsed, source) {
  const claudeAuth = parsed.claudeAiOauth;
  if (claudeAuth === void 0) {
    logger.debug(`No Claude OAuth credentials in ${source}`);
    return null;
  }
  const accessToken = claudeAuth.accessToken;
  const expiresAt = claudeAuth.expiresAt;
  if (accessToken === void 0 || accessToken === "") {
    logger.debug(`OAuth token missing in ${source} credentials`);
    return null;
  }
  if (expiresAt !== void 0 && expiresAt !== "") {
    const expiryMs = typeof expiresAt === "number" ? expiresAt : parseInt(expiresAt, 10);
    if (isTokenExpired(expiryMs)) {
      logger.warn({ expiryDate: new Date(expiryMs).toISOString() }, `OAuth token expired in ${source}, attempting refresh`);
      const refreshToken = claudeAuth.refreshToken;
      if (refreshToken !== void 0 && refreshToken !== "") {
        const newToken = await refreshOAuthToken(refreshToken);
        if (newToken !== null) {
          return newToken;
        }
        logger.warn(`Failed to refresh OAuth token from ${source}`);
      } else {
        logger.debug(`No refreshToken in ${source} credentials`);
      }
      return null;
    }
    logger.debug({ expiryDate: new Date(expiryMs).toISOString() }, `OAuth token valid from ${source}`);
  }
  return accessToken;
}
async function getOAuthTokenFromFile() {
  try {
    const credPath = join2(homedir2(), ".claude", ".credentials.json");
    const content = readFileSync(credPath, "utf-8");
    const parsed = JSON.parse(content);
    if (!isClaudeCredentialsFile(parsed)) {
      logger.debug("Invalid credentials structure in ~/.claude/.credentials.json");
      return null;
    }
    return resolveOAuthFromParsed(parsed, "~/.claude/.credentials.json");
  } catch {
    logger.debug("Could not read ~/.claude/.credentials.json");
    return null;
  }
}
async function getOAuthTokenFromKeychain() {
  if (process.platform !== "darwin") {
    logger.debug("Keychain lookup skipped \u2014 not macOS");
    return null;
  }
  try {
    const raw = execFileSync(
      "security",
      ["find-generic-password", "-s", "Claude Code-credentials", "-w"],
      { encoding: "utf-8", timeout: 5e3, stdio: ["pipe", "pipe", "pipe"] }
    ).trim();
    const parsed = JSON.parse(raw);
    if (!isClaudeCredentialsFile(parsed)) {
      logger.debug("Invalid credentials structure in macOS Keychain");
      return null;
    }
    return resolveOAuthFromParsed(parsed, "macOS Keychain");
  } catch {
    logger.debug("Could not read credentials from macOS Keychain");
    return null;
  }
}
function getApiKeyFromEnv() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey === void 0 || apiKey === "") {
    logger.debug("ANTHROPIC_API_KEY not found in environment");
    return null;
  }
  return apiKey;
}
async function getCredentials() {
  const fileToken = await getOAuthTokenFromFile();
  if (fileToken !== null) {
    logger.info("OAuth token available from ~/.claude/.credentials.json");
    return { type: "oauth", hasCredentials: true };
  }
  const keychainToken = await getOAuthTokenFromKeychain();
  if (keychainToken !== null) {
    logger.info("OAuth token available from macOS Keychain");
    return { type: "oauth", hasCredentials: true };
  }
  const apiKey = getApiKeyFromEnv();
  if (apiKey !== null) {
    logger.info("API key available from environment");
    return { type: "apikey", hasCredentials: true };
  }
  logger.error("No credentials found (checked ~/.claude/.credentials.json, macOS Keychain, and env)");
  return { type: "apikey", hasCredentials: false };
}
var ClaudeCredentials = {
  getOAuthTokenFromFile,
  getOAuthTokenFromKeychain,
  getApiKeyFromEnv,
  getCredentials
};

// src/nls.ts
function localize(_key, message) {
  return message;
}

// src/permissions.ts
var logger2 = createLogger("PermissionManager");
var PermissionManager = class _PermissionManager {
  requestCallback;
  snapshotCallback;
  alwaysAllowedTools = /* @__PURE__ */ new Set();
  acceptModeGetter;
  planModeGetter;
  planFilePathGetter;
  // Tools allowed through in plan mode (planning/reading tools that reach canUseTool)
  static PLAN_MODE_ALLOWED_TOOLS = /* @__PURE__ */ new Set([
    "ExitPlanMode",
    "EnterPlanMode",
    "AskUserQuestion",
    "TaskCreate",
    "TaskUpdate",
    "TaskGet",
    "TaskList",
    "ToolSearch",
    "Skill"
  ]);
  constructor(requestCallback, snapshotCallback, acceptModeGetter, planModeGetter, planFilePathGetter) {
    if (requestCallback !== void 0) {
      this.requestCallback = requestCallback;
    }
    if (snapshotCallback !== void 0) {
      this.snapshotCallback = snapshotCallback;
    }
    if (acceptModeGetter !== void 0) {
      this.acceptModeGetter = acceptModeGetter;
    }
    if (planModeGetter !== void 0) {
      this.planModeGetter = planModeGetter;
    }
    if (planFilePathGetter !== void 0) {
      this.planFilePathGetter = planFilePathGetter;
    }
  }
  /**
   * Reset the always-allowed tools set.
   */
  resetAlwaysAllowed() {
    this.alwaysAllowedTools.clear();
  }
  /**
   * Add a tool to the always-allowed list.
   */
  addAlwaysAllowed(toolName) {
    this.alwaysAllowedTools.add(toolName);
  }
  /**
   * Check if a tool is always allowed.
   */
  isAlwaysAllowed(toolName) {
    return this.alwaysAllowedTools.has(toolName);
  }
  /**
   * Create permission callback for the SDK.
   * This uses the SDK's canUseTool API.
   */
  createCallback() {
    return async (toolName, toolInput, options) => {
      logger2.debug({ toolName, toolInput }, "Permission callback invoked");
      try {
        const acceptModeActive = this.acceptModeGetter?.() ?? false;
        logger2.debug({ toolName, acceptModeActive }, "Permission check");
        if (acceptModeActive) {
          logger2.debug({ toolName }, "Accept mode active - auto-approving tool");
          return {
            behavior: "allow",
            updatedInput: toolInput
          };
        }
        const planModeActive = this.planModeGetter?.() ?? false;
        if (planModeActive) {
          if (toolName === "Write" || toolName === "Edit") {
            const filePath = toolInput.file_path;
            const planPath = this.planFilePathGetter?.();
            if (planPath && filePath === planPath) {
              logger2.info({ toolName, filePath }, "Plan mode \u2014 auto-approving write to plan file");
              return {
                behavior: "allow",
                updatedInput: toolInput
              };
            } else {
              logger2.info({ toolName, filePath }, "Plan mode active \u2014 denying write to non-plan file");
              return {
                behavior: "deny",
                message: `Plan mode is active. You can only write to the plan file${planPath ? ` (${planPath})` : ""}. Use ExitPlanMode to switch back.`
              };
            }
          } else if (!_PermissionManager.PLAN_MODE_ALLOWED_TOOLS.has(toolName)) {
            logger2.info({ toolName }, "Plan mode active \u2014 denying non-planning tool");
            return {
              behavior: "deny",
              message: "Plan mode is active. Only read-only tools and plan file edits are allowed. Use ExitPlanMode to switch back."
            };
          }
        }
        if ((toolName === "Write" || toolName === "Edit") && this.snapshotCallback) {
          try {
            await this.snapshotCallback(toolName, toolInput, null);
          } catch (error) {
            logger2.warn({ toolName, error }, "Failed to capture snapshot");
          }
        }
        if (this.isAlwaysAllowed(toolName)) {
          return {
            behavior: "allow",
            updatedInput: toolInput
          };
        }
        if (this.requestCallback) {
          try {
            const result = await this.requestCallback(toolName, toolInput, options);
            if (result.always && toolName !== "AskUserQuestion") {
              this.addAlwaysAllowed(toolName);
            }
            if (result.decision === "approve") {
              const updatedPermissions = toolName === "ExitPlanMode" ? [{ type: "setMode", mode: "default", destination: "session" }] : void 0;
              let updatedInput = toolInput;
              if (toolName === "AskUserQuestion" && result.answers) {
                updatedInput = {
                  ...toolInput,
                  answers: result.answers
                };
                logger2.debug({ answers: result.answers }, "AskUserQuestion answers received");
              }
              return {
                behavior: "allow",
                updatedInput,
                updatedPermissions
              };
            }
            return {
              behavior: "deny",
              message: localize("orbit.permissionDenied", "User denied permission"),
              interrupt: false
            };
          } catch (error) {
            logger2.error({ toolName, error }, "Permission request failed - DENYING");
            return {
              behavior: "deny",
              message: localize(
                "orbit.permissionFailed",
                "Permission request failed. Please try again."
              ),
              interrupt: false
            };
          }
        }
        return {
          behavior: "allow",
          updatedInput: toolInput
        };
      } catch (error) {
        logger2.error(
          { error },
          "CRITICAL: Permission callback crashed - DENYING to prevent silent approval"
        );
        return {
          behavior: "deny",
          message: localize(
            "orbit.permissionSystemError",
            "Permission system error. Please try again."
          ),
          interrupt: false
        };
      }
    };
  }
};

// src/plan-names.ts
import * as fs2 from "fs";
import * as os2 from "os";
import * as path2 from "path";
var ADJECTIVES = [
  "cozy",
  "woolly",
  "jazzy",
  "sunny",
  "misty",
  "calm",
  "bold",
  "crisp",
  "dusty",
  "eager",
  "frosty",
  "gentle",
  "happy",
  "keen",
  "lively",
  "mellow",
  "nimble",
  "plucky",
  "quiet",
  "rustic",
  "sleek",
  "tender",
  "vivid",
  "warm",
  "zesty",
  "amber",
  "bright",
  "coral",
  "dainty",
  "elfin",
  "fair",
  "golden",
  "humble",
  "ivory",
  "jolly",
  "kind",
  "lunar",
  "mossy",
  "noble",
  "olive",
  "pastel",
  "quaint",
  "rosy",
  "silver",
  "tawny",
  "urban",
  "velvet",
  "wild"
];
var VERBS = [
  "stirring",
  "crafting",
  "snuggling",
  "drifting",
  "gliding",
  "humming",
  "jumping",
  "knitting",
  "leaping",
  "melting",
  "nesting",
  "orbiting",
  "pacing",
  "quilting",
  "roaming",
  "sailing",
  "ticking",
  "unfolding",
  "vaulting",
  "winding",
  "yielding",
  "arching",
  "blazing",
  "climbing",
  "dancing",
  "echoing",
  "flowing",
  "grazing",
  "hiking",
  "inching",
  "jogging",
  "kicking",
  "lacing",
  "mapping",
  "nudging",
  "opening",
  "picking",
  "racing",
  "shaping",
  "tracing",
  "turning",
  "walking",
  "bending",
  "curving",
  "diving",
  "easing",
  "folding",
  "growing"
];
var NOUNS = [
  "hopper",
  "reef",
  "falcon",
  "meadow",
  "brook",
  "canyon",
  "delta",
  "ember",
  "fjord",
  "grove",
  "haven",
  "inlet",
  "jungle",
  "knoll",
  "lagoon",
  "mesa",
  "nexus",
  "oasis",
  "plume",
  "quartz",
  "ridge",
  "summit",
  "tundra",
  "updraft",
  "valley",
  "whisper",
  "zenith",
  "atlas",
  "beacon",
  "cedar",
  "dune",
  "echo",
  "flint",
  "glacier",
  "harbor",
  "iris",
  "jasper",
  "kelp",
  "lantern",
  "marble",
  "nimbus",
  "orchid",
  "pebble",
  "quill",
  "raven",
  "spruce",
  "timber"
];
function generatePlanName() {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const verb = VERBS[Math.floor(Math.random() * VERBS.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  return `${adj}-${verb}-${noun}`;
}
function getPlanFilePath(name) {
  return path2.join(os2.homedir(), ".solo", "plans", `${name}.md`);
}
function ensurePlanDirectory() {
  const dir = path2.join(os2.homedir(), ".solo", "plans");
  fs2.mkdirSync(dir, { recursive: true });
}

// src/session-mode.ts
var MODE_TOOLS = {
  chat: ["Read", "Glob", "Grep", "WebSearch", "WebFetch", "TodoWrite"],
  agent: [
    "Read",
    "Write",
    "Edit",
    "Glob",
    "Grep",
    "NotebookEdit",
    "Bash",
    "BashOutput",
    "KillShell",
    "WebSearch",
    "WebFetch",
    "Task",
    "TodoWrite",
    "ExitPlanMode"
  ]
};
function getAllowedToolsForMode(mode) {
  return MODE_TOOLS[mode];
}

// src/skills.ts
import { readdirSync, readFileSync as readFileSync2, statSync as statSync2, existsSync } from "fs";
import { join as join4, basename, extname } from "path";
import { homedir as homedir4 } from "os";
var logger3 = createLogger("Skills");
var FRONTMATTER_RE = /^---\s*\n([\s\S]*?)\n---\s*\n?/;
function parseFrontmatter(raw) {
  const match = raw.match(FRONTMATTER_RE);
  if (!match) {
    return { metadata: {}, body: raw.trim() };
  }
  const frontmatterBlock = match[1];
  const body = raw.slice(match[0].length).trim();
  const metadata = {};
  for (const line of frontmatterBlock.split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    if (!key) continue;
    if (value === "true") metadata[key] = true;
    else if (value === "false") metadata[key] = false;
    else if (/^\d+$/.test(value)) metadata[key] = parseInt(value, 10);
    else metadata[key] = value;
  }
  return { metadata, body };
}
function discoverSkillsFromDir(dirPath, scope) {
  if (!existsSync(dirPath)) return [];
  const skills = [];
  let entries;
  try {
    entries = readdirSync(dirPath);
  } catch {
    return [];
  }
  for (const entry of entries) {
    const fullPath = join4(dirPath, entry);
    let raw;
    let skillFilePath;
    let derivedName;
    try {
      const stat = statSync2(fullPath);
      if (stat.isFile() && extname(entry) === ".md") {
        raw = readFileSync2(fullPath, "utf-8");
        skillFilePath = fullPath;
        derivedName = basename(entry, ".md");
      } else if (stat.isDirectory()) {
        const skillMd = join4(fullPath, "SKILL.md");
        if (!existsSync(skillMd)) continue;
        raw = readFileSync2(skillMd, "utf-8");
        skillFilePath = skillMd;
        derivedName = entry;
      } else {
        continue;
      }
    } catch {
      continue;
    }
    const { metadata, body } = parseFrontmatter(raw);
    skills.push({
      metadata: {
        name: typeof metadata.name === "string" ? metadata.name : derivedName,
        description: typeof metadata.description === "string" ? metadata.description : "",
        enabled: metadata.enabled !== false,
        // default true
        priority: typeof metadata.priority === "number" ? metadata.priority : 0
      },
      content: body,
      source: scope,
      filePath: skillFilePath
    });
  }
  return skills;
}
function mergeSkills(userSkills, projectSkills) {
  const map = /* @__PURE__ */ new Map();
  for (const skill of userSkills) {
    map.set(skill.metadata.name, skill);
  }
  for (const skill of projectSkills) {
    map.set(skill.metadata.name, skill);
  }
  return Array.from(map.values()).filter((s) => s.metadata.enabled).sort((a, b) => {
    const pDiff = b.metadata.priority - a.metadata.priority;
    if (pDiff !== 0) return pDiff;
    return a.metadata.name.localeCompare(b.metadata.name);
  });
}
function formatSkillsForPrompt(skills) {
  if (skills.length === 0) return "";
  const sections = skills.map(
    (s) => `### ${s.metadata.name}

${s.content}`
  );
  return `
## Active Skills

The following skill instructions are loaded from .solo/skills/:

${sections.join("\n\n---\n\n")}`;
}
function loadSkills(cwd) {
  const userDir = join4(homedir4(), ".solo", "skills");
  const projectDir = join4(cwd, ".solo", "skills");
  const userSkills = discoverSkillsFromDir(userDir, "user");
  const projectSkills = discoverSkillsFromDir(projectDir, "project");
  const merged = mergeSkills(userSkills, projectSkills);
  if (merged.length > 0) {
    logger3.info(
      { count: merged.length, names: merged.map((s) => s.metadata.name) },
      "Skills loaded"
    );
  } else {
    logger3.debug("No skills found");
  }
  return merged;
}

// src/utils/content.ts
import * as fs3 from "fs";
import * as path3 from "path";
var MAX_IMAGE_SIZE = 20 * 1024 * 1024;
var MAX_DOCUMENT_SIZE = 30 * 1024 * 1024;
var MAX_TEXT_SIZE = 1 * 1024 * 1024;
function buildContentBlocks(message, attachments) {
  if (!attachments || attachments.length === 0) {
    return message;
  }
  const contentBlocks = [];
  for (const attachment of attachments) {
    if (attachment.type === "document" && attachment.source) {
      contentBlocks.push({
        type: "document",
        source: {
          type: "base64",
          media_type: attachment.source.mediaType,
          data: attachment.source.data
        }
      });
    } else if (attachment.type === "image" && attachment.source) {
      contentBlocks.push({
        type: "image",
        source: {
          type: "base64",
          media_type: attachment.source.mediaType,
          data: attachment.source.data
        }
      });
    } else if (attachment.type === "image" && attachment.filePath && !attachment.source) {
      const block = readImageFromPath(attachment.filePath);
      if (block) contentBlocks.push(block);
    } else if (attachment.type === "document" && attachment.filePath && !attachment.source) {
      const docBlock = readDocumentFromPath(attachment.filePath);
      if (docBlock) {
        contentBlocks.push(docBlock);
      } else {
        const fileContent = readTextFromPath(attachment.filePath);
        if (fileContent !== null) {
          const name = attachment.name ?? path3.basename(attachment.filePath);
          const languageHint = getLanguageHint(name);
          contentBlocks.push({
            type: "text",
            text: `File: ${name}
\`\`\`${languageHint}
${fileContent}
\`\`\``
          });
        }
      }
    } else if (attachment.type === "text") {
      let textContent = "";
      if (attachment.filePath !== void 0 && attachment.lineStart !== void 0 && attachment.lineEnd !== void 0) {
        const lineRange = attachment.lineStart === attachment.lineEnd ? `line ${String(attachment.lineStart)}` : `lines ${String(attachment.lineStart)}-${String(attachment.lineEnd)}`;
        textContent = `From: ${attachment.filePath} (${lineRange})
\`\`\`
${attachment.text ?? ""}
\`\`\``;
      } else if (attachment.terminalName !== void 0 && attachment.timestamp !== void 0) {
        textContent = `From: ${attachment.terminalName} (captured at ${attachment.timestamp})
\`\`\`
${attachment.text ?? ""}
\`\`\``;
      } else if (attachment.name !== void 0 && attachment.text !== void 0) {
        const languageHint = getLanguageHint(attachment.name);
        textContent = `File: ${attachment.name}
\`\`\`${languageHint}
${attachment.text}
\`\`\``;
      } else if (attachment.filePath && !attachment.text) {
        const fileContent = readTextFromPath(attachment.filePath);
        if (fileContent !== null) {
          const name = attachment.name ?? path3.basename(attachment.filePath);
          const languageHint = getLanguageHint(name);
          textContent = `File: ${name}
\`\`\`${languageHint}
${fileContent}
\`\`\``;
        }
      } else {
        textContent = attachment.text ?? "";
      }
      if (textContent) {
        contentBlocks.push({
          type: "text",
          text: textContent
        });
      }
    }
  }
  contentBlocks.push({
    type: "text",
    text: message
  });
  return contentBlocks;
}
function getImageMimeType(filename) {
  const ext = filename.split(".").pop()?.toLowerCase();
  const map = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp"
  };
  return map[ext ?? ""] ?? null;
}
function getDocumentMimeType(filename) {
  const ext = filename.split(".").pop()?.toLowerCase();
  if (ext === "pdf") return "application/pdf";
  return null;
}
function readImageFromPath(filePath) {
  const mimeType = getImageMimeType(path3.basename(filePath));
  if (!mimeType) return null;
  try {
    const stat = fs3.statSync(filePath);
    if (stat.size > MAX_IMAGE_SIZE) {
      console.warn(`Skipping image attachment: file too large (${stat.size} bytes): ${filePath}`);
      return null;
    }
    const data = fs3.readFileSync(filePath).toString("base64");
    return {
      type: "image",
      source: { type: "base64", media_type: mimeType, data }
    };
  } catch (err) {
    console.warn(`Failed to read image attachment: ${filePath}`, err);
    return null;
  }
}
function readDocumentFromPath(filePath) {
  const mimeType = getDocumentMimeType(path3.basename(filePath));
  if (!mimeType) return null;
  try {
    const stat = fs3.statSync(filePath);
    if (stat.size > MAX_DOCUMENT_SIZE) {
      console.warn(`Skipping document attachment: file too large (${stat.size} bytes): ${filePath}`);
      return null;
    }
    const data = fs3.readFileSync(filePath).toString("base64");
    return {
      type: "document",
      source: { type: "base64", media_type: mimeType, data }
    };
  } catch (err) {
    console.warn(`Failed to read document attachment: ${filePath}`, err);
    return null;
  }
}
function readTextFromPath(filePath) {
  try {
    const stat = fs3.statSync(filePath);
    if (stat.size > MAX_TEXT_SIZE) {
      console.warn(`Skipping text attachment: file too large (${stat.size} bytes): ${filePath}`);
      return null;
    }
    return fs3.readFileSync(filePath, "utf-8");
  } catch (err) {
    console.warn(`Failed to read text attachment: ${filePath}`, err);
    return null;
  }
}
function getLanguageHint(filename) {
  const ext = filename.split(".").pop()?.toLowerCase();
  const languageMap = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    py: "python",
    rb: "ruby",
    go: "go",
    rs: "rust",
    java: "java",
    cpp: "cpp",
    c: "c",
    cs: "csharp",
    php: "php",
    swift: "swift",
    kt: "kotlin",
    scala: "scala",
    sh: "bash",
    bash: "bash",
    zsh: "bash",
    yaml: "yaml",
    yml: "yaml",
    json: "json",
    md: "markdown",
    html: "html",
    css: "css",
    scss: "scss",
    sql: "sql"
  };
  return languageMap[ext ?? ""] ?? "";
}

// src/utils/formatter.ts
function contentToString(content) {
  if (content === null || content === void 0) {
    return "";
  }
  if (typeof content === "string") {
    return content;
  }
  if (typeof content === "number" || typeof content === "boolean" || typeof content === "bigint") {
    return String(content);
  }
  if (typeof content === "object") {
    try {
      return JSON.stringify(content);
    } catch {
      return "[Object]";
    }
  }
  return "[Unknown]";
}
function formatToolResult(toolName, toolInput, resultContent, isError = false) {
  if (isError) {
    return formatError(resultContent);
  }
  switch (toolName) {
    case "Read":
      return formatRead(resultContent);
    case "Write":
      return formatWrite(resultContent);
    case "Edit":
      return formatEdit(toolInput, resultContent);
    case "Bash":
      return formatBash(resultContent);
    case "Grep":
      return formatGrep(resultContent);
    case "Glob":
      return formatGlob(resultContent);
    case "TodoWrite":
      return formatTodoWrite(toolInput);
    case "WebFetch":
    case "WebSearch":
      return formatWebTool(resultContent);
    default:
      return formatGeneric(resultContent);
  }
}
function formatRead(resultContent) {
  if (resultContent === null || resultContent === void 0) {
    return "Completed";
  }
  const contentStr = contentToString(resultContent);
  const lineCount = contentStr.split("\n").length;
  return `Read ${String(lineCount)} lines`;
}
function formatWrite(resultContent) {
  if (resultContent === null || resultContent === void 0) {
    return "Completed";
  }
  const contentStr = contentToString(resultContent).toLowerCase();
  if (contentStr.includes("created")) {
    return "Created new file";
  }
  return "File written successfully";
}
function formatEdit(toolInput, resultContent) {
  if (resultContent === null || resultContent === void 0) {
    return "Completed";
  }
  const oldStringValue = toolInput.old_string;
  const newStringValue = toolInput.new_string;
  const oldString = typeof oldStringValue === "string" ? oldStringValue : "";
  const newString = typeof newStringValue === "string" ? newStringValue : "";
  const oldLines = oldString.length > 0 ? oldString.split("\n").length : 0;
  const newLines = newString.length > 0 ? newString.split("\n").length : 0;
  return `Updated with ${String(newLines)} addition${newLines !== 1 ? "s" : ""} and ${String(oldLines)} removal${oldLines !== 1 ? "s" : ""}`;
}
function formatBash(resultContent) {
  if (resultContent === null || resultContent === void 0) {
    return "Completed";
  }
  const contentStr = contentToString(resultContent);
  const lines = contentStr.split("\n");
  const MAX_LINES = 50;
  if (lines.length <= MAX_LINES) {
    return lines.join("\n");
  }
  const displayLines = lines.slice(0, MAX_LINES).join("\n");
  return `${displayLines}
... (${String(lines.length - MAX_LINES)} more lines)`;
}
function formatGrep(resultContent) {
  if (resultContent === null || resultContent === void 0) {
    return "Completed";
  }
  const contentStr = contentToString(resultContent);
  const matches = contentStr.split("\n").filter((line) => line.trim().length > 0);
  const MAX_MATCHES = 10;
  const lines = [`Found ${String(matches.length)} matches`];
  const displayMatches = matches.slice(0, MAX_MATCHES);
  for (const match of displayMatches) {
    lines.push(match);
  }
  if (matches.length > MAX_MATCHES) {
    lines.push(`... (${String(matches.length - MAX_MATCHES)} more matches)`);
  }
  return lines.join("\n");
}
function formatGlob(resultContent) {
  if (resultContent === null || resultContent === void 0) {
    return "Completed";
  }
  const contentStr = contentToString(resultContent);
  const files = contentStr.split("\n").filter((line) => line.trim().length > 0);
  const MAX_FILES = 15;
  const lines = [`Found ${String(files.length)} files`];
  const displayFiles = files.slice(0, MAX_FILES);
  for (const file of displayFiles) {
    lines.push(file);
  }
  if (files.length > MAX_FILES) {
    lines.push(`... (${String(files.length - MAX_FILES)} more files)`);
  }
  return lines.join("\n");
}
function formatTodoWrite(toolInput) {
  const todos = toolInput.todos;
  if (Array.isArray(todos)) {
    return `Updated ${String(todos.length)} todo items`;
  }
  return "Completed";
}
function formatWebTool(resultContent) {
  if (resultContent === null || resultContent === void 0) {
    return "Completed";
  }
  return contentToString(resultContent);
}
function formatError(resultContent) {
  if (resultContent === null || resultContent === void 0) {
    return "Error occurred";
  }
  const contentStr = contentToString(resultContent);
  const lines = contentStr.split("\n");
  const MAX_LINES = 10;
  if (lines.length <= MAX_LINES) {
    return lines.join("\n");
  }
  const displayLines = lines.slice(0, MAX_LINES).join("\n");
  return `${displayLines}
... (${String(lines.length - MAX_LINES)} more lines)`;
}
function formatGeneric(resultContent) {
  if (resultContent === null || resultContent === void 0) {
    return "Completed";
  }
  const contentStr = contentToString(resultContent);
  const lines = contentStr.split("\n");
  const MAX_LINES = 10;
  if (lines.length <= MAX_LINES) {
    return lines.join("\n");
  }
  const displayLines = lines.slice(0, MAX_LINES).join("\n");
  return `${displayLines}
... (${String(lines.length - MAX_LINES)} more lines)`;
}

// src/agent.ts
var logger4 = createLogger("OrbitAgent");
function isToolResultBlock(block) {
  if (typeof block !== "object" || block === null) {
    return false;
  }
  const obj = block;
  return obj.type === "tool_result" && typeof obj.tool_use_id === "string" && typeof obj.content === "string";
}
function isToolUseBlock(block) {
  if (typeof block !== "object" || block === null) {
    return false;
  }
  const obj = block;
  return obj.type === "tool_use" && typeof obj.id === "string" && typeof obj.name === "string" && typeof obj.input === "object" && obj.input !== null;
}
function getMessageContentArray(message) {
  if (message.type !== "assistant" && message.type !== "user") {
    return null;
  }
  const msg = message;
  const content = msg.message?.content;
  if (!Array.isArray(content)) {
    return null;
  }
  return content;
}
var MessageQueue = class {
  queue = [];
  resolvers = [];
  stopped = false;
  /**
   * Add a message to the queue.
   * If a consumer is waiting, resolve immediately.
   * Otherwise, add to queue for later consumption.
   */
  add(message, attachments) {
    if (this.stopped) {
      throw new Error("Message queue has been stopped");
    }
    const content = buildContentBlocks(message, attachments);
    const sdkMessage = {
      type: "user",
      message: {
        role: "user",
        content
        // Can be string or array of content blocks
      },
      parent_tool_use_id: null,
      session_id: ""
      // SDK will assign the real session_id
    };
    if (this.resolvers.length > 0) {
      const resolve = this.resolvers.shift();
      if (resolve) {
        resolve({ value: sdkMessage, done: false });
      }
    } else {
      this.queue.push(sdkMessage);
    }
  }
  /**
   * Stop the queue (marks as complete).
   * Resolves any waiting consumers with done: true.
   */
  stop() {
    this.stopped = true;
    for (const resolve of this.resolvers) {
      resolve({ value: void 0, done: true });
    }
    this.resolvers = [];
  }
  /**
   * Async iterator implementation.
   * Yields messages from queue or waits for new messages.
   */
  async *[Symbol.asyncIterator]() {
    while (!this.stopped) {
      if (this.queue.length > 0) {
        const message = this.queue.shift();
        if (message) {
          yield message;
        }
      } else {
        const result = await new Promise((resolve) => {
          this.resolvers.push(resolve);
        });
        if (result.done) {
          break;
        }
        yield result.value;
      }
    }
  }
};
var OrbitAgent = class {
  currentQuery = null;
  permissionManager;
  cwd;
  _thinkingMode;
  _thinkingBudget;
  // 0=off, 4096=think, 10240=hard, 32768=ultra
  _planMode;
  _planFilePath = null;
  _acceptMode;
  _critiqueMode;
  model;
  _fallbackModel;
  _sessionMode;
  // Session resume/fork fields
  _resumeSessionId;
  _forkSession;
  _currentSessionId;
  // Streaming input mode fields
  messageQueue = null;
  sessionActive = false;
  // MCP servers (DevTools, custom tools, etc.)
  _mcpServers;
  // Structured output format (JSON Schema)
  _outputFormat;
  // Custom subagents for Task tool
  _agents;
  constructor(config = {}) {
    this.permissionManager = new PermissionManager(
      config.permissionRequestCallback,
      config.snapshotCallback,
      () => this._acceptMode,
      // Pass Accept mode getter for dynamic checking
      () => this._planMode,
      // Pass Plan mode getter for dynamic enforcement
      () => this._planFilePath
      // Pass plan file path getter for file-specific allows
    );
    this.cwd = config.cwd ?? process.cwd();
    this._thinkingMode = config.thinkingEnabled ?? false;
    this._thinkingBudget = config.maxThinkingTokens ?? 0;
    this._planMode = config.planEnabled ?? false;
    if (this._planMode) {
      const planName = generatePlanName();
      this._planFilePath = getPlanFilePath(planName);
      ensurePlanDirectory();
      logger4.info({ planName, planFilePath: this._planFilePath }, "Plan file path generated during construction");
    }
    this._acceptMode = config.acceptEnabled ?? false;
    this._critiqueMode = config.critiqueEnabled ?? false;
    this._sessionMode = config.sessionMode ?? "agent";
    this._resumeSessionId = config.resumeSessionId;
    this._forkSession = config.forkSession ?? false;
    if (config.model !== void 0) {
      this.model = config.model;
    }
    if (config.fallbackModel !== void 0) {
      this._fallbackModel = config.fallbackModel;
    }
    this._mcpServers = config.mcpServers ?? {};
    this._outputFormat = config.outputFormat;
    this._agents = config.agents;
    logger4.info(
      {
        sessionMode: this._sessionMode,
        mcpServerCount: Object.keys(this._mcpServers).length,
        hasOutputFormat: !!this._outputFormat,
        agentCount: this._agents ? Object.keys(this._agents).length : 0
      },
      "OrbitAgent created with session mode"
    );
  }
  /**
   * Register an MCP server dynamically (before session start)
   */
  registerMcpServer(name, server) {
    if (this.sessionActive) {
      logger4.warn("Cannot register MCP server after session has started");
      return;
    }
    this._mcpServers[name] = server;
    logger4.info({ name }, "MCP server registered");
  }
  /**
   * Unregister an MCP server
   */
  unregisterMcpServer(name) {
    const { [name]: _removed, ...rest } = this._mcpServers;
    void _removed;
    this._mcpServers = rest;
    logger4.info({ name }, "MCP server unregistered");
  }
  /**
   * Set or remove the browser MCP server.
   * Call with server when browser panel is opened and session is active.
   * Call with null when browser panel is closed.
   */
  setBrowserMcpServer(server) {
    if (server) {
      this.registerMcpServer("browser", server);
    } else {
      this.unregisterMcpServer("browser");
    }
  }
  /**
   * Check if browser MCP server is registered
   */
  hasBrowserMcpServer() {
    return Object.hasOwn(this._mcpServers, "browser");
  }
  /**
   * Get the permission manager instance
   */
  getPermissionManager() {
    return this.permissionManager;
  }
  _createOptions() {
    const options = {
      // Use Claude Code's official system prompt with browser automation docs
      systemPrompt: {
        type: "preset",
        preset: "claude_code",
        append: `
## Browser Automation

You have access to browser automation tools via MCP. Use mcp__browser__open_browser to start a browser session.

### Panel Control
- **mcp__browser__open_browser**: Open the browser panel and navigate to URL. Use this first if browser is not open.
- **mcp__browser__close_browser**: Close the browser panel when done with automation.

### Navigation
- **mcp__browser__navigate**: Go to URL (returns accessibility snapshot with element refs)
- **mcp__browser__go_back / mcp__browser__go_forward / mcp__browser__reload**: History navigation
- **mcp__browser__url**: Get current URL

### Interaction
- **mcp__browser__click**: Click by CSS selector
- **mcp__browser__click_ref**: Click by accessibility ref (preferred - more reliable)
- **mcp__browser__type**: Type text character by character
- **mcp__browser__fill**: Fill form field (clears first, more reliable for inputs)
- **mcp__browser__select**: Select dropdown option
- **mcp__browser__hover**: Hover over element
- **mcp__browser__press_key**: Press keyboard key (Enter, Tab, Escape, ArrowDown, etc.)
- **mcp__browser__scroll**: Scroll page or element

### Observation
- **mcp__browser__snapshot**: Get accessibility tree showing all interactive elements with refs
- **mcp__browser__screenshot**: Capture visual screenshot
- **mcp__browser__wait**: Wait for element to appear

### JavaScript
- **mcp__browser__evaluate**: Execute JavaScript in page context

### Console/Network
- **mcp__browser__console_logs**: Get console messages (errors, warnings, logs)
- **mcp__browser__network_requests**: Get network requests (useful for debugging API calls)

### Recommended Workflow
1. Use mcp__browser__open_browser to start a browser session (or mcp__browser__navigate if already open)
2. Read the snapshot to find elements and their refs (e.g., ref="ref-5")
3. Use mcp__browser__click_ref with refs for reliable clicking (not CSS selectors)
4. After interactions, call mcp__browser__snapshot to see updated page state
5. Use mcp__browser__console_logs to check for JavaScript errors
6. Use mcp__browser__close_browser when done

### Tips
- **Use open_browser first** - it opens the panel and navigates in one step
- **Prefer refs over CSS selectors** - accessibility refs from snapshots are more reliable
- **Always check snapshot after navigation** to understand page structure
- **For forms**: use mcp__browser__fill for inputs, mcp__browser__select for dropdowns
- **Check console for errors** after page loads or after interactions fail

## Chrome DevTools (Advanced)

When browser is open, you also have access to Chrome DevTools Protocol tools via mcp__orbit-devtools__*:

### Console
- **devtools_console_get**: Get console logs with filtering by type (log/warn/error/info/debug)
- **devtools_console_clear**: Clear console messages
- **devtools_console_eval**: Execute JavaScript in console context

### Network (Detailed)
- **devtools_network_get**: Get network requests with filtering (url pattern, method, status)
- **devtools_network_detail**: Get full request/response details including headers and body
- **devtools_network_clear**: Clear network logs

### DOM Inspection
- **devtools_dom_query**: Query DOM with CSS selectors, get element structure
- **devtools_dom_html**: Get outer HTML of elements
- **devtools_dom_styles**: Get computed CSS styles for elements
- **devtools_dom_attributes**: Get all attributes of an element

### Performance
- **devtools_perf_metrics**: Get performance metrics (memory, DOM stats, rendering times)
- **devtools_perf_trace_start**: Start recording performance trace
- **devtools_perf_trace_stop**: Stop trace and get timeline events

### Storage
- **devtools_storage_local / devtools_storage_session**: Get localStorage/sessionStorage
- **devtools_storage_cookies**: Get cookies (optionally filter by domain)
- **devtools_storage_set_local / devtools_storage_set_session**: Set storage items
- **devtools_storage_set_cookie**: Set a cookie with full options
- **devtools_storage_clear**: Clear storage (local/session/cookies/all)

### General
- **devtools_eval**: Execute JavaScript with full page access, can await promises
- **devtools_page_info**: Get current page title and URL

### When to Use DevTools vs Browser Tools
- **Browser tools (mcp__browser__)**: Page interaction, navigation, clicking, typing
- **DevTools tools (mcp__orbit-devtools__)**: Deep inspection, debugging, storage, performance analysis
` + formatSkillsForPrompt(loadSkills(this.cwd))
      },
      // Working directory
      cwd: this.cwd,
      // Load CLAUDE.md from project directory for project-specific instructions
      settingSources: ["project"]
    };
    if (this._thinkingMode && this._thinkingBudget > 0) {
      options.maxThinkingTokens = this._thinkingBudget;
      const modeName = this._thinkingBudget <= 4096 ? "think" : this._thinkingBudget <= 10240 ? "hard" : "ultra";
      logger4.info(
        { thinkingMode: modeName, thinkingBudget: this._thinkingBudget },
        "Extended thinking ENABLED"
      );
    } else {
      logger4.info({ thinkingMode: "off" }, "Extended thinking DISABLED");
    }
    if (this._sessionMode === "chat") {
      const chatTools = getAllowedToolsForMode("chat");
      options.allowedTools = chatTools;
      logger4.info({ mode: "chat", tools: chatTools }, "Chat mode - read-only tools auto-approved");
    } else {
      const permissionCallback = this.permissionManager.createCallback();
      logger4.debug("Using SDK permission flow with canUseTool callback");
      options.canUseTool = async (toolName, toolInput, canUseToolOptions) => {
        logger4.debug({ toolName }, "canUseTool callback invoked");
        try {
          const result = await permissionCallback(toolName, toolInput, {
            signal: canUseToolOptions.signal,
            suggestions: canUseToolOptions.suggestions ?? []
          });
          return result;
        } catch (error) {
          logger4.error({ toolName, error }, "canUseTool callback error");
          return {
            behavior: "deny",
            message: "Permission request failed"
          };
        }
      };
      const subagentStartTimes = /* @__PURE__ */ new Map();
      const SAFE_TOOLS = /* @__PURE__ */ new Set([
        "Read",
        "Glob",
        "Grep",
        "WebSearch",
        "WebFetch",
        "Task",
        "TodoWrite",
        "ListMcpResourcesTool",
        "ReadMcpResourceTool"
      ]);
      options.hooks = {
        // PreToolUse hook - auto-approve safe tools, let SDK handle others
        PreToolUse: [
          {
            // No matcher means match ALL tools
            timeout: 86400,
            // 24 hours for indefinite waiting
            hooks: [
              (input) => {
                const preToolInput = input;
                const toolName = preToolInput.tool_name;
                const toolInput = preToolInput.tool_input;
                logger4.info(
                  {
                    toolName,
                    inputKeys: Object.keys(toolInput)
                  },
                  "Hook: PreToolUse \u2014 tool requested"
                );
                if (SAFE_TOOLS.has(toolName)) {
                  logger4.debug({ toolName }, "Hook: PreToolUse \u2014 auto-approved (safe tool)");
                  return Promise.resolve({
                    hookSpecificOutput: {
                      hookEventName: "PreToolUse",
                      permissionDecision: "allow",
                      updatedInput: toolInput
                    }
                  });
                }
                logger4.debug({ toolName }, "Hook: PreToolUse \u2014 delegating to SDK permission flow");
                return Promise.resolve({});
              }
            ]
          }
        ],
        // PostToolUse hook - log tool response + duration
        PostToolUse: [
          {
            timeout: 30,
            hooks: [
              (input, toolUseId) => {
                const postInput = input;
                const response = postInput.tool_response;
                const responseStr = typeof response === "string" ? response : JSON.stringify(response);
                logger4.info(
                  {
                    toolName: postInput.tool_name,
                    toolUseId,
                    responsePreview: responseStr?.slice(0, 500),
                    responseLength: responseStr?.length ?? 0
                  },
                  "Hook: PostToolUse \u2014 tool completed"
                );
                return Promise.resolve({});
              }
            ]
          }
        ],
        // PostToolUseFailure hook - log full error + context
        PostToolUseFailure: [
          {
            timeout: 30,
            hooks: [
              (input, toolUseId) => {
                const failureInput = input;
                logger4.warn(
                  {
                    toolName: failureInput.tool_name,
                    toolUseId,
                    error: failureInput.error,
                    isInterrupt: failureInput.is_interrupt,
                    toolInput: failureInput.tool_input ? JSON.stringify(failureInput.tool_input).slice(0, 300) : void 0
                  },
                  "Hook: PostToolUseFailure \u2014 tool failed"
                );
                return Promise.resolve({});
              }
            ]
          }
        ],
        // Notification hook - track agent status updates
        Notification: [
          {
            timeout: 30,
            hooks: [
              (input) => {
                const notifInput = input;
                logger4.info(
                  {
                    message: notifInput.message,
                    title: notifInput.title
                  },
                  "Hook: Notification"
                );
                return Promise.resolve({});
              }
            ]
          }
        ],
        // PreCompact hook - log trigger reason and context
        PreCompact: [
          {
            timeout: 30,
            hooks: [
              (input) => {
                const compactInput = input;
                logger4.info(
                  {
                    trigger: compactInput.trigger,
                    customInstructions: compactInput.custom_instructions ? `${compactInput.custom_instructions.slice(0, 100)}...` : void 0
                  },
                  "Hook: PreCompact \u2014 context compaction starting"
                );
                return Promise.resolve({});
              }
            ]
          }
        ],
        // SubagentStart hook - track subagent spawning with timing
        SubagentStart: [
          {
            timeout: 30,
            hooks: [
              (input) => {
                const startInput = input;
                const agentId = startInput.agent_id;
                subagentStartTimes.set(agentId, Date.now());
                logger4.info(
                  {
                    agentId,
                    agentType: startInput.agent_type
                  },
                  "Hook: SubagentStart \u2014 subagent spawned"
                );
                return Promise.resolve({});
              }
            ]
          }
        ],
        // SubagentStop hook - compute subagent duration
        SubagentStop: [
          {
            timeout: 30,
            hooks: [
              (input) => {
                const stopInput = input;
                logger4.info(
                  {
                    stopHookActive: stopInput.stop_hook_active
                  },
                  "Hook: SubagentStop \u2014 subagent completed"
                );
                return Promise.resolve({});
              }
            ]
          }
        ],
        // SessionStart hook - log session config snapshot
        SessionStart: [
          {
            timeout: 30,
            hooks: [
              (input) => {
                const sessionInput = input;
                logger4.info(
                  {
                    source: sessionInput.source,
                    model: this.model ?? "sonnet",
                    thinkingMode: this._thinkingMode,
                    thinkingBudget: this._thinkingBudget,
                    planMode: this._planMode,
                    acceptMode: this._acceptMode,
                    sessionMode: this._sessionMode,
                    mcpServers: Object.keys(this._mcpServers)
                  },
                  "Hook: SessionStart \u2014 session config snapshot"
                );
                return Promise.resolve({});
              }
            ]
          }
        ],
        // SessionEnd hook - log end reason
        SessionEnd: [
          {
            timeout: 30,
            hooks: [
              (input) => {
                const sessionInput = input;
                logger4.info(
                  {
                    reason: sessionInput.reason
                  },
                  "Hook: SessionEnd \u2014 session ended"
                );
                return Promise.resolve({});
              }
            ]
          }
        ],
        // UserPromptSubmit hook - inject plan mode system prompt per-turn
        UserPromptSubmit: [
          {
            timeout: 30,
            hooks: [
              (_input) => {
                if (!this._planMode || !this._planFilePath) {
                  return Promise.resolve({});
                }
                const planExists = fs4.existsSync(this._planFilePath);
                const planModePrompt = `Plan mode is active. The user indicated that they do not want you to execute yet -- you MUST NOT make any edits (with the exception of the plan file mentioned below), run any non-readonly tools (including changing configs or making commits), or otherwise make any changes to the system. This supercedes any other instructions you have received.

## Plan File Info:
${planExists ? `Your plan is at ${this._planFilePath}. Edit it incrementally.` : `No plan file exists yet. You should create your plan at ${this._planFilePath} using the Write tool.`}
You should build your plan incrementally by writing to or editing this file. NOTE that this is the only file you are allowed to edit - other than this you are only allowed to take READ-ONLY actions.`;
                logger4.info(
                  { planFilePath: this._planFilePath, planExists },
                  "Hook: UserPromptSubmit \u2014 injecting plan mode system prompt"
                );
                return Promise.resolve({
                  hookSpecificOutput: {
                    hookEventName: "UserPromptSubmit",
                    additionalContext: planModePrompt
                  }
                });
              }
            ]
          }
        ]
      };
    }
    if (this.model) {
      options.model = this.model;
      logger4.info({ model: this.model }, "Using model");
    }
    if (this._fallbackModel) {
      options.fallbackModel = this._fallbackModel;
      logger4.info({ fallbackModel: this._fallbackModel }, "Fallback model configured");
    }
    const permissionMode = this._acceptMode ? "acceptEdits" : "default";
    options.permissionMode = permissionMode;
    logger4.info({ permissionMode }, "Permission mode set");
    options.includePartialMessages = true;
    if (this._resumeSessionId) {
      options.resume = this._resumeSessionId;
      if (this._forkSession) {
        options.forkSession = true;
      }
      logger4.info(
        { resumeFrom: this._resumeSessionId, fork: this._forkSession },
        "Session resume/fork configured"
      );
    }
    if (Object.keys(this._mcpServers).length > 0) {
      options.mcpServers = this._mcpServers;
      logger4.info({ servers: Object.keys(this._mcpServers) }, "MCP servers configured");
    }
    if (this._outputFormat) {
      options.outputFormat = this._outputFormat;
      logger4.info({ type: this._outputFormat.type }, "Structured output format configured");
    }
    if (this._agents && Object.keys(this._agents).length > 0) {
      options.agents = this._agents;
      logger4.info({ agents: Object.keys(this._agents) }, "Custom subagents configured");
    }
    return options;
  }
  async startSession() {
    if (this.sessionActive) {
      logger4.warn("Session already active");
      return;
    }
    const currentPath = process.env.PATH ?? "";
    const homeDir = process.env.HOME ?? "";
    const additionalPaths = [
      "/opt/homebrew/bin",
      // Homebrew on Apple Silicon
      "/usr/local/bin",
      // Homebrew on Intel Macs
      "/usr/bin",
      // System binaries
      `${homeDir}/.nvm/versions/node/v22.11.0/bin`,
      // Common nvm path
      `${homeDir}/.nvm/versions/node/v20.18.0/bin`,
      // Another common nvm path
      `${homeDir}/.fnm/node-versions/v22.11.0/installation/bin`
      // fnm path
    ].filter((p) => !currentPath.includes(p));
    if (additionalPaths.length > 0) {
      process.env.PATH = [...additionalPaths, currentPath].join(":");
      logger4.debug({ addedPaths: additionalPaths }, "Fixed PATH for Electron app");
    }
    const credentials = await ClaudeCredentials.getCredentials();
    if (!credentials.hasCredentials) {
      throw new Error(
        'No credentials found. Please either:\n1. Run "claude login" to set up OAuth credentials in ~/.claude/.credentials.json, OR\n2. Set ANTHROPIC_API_KEY in .env file'
      );
    }
    if (credentials.type === "oauth") {
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.ANTHROPIC_AUTH_TOKEN;
      logger4.info("Using Claude Code OAuth (CLI reads from ~/.claude/.credentials.json)");
      logger4.info("Note: Using your Claude subscription quota, not API credits");
    } else {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        throw new Error("API key was detected but is no longer available");
      }
      logger4.info("Using API key from .env (will consume API credits)");
    }
    process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT = "86400000";
    logger4.debug(
      { thinkingMode: this._thinkingMode, thinkingBudget: this._thinkingBudget },
      "Starting session"
    );
    this.messageQueue = new MessageQueue();
    this.sessionActive = true;
    this.currentQuery = query({
      prompt: this.messageQueue[Symbol.asyncIterator](),
      options: this._createOptions()
    });
    logger4.info("Session started successfully");
  }
  /**
   * Check if the session is ready to receive messages
   */
  isSessionReady() {
    return this.sessionActive && this.messageQueue !== null;
  }
  queueMessage(message, attachments) {
    if (!this.sessionActive || !this.messageQueue) {
      throw new Error("Session not started. Call startSession() first.");
    }
    const thinkingModeName = this._thinkingMode && this._thinkingBudget > 0 ? this._thinkingBudget <= 4096 ? "think" : this._thinkingBudget <= 10240 ? "hard" : "ultra" : "off";
    logger4.info(
      {
        model: this.model ?? "sonnet",
        thinkingMode: thinkingModeName,
        thinkingBudget: this._thinkingBudget,
        thinkingEnabled: this._thinkingMode,
        planMode: this._planMode,
        acceptMode: this._acceptMode,
        critiqueMode: this._critiqueMode,
        sessionMode: this._sessionMode,
        messagePreview: message.substring(0, 80) + (message.length > 80 ? "..." : ""),
        attachmentCount: attachments?.length ?? 0
      },
      // allow-any-unicode-next-line
      "\u{1F4E4} Sending message to Claude"
    );
    this.messageQueue.add(message, attachments);
  }
  async *receiveResponse() {
    if (!this.currentQuery) {
      throw new Error("No active query. Call startSession() first.");
    }
    const toolUseMap = /* @__PURE__ */ new Map();
    for await (const message of this.currentQuery) {
      if (message.type === "system" && message.subtype === "init") {
        const initMessage = message;
        if (initMessage.session_id) {
          this._currentSessionId = initMessage.session_id;
        }
      }
      if (message.type === "assistant") {
        const contentArray = getMessageContentArray(message);
        if (contentArray !== null) {
          for (const block of contentArray) {
            if (isToolUseBlock(block)) {
              toolUseMap.set(block.id, {
                name: block.name,
                input: block.input
              });
            }
          }
        }
      }
      if (message.type === "user") {
        const contentArray = getMessageContentArray(message);
        if (contentArray !== null) {
          const msg = message;
          const formattedContent = contentArray.map((block) => {
            if (isToolResultBlock(block)) {
              const toolInfo = toolUseMap.get(block.tool_use_id);
              if (toolInfo !== void 0) {
                const formatted = formatToolResult(
                  toolInfo.name,
                  toolInfo.input,
                  block.content,
                  block.is_error === true
                );
                return { ...block, content: formatted };
              }
            }
            return block;
          });
          const formattedMessage = {
            ...message,
            message: { ...msg.message, content: formattedContent }
          };
          yield formattedMessage;
        } else {
          yield message;
        }
      } else {
        yield message;
      }
    }
    logger4.debug("Query session completed");
    this.sessionActive = false;
    this.currentQuery = null;
  }
  async stopSession() {
    if (!this.sessionActive) {
      logger4.debug("Session not active");
      return;
    }
    logger4.debug("Stopping session");
    if (this.messageQueue) {
      this.messageQueue.stop();
      this.messageQueue = null;
    }
    if (this.currentQuery) {
      try {
        await this.currentQuery.interrupt();
      } catch (error) {
        logger4.error({ error }, "Error interrupting query");
      }
      this.currentQuery = null;
    }
    this.sessionActive = false;
    logger4.info("Session stopped");
  }
  async interrupt() {
    if (!this.currentQuery) {
      throw new Error("No active query to interrupt.");
    }
    logger4.info("Interrupting current query");
    await this.currentQuery.interrupt();
  }
  async setPermissionMode(mode) {
    if (!this.currentQuery) {
      throw new Error("No active query.");
    }
    await this.currentQuery.setPermissionMode(mode);
  }
  isConnected() {
    return this.currentQuery !== null;
  }
  async setThinkingMode(enabled, maxTokens) {
    this._thinkingMode = enabled;
    if (maxTokens !== void 0) {
      this._thinkingBudget = maxTokens;
    }
    if (this.currentQuery) {
      const budget = enabled && this._thinkingBudget > 0 ? this._thinkingBudget : null;
      await this.currentQuery.setMaxThinkingTokens(budget);
      const modeName = budget === null ? "off" : budget <= 4096 ? "think" : budget <= 10240 ? "hard" : "ultra";
      logger4.info({ thinkingMode: modeName, budget }, "Thinking mode updated mid-session");
    }
  }
  getThinkingMode() {
    return this._thinkingMode;
  }
  setPlanMode(enabled) {
    this._planMode = enabled;
    if (enabled) {
      this._acceptMode = false;
      if (!this._planFilePath) {
        const planName = generatePlanName();
        this._planFilePath = getPlanFilePath(planName);
        ensurePlanDirectory();
        logger4.info({ planName, planFilePath: this._planFilePath }, "Plan file path generated");
      }
    } else {
      this._planFilePath = null;
    }
    logger4.info({ enabled, planFilePath: this._planFilePath }, "Plan mode changed - will take effect on next tool use");
  }
  getPlanMode() {
    return this._planMode;
  }
  getPlanFilePath() {
    return this._planFilePath;
  }
  setAcceptMode(enabled) {
    this._acceptMode = enabled;
    if (enabled) {
      this._planMode = false;
    }
    logger4.info({ enabled }, "Accept mode changed - will take effect on next tool use");
  }
  getAcceptMode() {
    return this._acceptMode;
  }
  setCritiqueMode(enabled) {
    this._critiqueMode = enabled;
  }
  getCritiqueMode() {
    return this._critiqueMode;
  }
  async setModel(model) {
    this.model = model;
    if (this.currentQuery) {
      await this.currentQuery.setModel(model);
      logger4.info({ model }, "Model updated mid-session via Query.setModel()");
    }
  }
  getModel() {
    return this.model ?? "sonnet";
  }
  /**
   * Get the current SDK session ID
   * This is captured from the system:init message when the session starts
   */
  getCurrentSessionId() {
    return this._currentSessionId;
  }
};

// src/events.ts
var Disposable = class {
  _isDisposed = false;
  _disposables = [];
  get isDisposed() {
    return this._isDisposed;
  }
  /**
   * Register a disposable to be cleaned up when this object is disposed
   */
  _register(disposable) {
    this._disposables.push(disposable);
    return disposable;
  }
  /**
   * Dispose all registered disposables
   */
  dispose() {
    if (this._isDisposed) {
      return;
    }
    this._isDisposed = true;
    for (const d of this._disposables) {
      d.dispose();
    }
    this._disposables = [];
  }
};
var Emitter = class {
  _listeners = /* @__PURE__ */ new Set();
  _disposed = false;
  /**
   * The event that can be subscribed to
   */
  event = (listener) => {
    if (this._disposed) {
      return {
        dispose: () => {
        }
      };
    }
    this._listeners.add(listener);
    return {
      dispose: () => {
        this._listeners.delete(listener);
      }
    };
  };
  /**
   * Fire the event with a value
   */
  fire(event) {
    if (this._disposed) {
      return;
    }
    for (const listener of this._listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error("[Emitter] Error in event listener:", error);
      }
    }
  }
  /**
   * Dispose the emitter and clear all listeners
   */
  dispose() {
    this._disposed = true;
    this._listeners.clear();
  }
};

// src/session-manager.ts
var logger5 = createLogger("SessionManager");
function isToolResultBlock2(block) {
  if (typeof block !== "object" || block === null) {
    return false;
  }
  const obj = block;
  return obj.type === "tool_result" && typeof obj.tool_use_id === "string";
}
function getString(value, fallback = "") {
  return typeof value === "string" ? value : fallback;
}
function generateToolId() {
  return `tool_${String(Date.now())}_${Math.random().toString(36).substring(2, 11)}`;
}
var SessionManager = class extends Disposable {
  // Event emitters
  _onError = this._register(new Emitter());
  onError = this._onError.event;
  _onPermissionRequest = this._register(new Emitter());
  onPermissionRequest = this._onPermissionRequest.event;
  _onAgentMessage = this._register(
    new Emitter()
  );
  onAgentMessage = this._onAgentMessage.event;
  _onPlanModeChanged = this._register(
    new Emitter()
  );
  onPlanModeChanged = this._onPlanModeChanged.event;
  _onAcceptModeChanged = this._register(
    new Emitter()
  );
  onAcceptModeChanged = this._onAcceptModeChanged.event;
  _onSessionInit = this._register(new Emitter());
  onSessionInit = this._onSessionInit.event;
  // Session tracking
  activeSessions = /* @__PURE__ */ new Map();
  sessionConsumers = /* @__PURE__ */ new Map();
  permissionResolvers = /* @__PURE__ */ new Map();
  modePreferences = /* @__PURE__ */ new Map();
  sessionResumeState = /* @__PURE__ */ new Map();
  sessionInitFired = /* @__PURE__ */ new Set();
  /**
   * Per-session tool use maps — shared between the background consumer
   * and the permission callback so the callback can look up the correct
   * toolId when emitting 'running' status.
   */
  sessionToolUseMaps = /* @__PURE__ */ new Map();
  // ==========================================================================
  // Session Lifecycle
  // ==========================================================================
  /**
   * Create a new agent session
   */
  async createSession(sessionId, config) {
    if (this.activeSessions.has(sessionId)) {
      return;
    }
    const toolUseMap = /* @__PURE__ */ new Map();
    this.sessionToolUseMaps.set(sessionId, toolUseMap);
    const permissionCallback = async (toolName, toolInput, _context) => {
      const requestId = randomUUID();
      this._onPermissionRequest.fire({
        sessionId,
        toolName,
        toolInput,
        requestId
      });
      const result = await new Promise((resolve) => {
        this.permissionResolvers.set(requestId, resolve);
      });
      if (result.decision === "approve") {
        if (toolName === "ExitPlanMode") {
          agent.setPlanMode(false);
          const prefs = this.modePreferences.get(sessionId) ?? {};
          prefs.planEnabled = false;
          this.modePreferences.set(sessionId, prefs);
          this._onPlanModeChanged.fire({ sessionId, enabled: false, planFilePath: null });
        }
        const sessionMap = this.sessionToolUseMaps.get(sessionId);
        if (sessionMap) {
          for (const [toolId, entry] of sessionMap) {
            if (entry.name === toolName && !entry.permissionResolved) {
              entry.permissionResolved = true;
              this._onAgentMessage.fire({
                sessionId,
                message: {
                  type: "tool_use",
                  content: `Tool ${toolName} running`,
                  metadata: {
                    toolName,
                    toolId,
                    toolInput: entry.input,
                    status: "running"
                  }
                }
              });
              break;
            }
          }
        }
      }
      return result;
    };
    const storedPrefs = this.modePreferences.get(sessionId);
    const finalConfig = {
      thinkingEnabled: storedPrefs?.thinkingEnabled ?? config?.thinkingEnabled ?? false,
      maxThinkingTokens: storedPrefs?.maxThinkingTokens ?? config?.maxThinkingTokens,
      planEnabled: storedPrefs?.planEnabled ?? config?.planEnabled ?? false,
      acceptEnabled: storedPrefs?.acceptEnabled ?? config?.acceptEnabled ?? false,
      critiqueEnabled: storedPrefs?.critiqueEnabled ?? config?.critiqueEnabled ?? false,
      model: storedPrefs?.model ?? config?.model,
      cwd: config?.cwd,
      sessionMode: config?.sessionMode ?? "agent",
      permissionRequestCallback: permissionCallback,
      resumeSessionId: config?.resumeSessionId,
      forkSession: config?.forkSession
    };
    logger5.info({ sessionId, sessionMode: finalConfig.sessionMode }, "Creating session");
    const agent = new OrbitAgent(finalConfig);
    this.sessionResumeState.set(sessionId, {
      isResumed: !!config?.resumeSessionId,
      isForked: !!config?.forkSession
    });
    this.activeSessions.set(sessionId, agent);
    try {
      await agent.startSession();
      logger5.info({ sessionId }, "Session started successfully");
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger5.error({ sessionId, error: errorMessage }, "Failed to start session");
      throw error;
    }
    this._startBackgroundConsumer(sessionId, agent);
  }
  /**
   * Start a background consumer for streaming messages.
   */
  _startBackgroundConsumer(sessionId, agent) {
    const state = { cancelled: false };
    const cancel = () => {
      state.cancelled = true;
    };
    this.sessionConsumers.set(sessionId, { cancel });
    void (async () => {
      try {
        const toolUseMap = this.sessionToolUseMaps.get(sessionId);
        for await (const rawMessage of agent.receiveResponse()) {
          if (state.cancelled) {
            break;
          }
          const sdkMessage = rawMessage;
          if (sdkMessage.type === "system") {
            logger5.debug({ sessionId, subtype: sdkMessage.subtype }, "SDK system message");
            if (sdkMessage.subtype === "init" && sdkMessage.session_id !== void 0) {
              if (this.sessionInitFired.has(sessionId)) {
                continue;
              }
              this.sessionInitFired.add(sessionId);
              const resumeState = this.sessionResumeState.get(sessionId) ?? {
                isResumed: false,
                isForked: false
              };
              this._onSessionInit.fire({
                sessionId,
                sdkSessionId: sdkMessage.session_id,
                isResumed: resumeState.isResumed,
                isForked: resumeState.isForked
              });
            }
            continue;
          }
          if (sdkMessage.type === "stream_event") {
            const event = sdkMessage.event;
            if (event === void 0) continue;
            if (event.type === "content_block_delta") {
              const deltaType = event.delta?.type;
              if (deltaType === "text_delta") {
                const textDelta = event.delta?.text;
                if (textDelta !== void 0) {
                  this._onAgentMessage.fire({
                    sessionId,
                    message: { type: "text", content: textDelta }
                  });
                }
              } else if (deltaType === "thinking_delta") {
                const thinkingDelta = event.delta?.thinking;
                if (thinkingDelta !== void 0) {
                  this._onAgentMessage.fire({
                    sessionId,
                    message: { type: "thinking", content: thinkingDelta }
                  });
                }
              }
            }
            continue;
          }
          if (sdkMessage.type === "assistant") {
            const content = sdkMessage.message?.content;
            if (content === void 0) continue;
            for (const block of content) {
              if (block.type === "text") {
                continue;
              }
              if (block.type === "thinking") {
                this._onAgentMessage.fire({
                  sessionId,
                  message: {
                    type: "thinking",
                    content: block.thinking ?? ""
                  }
                });
                continue;
              }
              const toolName = getString(block.name, "unknown");
              const toolId = getString(block.id) || generateToolId();
              const toolInput = block.input ?? {};
              logger5.info({ sessionId, toolName, toolId }, "Tool use block received");
              const toolMessage = {
                type: "tool_use",
                content: `Using tool: ${toolName}`,
                metadata: {
                  toolName,
                  toolId,
                  toolInput,
                  status: "awaiting-permission"
                }
              };
              toolUseMap.set(toolId, {
                name: toolName,
                input: toolInput,
                permissionResolved: false
              });
              this._onAgentMessage.fire({ sessionId, message: toolMessage });
            }
          } else if (sdkMessage.type === "user") {
            const content = sdkMessage.message?.content;
            if (!Array.isArray(content)) continue;
            for (const block of content) {
              if (isToolResultBlock2(block)) {
                const toolUseId = block.tool_use_id;
                const toolInfo = toolUseMap.get(toolUseId);
                if (toolInfo !== void 0) {
                  const toolOutput = typeof block.content === "string" ? block.content : JSON.stringify(block.content);
                  const isError = block.is_error === true;
                  logger5.info(
                    {
                      sessionId,
                      toolName: toolInfo.name,
                      toolId: toolUseId,
                      isError,
                      outputLength: toolOutput.length
                    },
                    "Tool result received"
                  );
                  this._onAgentMessage.fire({
                    sessionId,
                    message: {
                      type: "tool_use",
                      content: isError ? `Tool ${toolInfo.name} failed` : `Tool ${toolInfo.name} completed`,
                      metadata: {
                        toolName: toolInfo.name,
                        toolId: toolUseId,
                        toolInput: toolInfo.input,
                        toolOutput,
                        status: isError ? "error" : "success"
                      }
                    }
                  });
                  toolUseMap.delete(toolUseId);
                }
              }
            }
          } else {
            const resultMsg = sdkMessage;
            if (resultMsg.usage !== void 0) {
              logger5.info(
                {
                  sessionId,
                  inputTokens: resultMsg.usage.input_tokens,
                  outputTokens: resultMsg.usage.output_tokens,
                  cacheRead: resultMsg.usage.cache_read_input_tokens
                },
                "Turn complete \u2014 token usage"
              );
            }
            this._onAgentMessage.fire({
              sessionId,
              message: {
                type: "result",
                content: resultMsg.subtype === "error_max_structured_output_retries" ? "Failed to produce valid structured output" : "Turn complete",
                usage: resultMsg.usage !== void 0 ? {
                  inputTokens: resultMsg.usage.input_tokens ?? 0,
                  outputTokens: resultMsg.usage.output_tokens ?? 0,
                  cacheReadInputTokens: resultMsg.usage.cache_read_input_tokens,
                  cacheCreationInputTokens: resultMsg.usage.cache_creation_input_tokens
                } : void 0,
                totalCostUsd: resultMsg.total_cost_usd,
                durationMs: resultMsg.duration_ms,
                structuredOutput: resultMsg.structured_output,
                resultSubtype: resultMsg.subtype
              }
            });
            setCorrelationId(void 0);
          }
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : "no stack";
        logger5.error({ sessionId, error: errorMessage }, "Background consumer error");
        this._onError.fire({ message: `[SDK Error] ${errorMessage}`, stack: errorStack });
      }
    })();
  }
  /**
   * Delete a session
   */
  async deleteSession(sessionId) {
    const consumer = this.sessionConsumers.get(sessionId);
    if (consumer) {
      consumer.cancel();
      this.sessionConsumers.delete(sessionId);
    }
    const agent = this.activeSessions.get(sessionId);
    if (agent) {
      await agent.stopSession();
      this.activeSessions.delete(sessionId);
    }
    this.sessionToolUseMaps.delete(sessionId);
    this.sessionResumeState.delete(sessionId);
    this.sessionInitFired.delete(sessionId);
  }
  /**
   * Check if a session is ready
   */
  isSessionReady(sessionId) {
    const agent = this.activeSessions.get(sessionId);
    return agent?.isSessionReady() ?? false;
  }
  /**
   * Interrupt a session
   */
  async interrupt(sessionId) {
    const agent = this.activeSessions.get(sessionId);
    if (!agent) {
      throw new Error(`Session ${sessionId} not found`);
    }
    await agent.interrupt();
  }
  /**
   * Get the SDK session ID for a session
   */
  getSDKSessionId(sessionId) {
    const agent = this.activeSessions.get(sessionId);
    return agent?.getCurrentSessionId();
  }
  /**
   * Send a message to a session
   */
  sendMessage(message, sessionId, attachments) {
    const agent = this.activeSessions.get(sessionId);
    if (agent === void 0) {
      throw new Error(`Session ${sessionId} not found. Call createSession() first.`);
    }
    if (!agent.isSessionReady()) {
      throw new Error(`Session ${sessionId} is not ready.`);
    }
    const correlationId = randomUUID();
    setCorrelationId(correlationId);
    logger5.info(
      {
        sessionId,
        correlationId: correlationId.slice(0, 8),
        messagePreview: message.slice(0, 100) + (message.length > 100 ? "..." : ""),
        attachmentCount: attachments?.length ?? 0
      },
      "Sending message"
    );
    agent.queueMessage(message, attachments);
  }
  /**
   * Respond to a permission request
   */
  respondToPermission(response) {
    const resolver = this.permissionResolvers.get(response.requestId);
    if (resolver) {
      resolver({
        decision: response.decision,
        always: response.always,
        answers: response.answers
      });
      this.permissionResolvers.delete(response.requestId);
    }
  }
  /**
   * Set thinking mode for a session
   */
  async setThinkingMode(sessionId, enabled, maxTokens) {
    const agent = this.activeSessions.get(sessionId);
    if (!agent) {
      const prefs2 = this.modePreferences.get(sessionId) ?? {};
      prefs2.thinkingEnabled = enabled;
      prefs2.maxThinkingTokens = maxTokens;
      this.modePreferences.set(sessionId, prefs2);
      return;
    }
    await agent.setThinkingMode(enabled, maxTokens);
    const prefs = this.modePreferences.get(sessionId) ?? {};
    prefs.thinkingEnabled = enabled;
    prefs.maxThinkingTokens = maxTokens;
    this.modePreferences.set(sessionId, prefs);
  }
  /**
   * Get thinking mode for a session
   */
  getThinkingMode(sessionId) {
    const agent = this.activeSessions.get(sessionId);
    if (agent === void 0) {
      const prefs = this.modePreferences.get(sessionId);
      return prefs?.thinkingEnabled ?? false;
    }
    return agent.getThinkingMode();
  }
  /**
   * Set model for a session
   */
  async setModel(sessionId, model) {
    const agent = this.activeSessions.get(sessionId);
    if (!agent) {
      const prefs2 = this.modePreferences.get(sessionId) ?? {};
      prefs2.model = model;
      this.modePreferences.set(sessionId, prefs2);
      return;
    }
    await agent.setModel(model);
    const prefs = this.modePreferences.get(sessionId) ?? {};
    prefs.model = model;
    this.modePreferences.set(sessionId, prefs);
  }
  /**
   * Set plan mode for a session
   */
  setPlanMode(sessionId, enabled) {
    const agent = this.activeSessions.get(sessionId);
    if (agent === void 0) {
      const prefs2 = this.modePreferences.get(sessionId) ?? {};
      prefs2.planEnabled = enabled;
      this.modePreferences.set(sessionId, prefs2);
      this._onPlanModeChanged.fire({ sessionId, enabled, planFilePath: null });
      return;
    }
    agent.setPlanMode(enabled);
    const planFilePath = agent.getPlanFilePath();
    const prefs = this.modePreferences.get(sessionId) ?? {};
    prefs.planEnabled = enabled;
    this.modePreferences.set(sessionId, prefs);
    this._onPlanModeChanged.fire({ sessionId, enabled, planFilePath });
  }
  /**
   * Get plan mode for a session
   */
  getPlanMode(sessionId) {
    const agent = this.activeSessions.get(sessionId);
    if (agent === void 0) {
      const prefs = this.modePreferences.get(sessionId);
      return prefs?.planEnabled ?? false;
    }
    return agent.getPlanMode();
  }
  /**
   * Set accept mode for a session
   */
  setAcceptMode(sessionId, enabled) {
    const agent = this.activeSessions.get(sessionId);
    if (!agent) {
      const prefs2 = this.modePreferences.get(sessionId) ?? {};
      prefs2.acceptEnabled = enabled;
      this.modePreferences.set(sessionId, prefs2);
      this._onAcceptModeChanged.fire({ sessionId, enabled });
      return;
    }
    agent.setAcceptMode(enabled);
    const prefs = this.modePreferences.get(sessionId) ?? {};
    prefs.acceptEnabled = enabled;
    this.modePreferences.set(sessionId, prefs);
    this._onAcceptModeChanged.fire({ sessionId, enabled });
  }
  /**
   * Get accept mode for a session
   */
  getAcceptMode(sessionId) {
    const agent = this.activeSessions.get(sessionId);
    if (agent === void 0) {
      const prefs = this.modePreferences.get(sessionId);
      return prefs?.acceptEnabled ?? false;
    }
    return agent.getAcceptMode();
  }
  /**
   * Set tool permission policy for a session.
   * - 'approve-all': auto-approve everything (sets accept mode)
   * - 'smart': auto-approve read-only tools, prompt for writes
   * - 'ask-all': prompt for every tool (default)
   */
  setToolPolicy(sessionId, mode, _isWorktreeSession) {
    const agent = this.activeSessions.get(sessionId);
    if (mode === "approve-all") {
      this.setAcceptMode(sessionId, true);
      return;
    }
    if (agent) {
      agent.setAcceptMode(false);
    }
    if (mode === "smart" && agent) {
      const readOnlyTools = [
        "Read",
        "Glob",
        "Grep",
        "WebSearch",
        "WebFetch",
        "Task",
        "TodoRead",
        "TodoWrite"
      ];
      const pm = agent.getPermissionManager();
      for (const tool of readOnlyTools) {
        pm.addAlwaysAllowed(tool);
      }
    }
  }
  /**
   * Dispose the session manager
   */
  dispose() {
    for (const [, resolver] of this.permissionResolvers.entries()) {
      resolver({ decision: "deny", always: false });
    }
    this.permissionResolvers.clear();
    for (const [, consumer] of this.sessionConsumers.entries()) {
      consumer.cancel();
    }
    this.sessionConsumers.clear();
    for (const [sessionId, agent] of this.activeSessions.entries()) {
      void agent.stopSession().catch((err) => {
        logger5.error({ sessionId, error: err }, "Error stopping session");
      });
    }
    this.activeSessions.clear();
    this.sessionToolUseMaps.clear();
    super.dispose();
  }
};

// src/commit-message.ts
import Anthropic from "@anthropic-ai/sdk";
var logger6 = createLogger("CommitMessage");
var SYSTEM_PROMPT = `You are a git commit message generator. Given a diff summary, generate a concise commit message following conventional commits format (type: description). Be specific about what changed. Output ONLY the commit message, no explanation.

Rules:
- Use lowercase type prefix: feat, fix, refactor, style, docs, test, chore
- Keep the summary line under 72 characters
- If changes span multiple areas, use the most significant type
- Be specific: "fix: resolve null pointer in user auth flow" not "fix: bug fix"`;
async function generateCommitMessage(diff, apiKey) {
  logger6.info("Generating commit message...");
  let resolvedKey = apiKey;
  if (!resolvedKey) {
    resolvedKey = ClaudeCredentials.getApiKeyFromEnv() ?? void 0;
  }
  if (!resolvedKey) {
    throw new Error("No API key available. Set one in Settings > AI or set ANTHROPIC_API_KEY.");
  }
  const client = new Anthropic({ apiKey: resolvedKey });
  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 300,
    system: SYSTEM_PROMPT,
    messages: [{
      role: "user",
      content: `Generate a commit message for these changes:

${diff}`
    }]
  });
  const text = response.content[0]?.type === "text" ? response.content[0].text.trim() : "";
  logger6.info({ messageLength: text.length }, "Commit message generated");
  return text;
}

// src/refine-transcript.ts
import Anthropic2 from "@anthropic-ai/sdk";
var logger7 = createLogger("RefineTranscript");
var SYSTEM_PROMPT2 = `You are a speech-to-text transcript refiner for a coding IDE. Given a raw voice transcript, clean it up by:
- Fixing obvious transcription errors (homophones, technical terms)
- Correcting casing for proper nouns, programming terms, and file names
- Removing filler words (um, uh, like) and false starts
- Preserving the user's intent and meaning exactly
- Keeping the natural speaking style (do not make it overly formal)

If context from recent chat messages is provided, use it to understand technical terms and proper nouns.

Output ONLY the refined transcript, nothing else. If the transcript is already clean, return it unchanged.`;
async function refineTranscript(transcript, context, apiKey) {
  logger7.info("Refining transcript...");
  let resolvedKey = apiKey;
  if (!resolvedKey) {
    resolvedKey = ClaudeCredentials.getApiKeyFromEnv() ?? void 0;
  }
  if (!resolvedKey) {
    throw new Error("No API key available for transcript refinement.");
  }
  const client = new Anthropic2({ apiKey: resolvedKey });
  let userContent = `Refine this voice transcript:

"${transcript}"`;
  if (context) {
    userContent += `

Recent conversation context:
${context}`;
  }
  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 500,
    system: SYSTEM_PROMPT2,
    messages: [{ role: "user", content: userContent }]
  });
  const text = response.content[0]?.type === "text" ? response.content[0].text.trim() : "";
  logger7.info({ originalLength: transcript.length, refinedLength: text.length }, "Transcript refined");
  return text || transcript;
}

// src/session-title.ts
import Anthropic3 from "@anthropic-ai/sdk";
var logger8 = createLogger("SessionTitle");
var SYSTEM_PROMPT3 = `You are a session title generator. Given a user message and an AI assistant response, generate a concise title that captures the essence of the conversation topic.

Rules:
- Keep the title under 50 characters
- Use title case
- Be specific and descriptive
- Do not use quotes or special formatting
- Do not start with "Help with" or "Question about"
- Output ONLY the title, nothing else`;
async function generateSessionTitle(userMessage, assistantMessage, apiKey) {
  logger8.info("Generating session title...");
  let resolvedKey = apiKey;
  if (!resolvedKey) {
    resolvedKey = ClaudeCredentials.getApiKeyFromEnv() ?? void 0;
  }
  if (!resolvedKey) {
    throw new Error("No API key available. Set one in Settings > AI or set ANTHROPIC_API_KEY.");
  }
  const client = new Anthropic3({ apiKey: resolvedKey });
  const truncatedUser = userMessage.slice(0, 500);
  const truncatedAssistant = assistantMessage.slice(0, 500);
  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 60,
    system: SYSTEM_PROMPT3,
    messages: [{
      role: "user",
      content: `User message:
${truncatedUser}

Assistant response:
${truncatedAssistant}`
    }]
  });
  const text = response.content[0]?.type === "text" ? response.content[0].text.trim() : "";
  logger8.info({ titleLength: text.length }, "Session title generated");
  return text;
}

// src/index.ts
var logger9 = createLogger("AgentBridge");
function sendMessage(message) {
  const json = JSON.stringify(message);
  process.stdout.write(json + "\n");
}
function sendResponse(response) {
  sendMessage(response);
}
function sendEvent(event) {
  sendMessage(event);
}
function main() {
  configureFileLogging();
  logger9.info("Agent Bridge starting...");
  const sessionManager = new SessionManager();
  sessionManager.onAgentMessage((data) => {
    sendEvent({
      type: "agent_message",
      sessionId: data.sessionId,
      message: data.message
    });
  });
  sessionManager.onPermissionRequest((request) => {
    sendEvent({
      type: "permission_request",
      request
    });
  });
  sessionManager.onSessionInit((event) => {
    sendEvent({
      type: "session_init",
      event
    });
  });
  sessionManager.onPlanModeChanged((data) => {
    sendEvent({
      type: "plan_mode_changed",
      sessionId: data.sessionId,
      enabled: data.enabled,
      planFilePath: data.planFilePath
    });
  });
  sessionManager.onAcceptModeChanged((data) => {
    sendEvent({
      type: "accept_mode_changed",
      sessionId: data.sessionId,
      enabled: data.enabled
    });
  });
  sessionManager.onError((error) => {
    sendEvent({
      type: "error_event",
      error
    });
  });
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false
  });
  rl.on("line", (line) => {
    if (!line.trim()) {
      return;
    }
    let request;
    try {
      request = JSON.parse(line);
    } catch (error) {
      logger9.error({ error, line }, "Failed to parse request");
      sendResponse({
        type: "error",
        requestType: "unknown",
        error: `Failed to parse request: ${error instanceof Error ? error.message : String(error)}`
      });
      return;
    }
    logger9.info({ requestType: request.type }, "Received request");
    handleRequest(request, sessionManager).catch((error) => {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger9.error({ requestType: request.type, error: errorMessage }, "Error handling request");
      sendResponse({
        type: "error",
        requestType: request.type,
        error: errorMessage
      });
    });
  });
  rl.on("close", () => {
    logger9.info("stdin closed, shutting down...");
    sessionManager.dispose();
    shutdownFileLogging();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    logger9.info("SIGTERM received, shutting down...");
    sessionManager.dispose();
    shutdownFileLogging();
    process.exit(0);
  });
  process.on("SIGINT", () => {
    logger9.info("SIGINT received, shutting down...");
    sessionManager.dispose();
    shutdownFileLogging();
    process.exit(0);
  });
  sendEvent({ type: "ready" });
  logger9.info("Agent Bridge ready");
}
async function handleRequest(request, sessionManager) {
  switch (request.type) {
    case "create_session": {
      await sessionManager.createSession(request.sessionId, request.config);
      sendResponse({ type: "success", requestType: request.type });
      break;
    }
    case "delete_session": {
      await sessionManager.deleteSession(request.sessionId);
      sendResponse({ type: "success", requestType: request.type });
      break;
    }
    case "send_message": {
      sessionManager.sendMessage(request.message, request.sessionId, request.attachments);
      sendResponse({ type: "success", requestType: request.type });
      break;
    }
    case "interrupt": {
      await sessionManager.interrupt(request.sessionId);
      sendResponse({ type: "success", requestType: request.type });
      break;
    }
    case "permission_response": {
      sessionManager.respondToPermission(request.response);
      sendResponse({ type: "success", requestType: request.type });
      break;
    }
    case "set_thinking_mode": {
      await sessionManager.setThinkingMode(request.sessionId, request.enabled, request.maxTokens);
      sendResponse({ type: "success", requestType: request.type });
      break;
    }
    case "get_thinking_mode": {
      const enabled = sessionManager.getThinkingMode(request.sessionId);
      sendResponse({ type: "boolean", requestType: request.type, value: enabled });
      break;
    }
    case "set_model": {
      await sessionManager.setModel(request.sessionId, request.model);
      sendResponse({ type: "success", requestType: request.type });
      break;
    }
    case "set_plan_mode": {
      sessionManager.setPlanMode(request.sessionId, request.enabled);
      sendResponse({ type: "success", requestType: request.type });
      break;
    }
    case "get_plan_mode": {
      const enabled = sessionManager.getPlanMode(request.sessionId);
      sendResponse({ type: "boolean", requestType: request.type, value: enabled });
      break;
    }
    case "set_accept_mode": {
      sessionManager.setAcceptMode(request.sessionId, request.enabled);
      sendResponse({ type: "success", requestType: request.type });
      break;
    }
    case "get_accept_mode": {
      const enabled = sessionManager.getAcceptMode(request.sessionId);
      sendResponse({ type: "boolean", requestType: request.type, value: enabled });
      break;
    }
    case "set_tool_policy": {
      sessionManager.setToolPolicy(request.sessionId, request.mode, request.isWorktreeSession);
      sendResponse({ type: "success", requestType: request.type });
      break;
    }
    case "is_session_ready": {
      const ready = sessionManager.isSessionReady(request.sessionId);
      sendResponse({ type: "boolean", requestType: request.type, value: ready });
      break;
    }
    case "get_sdk_session_id": {
      const sdkSessionId = sessionManager.getSDKSessionId(request.sessionId);
      sendResponse({ type: "string", requestType: request.type, value: sdkSessionId ?? null });
      break;
    }
    case "generate_commit_message": {
      const message = await generateCommitMessage(request.diff, request.apiKey);
      sendResponse({ type: "string", requestType: request.type, value: message });
      break;
    }
    case "refine_transcript": {
      const refined = await refineTranscript(request.transcript, request.context, request.apiKey);
      sendResponse({ type: "string", requestType: request.type, value: refined });
      break;
    }
    case "generate_session_title": {
      const title = await generateSessionTitle(request.userMessage, request.assistantMessage, request.apiKey);
      sendResponse({ type: "string", requestType: request.type, value: title });
      break;
    }
    case "shutdown": {
      logger9.info("Shutdown requested");
      sendResponse({ type: "success", requestType: request.type });
      sessionManager.dispose();
      process.exit(0);
      break;
    }
    default: {
      const exhaustiveCheck = request;
      sendResponse({
        type: "error",
        requestType: exhaustiveCheck.type,
        error: `Unknown request type: ${exhaustiveCheck.type}`
      });
    }
  }
}
try {
  main();
} catch (error) {
  logger9.error({ error }, "Fatal error");
  process.exit(1);
}
