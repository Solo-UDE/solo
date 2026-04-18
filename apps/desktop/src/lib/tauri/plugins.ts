// apps/desktop/src/lib/tauri/plugins.ts
//
// Typed wrappers over the plugins_* Tauri commands. Types come from the
// auto-generated bindings in @/bindings — never hand-edit those.

import { invoke } from '@tauri-apps/api/core';
import type { PluginDetail } from '../../bindings/PluginDetail';
import type { PluginId } from '../../bindings/PluginId';
import type { PluginInstallResult } from '../../bindings/PluginInstallResult';
import type { PluginListOutcome } from '../../bindings/PluginListOutcome';
import type { PluginLoadError } from '../../bindings/PluginLoadError';
import type { PluginSummary } from '../../bindings/PluginSummary';

export type {
  PluginDetail,
  PluginId,
  PluginInstallResult,
  PluginListOutcome,
  PluginLoadError,
  PluginSummary,
};

export const pluginsApi = {
  list: (cwd: string): Promise<PluginListOutcome> =>
    invoke<PluginListOutcome>('plugins_list', { cwd }),

  getDetail: (cwd: string, id: PluginId): Promise<PluginDetail> =>
    invoke<PluginDetail>('plugins_get_detail', { cwd, id }),

  setEnabled: (cwd: string, id: PluginId, enabled: boolean): Promise<PluginSummary> =>
    invoke<PluginSummary>('plugins_set_enabled', { cwd, id, enabled }),

  installLocal: (sourcePath: string): Promise<PluginInstallResult> =>
    invoke<PluginInstallResult>('plugins_install_local', { sourcePath }),

  uninstall: (id: PluginId): Promise<void> =>
    invoke<void>('plugins_uninstall', { id }),
} as const;
