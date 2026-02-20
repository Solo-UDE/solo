/**
 * Message payload types for IPC communication between frontend and backend
 */

/**
 * Attachment content block for Claude SDK
 * Supports images, documents, and text with metadata
 */
export interface AttachmentContentBlock {
  type: 'document' | 'image' | 'text';
  source?: {
    type: 'base64';
    media_type: string; // 'application/pdf', 'image/png', 'text/plain', etc.
    data: string; // base64 encoded content
  };
  text?: string; // For text blocks
  name?: string; // Original filename for reference
  filePath?: string; // For editor selections
  lineStart?: number; // For editor selections
  lineEnd?: number; // For editor selections
  terminalName?: string; // For terminal selections
  timestamp?: string; // For terminal selections
}

/**
 * Message payload sent from frontend to backend via IPC
 */
export interface MessagePayload {
  sessionId: string;
  message: string;
  attachments?: AttachmentContentBlock[];
}

/**
 * Response from backend to frontend
 */
export interface MessageResponse {
  sessionId: string;
  success: boolean;
  error?: string;
}
