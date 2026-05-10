import {
  createLogger
} from "./chunk-PI2SZOW3.js";

// src/providers/gemini.ts
import { spawn } from "child_process";
import { constants as FsConstants } from "fs";
import { access, mkdtemp, rm, writeFile } from "fs/promises";
import { homedir, tmpdir } from "os";
import { join } from "path";
import { createInterface } from "readline";
var logger = createLogger("GeminiAdapter");
var GEMINI_CLI_COMMON_PATHS = [
  join(homedir(), ".bun/bin/gemini"),
  join(homedir(), ".npm-global/bin/gemini"),
  join(homedir(), ".local/bin/gemini"),
  "/opt/homebrew/bin/gemini",
  "/usr/local/bin/gemini"
];
var BUN_COMMON_PATHS = [
  process.env.SOLO_BUN_EXECUTABLE,
  process.env.BUN_EXECUTABLE,
  join(homedir(), ".bun/bin/bun"),
  "/opt/homebrew/bin/bun",
  "/usr/local/bin/bun"
].filter((candidate) => Boolean(candidate && candidate.trim() !== ""));
var geminiExecutablePromise = null;
async function createGeminiSession(opts) {
  if (opts.agentMode === true) {
    return createGeminiCliHarnessSession(opts);
  }
  const { credentials, maxTokens } = opts;
  const model = normalizeGeminiModelId(opts.model);
  const apiKey = credentialToken(credentials);
  let pendingUserText = null;
  let abortController = null;
  let closed = false;
  const session = {
    provider: "gemini",
    sendMessage(text, _attachments) {
      if (closed) {
        logger.warn("sendMessage called on closed Gemini session \u2014 ignoring");
        return;
      }
      pendingUserText = text;
    },
    async *receiveResponse() {
      if (closed) {
        yield { type: "done", stopReason: "session_closed" };
        return;
      }
      if (pendingUserText === null) {
        logger.warn("receiveResponse called with no pending message");
        yield { type: "done", stopReason: "no_input" };
        return;
      }
      const userText = pendingUserText;
      pendingUserText = null;
      abortController = new AbortController();
      const startedAt = Date.now();
      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
            model
          )}:generateContent?key=${encodeURIComponent(apiKey)}`,
          {
            method: "POST",
            signal: abortController.signal,
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              contents: [{ role: "user", parts: [{ text: userText }] }],
              generationConfig: maxTokens !== void 0 ? { maxOutputTokens: maxTokens } : void 0
            })
          }
        );
        const json = await response.json();
        if (!response.ok) {
          throw new Error(json.error?.message ?? `Gemini request failed with ${response.status}`);
        }
        const text = json.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
        if (text) {
          yield { type: "text_delta", text };
        }
        const usage = json.usageMetadata;
        if (usage) {
          yield {
            type: "usage",
            inputTokens: usage.promptTokenCount ?? 0,
            outputTokens: usage.candidatesTokenCount ?? 0
          };
        }
        yield {
          type: "done",
          stopReason: json.candidates?.[0]?.finishReason ?? "end_turn",
          durationMs: Date.now() - startedAt
        };
      } catch (err) {
        if (abortController?.signal.aborted) {
          yield { type: "done", stopReason: "interrupted", durationMs: Date.now() - startedAt };
          return;
        }
        const msg = err instanceof Error ? err.message : String(err);
        logger.error({ err: msg }, "Gemini API error");
        throw err;
      } finally {
        abortController = null;
      }
    },
    async interrupt() {
      abortController?.abort();
    },
    async close() {
      closed = true;
      abortController?.abort();
    }
  };
  return session;
}
async function createGeminiCliHarnessSession(opts) {
  const cwd = opts.cwd ?? process.cwd();
  let model = normalizeGeminiModelId(opts.model);
  let geminiSessionId = opts.resumeSessionId ?? null;
  let pendingMessage = null;
  let activeChild = null;
  let interrupted = false;
  let closed = false;
  const session = {
    provider: "gemini",
    sendMessage(text, attachments) {
      if (closed) {
        logger.warn("sendMessage called on closed Gemini CLI session \u2014 ignoring");
        return;
      }
      pendingMessage = { text, attachments };
    },
    async *receiveResponse() {
      if (closed) {
        yield { type: "done", stopReason: "session_closed" };
        return;
      }
      if (pendingMessage === null) {
        logger.warn("receiveResponse called with no pending Gemini CLI message");
        yield { type: "done", stopReason: "no_input" };
        return;
      }
      const message = pendingMessage;
      pendingMessage = null;
      interrupted = false;
      const prompt = buildGeminiPrompt(message);
      const executable = await resolveGeminiExecutable();
      const useResume = geminiSessionId !== null;
      const args = [
        ...executable.prefixArgs,
        ...buildGeminiCliArgs({
          model,
          resumeSessionId: useResume ? geminiSessionId : null
        })
      ];
      const { env, cleanup } = await buildGeminiCliEnv(opts.credentials, opts.mcpServers);
      const startedAt = Date.now();
      const child = spawn(executable.command, args, {
        cwd,
        env,
        stdio: ["pipe", "pipe", "pipe"]
      });
      activeChild = child;
      let stderr = "";
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      child.stdin.on("error", () => {
      });
      child.stdin.end(prompt);
      const exitPromise = new Promise(
        (resolve, reject) => {
          child.once("error", reject);
          child.once("close", (code, signal) => resolve({ code, signal }));
        }
      );
      const translationState = {
        isResumed: useResume,
        isForked: opts.forkSession === true
      };
      let sawDone = false;
      const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
      try {
        for await (const line of lines) {
          if (line.trim() === "") continue;
          const event = parseGeminiCliEvent(line);
          if (event === null) {
            logger.debug({ line }, "Ignoring non-JSON Gemini CLI output");
            continue;
          }
          for (const providerEvent of translateGeminiCliEvent(event, translationState)) {
            if (providerEvent.type === "session_init") {
              geminiSessionId = providerEvent.sdkSessionId;
            } else if (providerEvent.type === "done") {
              sawDone = true;
            }
            yield providerEvent;
          }
        }
        const { code, signal } = await exitPromise;
        if (interrupted) {
          if (!sawDone) {
            yield { type: "done", stopReason: "interrupted", durationMs: Date.now() - startedAt };
          }
          return;
        }
        if (code !== 0) {
          const suffix = signal ? ` (signal ${signal})` : "";
          const messageText = stderr.trim() || `gemini exited with code ${String(code)}${suffix}`;
          throw new Error(messageText);
        }
        if (!sawDone) {
          yield { type: "done", stopReason: "end_turn", durationMs: Date.now() - startedAt };
        }
      } finally {
        activeChild = null;
        await cleanup();
      }
    },
    async interrupt() {
      interrupted = true;
      if (activeChild && !activeChild.killed) {
        activeChild.kill("SIGINT");
      }
    },
    async close() {
      closed = true;
      interrupted = true;
      if (activeChild && !activeChild.killed) {
        activeChild.kill("SIGINT");
      }
    },
    async setModel(nextModel) {
      model = normalizeGeminiModelId(nextModel);
    }
  };
  return session;
}
async function resolveGeminiExecutable() {
  geminiExecutablePromise ??= resolveGeminiExecutableInner();
  return geminiExecutablePromise;
}
async function resolveGeminiExecutableInner() {
  const candidates = [
    process.env.SOLO_GEMINI_EXECUTABLE,
    process.env.GEMINI_EXECUTABLE,
    process.env.GEMINI_CLI_PATH,
    ...GEMINI_CLI_COMMON_PATHS
  ].filter((candidate) => Boolean(candidate && candidate.trim() !== ""));
  for (const candidate of candidates) {
    if (!candidate.includes("/")) {
      return { command: candidate, prefixArgs: [] };
    }
    try {
      await access(candidate, FsConstants.X_OK);
      return { command: candidate, prefixArgs: [] };
    } catch {
      logger.debug({ candidate }, "Gemini executable candidate is not usable");
    }
  }
  for (const candidate of BUN_COMMON_PATHS) {
    if (!candidate.includes("/")) {
      return { command: candidate, prefixArgs: ["x", "@google/gemini-cli@latest"] };
    }
    try {
      await access(candidate, FsConstants.X_OK);
      return { command: candidate, prefixArgs: ["x", "@google/gemini-cli@latest"] };
    } catch {
      logger.debug({ candidate }, "Bun executable candidate is not usable for Gemini CLI fallback");
    }
  }
  return { command: "gemini", prefixArgs: [] };
}
function buildGeminiCliArgs(opts) {
  const args = [
    "--model",
    opts.model,
    "--output-format",
    "stream-json",
    "--approval-mode",
    process.env.SOLO_GEMINI_APPROVAL_MODE ?? "yolo"
  ];
  if (opts.resumeSessionId !== null) {
    args.push("--resume", opts.resumeSessionId);
  }
  return args;
}
async function buildGeminiCliEnv(credentials, mcpServers) {
  const env = {
    ...process.env,
    GEMINI_CLI_TRUST_WORKSPACE: "true"
  };
  if (credentials !== void 0) {
    const apiKey = credentialToken(credentials);
    env.GEMINI_API_KEY = apiKey;
    env.GOOGLE_API_KEY = apiKey;
  }
  if (!mcpServers || Object.keys(mcpServers).length === 0) {
    return { env, cleanup: async () => {
    } };
  }
  const settingsDir = await mkdtemp(join(tmpdir(), "solo-gemini-cli-"));
  const settingsPath = join(settingsDir, "settings.json");
  await writeFile(
    settingsPath,
    JSON.stringify({ mcpServers }, null, 2),
    "utf8"
  );
  env.GEMINI_CLI_SYSTEM_SETTINGS_PATH = settingsPath;
  return {
    env,
    cleanup: async () => {
      await rm(settingsDir, { recursive: true, force: true });
    }
  };
}
function buildGeminiPrompt(message) {
  const attachmentText = (message.attachments ?? []).map(formatAttachmentForPrompt).filter((text) => text !== null);
  if (attachmentText.length === 0) {
    return message.text;
  }
  return `${message.text}

<solo_attachments>
${attachmentText.join("\n\n")}
</solo_attachments>`;
}
function formatAttachmentForPrompt(attachment) {
  if (attachment.type === "text" && attachment.text) {
    const label = attachment.name ?? attachment.filePath ?? "text attachment";
    return `<attachment name="${escapeXmlAttribute(label)}">
${attachment.text}
</attachment>`;
  }
  if (attachment.filePath) {
    const range = attachment.lineStart !== void 0 ? ` lines ${String(attachment.lineStart)}-${String(attachment.lineEnd ?? attachment.lineStart)}` : "";
    return `<attachment_path>${attachment.filePath}${range}</attachment_path>`;
  }
  if (attachment.name) {
    return `<attachment name="${escapeXmlAttribute(attachment.name)}" type="${attachment.type}">Attached binary content is available in Solo but cannot be passed to gemini without a file path.</attachment>`;
  }
  return null;
}
function escapeXmlAttribute(value) {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
function parseGeminiCliEvent(line) {
  try {
    const parsed = JSON.parse(line);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
function* translateGeminiCliEvent(event, state) {
  const type = asString(event.type);
  switch (type) {
    case "init": {
      const sessionId = asString(event.session_id);
      if (sessionId !== "") {
        yield {
          type: "session_init",
          sdkSessionId: sessionId,
          isResumed: state.isResumed,
          isForked: state.isForked
        };
      }
      return;
    }
    case "message": {
      const role = asString(event.role);
      if (role === "assistant" || role === "agent" || role === "model") {
        const text = asString(event.content);
        if (text !== "") yield { type: "text_delta", text };
      }
      return;
    }
    case "tool_use": {
      const id = asString(event.tool_id, generateGeminiToolId());
      const name = asString(event.tool_name, "unknown");
      yield {
        type: "tool_call",
        id,
        name,
        input: normalizeToolInput(event.parameters)
      };
      return;
    }
    case "tool_result": {
      const error = isRecord(event.error) ? event.error : null;
      yield {
        type: "tool_result",
        toolCallId: asString(event.tool_id, "gemini_tool"),
        output: asString(event.output) || (error ? asString(error.message) : jsonForDisplay(event)),
        isError: asString(event.status) === "error" || error !== null
      };
      return;
    }
    case "error": {
      const severity = asString(event.severity);
      const message = asString(event.message, "Gemini CLI error");
      if (severity === "error") {
        throw new Error(message);
      }
      if (message !== "") {
        yield { type: "thinking_delta", text: `[Gemini CLI] ${message}` };
      }
      return;
    }
    case "result": {
      const status = asString(event.status);
      if (status === "error") {
        const error = isRecord(event.error) ? event.error : {};
        throw new Error(asString(error.message, "Gemini CLI turn failed"));
      }
      const stats = isRecord(event.stats) ? event.stats : {};
      if (Object.keys(stats).length > 0) {
        yield {
          type: "usage",
          inputTokens: asNumber(stats.input_tokens, asNumber(stats.input)),
          outputTokens: asNumber(stats.output_tokens),
          cacheReadInputTokens: asNumber(stats.cached)
        };
      }
      yield { type: "done", stopReason: status || "end_turn" };
      return;
    }
    default:
      return;
  }
}
function normalizeToolInput(value) {
  if (isRecord(value)) return value;
  return { arguments: value };
}
function generateGeminiToolId() {
  return `gemini_tool_${String(Date.now())}_${Math.random().toString(36).slice(2, 11)}`;
}
function jsonForDisplay(value) {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function asString(value, fallback = "") {
  return typeof value === "string" ? value : fallback;
}
function asNumber(value, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
function credentialToken(credentials) {
  if (credentials === void 0) {
    throw new Error(
      "Gemini chat requires a Gemini API key. For agent mode, sign in with Gemini CLI or save an API key in Solo."
    );
  }
  if (credentials.kind !== "api_key") {
    throw new Error("Gemini requires an API key credential from Solo.");
  }
  return credentials.token;
}
function normalizeGeminiModelId(model) {
  switch (model) {
    case "gemini-3-pro":
      return "gemini-3.1-pro-preview";
    case "gemini-3-flash":
      return "gemini-3-flash-preview";
    default:
      return model;
  }
}
export {
  createGeminiSession
};
//# sourceMappingURL=gemini-MBZWSO6P.js.map