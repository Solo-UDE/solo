/**
 * useParseResults - Hook for tree-sitter parse results
 * Manages parsing, caching, and real-time updates
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import * as parse from '../lib/tauri/parse';
import type { Symbol } from '../lib/tauri/parse';

interface ParseState {
  symbols: Symbol[];
  errors: parse.ParseError[];
  isLoading: boolean;
  error: string | null;
  parseTimeMs: number;
  hasErrors: boolean;
}

const initialState: ParseState = {
  symbols: [],
  errors: [],
  isLoading: false,
  error: null,
  parseTimeMs: 0,
  hasErrors: false,
};

/**
 * Hook to get parse results for a file
 * @param path - File path to parse
 * @param content - Optional content (for unsaved changes)
 */
export function useParseResults(
  path: string | null,
  content?: string
): ParseState & { refresh: () => void } {
  const [state, setState] = useState<ParseState>(initialState);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const lastParseRef = useRef<{ path: string; content?: string } | null>(null);

  const doParse = useCallback(async (filePath: string, fileContent?: string) => {
    // Prevent duplicate parses
    const key = { path: filePath, content: fileContent };
    if (
      lastParseRef.current &&
      lastParseRef.current.path === key.path &&
      lastParseRef.current.content === key.content
    ) {
      return;
    }
    lastParseRef.current = key;

    setState((s) => ({ ...s, isLoading: true, error: null }));

    try {
      const response = await parse.parseFile(filePath, fileContent);
      setState({
        symbols: response.symbols,
        errors: response.errors,
        isLoading: false,
        error: null,
        parseTimeMs: response.parse_time_ms,
        hasErrors: response.has_errors,
      });
    } catch (err) {
      console.error('Parse error:', err);
      setState((s) => ({
        ...s,
        isLoading: false,
        error: err instanceof Error ? err.message : String(err),
      }));
    }
  }, []);

  // Debounced parse function
  const parseDebounced = useCallback(
    (filePath: string, fileContent?: string) => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
      debounceRef.current = setTimeout(() => {
        doParse(filePath, fileContent);
      }, 200);
    },
    [doParse]
  );

  // Parse when path or content changes
  useEffect(() => {
    if (!path) {
      setState(initialState);
      lastParseRef.current = null;
      return;
    }

    // Check if file is parseable
    parse.isParseable(path).then((supported) => {
      if (supported) {
        parseDebounced(path, content);
      } else {
        setState(initialState);
      }
    });

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [path, content, parseDebounced]);

  // Listen for file change events
  useEffect(() => {
    if (!path) return;

    interface BackendEventPayload {
      type: string;
      payload: { path: string };
    }

    const unlisten = listen<BackendEventPayload>('backend-event', (event) => {
      const payload = event.payload;
      if (
        payload.type === 'file:changed' &&
        payload.payload.path === path &&
        !content // Only auto-refresh if we're not using custom content
      ) {
        doParse(path);
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [path, content, doParse]);

  // Manual refresh function
  const refresh = useCallback(() => {
    if (path) {
      lastParseRef.current = null; // Force re-parse
      doParse(path, content);
    }
  }, [path, content, doParse]);

  return { ...state, refresh };
}

/**
 * Find the symbol at a given position
 */
export function findSymbolAtPosition(
  symbols: Symbol[],
  line: number,
  col: number
): Symbol | null {
  for (const symbol of symbols) {
    const range = symbol.range;
    const inRange =
      (line > range.start_line ||
        (line === range.start_line && col >= range.start_col)) &&
      (line < range.end_line || (line === range.end_line && col <= range.end_col));

    if (inRange) {
      // Check children for more specific match
      const childMatch = findSymbolAtPosition(symbol.children, line, col);
      return childMatch ?? symbol;
    }
  }
  return null;
}

/**
 * Get the symbol path (breadcrumb) for a position
 */
export function getSymbolPath(
  symbols: Symbol[],
  line: number,
  col: number
): Symbol[] {
  const path: Symbol[] = [];

  function findPath(syms: Symbol[]): boolean {
    for (const symbol of syms) {
      const range = symbol.range;
      const inRange =
        (line > range.start_line ||
          (line === range.start_line && col >= range.start_col)) &&
        (line < range.end_line ||
          (line === range.end_line && col <= range.end_col));

      if (inRange) {
        path.push(symbol);
        findPath(symbol.children);
        return true;
      }
    }
    return false;
  }

  findPath(symbols);
  return path;
}
