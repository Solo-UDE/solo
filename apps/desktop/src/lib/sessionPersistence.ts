/**
 * Session Persistence
 * Saves and loads agent sessions from localStorage
 *
 * Future: Could be extended to save to ~/.solo/sessions.json via Tauri fs
 */

import type { AgentSession, Message, ToolCallState } from '@/stores/agentStore';

const STORAGE_KEY = 'solo-agent-sessions';
const VERSION = 2;

/** Serialized message format for persistence */
interface PersistedMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string; // ISO string
  mode?: 'planning' | 'fast';
  toolCalls?: ToolCallState[];
}

/** Serialized session format for persistence */
interface PersistedSession {
  id: string;
  createdAt: string; // ISO string
  model: string;
  name?: string; // User-assigned custom name
  title: string; // First message preview for tab titles
  messages: PersistedMessage[];
}

/** Root persistence format */
interface PersistedSessionData {
  version: number;
  timestamp: number;
  sessions: PersistedSession[];
}

/**
 * Generate a title from the first user message
 */
function generateTitle(messages: Message[]): string {
  const firstUserMessage = messages.find((m) => m.role === 'user');
  if (!firstUserMessage) return 'New Session';

  const content = firstUserMessage.content;
  if (content.length <= 30) return content;
  return content.slice(0, 30) + '...';
}

/**
 * Serialize a session for storage
 */
function serializeSession(
  session: AgentSession,
  messages: Message[]
): PersistedSession {
  return {
    id: session.id,
    createdAt: session.createdAt.toISOString(),
    model: session.model,
    name: session.name,
    title: generateTitle(messages),
    messages: messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      timestamp: m.timestamp.toISOString(),
      mode: m.mode,
      toolCalls: m.toolCalls,
    })),
  };
}

/**
 * Deserialize a session from storage
 */
function deserializeSession(persisted: PersistedSession): {
  session: AgentSession;
  messages: Message[];
} {
  return {
    session: {
      id: persisted.id,
      createdAt: new Date(persisted.createdAt),
      model: persisted.model,
      name: persisted.name,
    },
    messages: persisted.messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      blocks: [],
      timestamp: new Date(m.timestamp),
      mode: m.mode,
      toolCalls: m.toolCalls,
      isStreaming: false,
    })),
  };
}

/**
 * Save all sessions to localStorage
 */
export function saveSessions(
  sessions: Map<string, AgentSession>,
  messagesMap: Map<string, Message[]>
): void {
  try {
    const persistedSessions: PersistedSession[] = [];

    sessions.forEach((session, sessionId) => {
      const messages = messagesMap.get(sessionId) || [];
      persistedSessions.push(serializeSession(session, messages));
    });

    const data: PersistedSessionData = {
      version: VERSION,
      timestamp: Date.now(),
      sessions: persistedSessions,
    };

    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (error) {
    console.error('Failed to save sessions:', error);
  }
}

/**
 * Load all sessions from localStorage
 */
export function loadSessions(): {
  sessions: Map<string, AgentSession>;
  messages: Map<string, Message[]>;
} | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return null;

    const data: PersistedSessionData = JSON.parse(stored);

    // Version check
    if (data.version !== VERSION) {
      console.warn(`Session data version mismatch: expected ${VERSION}, got ${data.version}`);
      return null;
    }

    const sessions = new Map<string, AgentSession>();
    const messages = new Map<string, Message[]>();

    for (const persisted of data.sessions) {
      const { session, messages: sessionMessages } = deserializeSession(persisted);
      sessions.set(session.id, session);
      messages.set(session.id, sessionMessages);
    }

    return { sessions, messages };
  } catch (error) {
    console.error('Failed to load sessions:', error);
    return null;
  }
}

/**
 * Delete a session from persistence
 */
export function deleteSession(sessionId: string): void {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return;

    const data: PersistedSessionData = JSON.parse(stored);
    data.sessions = data.sessions.filter((s) => s.id !== sessionId);
    data.timestamp = Date.now();

    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (error) {
    console.error('Failed to delete session:', error);
  }
}

/**
 * Clear all persisted sessions
 */
export function clearSessions(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.error('Failed to clear sessions:', error);
  }
}

/**
 * Create a debounced save function
 */
export function createDebouncedSessionSave(delay: number = 1000): {
  save: (sessions: Map<string, AgentSession>, messages: Map<string, Message[]>) => void;
  cancel: () => void;
  flush: () => void;
} {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let pendingSessions: Map<string, AgentSession> | null = null;
  let pendingMessages: Map<string, Message[]> | null = null;

  return {
    save: (sessions, messages) => {
      pendingSessions = sessions;
      pendingMessages = messages;

      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      timeoutId = setTimeout(() => {
        if (pendingSessions && pendingMessages) {
          saveSessions(pendingSessions, pendingMessages);
        }
        timeoutId = null;
        pendingSessions = null;
        pendingMessages = null;
      }, delay);
    },
    cancel: () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      pendingSessions = null;
      pendingMessages = null;
    },
    flush: () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      if (pendingSessions && pendingMessages) {
        saveSessions(pendingSessions, pendingMessages);
      }
      pendingSessions = null;
      pendingMessages = null;
    },
  };
}
