/**
 * Tauri IPC wrappers for git commands
 */

import { invoke } from '@tauri-apps/api/core';
import type { GitRepoStatus } from '../../bindings/GitRepoStatus';
import type { GitChangesResponse } from '../../bindings/GitChangesResponse';
import type { GitPushResponse } from '../../bindings/GitPushResponse';
import type { GitPullResponse } from '../../bindings/GitPullResponse';
import type { GitFileDiffResponse } from '../../bindings/GitFileDiffResponse';
import type { BranchInfo } from '../../bindings/BranchInfo';
import type { GitMergeResult } from '../../bindings/GitMergeResult';
import type { StashEntry } from '../../bindings/StashEntry';
import type { GitStashPopResult } from '../../bindings/GitStashPopResult';
import type { FileDiff } from '../../bindings/FileDiff';

export type { GitRepoStatus } from '../../bindings/GitRepoStatus';
export type { GitChangesResponse } from '../../bindings/GitChangesResponse';
export type { GitChangedFile } from '../../bindings/GitChangedFile';
export type { GitChangesSummary } from '../../bindings/GitChangesSummary';
export type { GitFileStatus } from '../../bindings/GitFileStatus';
export type { GitPushResponse } from '../../bindings/GitPushResponse';
export type { GitPullResponse } from '../../bindings/GitPullResponse';
export type { GitFileDiffResponse } from '../../bindings/GitFileDiffResponse';
export type { BranchInfo } from '../../bindings/BranchInfo';
export type { GitMergeResult } from '../../bindings/GitMergeResult';
export type { StashEntry } from '../../bindings/StashEntry';
export type { GitStashPopResult } from '../../bindings/GitStashPopResult';
export type { FileDiff } from '../../bindings/FileDiff';
export type { DiffHunk } from '../../bindings/DiffHunk';
export type { DiffLine } from '../../bindings/DiffLine';

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

/** Get full unified diff for all branch changes */
export const gitGetBranchDiff = (branch?: string) =>
  invoke<FileDiff[]>('git_get_branch_diff', { branch: branch ?? null });

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

/** Clone a git repository to a target path (pass accessToken for private repos) */
export const gitClone = (repositoryUrl: string, targetPath: string, accessToken?: string) =>
  invoke<string>('git_clone', { repositoryUrl, targetPath, accessToken: accessToken ?? null });

/** Fetch from remote (update tracking refs) */
export const gitFetch = (accessToken: string, githubRepoUrl: string, branch: string) =>
  invoke<void>('git_fetch', { accessToken, githubRepoUrl, branch });

/** List local branches with ahead/behind counts */
export const gitListBranches = () =>
  invoke<BranchInfo[]>('git_list_branches');

/** Switch to an existing branch */
export const gitCheckoutBranch = (branchName: string) =>
  invoke<void>('git_checkout_branch', { branchName });

/** Delete a local branch */
export const gitDeleteBranch = (branchName: string, force: boolean = false) =>
  invoke<void>('git_delete_branch', { branchName, force });

/** Merge a source branch into the current HEAD */
export const gitMerge = (sourceBranch: string) =>
  invoke<GitMergeResult>('git_merge', { sourceBranch });

/** Stash uncommitted changes */
export const gitStash = (message?: string, includeUntracked: boolean = true) =>
  invoke<void>('git_stash', { message: message ?? null, includeUntracked });

/** Pop the most recent stash */
export const gitStashPop = () =>
  invoke<GitStashPopResult>('git_stash_pop');

/** List stash entries */
export const gitStashList = () =>
  invoke<StashEntry[]>('git_stash_list');

// =============================================================================
// GitHub OAuth (direct GitHub token for git operations)
// =============================================================================

export interface GitHubOAuthFlowResult {
  auth_url: string;
  state: string;
}

/** Start GitHub OAuth flow — returns auth URL to open in browser */
export const githubStartAuth = () =>
  invoke<GitHubOAuthFlowResult>('github_start_auth');

/** Complete GitHub OAuth — exchange code for token */
export const githubCompleteAuth = (code: string, oauthState: string) =>
  invoke<void>('github_complete_auth', { code, oauthState });

/** Start the cloud GitHub link flow for the current Solo account */
export const githubStartLink = () =>
  invoke<string>('github_start_link');

/** Get stored GitHub access token (null if not connected) */
export const githubGetToken = () =>
  invoke<string | null>('github_get_token');

/** Unlink GitHub from the current Solo account and clear the local token cache */
export const githubDisconnect = () =>
  invoke<void>('github_disconnect');

// =============================================================================
// GitHub Device Flow (recommended — no secret, no callback server)
// =============================================================================

import type { GitHubDeviceCodeResponse } from '../../bindings/GitHubDeviceCodeResponse';
import type { GitHubDevicePollResult } from '../../bindings/GitHubDevicePollResult';

export type { GitHubDeviceCodeResponse } from '../../bindings/GitHubDeviceCodeResponse';
export type { GitHubDevicePollResult } from '../../bindings/GitHubDevicePollResult';

/** Start GitHub Device Flow — returns user_code to display and device_code for polling */
export const githubStartDeviceAuth = () =>
  invoke<GitHubDeviceCodeResponse>('github_start_device_auth');

/** Poll for GitHub Device Flow completion */
export const githubPollDeviceAuth = (deviceCode: string) =>
  invoke<GitHubDevicePollResult>('github_poll_device_auth', { deviceCode });
