/**
 * Built-in Panel Types
 * Registers the default panel types that come with the application
 */

import { panelRegistry } from './registry';
import { FileViewerPanel } from '@/components/panels/FileViewerPanel';
import { WelcomePanel } from '@/components/panels/WelcomePanel';

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
}

/**
 * List of built-in panel type IDs
 */
export const BUILTIN_PANEL_TYPES = {
  FILE_VIEWER: 'file-viewer',
  WELCOME: 'welcome',
} as const;
