/**
 * GitHub REST API client
 *
 * Provides functions for interacting with GitHub's REST API
 * for repository management, branch operations, and account info.
 */

const GITHUB_API = 'https://api.github.com';

function makeHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

export interface GitHubAccount {
  id: number;
  login: string;
  avatar_url: string;
  type: 'User' | 'Organization';
}

export interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  html_url: string;
  clone_url: string;
  private: boolean;
  default_branch: string;
}

export interface GitHubBranch {
  name: string;
  commit: { sha: string };
  protected: boolean;
}

export interface GitHubInstallation {
  id: number;
  account: GitHubAccount;
  app_slug: string;
}

/** Get the authenticated user */
export const getAuthenticatedUser = async (token: string): Promise<GitHubAccount> => {
  const res = await fetch(`${GITHUB_API}/user`, { headers: makeHeaders(token) });
  if (!res.ok) throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
  return res.json();
};

/** List user's repositories */
export const listRepos = async (
  token: string,
  page = 1,
  perPage = 30,
): Promise<GitHubRepo[]> => {
  const res = await fetch(
    `${GITHUB_API}/user/repos?sort=updated&per_page=${perPage}&page=${page}`,
    { headers: makeHeaders(token) },
  );
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
  return res.json();
};

/** Create a new repository */
export const createRepo = async (
  token: string,
  name: string,
  isPrivate = true,
  description?: string,
): Promise<GitHubRepo> => {
  const res = await fetch(`${GITHUB_API}/user/repos`, {
    method: 'POST',
    headers: makeHeaders(token),
    body: JSON.stringify({
      name,
      private: isPrivate,
      description: description ?? `Created by Solo IDE`,
      auto_init: false,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to create repo: ${res.status} ${body}`);
  }
  return res.json();
};

/** List branches for a repository */
export const listBranches = async (
  token: string,
  owner: string,
  repo: string,
): Promise<GitHubBranch[]> => {
  const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/branches`, {
    headers: makeHeaders(token),
  });
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
  return res.json();
};

/** Create a new branch from a reference */
export const createBranch = async (
  token: string,
  owner: string,
  repo: string,
  branchName: string,
  fromSha: string,
): Promise<void> => {
  const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/git/refs`, {
    method: 'POST',
    headers: makeHeaders(token),
    body: JSON.stringify({
      ref: `refs/heads/${branchName}`,
      sha: fromSha,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to create branch: ${res.status} ${body}`);
  }
};

/** Check if a repository exists */
export const checkRepoExists = async (
  token: string,
  owner: string,
  repo: string,
): Promise<boolean> => {
  const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}`, {
    headers: makeHeaders(token),
  });
  return res.ok;
};

/** Get GitHub App installation URL */
export const getInstallUrl = (appSlug = 'solo-ide'): string => {
  return `https://github.com/apps/${appSlug}/installations/new`;
};

/** List GitHub App installations for the authenticated user */
export const listInstallations = async (
  token: string,
): Promise<GitHubInstallation[]> => {
  const res = await fetch(`${GITHUB_API}/user/installations`, {
    headers: makeHeaders(token),
  });
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
  const data = await res.json();
  return data.installations ?? [];
};

// ============================================================================
// Bug Report API
// ============================================================================

export interface GitHubFileUploadResult {
  download_url: string;
  path: string;
  sha: string;
}

export interface GitHubIssueResult {
  html_url: string;
  number: number;
}

/** Upload a file to a repository via the Contents API */
export const uploadFileToRepo = async (
  token: string,
  owner: string,
  repo: string,
  path: string,
  base64Content: string,
  commitMessage: string,
): Promise<GitHubFileUploadResult> => {
  const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/contents/${path}`, {
    method: 'PUT',
    headers: makeHeaders(token),
    body: JSON.stringify({
      message: commitMessage,
      content: base64Content,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to upload file: ${res.status} ${body}`);
  }
  const data = await res.json();
  return {
    download_url: data.content.download_url,
    path: data.content.path,
    sha: data.content.sha,
  };
};

/** Create a new issue on a repository */
export const createIssue = async (
  token: string,
  owner: string,
  repo: string,
  title: string,
  body: string,
  labels?: string[],
): Promise<GitHubIssueResult> => {
  const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/issues`, {
    method: 'POST',
    headers: makeHeaders(token),
    body: JSON.stringify({
      title,
      body,
      ...(labels && labels.length > 0 ? { labels } : {}),
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to create issue: ${res.status} ${text}`);
  }
  const data = await res.json();
  return {
    html_url: data.html_url,
    number: data.number,
  };
};

/** Generate a commit message using AI (placeholder — delegates to agent) */
export const generateCommitMessage = async (
  diff: string,
): Promise<string> => {
  // Simple heuristic for now — will be replaced by agent call
  const lines = diff.split('\n');
  const additions = lines.filter((l) => l.startsWith('+')).length;
  const deletions = lines.filter((l) => l.startsWith('-')).length;

  if (additions > 0 && deletions > 0) {
    return `Update ${additions} additions, ${deletions} deletions`;
  } else if (additions > 0) {
    return `Add ${additions} lines`;
  } else if (deletions > 0) {
    return `Remove ${deletions} lines`;
  }
  return 'Update files';
};
