/**
 * Structured logger for agent-bridge
 *
 * Features:
 * - Structured JSON log entries with correlation IDs and timing
 * - File logging with rotation (10MB max, 5 file history)
 * - Debug callback for routing entries to IPC/debug panel
 * - Configurable log levels (stderr vs file)
 *
 * IMPORTANT: Uses stderr to avoid polluting stdout which is used for JSON IPC
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// =============================================================================
// Types
// =============================================================================

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

type LogContext = Record<string, unknown>;

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  prefix: string;
  message: string;
  correlationId?: string;
  context?: LogContext;
  durationMs?: number;
}

type DebugCallback = (entry: LogEntry) => void;

interface Logger {
  debug(context: LogContext, message: string): void;
  debug(message: string): void;
  info(context: LogContext, message: string): void;
  info(message: string): void;
  warn(context: LogContext, message: string): void;
  warn(message: string): void;
  error(context: LogContext, message: string): void;
  error(message: string): void;
}

// =============================================================================
// Log Level Ordering
// =============================================================================

const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// =============================================================================
// Module State
// =============================================================================

/** Minimum level for stderr output */
let stderrLevel: LogLevel = 'info';

/** Minimum level for file output (more verbose by default) */
let fileLevel: LogLevel = 'debug';

/** File logging state */
let logFilePath: string | null = null;
let logFileStream: fs.WriteStream | null = null;

/** Max log file size in bytes (10MB) */
const MAX_FILE_SIZE = 10 * 1024 * 1024;

/** Number of rotated files to keep */
const MAX_ROTATED_FILES = 5;

/** Debug callback for routing to IPC */
let debugCallback: DebugCallback | null = null;

/** Active correlation ID (set per-operation) */
let activeCorrelationId: string | undefined;

// =============================================================================
// Configuration
// =============================================================================

/**
 * Set the minimum log level for stderr output
 */
export function setStderrLevel(level: LogLevel): void {
  stderrLevel = level;
}

/**
 * Set the minimum log level for file output
 */
export function setFileLevel(level: LogLevel): void {
  fileLevel = level;
}

/**
 * Configure file logging.
 * Creates the log directory if needed and opens a write stream.
 *
 * @param logDir Directory for log files (default: ~/.solo/logs)
 */
export function configureFileLogging(logDir?: string): void {
  const dir = logDir ?? path.join(os.homedir(), '.solo', 'logs');

  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    // Directory may already exist
  }

  logFilePath = path.join(dir, 'agent-bridge.log');

  // Check if we need to rotate before opening
  rotateIfNeeded();

  logFileStream = fs.createWriteStream(logFilePath, { flags: 'a' });

  // Handle stream errors gracefully
  logFileStream.on('error', (err) => {
    process.stderr.write(`[logger] File write error: ${err.message}\n`);
    logFileStream = null;
  });
}

/**
 * Set a callback that receives all structured log entries.
 * Used to route debug events to the IPC channel / debug panel.
 */
export function setDebugCallback(cb: DebugCallback | null): void {
  debugCallback = cb;
}

/**
 * Set the active correlation ID for subsequent log entries.
 * Call with undefined to clear.
 */
export function setCorrelationId(id: string | undefined): void {
  activeCorrelationId = id;
}

/**
 * Get the current active correlation ID.
 */
export function getCorrelationId(): string | undefined {
  return activeCorrelationId;
}

// =============================================================================
// File Rotation
// =============================================================================

function rotateIfNeeded(): void {
  if (!logFilePath) return;

  let stat: fs.Stats;
  try {
    stat = fs.statSync(logFilePath);
  } catch {
    // File doesn't exist yet — no rotation needed
    return;
  }

  if (stat.size < MAX_FILE_SIZE) return;

  // Close existing stream before rotating
  if (logFileStream) {
    logFileStream.end();
    logFileStream = null;
  }

  // Rotate files: .4 → delete, .3 → .4, .2 → .3, .1 → .2, current → .1
  for (let i = MAX_ROTATED_FILES; i >= 1; i--) {
    const from = i === 1 ? logFilePath : `${logFilePath}.${i - 1}`;
    const to = `${logFilePath}.${i}`;

    try {
      if (i === MAX_ROTATED_FILES) {
        // Delete the oldest
        fs.unlinkSync(to);
      }
    } catch {
      // File may not exist
    }

    try {
      fs.renameSync(from, to);
    } catch {
      // Source may not exist
    }
  }

  // Re-open the stream (caller will do this)
}

// =============================================================================
// Core Write Functions
// =============================================================================

function shouldLog(entryLevel: LogLevel, minLevel: LogLevel): boolean {
  return LOG_LEVEL_ORDER[entryLevel] >= LOG_LEVEL_ORDER[minLevel];
}

function writeEntry(entry: LogEntry): void {
  // Stderr output (human-readable)
  if (shouldLog(entry.level, stderrLevel)) {
    const contextStr = entry.context ? ` ${JSON.stringify(entry.context)}` : '';
    const correlStr = entry.correlationId ? ` [${entry.correlationId.slice(0, 8)}]` : '';
    const durationStr = entry.durationMs !== undefined ? ` (${entry.durationMs}ms)` : '';
    const formatted = `[${entry.timestamp}] [${entry.prefix}] [${entry.level.toUpperCase()}]${correlStr}${contextStr} ${entry.message}${durationStr}`;
    process.stderr.write(formatted + '\n');
  }

  // File output (structured JSON lines)
  if (logFileStream && shouldLog(entry.level, fileLevel)) {
    const jsonLine = JSON.stringify(entry) + '\n';
    logFileStream.write(jsonLine);

    // Check rotation after write
    if (logFilePath) {
      try {
        const stat = fs.statSync(logFilePath);
        if (stat.size >= MAX_FILE_SIZE) {
          rotateIfNeeded();
          logFileStream = fs.createWriteStream(logFilePath, { flags: 'a' });
        }
      } catch {
        // Ignore stat errors
      }
    }
  }

  // Debug callback (all levels)
  if (debugCallback) {
    try {
      debugCallback(entry);
    } catch {
      // Never let callback errors break logging
    }
  }
}

// =============================================================================
// Logger Factory
// =============================================================================

/**
 * Create a logger instance with a prefix.
 * All output goes to STDERR to avoid polluting the JSON IPC channel on stdout.
 * Structured entries also go to the log file and debug callback.
 */
export function createLogger(prefix: string): Logger {
  const buildEntry = (
    level: LogLevel,
    contextOrMessage: LogContext | string,
    message?: string,
  ): LogEntry => {
    const isContextOverload = typeof contextOrMessage !== 'string';
    return {
      timestamp: new Date().toISOString(),
      level,
      prefix,
      message: isContextOverload ? (message ?? '') : contextOrMessage,
      context: isContextOverload ? (contextOrMessage as LogContext) : undefined,
      correlationId: activeCorrelationId,
    };
  };

  return {
    debug(contextOrMessage: LogContext | string, message?: string): void {
      writeEntry(buildEntry('debug', contextOrMessage, message));
    },
    info(contextOrMessage: LogContext | string, message?: string): void {
      writeEntry(buildEntry('info', contextOrMessage, message));
    },
    warn(contextOrMessage: LogContext | string, message?: string): void {
      writeEntry(buildEntry('warn', contextOrMessage, message));
    },
    error(contextOrMessage: LogContext | string, message?: string): void {
      writeEntry(buildEntry('error', contextOrMessage, message));
    },
  };
}

/**
 * Shutdown file logging gracefully.
 * Call this during process shutdown.
 */
export function shutdownFileLogging(): void {
  if (logFileStream) {
    logFileStream.end();
    logFileStream = null;
  }
}
