/**
 * Bug Report utilities — prompt construction, screenshot handling, and submission.
 */

import { uploadFileToRepo, createIssue } from './github-api';
import type { GitHubIssueResult } from './github-api';

const BUG_REPORT_OWNER = 'Solo-UDE';
const BUG_REPORT_REPO = 'solo';

/** System prompt for AI-powered bug description expansion */
export const BUG_EXPAND_SYSTEM_PROMPT = `You are a QA assistant helping expand brief bug notes into structured bug reports. Given the user's short bug description, expand it into a clear, structured report using this format:

## Summary
[1-2 sentence summary of the bug]

## Steps to Reproduce
1. [Step 1]
2. [Step 2]
3. [Step 3]

## Expected Behavior
[What should happen]

## Actual Behavior
[What actually happens]

## Environment
- App: Solo IDE
- Platform: [infer from context or say "Desktop"]

Keep it concise and actionable. Don't invent details — if something is unclear from the description, note it as "[needs clarification]". Only output the structured report, no preamble.`;

export interface BugScreenshot {
  id: string;
  base64: string;
  thumbnailUrl: string;
  name: string;
}

/** Upload screenshots to the bug report repo and return markdown image references */
export const uploadScreenshots = async (
  token: string,
  screenshots: BugScreenshot[],
): Promise<string[]> => {
  const timestamp = Date.now();
  const imageUrls: string[] = [];

  for (let i = 0; i < screenshots.length; i++) {
    const screenshot = screenshots[i];
    const path = `.solo-bug-reports/${timestamp}-${i}-${screenshot.name}`;

    const result = await uploadFileToRepo(
      token,
      BUG_REPORT_OWNER,
      BUG_REPORT_REPO,
      path,
      screenshot.base64,
      `bug-report: upload screenshot ${screenshot.name}`,
    );

    imageUrls.push(result.download_url);
  }

  return imageUrls;
};

/** Build the issue body from description, expanded text, and screenshot URLs */
export const buildIssueBody = (
  description: string,
  expandedDescription: string | null,
  screenshotUrls: string[],
): string => {
  const parts: string[] = [];

  if (expandedDescription) {
    parts.push(expandedDescription);
  } else {
    parts.push(description);
  }

  if (screenshotUrls.length > 0) {
    parts.push('\n## Screenshots\n');
    screenshotUrls.forEach((url, i) => {
      parts.push(`![screenshot-${i + 1}](${url})`);
    });
  }

  parts.push('\n---\n*Reported from Solo IDE*');

  return parts.join('\n');
};

/** Submit a bug report as a GitHub issue */
export const submitBugReport = async (
  token: string,
  title: string,
  body: string,
): Promise<GitHubIssueResult> => {
  return createIssue(
    token,
    BUG_REPORT_OWNER,
    BUG_REPORT_REPO,
    title,
    body,
    ['bug', 'solo-reported'],
  );
};
