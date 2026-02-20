/**
 * Utility to build Claude SDK content blocks from attachments
 * Converts various attachment types into proper Claude API format
 */

import type { AttachmentContentBlock } from '../messages.js';

/**
 * Supported image media types for Claude SDK
 */
export type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

/**
 * Supported document media types for Claude SDK
 */
export type DocumentMediaType = 'application/pdf';

/**
 * Claude SDK content block types
 */
export type ClaudeContentBlock =
  | { type: 'text'; text: string }
  | {
      type: 'image';
      source: {
        type: 'base64';
        media_type: ImageMediaType;
        data: string;
      };
    }
  | {
      type: 'document';
      source: {
        type: 'base64';
        media_type: DocumentMediaType;
        data: string;
      };
    };

/**
 * Build Claude SDK content blocks from message text and attachments
 * @param message - The user's text message
 * @param attachments - Array of attachments to include
 * @returns Array of content blocks or simple string if no attachments
 */
export function buildContentBlocks(
  message: string,
  attachments?: AttachmentContentBlock[]
): string | ClaudeContentBlock[] {
  // If no attachments, return simple string format
  if (!attachments || attachments.length === 0) {
    return message;
  }

  const contentBlocks: ClaudeContentBlock[] = [];

  // Process attachments FIRST (Claude processes content blocks in order)
  for (const attachment of attachments) {
    if (attachment.type === 'document' && attachment.source) {
      // Binary document (PDF)
      contentBlocks.push({
        type: 'document',
        source: {
          type: 'base64',
          media_type: attachment.source.media_type as DocumentMediaType,
          data: attachment.source.data,
        },
      });
    } else if (attachment.type === 'image' && attachment.source) {
      // Image file
      contentBlocks.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: attachment.source.media_type as ImageMediaType,
          data: attachment.source.data,
        },
      });
    } else if (attachment.type === 'text') {
      // Text content with metadata
      let textContent = '';

      if (
        attachment.filePath !== undefined &&
        attachment.lineStart !== undefined &&
        attachment.lineEnd !== undefined
      ) {
        // Editor selection with line numbers
        const lineRange =
          attachment.lineStart === attachment.lineEnd
            ? `line ${String(attachment.lineStart)}`
            : `lines ${String(attachment.lineStart)}-${String(attachment.lineEnd)}`;

        textContent = `From: ${attachment.filePath} (${lineRange})\n\`\`\`\n${attachment.text ?? ''}\n\`\`\``;
      } else if (attachment.terminalName !== undefined && attachment.timestamp !== undefined) {
        // Terminal output
        textContent = `From: ${attachment.terminalName} (captured at ${attachment.timestamp})\n\`\`\`\n${attachment.text ?? ''}\n\`\`\``;
      } else if (attachment.name !== undefined && attachment.text !== undefined) {
        // Text file with inline content
        const languageHint = getLanguageHint(attachment.name);
        textContent = `File: ${attachment.name}\n\`\`\`${languageHint}\n${attachment.text}\n\`\`\``;
      } else {
        // Plain text
        textContent = attachment.text ?? '';
      }

      contentBlocks.push({
        type: 'text',
        text: textContent,
      });
    }
  }

  // Add the user's message text LAST
  contentBlocks.push({
    type: 'text',
    text: message,
  });

  return contentBlocks;
}

/**
 * Get language hint for code fence based on filename
 */
function getLanguageHint(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();

  const languageMap: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    py: 'python',
    rb: 'ruby',
    go: 'go',
    rs: 'rust',
    java: 'java',
    cpp: 'cpp',
    c: 'c',
    cs: 'csharp',
    php: 'php',
    swift: 'swift',
    kt: 'kotlin',
    scala: 'scala',
    sh: 'bash',
    bash: 'bash',
    zsh: 'bash',
    yaml: 'yaml',
    yml: 'yaml',
    json: 'json',
    md: 'markdown',
    html: 'html',
    css: 'css',
    scss: 'scss',
    sql: 'sql',
  };

  return languageMap[ext ?? ''] ?? '';
}
