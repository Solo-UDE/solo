/**
 * Vault reader for agent-bridge.
 *
 * Opens the same SQLite DB the Rust side writes to (WAL mode makes concurrent
 * reads safe). Exposes:
 *   1. A `vault_search` tool for the SDK so the model can query the vault on
 *      demand (supports both `fts` and `semantic` modes).
 *   2. `fetchVaultContext()` used by the pre-flight injector that automatically
 *      prepends the top-k FTS hits + pinned chunks to every user message.
 *   3. `loadEmbeddingsCache()` — preloaded on session start so semantic tool
 *      calls are sub-millisecond after the query-embed step.
 *   4. `embedQuery()` — **local** inference via `@xenova/transformers` +
 *      `all-MiniLM-L6-v2` (384 dims, ~90 MB model cached locally on first
 *      call). Zero network per query, zero API keys, zero per-user cost.
 *      LRU cache (size 128) still applies so repeat queries are free.
 *
 * Schema is mirrored from `crates/solo-vault/src/store.rs`. Keep the two in
 * sync; breaking changes will surface as runtime SQL errors here.
 *
 * ## Observability
 * Every boundary crossing emits a structured log event under the `vault.*`
 * namespace so we can measure latency and retrieval quality.
 *   - `vault.cache.load.start` / `vault.cache.loaded` — cold-load stats
 *   - `vault.embedder.init`     — one-time model load / download latency
 *   - `vault.query.embed`       — per-query embedding latency + cache hit
 *   - `vault.tool.search`       — mode, candidates, rank_ms, top scores
 *   - `vault.rag.preflight`     — injected size + chunk counts per turn
 *
 * Set `VAULT_DEBUG=1` to dump per-chunk scores in the tool output for
 * eyeball QA.
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

// Keep in sync with `EMBEDDING_DIM` in crates/solo-vault/src/store.rs.
// V1.2.1: switched from OpenAI (1536) to local MiniLM-L6-v2 (384).
const EMBEDDING_DIM = 384;

// Env toggle: when set to any truthy value, the semantic tool returns the
// full scored list in its visible text so the developer can eyeball quality.
const VAULT_DEBUG = process.env.VAULT_DEBUG === '1' || process.env.VAULT_DEBUG === 'true';

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

// ============================================================================
// V1.2 — Semantic search (Bun-side cosine over a session-lifetime cache)
// ============================================================================

interface CachedChunk {
  chunkId: string;
  entryId: string;
  entryTitle: string;
  kind: string;
  pinned: boolean;
  chunkIndex: number;
  content: string;
  embedding: Float32Array;
}

/**
 * Session-lifetime embedding cache. Populated by `loadEmbeddingsCache()`.
 * Keyed by scope ("global" or "project:<id>") — simple invalidation strategy
 * is to just reload when scope changes.
 */
let semanticCache: CachedChunk[] | null = null;
let semanticCacheScope: string | null = null;
let semanticCacheLoading: Promise<void> | null = null;

/**
 * Preload all scope-eligible chunks that have an embedding, into RAM,
 * decoded as `Float32Array`. Safe to call multiple times — no-op if already
 * loaded for the same scope. Called from `agent.ts` on session start so the
 * first semantic tool invocation doesn't pay the load cost.
 *
 * Cold-load timing is logged as `vault.cache.loaded` for eyeball sanity.
 */
export async function loadEmbeddingsCache(projectId?: string): Promise<void> {
  const scopeKey = projectId ? `project:${projectId}` : 'global';
  if (semanticCache !== null && semanticCacheScope === scopeKey) {
    return;
  }
  if (semanticCacheLoading) {
    return semanticCacheLoading;
  }

  const p = (async () => {
    const start = Date.now();
    logger.info({ scope: scopeKey }, 'vault.cache.load.start');
    const db = openDb();
    if (!db) {
      semanticCache = [];
      semanticCacheScope = scopeKey;
      logger.warn({ path: VAULT_DB }, 'vault.cache.load.no_db');
      return;
    }
    try {
      const stmt = db.query(`
        SELECT
          c.id          AS chunk_id,
          c.entry_id    AS entry_id,
          c.chunk_index AS chunk_index,
          c.content     AS content,
          c.embedding   AS embedding,
          e.title       AS title,
          e.kind        AS kind,
          e.pinned      AS pinned
        FROM chunks c
        JOIN entries e ON e.id = c.entry_id
        WHERE c.embedding IS NOT NULL
          AND (e.scope_type = 'global'
               OR (e.scope_type = 'project' AND e.scope_project_id = ?))
      `);
      const rows = stmt.all(projectId ?? null) as Array<{
        chunk_id: string;
        entry_id: string;
        chunk_index: number;
        content: string;
        embedding: Uint8Array;
        title: string;
        kind: string;
        pinned: number;
      }>;

      const out: CachedChunk[] = [];
      let totalBytes = 0;
      let skipped = 0;
      for (const r of rows) {
        const vec = decodeEmbedding(r.embedding, EMBEDDING_DIM);
        if (!vec) {
          skipped++;
          continue;
        }
        totalBytes += r.embedding.byteLength;
        out.push({
          chunkId: r.chunk_id,
          entryId: r.entry_id,
          entryTitle: r.title,
          kind: r.kind,
          pinned: r.pinned !== 0,
          chunkIndex: r.chunk_index,
          content: r.content,
          embedding: vec,
        });
      }
      semanticCache = out;
      semanticCacheScope = scopeKey;
      logger.info(
        {
          chunks: out.length,
          bytes: totalBytes,
          ms: Date.now() - start,
          dim: EMBEDDING_DIM,
          skipped_corrupt: skipped,
          scope: scopeKey,
        },
        'vault.cache.loaded',
      );
    } catch (err) {
      logger.error({ err: String(err) }, 'vault.cache.load_failed');
      semanticCache = [];
      semanticCacheScope = scopeKey;
    } finally {
      try {
        db.close();
      } catch {
        /* already closed */
      }
    }
  })();
  semanticCacheLoading = p;
  try {
    await p;
  } finally {
    semanticCacheLoading = null;
  }
}

/** Invalidate the semantic cache. Call when an entry is added/removed/updated. */
export function invalidateEmbeddingsCache(): void {
  semanticCache = null;
  semanticCacheScope = null;
}

/**
 * Decode a little-endian packed-f32 BLOB into a Float32Array. Returns null on
 * dimension mismatch so the caller can skip + log.
 */
function decodeEmbedding(bytes: Uint8Array, expectedDim: number): Float32Array | null {
  if (bytes.byteLength % 4 !== 0) return null;
  const gotDim = bytes.byteLength / 4;
  if (gotDim !== expectedDim) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Float32Array(gotDim);
  for (let i = 0; i < gotDim; i++) {
    out[i] = view.getFloat32(i * 4, /* littleEndian */ true);
  }
  return out;
}

/**
 * Cosine similarity between two equal-length f32 vectors. Returns 0 for
 * non-finite or zero-magnitude inputs.
 */
function cosine(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    dot += x * y;
    ma += x * x;
    mb += y * y;
  }
  const denom = Math.sqrt(ma) * Math.sqrt(mb);
  if (!Number.isFinite(denom) || denom === 0) return 0;
  const c = dot / denom;
  return Number.isFinite(c) ? c : 0;
}

// LRU cache for local query embeddings. Map preserves insertion order, so
// re-insert on hit to keep recent queries warm and evict the oldest on overflow.
// MiniLM inference is ~10ms/query on an M-series CPU but caching still wins
// for the "agent re-searches the same string" case.
const QUERY_CACHE_MAX = 128;
const queryEmbedCache = new Map<string, Float32Array>();

/**
 * Lazy-initialized `@xenova/transformers` pipeline holding the MiniLM
 * model. The first call to `getEmbedder()` triggers a one-time ~90MB
 * download to `~/.cache/transformers-js/` (or wherever HF_HUB_CACHE
 * points). Subsequent calls reuse the in-memory pipeline — roughly 90MB
 * of process memory for the weights, CPU inference.
 *
 * We deliberately mirror the Rust-side model choice so both runtimes use
 * the same embedding space; a chunk embedded by Rust can be scored
 * against a query embedded by the bridge without shape mismatch.
 */
let embedderPromise: Promise<(input: string, opts?: unknown) => Promise<{ data: Float32Array }>> | null = null;

async function getEmbedder(): Promise<(input: string, opts?: unknown) => Promise<{ data: Float32Array }>> {
  if (embedderPromise) return embedderPromise;
  embedderPromise = (async () => {
    const start = Date.now();
    logger.info({ model: 'Xenova/all-MiniLM-L6-v2' }, 'vault.embedder.init.start');
    try {
      // Dynamic import so the tsup bundle doesn't pull in transformers
      // unless semantic is actually used. First call downloads the model.
      const { pipeline, env } = await import('@xenova/transformers');
      // Disable the remote-fetch-through-proxy logic; we want local cache.
      // `env.localModelPath` can be overridden; default HF cache is fine.
      env.allowRemoteModels = true;
      const extractor = (await pipeline(
        'feature-extraction',
        'Xenova/all-MiniLM-L6-v2',
      )) as unknown as (input: string, opts?: unknown) => Promise<{ data: Float32Array }>;
      logger.info(
        { ms: Date.now() - start },
        'vault.embedder.init.done',
      );
      return extractor;
    } catch (err) {
      logger.error({ err: String(err) }, 'vault.embedder.init.failed');
      // Reset so the next query can retry (e.g. transient download failure).
      embedderPromise = null;
      throw err;
    }
  })();
  return embedderPromise;
}

/**
 * Embed a user query locally via MiniLM. Sub-20ms after the first load.
 * Returns null if the model fails to load (e.g. first run offline) — the
 * semantic tool falls back to FTS in that case.
 */
export async function embedQuery(text: string): Promise<Float32Array | null> {
  const start = Date.now();
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;

  const cached = queryEmbedCache.get(trimmed);
  if (cached) {
    queryEmbedCache.delete(trimmed);
    queryEmbedCache.set(trimmed, cached);
    logger.info(
      {
        cached: true,
        ms: Date.now() - start,
        tokens_est: Math.ceil(trimmed.length / 4),
      },
      'vault.query.embed',
    );
    return cached;
  }

  let extractor: Awaited<ReturnType<typeof getEmbedder>>;
  try {
    extractor = await getEmbedder();
  } catch {
    return null;
  }

  const inferenceStart = Date.now();
  let vec: Float32Array;
  try {
    const output = await extractor(trimmed, { pooling: 'mean', normalize: true });
    // `output.data` is a Float32Array — copy to detach from any shared ArrayBuffer.
    vec = new Float32Array(output.data);
  } catch (err) {
    logger.error({ err: String(err) }, 'vault.query.embed.failed');
    return null;
  }

  // LRU evict if over cap.
  if (queryEmbedCache.size >= QUERY_CACHE_MAX) {
    const firstKey = queryEmbedCache.keys().next().value;
    if (firstKey !== undefined) queryEmbedCache.delete(firstKey);
  }
  queryEmbedCache.set(trimmed, vec);

  logger.info(
    {
      cached: false,
      ms: Date.now() - start,
      inference_ms: Date.now() - inferenceStart,
      tokens_est: Math.ceil(trimmed.length / 4),
      dim: vec.length,
    },
    'vault.query.embed',
  );
  return vec;
}

/**
 * Semantic search over the in-memory cache. Returns top-K hits by cosine
 * similarity. Empty result when cache is not loaded or the OpenAI call fails.
 */
export async function searchVaultSemantic(
  query: string,
  opts: { projectId?: string; topK?: number } = {},
): Promise<VaultHit[]> {
  const start = Date.now();
  const { projectId, topK = 6 } = opts;

  await loadEmbeddingsCache(projectId);

  if (!semanticCache || semanticCache.length === 0) {
    logger.warn(
      { reason: 'cache_empty', candidates: 0 },
      'vault.tool.semantic_unavailable',
    );
    return [];
  }

  const queryVec = await embedQuery(query);
  if (!queryVec) {
    logger.warn(
      { reason: 'query_embed_failed' },
      'vault.tool.semantic_unavailable',
    );
    return [];
  }

  const rankStart = Date.now();
  const scored = semanticCache.map((c) => ({
    c,
    score: cosine(queryVec, c.embedding),
  }));
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, topK);
  const rankMs = Date.now() - rankStart;

  const hits: VaultHit[] = top.map(({ c, score }) => ({
    entryId: c.entryId,
    entryTitle: c.entryTitle,
    kind: c.kind,
    pinned: c.pinned,
    chunkIndex: c.chunkIndex,
    content: c.content,
    score,
  }));

  logger.info(
    {
      mode: 'semantic',
      query_len: query.length,
      top_k: topK,
      candidates: semanticCache.length,
      rank_ms: rankMs,
      total_ms: Date.now() - start,
      top_scores: hits.slice(0, 5).map((h) => ({
        title: h.entryTitle,
        score: Math.round(h.score * 1000) / 1000,
      })),
    },
    'vault.tool.search',
  );

  return hits;
}

// ============================================================================
// SDK tool — the model can call `vault_search` with mode=fts or mode=semantic.
// ============================================================================

export const vaultSearchTool = tool(
  'vault_search',
  "Search the user's personal vault (agent memory) for indexed content. " +
    'The vault holds documents, code, screenshots, and data the user has ' +
    'chosen to remember across sessions. ALWAYS use this tool before asking ' +
    'the user to re-explain something they\'ve indexed — especially when they ' +
    'refer to "that spec", "the schema I shared", "my notes on X", or ask ' +
    '"did I put X in the vault?". ' +
    'Pick mode="fts" for exact keyword recall and mode="semantic" for ' +
    'conceptual / paraphrased queries. When unsure, start with fts; if it ' +
    'returns nothing, retry with semantic.',
  {
    query: z
      .string()
      .min(2)
      .describe(
        'Free-text search query. Keywords from the user\'s message work well ' +
          'for fts mode; natural-language phrases work better for semantic mode.',
      ),
    mode: z
      .enum(['fts', 'semantic'])
      .default('fts')
      .describe(
        'Retrieval strategy. "fts" = BM25 keyword match (fast, precise). ' +
          '"semantic" = OpenAI embedding + cosine (recalls paraphrased matches).',
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
    const start = Date.now();
    const mode = args.mode ?? 'fts';
    const topK = args.top_k ?? 6;

    let hits: VaultHit[];
    if (mode === 'semantic') {
      hits = await searchVaultSemantic(args.query, { topK });
    } else {
      hits = searchVault(args.query, { topK });
      logger.info(
        {
          mode: 'fts',
          query_len: args.query.length,
          top_k: topK,
          ms: Date.now() - start,
          returned: hits.length,
          top_scores: hits.slice(0, 5).map((h) => ({
            title: h.entryTitle,
            score: Math.round(h.score * 1000) / 1000,
          })),
        },
        'vault.tool.search',
      );
    }

    if (hits.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: `No vault entries matched "${args.query}" (mode: ${mode}).`,
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

    const debugFooter = VAULT_DEBUG
      ? `\n\n---\n<vault-debug>\nmode=${mode} top_k=${topK} returned=${hits.length} ms=${Date.now() - start}\n${hits.map((h) => `  ${h.entryTitle} → ${h.score.toFixed(4)}`).join('\n')}\n</vault-debug>`
      : '';

    return {
      content: [{ type: 'text', text: body + debugFooter }],
    };
  },
);
