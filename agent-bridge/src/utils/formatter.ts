/**
 * Tool output formatter - formats tool results to show summaries instead of full content
 * Matches the Python backend's tool_formatter.py logic
 */

export interface ToolResult {
  tool_use_id: string;
  type: 'tool_result';
  content: unknown;
  is_error?: boolean;
}

/**
 * Safely convert content to string
 */
function contentToString(content: unknown): string {
  if (content === null || content === undefined) {
    return '';
  }
  if (typeof content === 'string') {
    return content;
  }
  if (typeof content === 'number' || typeof content === 'boolean' || typeof content === 'bigint') {
    return String(content);
  }
  if (typeof content === 'object') {
    try {
      return JSON.stringify(content);
    } catch {
      return '[Object]';
    }
  }
  // symbol or function
  return '[Unknown]';
}

/**
 * Format tool result content based on tool type
 */
export function formatToolResult(
  toolName: string,
  toolInput: Record<string, unknown>,
  resultContent: unknown,
  isError = false
): string {
  if (isError) {
    return formatError(resultContent);
  }

  // Tool-specific formatters
  switch (toolName) {
    case 'Read':
      return formatRead(resultContent);
    case 'Write':
      return formatWrite(resultContent);
    case 'Edit':
      return formatEdit(toolInput, resultContent);
    case 'Bash':
      return formatBash(resultContent);
    case 'Grep':
      return formatGrep(resultContent);
    case 'Glob':
      return formatGlob(resultContent);
    case 'TodoWrite':
      return formatTodoWrite(toolInput);
    case 'WebFetch':
    case 'WebSearch':
      return formatWebTool(resultContent);
    default:
      return formatGeneric(resultContent);
  }
}

/**
 * Format Read tool output - show line count instead of full file content
 */
function formatRead(resultContent: unknown): string {
  if (resultContent === null || resultContent === undefined) {
    return 'Completed';
  }

  const contentStr = contentToString(resultContent);
  const lineCount = contentStr.split('\n').length;
  return `Read ${String(lineCount)} lines`;
}

/**
 * Format Write tool output
 */
function formatWrite(resultContent: unknown): string {
  if (resultContent === null || resultContent === undefined) {
    return 'Completed';
  }

  const contentStr = contentToString(resultContent).toLowerCase();
  if (contentStr.includes('created')) {
    return 'Created new file';
  }
  return 'File written successfully';
}

/**
 * Format Edit tool output
 */
function formatEdit(toolInput: Record<string, unknown>, resultContent: unknown): string {
  if (resultContent === null || resultContent === undefined) {
    return 'Completed';
  }

  const oldStringValue = toolInput.old_string;
  const newStringValue = toolInput.new_string;
  const oldString = typeof oldStringValue === 'string' ? oldStringValue : '';
  const newString = typeof newStringValue === 'string' ? newStringValue : '';

  const oldLines = oldString.length > 0 ? oldString.split('\n').length : 0;
  const newLines = newString.length > 0 ? newString.split('\n').length : 0;

  return `Updated with ${String(newLines)} addition${newLines !== 1 ? 's' : ''} and ${String(oldLines)} removal${oldLines !== 1 ? 's' : ''}`;
}

/**
 * Format Bash command output
 */
function formatBash(resultContent: unknown): string {
  if (resultContent === null || resultContent === undefined) {
    return 'Completed';
  }

  const contentStr = contentToString(resultContent);
  const lines = contentStr.split('\n');
  const MAX_LINES = 50;

  if (lines.length <= MAX_LINES) {
    return lines.join('\n');
  }

  const displayLines = lines.slice(0, MAX_LINES).join('\n');
  return `${displayLines}\n... (${String(lines.length - MAX_LINES)} more lines)`;
}

/**
 * Format Grep output
 */
function formatGrep(resultContent: unknown): string {
  if (resultContent === null || resultContent === undefined) {
    return 'Completed';
  }

  const contentStr = contentToString(resultContent);
  const matches = contentStr.split('\n').filter((line) => line.trim().length > 0);
  const MAX_MATCHES = 10;

  const lines = [`Found ${String(matches.length)} matches`];

  const displayMatches = matches.slice(0, MAX_MATCHES);
  for (const match of displayMatches) {
    lines.push(match);
  }

  if (matches.length > MAX_MATCHES) {
    lines.push(`... (${String(matches.length - MAX_MATCHES)} more matches)`);
  }

  return lines.join('\n');
}

/**
 * Format Glob output
 */
function formatGlob(resultContent: unknown): string {
  if (resultContent === null || resultContent === undefined) {
    return 'Completed';
  }

  const contentStr = contentToString(resultContent);
  const files = contentStr.split('\n').filter((line) => line.trim().length > 0);
  const MAX_FILES = 15;

  const lines = [`Found ${String(files.length)} files`];

  const displayFiles = files.slice(0, MAX_FILES);
  for (const file of displayFiles) {
    lines.push(file);
  }

  if (files.length > MAX_FILES) {
    lines.push(`... (${String(files.length - MAX_FILES)} more files)`);
  }

  return lines.join('\n');
}

/**
 * Format TodoWrite output
 */
function formatTodoWrite(toolInput: Record<string, unknown>): string {
  const todos = toolInput.todos;
  if (Array.isArray(todos)) {
    return `Updated ${String(todos.length)} todo items`;
  }
  return 'Completed';
}

/**
 * Format WebFetch and WebSearch output - return full content without truncation
 */
function formatWebTool(resultContent: unknown): string {
  if (resultContent === null || resultContent === undefined) {
    return 'Completed';
  }
  return contentToString(resultContent);
}

/**
 * Format error output
 */
function formatError(resultContent: unknown): string {
  if (resultContent === null || resultContent === undefined) {
    return 'Error occurred';
  }

  const contentStr = contentToString(resultContent);
  const lines = contentStr.split('\n');
  const MAX_LINES = 10;

  if (lines.length <= MAX_LINES) {
    return lines.join('\n');
  }

  const displayLines = lines.slice(0, MAX_LINES).join('\n');
  return `${displayLines}\n... (${String(lines.length - MAX_LINES)} more lines)`;
}

/**
 * Format generic tool output
 */
function formatGeneric(resultContent: unknown): string {
  if (resultContent === null || resultContent === undefined) {
    return 'Completed';
  }

  const contentStr = contentToString(resultContent);
  const lines = contentStr.split('\n');
  const MAX_LINES = 10;

  if (lines.length <= MAX_LINES) {
    return lines.join('\n');
  }

  const displayLines = lines.slice(0, MAX_LINES).join('\n');
  return `${displayLines}\n... (${String(lines.length - MAX_LINES)} more lines)`;
}
