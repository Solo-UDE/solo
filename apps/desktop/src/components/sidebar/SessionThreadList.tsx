/**
 * SessionThreadList — Codex-style session list grouped by worktree.
 *
 * Replaces the worktree-list-first layout that lived in the old DevSidebar.
 * Sessions are the primary navigation unit; worktrees are collapsible group
 * headers. This matches the UX in reference screenshots where a developer
 * picks the conversation first and the IDE's file-explorer surface is opened
 * by a secondary click on the worktree's branch badge.
 *
 * Data flow:
 *   - `useSessions()` — all sessions across all workspaces.
 *   - `useRepoStore().activeRepoPath` — scopes to this project only.
 *   - `useWorktreeStore().worktrees` — the groups we render.
 *   - Filter sessions by `workspacePath.startsWith(activeRepoPath)`, group
 *     by `worktreeId ?? '<main>'`.
 *   - Render each worktree group in the order given by the worktree list,
 *     with main pinned first.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import type { FC } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Inbox } from 'lucide-react';
import type { WorktreeInfo } from '@/bindings';
import {
  useAgentStore,
  useSessions,
  useActiveSessionId,
  type AgentSession,
  type Message,
} from '@/stores/agentStore';
import { useWorktreeStore } from '@/stores/worktreeStore';
import { useRepoStore } from '@/stores/repoStore';
import { useUIStore } from '@/stores/uiStore';
import { useFileExplorerStore } from '@/stores/fileExplorerStore';
import { usePanelTabsStore } from '@/stores/panelTabsStore';
import { BUILTIN_PANEL_TYPES } from '@/lib/panels/constants';
import { useInlineRename } from '@/hooks/useInlineRename';
import { SessionThreadRow } from './SessionThreadRow';
import { WorktreeGroupHeader } from './WorktreeGroupHeader';

const MAIN_GROUP_KEY = '__main__';
const EMPTY_OPEN_IDS: ReadonlySet<string> = new Set();

/**
 * Zustand selector helper: subscribe to panelTabsStore and return a stable
 * `Set<string>` of session IDs that have open agent tabs. We cache by a
 * joined string key so repeated renders see the same Set reference (which
 * React's useSyncExternalStore requires — otherwise every render produces a
 * new snapshot and we get "Maximum update depth exceeded").
 */
function useOpenAgentSessionIds(): ReadonlySet<string> {
  const prevRef = useRef<{ key: string; result: ReadonlySet<string> }>({
    key: '',
    result: EMPTY_OPEN_IDS,
  });
  return usePanelTabsStore((state) => {
    const ids: string[] = [];
    for (const instance of state.instances.values()) {
      if (instance.panelType === BUILTIN_PANEL_TYPES.AGENT) {
        const sid = (instance.data as Record<string, unknown>)?.sessionId;
        if (typeof sid === 'string') ids.push(sid);
      }
    }
    ids.sort();
    const key = ids.join(',');
    if (key === prevRef.current.key) return prevRef.current.result;
    const result: ReadonlySet<string> = new Set(ids);
    prevRef.current = { key, result };
    return result;
  });
}

export interface SessionThreadListProps {
  readonly onSessionSelect: (sessionId: string) => void;
}

interface Grouped {
  readonly worktree: WorktreeInfo | null;
  readonly key: string;
  readonly sessions: AgentSession[];
}

function sessionTitle(
  sessionId: string,
  name: string | undefined,
  messagesMap: Map<string, Message[]>,
): string {
  if (name) return name;
  const first = messagesMap.get(sessionId)?.find((m) => m.role === 'user');
  if (!first) return 'New Session';
  return first.content.length <= 40 ? first.content : first.content.slice(0, 40) + '…';
}

export const SessionThreadList: FC<SessionThreadListProps> = ({ onSessionSelect }) => {
  const sessions = useSessions();
  const activeSessionId = useActiveSessionId();
  const messagesMap = useAgentStore((s) => s.messages);
  const renameSession = useAgentStore((s) => s.renameSession);
  const deleteSession = useAgentStore((s) => s.deleteSession);
  const sessionStreaming = useAgentStore((s) => s.sessionStreaming);

  // Select the raw Map (referentially stable between Immer mutations) and
  // derive the array with useMemo. A selector that returned `Array.from(...)`
  // directly would produce a fresh array every render and trip the
  // useSyncExternalStore infinite-loop guard.
  const worktreesMap = useWorktreeStore((s) => s.worktrees);
  const worktrees = useMemo(
    () => Array.from(worktreesMap.values()),
    [worktreesMap],
  );
  const activeWorktreeId = useWorktreeStore((s) => s.activeWorktreeId);
  const activeRepoPath = useRepoStore((s) => s.activeRepoPath);
  const currentRootPath = useFileExplorerStore((s) => s.rootPath);
  const drillIntoWorktree = useUIStore((s) => s.drillIntoWorktree);

  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  const toggleGroup = useCallback((key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const rename = useInlineRename((id, value) => renameSession(id, value));

  // Stable Set of session IDs with open agent tabs (see helper above).
  const openSessionIds = useOpenAgentSessionIds();

  const grouped = useMemo<Grouped[]>(() => {
    // Repo scoping — filter out sessions from other projects.
    const scoped = sessions.filter((s) => {
      if (!currentRootPath) return true;
      if (!s.workspacePath) return true;
      return s.workspacePath.startsWith(currentRootPath);
    });

    // Group by worktreeId; `undefined` → main-worktree bucket.
    const buckets = new Map<string, AgentSession[]>();
    for (const s of scoped) {
      const key = s.worktreeId ?? MAIN_GROUP_KEY;
      const list = buckets.get(key);
      if (list) list.push(s);
      else buckets.set(key, [s]);
    }

    // Order groups: main first, then worktrees in the order the worktree
    // store returns them (newest-first today; we follow whatever the repo
    // store decides).
    const groups: Grouped[] = [];
    const mainLike = worktrees.find((w) => w.is_main);
    groups.push({
      worktree: mainLike ?? null,
      key: MAIN_GROUP_KEY,
      sessions: buckets.get(MAIN_GROUP_KEY) ?? [],
    });
    for (const wt of worktrees) {
      if (wt.is_main) continue;
      groups.push({
        worktree: wt,
        key: wt.id,
        sessions: buckets.get(wt.id) ?? [],
      });
    }
    return groups;
  }, [sessions, worktrees, currentRootPath]);

  const handleDrillIn = useCallback(
    (worktreeId: string) => {
      drillIntoWorktree(worktreeId);
    },
    [drillIntoWorktree],
  );

  if (!activeRepoPath) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <Inbox className="h-5 w-5 text-muted-foreground/35" />
        <p className="text-xs text-muted-foreground">
          Open a project to see its sessions.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-2 pb-3">
      <AnimatePresence initial={false}>
        {grouped.map((group) => {
          const worktree = group.worktree;
          const isMainGroup = group.key === MAIN_GROUP_KEY;
          const worktreeIsActive = worktree
            ? worktree.is_main
              ? activeWorktreeId === null
              : activeWorktreeId === worktree.id
            : isMainGroup && activeWorktreeId === null;
          const expanded = !collapsed.has(group.key);
          const headerWorktree: WorktreeInfo | null =
            worktree ??
            (isMainGroup
              ? ({
                  id: '__main__',
                  path: activeRepoPath,
                  branch: 'main',
                  head_sha: '',
                  is_main: true,
                  is_locked: false,
                  lock_reason: null,
                  is_dirty: false,
                  agent_session_id: null,
                  created_at: 0,
                  exists_on_disk: true,
                } as unknown as WorktreeInfo)
              : null);

          if (!headerWorktree) return null;

          return (
            <motion.div
              key={group.key}
              layout
              initial={{ opacity: 0, y: -2 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.12 }}
              className="mb-1"
            >
              <WorktreeGroupHeader
                worktree={headerWorktree}
                sessionCount={group.sessions.length}
                expanded={expanded}
                isActive={worktreeIsActive}
                onToggle={() => toggleGroup(group.key)}
                onDrillIn={() => {
                  if (!worktree) return;
                  handleDrillIn(worktree.id);
                }}
              />
              <AnimatePresence initial={false}>
                {expanded && group.sessions.length > 0 && (
                  <motion.div
                    key="sessions"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.15 }}
                    className="overflow-hidden"
                  >
                    <div className="mt-0.5 space-y-0.5">
                      {group.sessions.map((session) => {
                        const streaming =
                          sessionStreaming.get(session.id)?.isStreaming ?? false;
                        return (
                          <SessionThreadRow
                            key={session.id}
                            session={session}
                            title={sessionTitle(session.id, session.name, messagesMap)}
                            isActive={activeSessionId === session.id}
                            isStreaming={streaming}
                            hasOpenTab={openSessionIds.has(session.id)}
                            isRenaming={rename.renamingId === session.id}
                            renameValue={rename.renameValue}
                            messagesMap={messagesMap}
                            onSelect={() => onSessionSelect(session.id)}
                            onStartRename={() =>
                              rename.startRename(
                                session.id,
                                session.name ??
                                  sessionTitle(session.id, undefined, messagesMap),
                              )
                            }
                            onCommitRename={rename.commitRename}
                            onCancelRename={rename.cancelRename}
                            onRenameChange={rename.setRenameValue}
                            onRequestDelete={() => deleteSession(session.id)}
                          />
                        );
                      })}
                    </div>
                  </motion.div>
                )}
                {expanded && group.sessions.length === 0 && (
                  <motion.div
                    key="empty"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.12 }}
                    className="ml-6 py-1 text-[11px] text-muted-foreground/50"
                  >
                    No sessions yet.
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
};
