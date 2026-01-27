/**
 * Tauri parse command wrappers
 * Type-safe wrappers around Tauri invoke for code parsing operations
 */

import { invoke } from '@tauri-apps/api/core';

/**
 * Symbol kind enum matching Rust SymbolKind
 */
export type SymbolKind =
  | 'function'
  | 'method'
  | 'class'
  | 'struct'
  | 'enum'
  | 'interface'
  | 'type_alias'
  | 'constant'
  | 'variable'
  | 'module'
  | 'property'
  | 'enum_member'
  | 'trait'
  | 'impl'
  | 'macro'
  | 'unknown';

/**
 * Range in source code (0-indexed)
 */
export interface SymbolRange {
  start_line: number;
  start_col: number;
  end_line: number;
  end_col: number;
}

/**
 * A symbol extracted from source code
 */
export interface Symbol {
  name: string;
  kind: SymbolKind;
  range: SymbolRange;
  selection_range: SymbolRange;
  children: Symbol[];
  detail?: string;
}

/**
 * Parse error information
 */
export interface ParseError {
  message: string;
  range: SymbolRange;
}

/**
 * Response from parse operations
 */
export interface ParseResponse {
  symbols: Symbol[];
  errors: ParseError[];
  parse_time_ms: number;
  has_errors: boolean;
}

/**
 * Parse a file and extract symbols
 * @param path - Path to the file
 * @param content - Optional content (if not provided, reads from disk)
 */
export async function parseFile(
  path: string,
  content?: string
): Promise<ParseResponse> {
  const request = { path, content: content ?? null };
  return invoke<ParseResponse>('parse_file', { request });
}

/**
 * Parse content without reading from disk
 * @param path - Path (used for language detection)
 * @param content - Content to parse
 */
export async function parseContent(
  path: string,
  content: string
): Promise<ParseResponse> {
  return invoke<ParseResponse>('parse_content', { path, content });
}

/**
 * Check if a file is parseable (supported language)
 * @param path - Path to check
 */
export async function isParseable(path: string): Promise<boolean> {
  return invoke<boolean>('is_parseable', { path });
}

/**
 * Get a display icon for a symbol kind
 */
export function getSymbolIcon(kind: SymbolKind): string {
  const icons: Record<SymbolKind, string> = {
    function: 'ƒ',
    method: 'm',
    class: 'C',
    struct: 'S',
    enum: 'E',
    interface: 'I',
    type_alias: 'T',
    constant: 'c',
    variable: 'v',
    module: 'M',
    property: 'p',
    enum_member: 'e',
    trait: 't',
    impl: 'i',
    macro: '!',
    unknown: '?',
  };
  return icons[kind] ?? '?';
}

/**
 * Get a display name for a symbol kind
 */
export function getSymbolKindName(kind: SymbolKind): string {
  const names: Record<SymbolKind, string> = {
    function: 'Function',
    method: 'Method',
    class: 'Class',
    struct: 'Struct',
    enum: 'Enum',
    interface: 'Interface',
    type_alias: 'Type',
    constant: 'Constant',
    variable: 'Variable',
    module: 'Module',
    property: 'Property',
    enum_member: 'Enum Member',
    trait: 'Trait',
    impl: 'Implementation',
    macro: 'Macro',
    unknown: 'Unknown',
  };
  return names[kind] ?? 'Unknown';
}
