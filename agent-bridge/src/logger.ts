/**
 * Simple logger for agent-bridge
 * IMPORTANT: Uses stderr to avoid polluting stdout which is used for JSON IPC
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

type LogContext = Record<string, unknown>;

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

/**
 * Create a logger instance with a prefix
 * All output goes to STDERR to avoid polluting the JSON IPC channel on stdout
 */
export function createLogger(prefix: string): Logger {
  const formatMessage = (
    level: LogLevel,
    context: LogContext | string,
    message?: string
  ): string => {
    const timestamp = new Date().toISOString();
    const contextStr = typeof context === 'string' ? '' : ` ${JSON.stringify(context)}`;
    const msg = typeof context === 'string' ? context : (message ?? '');
    return `[${timestamp}] [${prefix}] [${level.toUpperCase()}]${contextStr} ${msg}`;
  };

  // Write to stderr instead of stdout
  const writeToStderr = (message: string): void => {
    process.stderr.write(message + '\n');
  };

  return {
    debug(contextOrMessage: LogContext | string, message?: string): void {
      if (process.env.DEBUG) {
        writeToStderr(formatMessage('debug', contextOrMessage, message));
      }
    },
    info(contextOrMessage: LogContext | string, message?: string): void {
      writeToStderr(formatMessage('info', contextOrMessage, message));
    },
    warn(contextOrMessage: LogContext | string, message?: string): void {
      writeToStderr(formatMessage('warn', contextOrMessage, message));
    },
    error(contextOrMessage: LogContext | string, message?: string): void {
      writeToStderr(formatMessage('error', contextOrMessage, message));
    },
  };
}
