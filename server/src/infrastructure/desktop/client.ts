/**
 * DesktopClient — Server-side proxy for executing file/command operations
 * on the desktop via WebSocket.
 *
 * The server sends `fs_operation` messages and the desktop (Tauri) responds
 * with `fs_operation_response`. This client manages the request-response
 * correlation using UUIDs and timeouts.
 */

import { v4 as uuidv4 } from 'uuid';
import type { WSContext } from 'hono/ws';
import type { FsOperationType } from '../../types/websocket';

interface PendingRequest {
  resolve: (data: any) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

/** Safe WS send — returns false if socket is closed */
function safeSend(ws: WSContext<unknown>, message: string | object): boolean {
  try {
    const str = typeof message === 'string' ? message : JSON.stringify(message);
    ws.send(str);
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes('closed')) {
      console.warn('WebSocket closed, cannot send:', error.message);
      return false;
    }
    throw error;
  }
}

export class DesktopClient {
  private static readonly COMMAND_TIMEOUT_MS = 5 * 60 * 1000; // 5 min for commands
  private static readonly FILE_OPERATION_TIMEOUT_MS = 30 * 1000; // 30s for file ops

  private ws: WSContext<unknown>;
  private workspaceRoot: string;
  private pendingRequests: Map<string, PendingRequest>;

  constructor(ws: WSContext<unknown>, workspaceRoot: string) {
    this.ws = ws;
    this.workspaceRoot = workspaceRoot.endsWith('/')
      ? workspaceRoot
      : workspaceRoot + '/';
    this.pendingRequests = new Map();
  }

  /** Handle a response from the desktop for a pending request */
  handleResponse(id: string, success: boolean, data?: any, error?: string): void {
    const request = this.pendingRequests.get(id);
    if (!request) return;

    clearTimeout(request.timeout);
    this.pendingRequests.delete(id);

    if (success) {
      request.resolve(data);
    } else {
      let msg = error || 'Operation failed';
      if (data !== undefined && data !== null && data !== '') {
        const dataText = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
        msg = `${msg}\n\n${dataText}`;
      }
      request.reject(new Error(msg));
    }
  }

  /** Send an fs_operation to the desktop and wait for response */
  private sendFsOperation(operation: FsOperationType, params: any = {}): Promise<any> {
    const id = uuidv4();
    const message = {
      type: 'fs_operation' as const,
      id,
      operation,
      ...params,
    };

    return new Promise((resolve, reject) => {
      const timeoutMs = operation === 'run_command'
        ? DesktopClient.COMMAND_TIMEOUT_MS
        : DesktopClient.FILE_OPERATION_TIMEOUT_MS;

      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Operation timeout: ${operation} (${timeoutMs}ms)`));
      }, timeoutMs);

      this.pendingRequests.set(id, { resolve, reject, timeout });

      if (!safeSend(this.ws, message)) {
        this.pendingRequests.delete(id);
        clearTimeout(timeout);
        reject(new Error('WebSocket connection closed'));
      }
    });
  }

  /** Prepend workspace root to relative paths */
  private prependWorkdir(path: string): string {
    if (path.startsWith(this.workspaceRoot.replace(/\/$/, ''))) {
      return path;
    }
    return `${this.workspaceRoot}${path.replace(/^\//, '')}`;
  }

  // =========================================================================
  // File operations
  // =========================================================================

  async readFile(path: string): Promise<string | null> {
    const absPath = this.prependWorkdir(path);
    try {
      return await this.sendFsOperation('read', { path: absPath });
    } catch {
      return null;
    }
  }

  async writeFile(path: string, content: string): Promise<void> {
    const absPath = this.prependWorkdir(path);
    await this.sendFsOperation('write', { path: absPath, content });
  }

  async listDirectory(path: string = ''): Promise<string[]> {
    const absPath = this.prependWorkdir(path);
    return await this.sendFsOperation('list', { path: absPath });
  }

  async runCommand(command: string): Promise<string> {
    return await this.sendFsOperation('run_command', { command });
  }

  async grep(
    pattern: string,
    options?: {
      path?: string;
      glob?: string;
      output_mode?: 'content' | 'files_with_matches' | 'count';
      caseInsensitive?: boolean;
      head_limit?: number;
    }
  ): Promise<string> {
    const searchPath = options?.path || '.';
    const absPath = this.prependWorkdir(searchPath);
    return await this.sendFsOperation('ripgrep', {
      ripgrepParameters: {
        pattern,
        path: absPath,
        glob: options?.glob,
        output_mode: options?.output_mode || 'files_with_matches',
        caseInsensitive: options?.caseInsensitive,
        head_limit: options?.head_limit,
      },
    });
  }

  async glob(
    pattern: string,
    options?: { path?: string }
  ): Promise<string> {
    const searchPath = options?.path || '.';
    const absPath = this.prependWorkdir(searchPath);
    return await this.sendFsOperation('glob', {
      globParameters: {
        pattern,
        path: absPath,
      },
    });
  }

  getWorkingDirectory(): string {
    return this.workspaceRoot;
  }

  /** Clean up all pending requests */
  cleanup(): void {
    for (const [, request] of this.pendingRequests.entries()) {
      clearTimeout(request.timeout);
      request.reject(new Error('DesktopClient cleanup — connection closing'));
    }
    this.pendingRequests.clear();
  }
}
