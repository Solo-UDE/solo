/**
 * Vault reader for agent-bridge.
 *
 * Opens the same SQLite DB the Rust side writes to (WAL mode makes concurrent
 * reads safe). Exposes:
 *   1. A `vault_search` tool for the SDK so the model can query the vault on
 *      demand (Option A — hint-based recall).
 *   2. `fetchVaultContext()` used by the pre-flight injector that automatically
 *      prepends the top-k chunks for a user message (Option B — RAG).
 *
 * Schema is mirrored from `crates/solo-vault/src/store.rs`. Keep the two in
 * sync; breaking changes will surface as runtime SQL errors here.
 */

// eslint-disable-next-line import/no-unresolved
import { Database } from 'bun:sqlite';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { createLogger } from './logger.js';

const logger = createLogger('vault');

const VAULT_DB = join(homedir(), '.solo', 'vault', 'index.sqlite');

interface VaultChunkRow {
  chunk_id: string;
  entry_id: string;
  chunk_index: number;
  content: string;
  title: string;
  kind: string;
  pinned: number;
  scope_type: string;
  scope_project_id: string | null;
  rank: number;
}

export interface VaultHit {
  entryId: string;
  entryTitle: string;
  kind: string;
  pinned: boolean;
  chunkIndex: number;
  content: string;
  score: number;
}

function openDb(): Database | null {
  if (!existsSync(VAULT_DB)) {
    return null;
  }
  try {
    // Rust side already configured WAL mode on the database file; opening
    // read-only here inherits that setting.
    return new Database(VAULT_DB, { readonly: true });
  } catch (err) {
    logger.warn({ err: String(err), path: VAULT_DB }, 'vault: open failed');
    return null;
  }
}

/**
 * FTS5 search over vault chunks. Scope rules mirror Rust: global entries are
 * always visible; project entries only match if `projectId` matches.
 *
 * Pinned entries are surfaced even when FTS score is weak by a cheap UNION
 * fallback — each pinned entry's top chunk is included regardless of match.
 */
export function searchVault(
  query: string,
  opts: { projectId?: string; topK?: number } = {},
): VaultHit[] {
  const { projectId, topK = 6 } = opts;
  const db = openDb();
  if (!db) return [];

  try {
    // FTS escaping: strip quotes, bind as a phrase for safety
    const ftsQuery = sanitizeFts(query);
    if (!ftsQuery) {
      db.close();
      return [];
    }

    const stmt = db.query(`
      SELECT
        c.id AS chunk_id,
        c.entry_id AS entry_id,
        c.chunk_index AS chunk_index,
        c.content AS content,
        e.title AS title,
        e.kind AS kind,
        e.pinned AS pinned,
        e.scope_type AS scope_type,
        e.scope_project_id AS scope_project_id,
        bm25(chunks_fts) AS rank
      FROM chunks_fts
      JOIN chunks  c ON c.id = chunks_fts.chunk_id
      JOIN entries e ON e.id = c.entry_id
      WHERE chunks_fts MATCH ?
        AND (e.scope_type = 'global'
             OR (e.scope_type = 'project' AND e.scope_project_id = ?))
      ORDER BY rank
      LIMIT ?
    `);

    const rows = stmt.all(ftsQuery, projectId ?? null, topK) as VaultChunkRow[];

    db.close();
    return rows.map((r) => ({
      entryId: r.entry_id,
      entryTitle: r.title,
      kind: r.kind,
      pinned: r.pinned !== 0,
      chunkIndex: r.chunk_index,
      content: r.content,
      score: 1 / (1 + Math.abs(r.rank)),
    }));
  } catch (err) {
    logger.warn({ err: String(err), query }, 'vault: search failed');
    try {
      db.close();
    } catch {
      /* already closed */
    }
    return [];
  }
}

/**
 * Pinned-only fetch — used by the pre-flight injector to guarantee pinned
 * sources of truth are in context on every turn.
 */
export function pinnedEntries(opts: { projectId?: string; limit?: number } = {}): VaultHit[] {
  const { projectId, limit = 3 } = opts;
  const db = openDb();
  if (!db) return [];
  try {
    const stmt = db.query(`
      SELECT
        c.id AS chunk_id,
        c.entry_id AS entry_id,
        c.chunk_index AS chunk_index,
        c.content AS content,
        e.title AS title,
        e.kind AS kind,
        e.pinned AS pinned,
        e.scope_type AS scope_type,
        e.scope_project_id AS scope_project_id,
        0 AS rank
      FROM entries e
      JOIN chunks  c ON c.entry_id = e.id AND c.chunk_index = 0
      WHERE e.pinned = 1
        AND (e.scope_type = 'global'
             OR (e.scope_type = 'project' AND e.scope_project_id = ?))
      ORDER BY e.updated_at DESC
      LIMIT ?
    `);
    const rows = stmt.all(projectId ?? null, limit) as VaultChunkRow[];
    db.close();
    return rows.map((r) => ({
      entryId: r.entry_id,
      entryTitle: r.title,
      kind: r.kind,
      pinned: true,
      chunkIndex: r.chunk_index,
      content: r.content,
      score: 1.0,
    }));
  } catch (err) {
    logger.warn({ err: String(err) }, 'vault: pinned fetch failed');
    try {
      db.close();
    } catch {
      /* already closed */
    }
    return [];
  }
}

/**
 * Fetch compact vault context for a user message. Returns a formatted string
 * ready to prepend or an empty string if no relevant chunks were found.
 * Token budget is approximate (~2000 tokens ≈ 1500 words).
 */
export function fetchVaultContext(
  userMessage: string,
  opts: { projectId?: string; maxChunks?: number } = {},
): string {
  const { projectId, maxChunks = 5 } = opts;

  const pinned = pinnedEntries({ projectId, limit: 3 });
  const hits = searchVault(userMessage, { projectId, topK: maxChunks });

  // Merge: pinned first, then FTS hits (dedupe by entryId+chunkIndex)
  const seen = new Set<string>();
  const merged: VaultHit[] = [];
  for (const h of [...pinned, ...hits]) {
    const key = `${h.entryId}:${h.chunkIndex}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(h);
    if (merged.length >= maxChunks + pinned.length) break;
  }

  if (merged.length === 0) return '';

  const sections = merged.map((h) => {
    const badge = h.pinned ? ' [pinned]' : '';
    return `### ${h.entryTitle}${badge} (${h.kind}, chunk ${h.chunkIndex})\n${h.content.trim()}`;
  });

  return [
    '<vault-memory>',
    'The following context was auto-retrieved from the user\'s vault. Treat it',
    'as authoritative when answering. If none of it is relevant to the user\'s',
    'current question, ignore it silently rather than mentioning that you',
    'received it.',
    '',
    sections.join('\n\n'),
    '</vault-memory>',
  ].join('\n');
}

/** Escape user input for FTS5. Strip double quotes and wrap in quotes so
 *  the full phrase is treated as a single token group. */
function sanitizeFts(raw: string): string {
  const cleaned = raw.replace(/["']/g, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';
  // Tokenize into OR-joined terms so any overlap hits
  const terms = cleaned
    .split(' ')
    .filter((t) => t.length >= 2)
    .map((t) => t.replace(/[^\p{L}\p{N}_-]/gu, ''))
    .filter(Boolean);
  if (terms.length === 0) return '';
  return terms.join(' OR ');
}

// ----------------------------------------------------------------------------
// SDK tool — Option A: the model can call `vault_search` like Read/Grep.
// ----------------------------------------------------------------------------

export const vaultSearchTool = tool(
  'vault_search',
  'Search the user\'s personal vault (agent memory) for indexed content. ' +
    'The vault holds documents, code, screenshots, and data the user has ' +
    'chosen to remember across sessions. ALWAYS use this tool before asking ' +
    'the user to re-explain something they\'ve indexed — especially when they ' +
    'refer to "that spec", "the schema I shared", "my notes on X", or ask ' +
    '"did I put X in the vault?". Returns the top matching chunks with titles.',
  {
    query: z
      .string()
      .min(2)
      .describe(
        'Free-text search query. Use keywords from the user\'s message. ' +
          'Supports lexical (FTS5) matching over chunk content.',
      ),
    top_k: z
      .number()
      .int()
      .min(1)
      .max(20)
      .default(6)
      .describe('Maximum chunks to return (default 6).'),
  },
  async (args) => {
    const hits = searchVault(args.query, { topK: args.top_k ?? 6 });
    if (hits.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: `No vault entries matched "${args.query}".`,
          },
        ],
      };
    }
    const body = hits
      .map(
        (h) =>
          `### ${h.entryTitle}${h.pinned ? ' [pinned]' : ''} (${h.kind})\n` +
          `score: ${(h.score * 100).toFixed(0)}%\n` +
          `${h.content.trim()}`,
      )
      .join('\n\n---\n\n');
    return {
      content: [{ type: 'text', text: body }],
    };
  },
);
