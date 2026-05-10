/**
 * Tauri IPC wrappers for vault commands.
 *
 * V0: every command is a thin invoke. Backends are stubbed in
 * `vault_commands.rs`; real work lands in Phase V1.
 */

import { invoke } from '@tauri-apps/api/core';
import type { VaultEntry } from '../../bindings/VaultEntry';
import type { VaultScope } from '../../bindings/VaultScope';
import type { VaultListFilters } from '../../bindings/VaultListFilters';
import type { VaultRetrievalSource } from '../../bindings/VaultRetrievalSource';
import type { VaultSearchMode } from '../../bindings/VaultSearchMode';
import type { VaultSearchResult } from '../../bindings/VaultSearchResult';
import type { MemoryType } from '../../bindings/MemoryType';
import type { EntryKind } from '../../bindings/EntryKind';
import type { PlacementSuggestion } from '../../bindings/PlacementSuggestion';
import type { PlacementResult } from '../../bindings/PlacementResult';
import type { PlacementMode } from '../../bindings/PlacementMode';

export type {
  VaultEntry,
  VaultScope,
  VaultListFilters,
  VaultRetrievalSource,
  VaultSearchMode,
  VaultSearchResult,
  MemoryType,
  EntryKind,
  PlacementSuggestion,
  PlacementResult,
  PlacementMode,
};
export type { VaultChunk } from '../../bindings/VaultChunk';
export type { CloudSyncState } from '../../bindings/CloudSyncState';
export type { IndexStatus } from '../../bindings/IndexStatus';
export type { RetrievalStats } from '../../bindings/RetrievalStats';

export const vaultDropPaths = (
  paths: string[],
  scope: VaultScope,
  memoryType: MemoryType,
  labelIds: string[],
  expiresAt: number | null,
  syncToCloud: boolean,
) => invoke<string[]>('vault_drop_paths', { paths, scope, memoryType, labelIds, expiresAt, syncToCloud });

export const vaultAddText = (
  text: string,
  title: string | null,
  scope: VaultScope,
  memoryType: MemoryType,
  labelIds: string[],
  expiresAt: number | null,
  syncToCloud: boolean,
) => invoke<VaultEntry>('vault_add_text', { text, title, scope, memoryType, labelIds, expiresAt, syncToCloud });

export const vaultList = (scope: VaultScope, filters: VaultListFilters) =>
  invoke<VaultEntry[]>('vault_list', { scope, filters });

export const vaultGet = (entryId: string) =>
  invoke<VaultEntry | null>('vault_get', { entryId });

export const vaultSyncEntry = (entryId: string) =>
  invoke<VaultEntry | null>('vault_sync_entry', { entryId });

export const vaultUpdateTags = (entryId: string, tags: string[]) =>
  invoke<VaultEntry | null>('vault_update_tags', { entryId, tags });

export const vaultUpdateLabelsAndExpiry = (
  entryId: string,
  labelIds: string[],
  expiresAt: number | null,
) =>
  invoke<VaultEntry | null>('vault_update_labels_and_expiry', { entryId, labelIds, expiresAt });

export const vaultSetPinned = (entryId: string, pinned: boolean) =>
  invoke<VaultEntry | null>('vault_set_pinned', { entryId, pinned });

export const vaultMoveScope = (entryId: string, newScope: VaultScope) =>
  invoke<VaultEntry | null>('vault_move_scope', { entryId, newScope });

export const vaultMoveBucket = (entryId: string, newKind: EntryKind) =>
  invoke<VaultEntry | null>('vault_move_bucket', { entryId, newKind });

export const vaultDelete = (entryId: string, alsoRemote: boolean) =>
  invoke<void>('vault_delete', { entryId, alsoRemote });

export const vaultSearch = (
  query: string,
  scope: VaultScope,
  topK: number,
  mode: VaultSearchMode,
  source: VaultRetrievalSource,
  includeExpired = false,
) => invoke<VaultSearchResult[]>('vault_search', { query, scope, topK, mode, source, includeExpired });

export const vaultSuggestPlacement = (entryId: string, workspacePath: string) =>
  invoke<PlacementSuggestion | null>('vault_suggest_placement', { entryId, workspacePath });

export const vaultAcceptPlacement = (
  entryId: string,
  targetPath: string,
  mode: PlacementMode,
) => invoke<PlacementResult>('vault_accept_placement', { entryId, targetPath, mode });

/**
 * Result from the semantic embedding backfill. Counts are cumulative for
 * the single backfill run; the backend also streams
 * `vault:backfill_progress` BackendEvent ticks while it runs.
 */
export interface VaultBackfillResult {
  total: number;
  embedded: number;
  failed: number;
  retries: number;
  totalMs: number;
}

export const vaultBackfillEmbeddings = (batchSize?: number) =>
  invoke<VaultBackfillResult>('vault_backfill_embeddings', { batchSize: batchSize ?? null });

export const vaultPendingEmbeddingsCount = () =>
  invoke<number>('vault_pending_embeddings_count');

/**
 * Result from re-running extraction over legacy entries.
 * The backend also streams `vault:reextract_progress` ticks while it runs.
 */
export interface VaultReextractResult {
  total: number;
  recovered: number;
  failed: number;
  embedded: number;
  totalMs: number;
}

export const vaultReextract = (batchSize?: number) =>
  invoke<VaultReextractResult>('vault_reextract', { batchSize: batchSize ?? null });

export const vaultPendingReextractCount = () =>
  invoke<number>('vault_pending_reextract_count');

export const vaultLogClassifierCorrection = (
  entryId: string,
  oldKind: EntryKind,
  newKind: EntryKind,
) =>
  invoke<void>('vault_log_classifier_correction', { entryId, oldKind, newKind });

export const vaultUnsortedCount = () =>
  invoke<number>('vault_unsorted_count');
