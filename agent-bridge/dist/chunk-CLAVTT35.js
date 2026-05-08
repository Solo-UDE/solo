var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});

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

export {
  __require,
  configureFileLogging,
  setCorrelationId,
  createLogger,
  shutdownFileLogging
};
