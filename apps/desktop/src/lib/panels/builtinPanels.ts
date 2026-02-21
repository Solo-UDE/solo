/**
 * Built-in Panel Types
 * Registers the default panel types that come with the application
 */

import { panelRegistry } from './registry';
import { FileViewerPanel } from '@/components/panels/FileViewerPanel';
import { WelcomePanel } from '@/components/panels/WelcomePanel';
import { AgentPanel } from '@/components/panels/AgentPanel';
import { TerminalPanel } from '@/components/panels/TerminalPanel';
import { GitDiffPanel } from '@/components/panels/GitDiffPanel';
import { WorktreeDiffPanel } from '@/components/panels/WorktreeDiffPanel';

/**
 * Register all built-in panel types
 * Call this during application initialization
 */
export function registerBuiltinPanels(): void {
  // File Viewer Panel
  panelRegistry.register({
    id: 'file-viewer',
    displayName: 'File',
    defaultIcon: 'file-text',
    component: FileViewerPanel,
    getDefaultTitle: (data) => {
      const filePath = data.filePath as string | undefined;
      if (!filePath) return 'Untitled';
      return filePath.split('/').pop() ?? 'Untitled';
    },
    allowMultiple: true,
    preferredRegion: 'editor',
    serializeData: (data) => ({ filePath: data.filePath }),
    deserializeData: (raw) => ({
      filePath: raw.filePath as string,
      fileName: (raw.filePath as string).split('/').pop() ?? 'Untitled',
    }),
  });

  // Welcome Panel
  panelRegistry.register({
    id: 'welcome',
    displayName: 'Welcome',
    defaultIcon: 'home',
    component: WelcomePanel,
    allowMultiple: false,
    preferredRegion: 'editor',
  });

  // Agent Panel (AI chat session)
  panelRegistry.register({
    id: 'agent',
    displayName: 'Agent Session',
    defaultIcon: 'message-square',
    component: AgentPanel,
    getDefaultTitle: (data) => {
      const sessionId = data.sessionId as string | undefined;
      if (!sessionId) return 'New Session';
      // Will be updated dynamically by the panel
      return 'New Session';
    },
    allowMultiple: true,
    preferredRegion: 'editor',
    serializeData: (data) => ({ sessionId: data.sessionId }),
    deserializeData: (raw) => ({ sessionId: raw.sessionId as string | undefined }),
  });

  // Terminal Panel — no serialization: terminals can't survive app restarts
  // because backend PTY processes are gone. Serializing would create zombie tabs.
  panelRegistry.register({
    id: 'terminal',
    displayName: 'Terminal',
    defaultIcon: 'terminal',
    component: TerminalPanel,
    getDefaultTitle: () => 'Terminal',
    allowMultiple: true,
    preferredRegion: 'editor',
  });
  // Git Diff Panel — no serialization: diffs should be fresh each time
  panelRegistry.register({
    id: 'git-diff',
    displayName: 'Diff',
    defaultIcon: 'git-diff',
    component: GitDiffPanel,
    getDefaultTitle: (data) => {
      const filePath = data.filePath as string | undefined;
      if (!filePath) return 'Diff';
      return `Diff: ${filePath.split('/').pop() ?? 'Diff'}`;
    },
    allowMultiple: true,
    preferredRegion: 'editor',
  });

  // Worktree Diff Panel — shows changes vs base branch, no serialization
  panelRegistry.register({
    id: 'worktree-diff',
    displayName: 'Worktree Diff',
    defaultIcon: 'git-diff',
    component: WorktreeDiffPanel,
    getDefaultTitle: (data) => {
      const branch = data.branch as string | undefined;
      return branch ? `Diff: ${branch}` : 'Worktree Diff';
    },
    allowMultiple: true,
    preferredRegion: 'editor',
  });
}

// BUILTIN_PANEL_TYPES lives in ./constants.ts to avoid circular imports
export { BUILTIN_PANEL_TYPES } from './constants';
