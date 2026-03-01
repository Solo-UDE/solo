/**
 * Utility to build Claude SDK content blocks from attachments
 * Converts various attachment types into proper Claude API format
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import type { AttachmentContentBlock } from '../messages.js';

/** Max file sizes to avoid API payload limits */
const MAX_IMAGE_SIZE = 20 * 1024 * 1024; // 20MB
const MAX_DOCUMENT_SIZE = 30 * 1024 * 1024; // 30MB
const MAX_TEXT_SIZE = 1 * 1024 * 1024; // 1MB

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
          media_type: attachment.source.mediaType as DocumentMediaType,
          data: attachment.source.data,
        },
      });
    } else if (attachment.type === 'image' && attachment.source) {
      // Image with inline base64 data
      contentBlocks.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: attachment.source.mediaType as ImageMediaType,
          data: attachment.source.data,
        },
      });
    } else if (attachment.type === 'image' && attachment.filePath && !attachment.source) {
      // Image from filesystem — read and base64-encode
      const block = readImageFromPath(attachment.filePath);
      if (block) contentBlocks.push(block);
    } else if (attachment.type === 'document' && attachment.filePath && !attachment.source) {
      // Try as binary document (PDF) first, fall back to text for code/markup files
      const docBlock = readDocumentFromPath(attachment.filePath);
      if (docBlock) {
        contentBlocks.push(docBlock);
      } else {
        // Not a PDF — read as text (code files, markdown, config, etc.)
        const fileContent = readTextFromPath(attachment.filePath);
        if (fileContent !== null) {
          const name = attachment.name ?? path.basename(attachment.filePath);
          const languageHint = getLanguageHint(name);
          contentBlocks.push({
            type: 'text',
            text: `File: ${name}\n\`\`\`${languageHint}\n${fileContent}\n\`\`\``,
          });
        }
      }
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
      } else if (attachment.filePath && !attachment.text) {
        // File-path-only text attachment (@ mentions, file picker)
        const fileContent = readTextFromPath(attachment.filePath);
        if (fileContent !== null) {
          const name = attachment.name ?? path.basename(attachment.filePath);
          const languageHint = getLanguageHint(name);
          textContent = `File: ${name}\n\`\`\`${languageHint}\n${fileContent}\n\`\`\``;
        }
      } else {
        // Plain text
        textContent = attachment.text ?? '';
      }

      if (textContent) {
        contentBlocks.push({
          type: 'text',
          text: textContent,
        });
      }
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
 * Map file extension to Claude-supported image MIME type.
 * Returns null for unsupported types.
 */
function getImageMimeType(filename: string): ImageMediaType | null {
  const ext = filename.split('.').pop()?.toLowerCase();
  const map: Record<string, ImageMediaType> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
  };
  return map[ext ?? ''] ?? null;
}

/**
 * Map file extension to Claude-supported document MIME type.
 * Returns null for unsupported types.
 */
function getDocumentMimeType(filename: string): DocumentMediaType | null {
  const ext = filename.split('.').pop()?.toLowerCase();
  if (ext === 'pdf') return 'application/pdf';
  return null;
}

/**
 * Read an image file from disk and return a Claude image content block.
 * Returns null if the file can't be read or has an unsupported type.
 */
function readImageFromPath(filePath: string): ClaudeContentBlock | null {
  const mimeType = getImageMimeType(path.basename(filePath));
  if (!mimeType) return null;

  try {
    const stat = fs.statSync(filePath);
    if (stat.size > MAX_IMAGE_SIZE) {
      console.warn(`Skipping image attachment: file too large (${stat.size} bytes): ${filePath}`);
      return null;
    }
    const data = fs.readFileSync(filePath).toString('base64');
    return {
      type: 'image',
      source: { type: 'base64', media_type: mimeType, data },
    };
  } catch (err) {
    console.warn(`Failed to read image attachment: ${filePath}`, err);
    return null;
  }
}

/**
 * Read a document file (PDF) from disk and return a Claude document content block.
 * Returns null if the file can't be read or has an unsupported type.
 */
function readDocumentFromPath(filePath: string): ClaudeContentBlock | null {
  const mimeType = getDocumentMimeType(path.basename(filePath));
  if (!mimeType) return null;

  try {
    const stat = fs.statSync(filePath);
    if (stat.size > MAX_DOCUMENT_SIZE) {
      console.warn(`Skipping document attachment: file too large (${stat.size} bytes): ${filePath}`);
      return null;
    }
    const data = fs.readFileSync(filePath).toString('base64');
    return {
      type: 'document',
      source: { type: 'base64', media_type: mimeType, data },
    };
  } catch (err) {
    console.warn(`Failed to read document attachment: ${filePath}`, err);
    return null;
  }
}

/**
 * Read a text file from disk. Returns the content string or null on failure.
 */
function readTextFromPath(filePath: string): string | null {
  try {
    const stat = fs.statSync(filePath);
    if (stat.size > MAX_TEXT_SIZE) {
      console.warn(`Skipping text attachment: file too large (${stat.size} bytes): ${filePath}`);
      return null;
    }
    return fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    console.warn(`Failed to read text attachment: ${filePath}`, err);
    return null;
  }
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
