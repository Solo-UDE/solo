/**
 * Session Persistence — Filesystem-backed (v3)
 *
 * Saves and loads agent sessions from `~/.solo/sessions/{session-id}.json`
 * via Tauri IPC commands (session_commands.rs).
 *
 * Migration: on first startup, migrates any v2 localStorage data to filesystem.
 */

import type { AgentSession, Message, ToolCallState, FileAttachment, ImageAttachment, Attachment, FileMention, ContentBlock } from '@/stores/agentStore';
import {
  sessionListFiles,
  sessionReadFile,
  sessionWriteFile,
  sessionDeleteFile,
} from '@/lib/tauri/sessions';

// =============================================================================
// Constants
// =============================================================================

const LOCALSTORAGE_KEY = 'solo-agent-sessions';
const LOCALSTORAGE_VERSION = 2;
const FILE_VERSION = 3;

// =============================================================================
// Persisted File Format (v3)
// =============================================================================

/** Serialized message format for persistence */
interface PersistedMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string; // ISO string
  mode?: 'planning' | 'fast';
  toolCalls?: ToolCallState[];
  isInterrupted?: boolean;
  thinkingContent?: string;
  thinkingDurationMs?: number;
  attachedFiles?: FileAttachment[];
  attachedImages?: ImageAttachment[];
  attachments?: Attachment[];
  mentions?: FileMention[];
}

/** Per-session file format written to `~/.solo/sessions/{id}.json` */
interface PersistedSessionFileV3 {
  version: 3;
  metadata: {
    id: string;
    createdAt: string;           // ISO 8601
    lastActiveAt: string;        // Updated on every save
    model: string;
    name?: string;               // User-assigned name
    title: string;               // Auto from first message (30 chars)
    summary?: string;            // Future: AI summary
    sdkSessionId?: string;       // Claude SDK session ID for resume
    resumable: boolean;          // Whether bridge resume is possible
    workspacePath?: string;      // Project path for filtering
    worktreeId?: string;         // Worktree binding (survives switches + restarts)
    worktreeBranch?: string;     // Branch name for display/matching
    totalTokens?: number;        // Accumulated usage
    totalCost?: number;          // Accumulated cost (USD)
    turnCount: number;           // Completed assistant turns
    tags?: string[];             // Future categorization
  };
  messages: PersistedMessage[];
}

// =============================================================================
// Legacy localStorage format (v2) — for migration only
// =============================================================================

interface LegacyPersistedSession {
  id: string;
  createdAt: string;
  model: string;
  name?: string;
  title: string;
  messages: PersistedMessage[];
}

interface LegacyPersistedSessionData {
  version: number;
  timestamp: number;
  sessions: LegacyPersistedSession[];
}

// =============================================================================
// Helpers
// =============================================================================

/** Generate a title from the first user message */
function generateTitle(messages: Message[]): string {
  const firstUserMessage = messages.find((m) => m.role === 'user');
  if (!firstUserMessage) return 'New Session';
  const content = firstUserMessage.content;
  if (content.length <= 30) return content;
  return content.slice(0, 30) + '...';
}

/** Serialize a session + messages into the v3 file format */
function serializeSessionV3(
  session: AgentSession,
  messages: Message[],
): PersistedSessionFileV3 {
  return {
    version: FILE_VERSION,
    metadata: {
      id: session.id,
      createdAt: session.createdAt.toISOString(),
      lastActiveAt: new Date().toISOString(),
      model: session.model,
      name: session.name,
      title: generateTitle(messages),
      sdkSessionId: session.sdkSessionId,
      resumable: !!(session.sdkSessionId && session.resumable),
      workspacePath: session.workspacePath,
      worktreeId: session.worktreeId,
      worktreeBranch: session.worktreeBranch,
      totalTokens: session.totalTokens,
      totalCost: session.totalCost,
      turnCount: session.turnCount ?? 0,
      tags: session.tags,
      summary: session.summary,
    },
    messages: messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      timestamp: m.timestamp.toISOString(),
      mode: m.mode,
      toolCalls: m.toolCalls,
      isInterrupted: m.isInterrupted,
      thinkingContent: m.thinkingContent,
      thinkingDurationMs: m.thinkingDurationMs,
      attachedFiles: m.attachedFiles,
      attachedImages: m.attachedImages,
      attachments: m.attachments,
      mentions: m.mentions,
    })),
  };
}

/**
 * Reconstruct ContentBlock[] from persisted message fields.
 * Restores the interleaved block ordering so the UI renders
 * thinking, text, and tool cards in chronological order.
 */
function reconstructBlocks(m: PersistedMessage): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  if (m.thinkingContent) {
    blocks.push({ type: 'thinking', text: m.thinkingContent });
  }
  if (m.content) {
    blocks.push({ type: 'text', text: m.content });
  }
  if (m.toolCalls) {
    for (const tc of m.toolCalls) {
      blocks.push({ type: 'tool_use', toolCall: tc });
    }
  }
  return blocks;
}

/** Deserialize a v3 file into session + messages */
function deserializeSessionV3(file: PersistedSessionFileV3): {
  session: AgentSession;
  messages: Message[];
} {
  const meta = file.metadata;
  return {
    session: {
      id: meta.id,
      createdAt: new Date(meta.createdAt),
      model: meta.model,
      name: meta.name,
      sdkSessionId: meta.sdkSessionId,
      resumable: meta.resumable,
      workspacePath: meta.workspacePath,
      worktreeId: meta.worktreeId,
      worktreeBranch: meta.worktreeBranch,
      lastActiveAt: meta.lastActiveAt,
      totalTokens: meta.totalTokens,
      totalCost: meta.totalCost,
      turnCount: meta.turnCount,
      tags: meta.tags,
      summary: meta.summary,
      connectionState: 'archived', // Always archived on load from disk
    },
    messages: file.messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      blocks: reconstructBlocks(m),
      timestamp: new Date(m.timestamp),
      mode: m.mode,
      toolCalls: m.toolCalls,
      isStreaming: false,
      isInterrupted: m.isInterrupted,
      thinkingContent: m.thinkingContent,
      thinkingDurationMs: m.thinkingDurationMs,
      attachedFiles: m.attachedFiles,
      attachedImages: m.attachedImages,
      attachments: m.attachments,
      mentions: m.mentions,
    })),
  };
}

// =============================================================================
// Public API — Async filesystem operations
// =============================================================================

/**
 * Save a single session to disk.
 */
export async function saveSession(
  session: AgentSession,
  messages: Message[],
): Promise<void> {
  try {
    const file = serializeSessionV3(session, messages);
    const json = JSON.stringify(file, null, 2);
    await sessionWriteFile(session.id, json);
  } catch (error) {
    console.error(`Failed to save session ${session.id}:`, error);
  }
}

/**
 * Load all sessions from `~/.solo/sessions/`.
 * Reads files in parallel using `Promise.allSettled`.
 */
export async function loadAllSessions(): Promise<{
  sessions: Map<string, AgentSession>;
  messages: Map<string, Message[]>;
} | null> {
  try {
    const ids = await sessionListFiles();
    if (ids.length === 0) return null;

    const results = await Promise.allSettled(
      ids.map(async (id) => {
        const raw = await sessionReadFile(id);
        const file: PersistedSessionFileV3 = JSON.parse(raw);
        if (file.version !== FILE_VERSION) {
          console.warn(`Skipping session ${id}: version ${file.version} !== ${FILE_VERSION}`);
          return null;
        }
        return deserializeSessionV3(file);
      }),
    );

    const sessions = new Map<string, AgentSession>();
    const messages = new Map<string, Message[]>();

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        const { session, messages: msgs } = result.value;
        sessions.set(session.id, session);
        messages.set(session.id, msgs);
      } else if (result.status === 'rejected') {
        console.error('Failed to load session file:', result.reason);
      }
    }

    return sessions.size > 0 ? { sessions, messages } : null;
  } catch (error) {
    console.error('Failed to load sessions from filesystem:', error);
    return null;
  }
}

/**
 * Delete a session from disk.
 */
export async function deleteSessionFile(sessionId: string): Promise<void> {
  try {
    await sessionDeleteFile(sessionId);
  } catch (error) {
    console.error(`Failed to delete session file ${sessionId}:`, error);
  }
}

// =============================================================================
// Migration: localStorage v2 → filesystem v3
// =============================================================================

/**
 * Attempt to migrate sessions from localStorage (v2) to filesystem (v3).
 * Returns the migrated data if successful, null otherwise.
 * Removes the localStorage entry after successful migration.
 */
export async function migrateFromLocalStorage(): Promise<{
  sessions: Map<string, AgentSession>;
  messages: Map<string, Message[]>;
} | null> {
  try {
    const stored = localStorage.getItem(LOCALSTORAGE_KEY);
    if (!stored) return null;

    const data: LegacyPersistedSessionData = JSON.parse(stored);
    if (data.version !== LOCALSTORAGE_VERSION) {
      console.warn(`Skipping localStorage migration: version ${data.version} !== ${LOCALSTORAGE_VERSION}`);
      localStorage.removeItem(LOCALSTORAGE_KEY);
      return null;
    }

    const sessions = new Map<string, AgentSession>();
    const messages = new Map<string, Message[]>();

    // Convert each v2 session → v3 file and write to disk
    const writes: Promise<void>[] = [];

    for (const legacy of data.sessions) {
      const session: AgentSession = {
        id: legacy.id,
        createdAt: new Date(legacy.createdAt),
        model: legacy.model,
        name: legacy.name,
        turnCount: 0,
        resumable: false,
        connectionState: 'archived',
      };

      const msgs: Message[] = legacy.messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        blocks: reconstructBlocks(m),
        timestamp: new Date(m.timestamp),
        mode: m.mode,
        toolCalls: m.toolCalls,
        isStreaming: false,
        isInterrupted: m.isInterrupted,
        thinkingContent: m.thinkingContent,
        thinkingDurationMs: m.thinkingDurationMs,
        attachedFiles: m.attachedFiles,
        attachedImages: m.attachedImages,
      }));

      sessions.set(session.id, session);
      messages.set(session.id, msgs);
      writes.push(saveSession(session, msgs));
    }

    await Promise.allSettled(writes);
    localStorage.removeItem(LOCALSTORAGE_KEY);

    console.log(`Migrated ${sessions.size} sessions from localStorage to filesystem`);
    return sessions.size > 0 ? { sessions, messages } : null;
  } catch (error) {
    console.error('Failed to migrate from localStorage:', error);
    return null;
  }
}

// =============================================================================
// Debounced Per-Session Save
// =============================================================================

/**
 * Create a per-session debounced save function.
 * Each session ID gets its own debounce timer so saving session A
 * doesn't delay/cancel a pending save for session B.
 */
export function createDebouncedSessionSave(delay: number = 1000): {
  save: (session: AgentSession, messages: Message[]) => void;
  cancel: (sessionId?: string) => void;
  flush: (sessionId?: string) => void;
} {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const pending = new Map<string, { session: AgentSession; messages: Message[] }>();

  return {
    save: (session, messages) => {
      pending.set(session.id, { session, messages });

      const existing = timers.get(session.id);
      if (existing) clearTimeout(existing);

      timers.set(
        session.id,
        setTimeout(() => {
          const data = pending.get(session.id);
          if (data) {
            saveSession(data.session, data.messages).catch(console.error);
          }
          timers.delete(session.id);
          pending.delete(session.id);
        }, delay),
      );
    },
    cancel: (sessionId) => {
      if (sessionId) {
        const timer = timers.get(sessionId);
        if (timer) clearTimeout(timer);
        timers.delete(sessionId);
        pending.delete(sessionId);
      } else {
        for (const timer of timers.values()) clearTimeout(timer);
        timers.clear();
        pending.clear();
      }
    },
    flush: (sessionId) => {
      if (sessionId) {
        const timer = timers.get(sessionId);
        if (timer) clearTimeout(timer);
        timers.delete(sessionId);
        const data = pending.get(sessionId);
        if (data) {
          saveSession(data.session, data.messages);
          pending.delete(sessionId);
        }
      } else {
        for (const timer of timers.values()) clearTimeout(timer);
        timers.clear();
        for (const data of pending.values()) {
          saveSession(data.session, data.messages);
        }
        pending.clear();
      }
    },
  };
}
