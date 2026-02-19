/**
 * Tauri IPC wrappers for git commands
 */

import { invoke } from '@tauri-apps/api/core';
import type { GitRepoStatus } from '../../bindings/GitRepoStatus';
import type { GitChangesResponse } from '../../bindings/GitChangesResponse';
import type { GitPushResponse } from '../../bindings/GitPushResponse';
import type { GitPullResponse } from '../../bindings/GitPullResponse';
import type { GitFileDiffResponse } from '../../bindings/GitFileDiffResponse';

export type { GitRepoStatus } from '../../bindings/GitRepoStatus';
export type { GitChangesResponse } from '../../bindings/GitChangesResponse';
export type { GitChangedFile } from '../../bindings/GitChangedFile';
export type { GitChangesSummary } from '../../bindings/GitChangesSummary';
export type { GitFileStatus } from '../../bindings/GitFileStatus';
export type { GitPushResponse } from '../../bindings/GitPushResponse';
export type { GitPullResponse } from '../../bindings/GitPullResponse';
export type { GitFileDiffResponse } from '../../bindings/GitFileDiffResponse';

/** Get git repository status */
export const gitGetStatus = () =>
  invoke<GitRepoStatus>('git_get_status');

/** Setup GitHub integration */
export const gitSetup = (githubRepoUrl: string, username: string, email: string) =>
  invoke<void>('git_setup', { githubRepoUrl, username, email });

/** Commit staged changes locally */
export const gitCommit = (commitMessage: string) =>
  invoke<void>('git_commit', { commitMessage });

/** Push changes to GitHub */
export const gitPush = (
  accessToken: string,
  githubRepoUrl: string,
  branch: string,
  commitMessage?: string,
) => invoke<GitPushResponse>('git_push', { accessToken, githubRepoUrl, branch, commitMessage: commitMessage ?? null });

/** Pull changes from GitHub */
export const gitPull = (
  accessToken: string,
  githubRepoUrl: string,
  branch: string,
  forceReset: boolean = false,
) => invoke<GitPullResponse>('git_pull', { accessToken, githubRepoUrl, branch, forceReset });

/** Get the current HEAD commit SHA */
export const gitGetCurrentSha = () =>
  invoke<string>('git_get_current_sha');

/** Get list of changed files */
export const gitGetChanges = (branch?: string) =>
  invoke<GitChangesResponse>('git_get_changes', { branch: branch ?? null });

/** Get old and new content for a file diff */
export const gitGetFileDiff = (filePath: string, branch?: string) =>
  invoke<GitFileDiffResponse>('git_get_file_diff', { filePath, branch: branch ?? null });

/** Discard changes for a specific file */
export const gitDiscardFile = (filePath: string, branch?: string) =>
  invoke<void>('git_discard_file', { filePath, branch: branch ?? null });

/** Discard all changes */
export const gitDiscardAll = (branch?: string) =>
  invoke<void>('git_discard_all', { branch: branch ?? null });

/** Clean up stale git lock files */
export const gitCleanupLocks = () =>
  invoke<void>('git_cleanup_locks');

/** Stage a file (git add) */
export const gitStageFile = (filePath: string) =>
  invoke<void>('git_stage_file', { filePath });

/** Unstage a file (git reset HEAD -- file) */
export const gitUnstageFile = (filePath: string) =>
  invoke<void>('git_unstage_file', { filePath });

/** Stage all files (git add .) */
export const gitStageAll = () =>
  invoke<void>('git_stage_all');

/** Unstage all files (git reset HEAD) */
export const gitUnstageAll = () =>
  invoke<void>('git_unstage_all');

/** Create a new local branch and check it out */
export const gitCreateBranch = (branchName: string) =>
  invoke<void>('git_create_branch', { branchName });

/** Clone a git repository to a target path */
export const gitClone = (repositoryUrl: string, targetPath: string) =>
  invoke<string>('git_clone', { repositoryUrl, targetPath });
