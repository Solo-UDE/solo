/**
 * Vault reader for agent-bridge.
 *
 * Opens the same SQLite DB the Rust side writes to (WAL mode makes concurrent
 * reads safe). Exposes:
 *   1. A `vault_search` tool for the SDK so the model can query the vault on
 *      demand (supports `fts`, `semantic`, and `hybrid` modes).
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
import { randomUUID } from 'node:crypto';
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
const WRITE_CHUNK_WORDS = 500;
const WRITE_CHUNK_OVERLAP_WORDS = 50;

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
  chunkId?: string;
  entryId: string;
  entryTitle: string;
  kind: string;
  pinned: boolean;
  chunkIndex: number;
  content: string;
  score: number;
  source: VaultRetrievalSource;
  mode: VaultSearchMode;
  embeddingModel?: string;
}

export type VaultSearchMode = 'fts' | 'semantic' | 'hybrid';
export type VaultRetrievalSource = 'local' | 'cloud' | 'hybrid';
export type VaultMemoryType = 'project' | 'user' | 'pinned_source_of_truth';

export interface VaultAuthConfig {
  endpoint?: string;
  idToken?: string;
  retrievalSource?: VaultRetrievalSource;
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

function openWritableDb(): Database | null {
  if (!existsSync(VAULT_DB)) {
    return null;
  }
  try {
    const db = new Database(VAULT_DB);
    db.run('PRAGMA busy_timeout = 5000');
    return db;
  } catch (err) {
    logger.warn({ err: String(err), path: VAULT_DB }, 'vault: writable open failed');
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
      chunkId: r.chunk_id,
      entryId: r.entry_id,
      entryTitle: r.title,
      kind: r.kind,
      pinned: r.pinned !== 0,
      chunkIndex: r.chunk_index,
      content: r.content,
      score: 1 / (1 + Math.abs(r.rank)),
      source: 'local',
      mode: 'fts',
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
      chunkId: r.chunk_id,
      entryId: r.entry_id,
      entryTitle: r.title,
      kind: r.kind,
      pinned: true,
      chunkIndex: r.chunk_index,
      content: r.content,
      score: 1.0,
      source: 'local',
      mode: 'fts',
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
export async function fetchVaultContext(
  userMessage: string,
  opts: {
    projectId?: string;
    maxChunks?: number;
    mode?: VaultSearchMode;
    source?: VaultRetrievalSource;
    vaultAuth?: VaultAuthConfig;
  } = {},
): Promise<string> {
  const { projectId, maxChunks = 5 } = opts;
  const mode = opts.mode ?? 'hybrid';
  const source =
    opts.source ??
    opts.vaultAuth?.retrievalSource ??
    (opts.vaultAuth?.endpoint && opts.vaultAuth?.idToken ? 'hybrid' : 'local');

  const pinned = pinnedEntries({ projectId, limit: 3 });
  const hits = await searchVaultBySource(userMessage, {
    projectId,
    topK: maxChunks,
    mode,
    source,
    vaultAuth: opts.vaultAuth,
    includePinned: false,
  });

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
    return `### ${h.entryTitle}${badge} (${h.kind}, ${h.source}/${h.mode}, chunk ${h.chunkIndex})\n${h.content.trim()}`;
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
    .filter(Boolean)
    .map((t) => `"${t}"`);
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
    chunkId: c.chunkId,
    entryId: c.entryId,
    entryTitle: c.entryTitle,
    kind: c.kind,
    pinned: c.pinned,
    chunkIndex: c.chunkIndex,
    content: c.content,
    score,
    source: 'local',
    mode: 'semantic',
    embeddingModel: 'Xenova/all-MiniLM-L6-v2',
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

function fuseHits(
  lists: VaultHit[][],
  mode: VaultSearchMode,
  markCrossSourceDuplicates: boolean,
  topK: number,
): VaultHit[] {
  const RRF_K = 60;
  const fused = new Map<string, { hit: VaultHit; fusedScore: number }>();

  for (const list of lists) {
    list.forEach((hit, index) => {
      const key = `${hit.entryId}:${hit.chunkIndex}`;
      const contribution = 1 / (RRF_K + index + 1);
      const current = fused.get(key);
      if (current) {
        current.fusedScore += contribution;
        if (current.hit.source === 'cloud' && hit.source === 'local') {
          current.hit = { ...hit };
        }
        if (markCrossSourceDuplicates && current.hit.source !== hit.source) {
          current.hit.source = 'hybrid';
        }
        current.hit.mode = mode;
      } else {
        fused.set(key, {
          hit: { ...hit, mode },
          fusedScore: contribution,
        });
      }
    });
  }

  const sorted = [...fused.values()].sort((a, b) => {
    if (b.fusedScore !== a.fusedScore) return b.fusedScore - a.fusedScore;
    if (b.hit.score !== a.hit.score) return b.hit.score - a.hit.score;
    return `${a.hit.entryId}:${a.hit.chunkIndex}`.localeCompare(`${b.hit.entryId}:${b.hit.chunkIndex}`);
  });
  const topScore = sorted[0]?.fusedScore ?? 1;
  return sorted.slice(0, topK).map(({ hit, fusedScore }) => ({
    ...hit,
    score: topScore > 0 ? fusedScore / topScore : 0,
  }));
}

async function searchVaultLocal(
  query: string,
  opts: { projectId?: string; topK?: number; mode?: VaultSearchMode } = {},
): Promise<VaultHit[]> {
  const { projectId, topK = 6, mode = 'fts' } = opts;
  if (mode === 'semantic') {
    return searchVaultSemantic(query, { projectId, topK });
  }
  if (mode === 'hybrid') {
    const fts = searchVault(query, { projectId, topK });
    const semantic = await searchVaultSemantic(query, { projectId, topK });
    return fuseHits([fts, semantic], 'hybrid', false, topK);
  }
  return searchVault(query, { projectId, topK });
}

interface CloudVaultSearchResponse {
  results?: Array<{
    chunk_id?: string;
    chunk_index?: number;
    snippet?: string;
    score?: number;
    source?: VaultRetrievalSource;
    mode?: VaultSearchMode;
    embedding_model?: string;
    entry?: {
      id?: string;
      title?: string;
      kind?: string;
      pinned?: number | boolean;
    };
  }>;
  cloud_error?: string;
}

async function searchVaultCloud(
  queryText: string,
  opts: {
    projectId?: string;
    topK?: number;
    mode?: VaultSearchMode;
    vaultAuth?: VaultAuthConfig;
  } = {},
): Promise<VaultHit[]> {
  const { projectId, topK = 6, mode = 'fts', vaultAuth } = opts;
  const endpoint = vaultAuth?.endpoint?.replace(/\/+$/, '');
  const token = vaultAuth?.idToken;
  if (!endpoint || !token) {
    throw new Error('Cloud vault search requires sign-in');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`${endpoint}/vault/search`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: queryText,
        limit: topK,
        mode,
        scope_type: projectId ? 'project' : 'global',
        scope_project_id: projectId,
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`cloud search failed (${response.status}): ${body}`);
    }
    const payload = (await response.json()) as CloudVaultSearchResponse;
    if (payload.cloud_error) {
      logger.warn({ error: payload.cloud_error }, 'vault.cloud.partial_error');
    }
    return (payload.results ?? [])
      .filter((row) => row.entry?.id && row.entry?.title && row.snippet)
      .map((row) => ({
        chunkId: row.chunk_id,
        entryId: String(row.entry?.id),
        entryTitle: String(row.entry?.title),
        kind: String(row.entry?.kind ?? 'document'),
        pinned: row.entry?.pinned === true || Number(row.entry?.pinned ?? 0) !== 0,
        chunkIndex: Number(row.chunk_index ?? 0),
        content: String(row.snippet ?? ''),
        score: Number(row.score ?? 0),
        source: row.source ?? 'cloud',
        mode: row.mode ?? mode,
        embeddingModel: row.embedding_model,
      }));
  } finally {
    clearTimeout(timeout);
  }
}

export async function searchVaultBySource(
  queryText: string,
  opts: {
    projectId?: string;
    topK?: number;
    mode?: VaultSearchMode;
    source?: VaultRetrievalSource;
    vaultAuth?: VaultAuthConfig;
    includePinned?: boolean;
  } = {},
): Promise<VaultHit[]> {
  const { projectId, topK = 6, mode = 'hybrid', includePinned = false } = opts;
  const source =
    opts.source ??
    opts.vaultAuth?.retrievalSource ??
    (opts.vaultAuth?.endpoint && opts.vaultAuth?.idToken ? 'hybrid' : 'local');
  const pinned = includePinned ? pinnedEntries({ projectId, limit: 3 }) : [];

  if (source === 'local') {
    return fuseHits([pinned, await searchVaultLocal(queryText, { projectId, topK, mode })], mode, false, topK + pinned.length);
  }

  if (source === 'cloud') {
    const cloud = await searchVaultCloud(queryText, { projectId, topK, mode, vaultAuth: opts.vaultAuth });
    return fuseHits([pinned, cloud], mode, false, topK + pinned.length);
  }

  const local = await searchVaultLocal(queryText, { projectId, topK, mode });
  try {
    const cloud = await searchVaultCloud(queryText, { projectId, topK, mode, vaultAuth: opts.vaultAuth });
    return fuseHits([pinned, local, cloud], mode, true, topK + pinned.length);
  } catch (err) {
    logger.warn({ err: String(err) }, 'vault.cloud.degraded_to_local');
    return fuseHits([pinned, local], mode, false, topK + pinned.length);
  }
}

interface AddedVaultEntry {
  id: string;
  title: string;
  scopeType: 'global' | 'project';
  scopeProjectId: string | null;
  chunkCount: number;
  embeddedCount: number;
  cloudSyncState: 'offline' | 'pending' | 'synced' | 'failed';
}

function unixNow(): number {
  return Math.floor(Date.now() / 1000);
}

function inferTextTitle(text: string, title?: string): string {
  const explicit = title?.trim();
  if (explicit) return explicit.slice(0, 500);
  const firstLine = text
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean);
  if (!firstLine) return 'Agent memory';
  return firstLine.length > 96 ? `${firstLine.slice(0, 96)}...` : firstLine;
}

function chunkTextForVault(text: string): Array<{ content: string; tokenCount: number }> {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const step = Math.max(1, WRITE_CHUNK_WORDS - WRITE_CHUNK_OVERLAP_WORDS);
  const chunks: Array<{ content: string; tokenCount: number }> = [];
  for (let i = 0; i < words.length;) {
    const end = Math.min(words.length, i + WRITE_CHUNK_WORDS);
    const content = words.slice(i, end).join(' ');
    chunks.push({
      content,
      tokenCount: Math.round(content.split(/\s+/).filter(Boolean).length * 1.3),
    });
    if (end === words.length) break;
    i += step;
  }
  return chunks;
}

function packEmbedding(vec: Float32Array): Uint8Array | null {
  if (vec.length === 0) return null;
  const normalized = new Float32Array(EMBEDDING_DIM);
  normalized.set(vec.slice(0, EMBEDDING_DIM));
  const bytes = new Uint8Array(EMBEDDING_DIM * 4);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < EMBEDDING_DIM; i++) {
    view.setFloat32(i * 4, normalized[i] ?? 0, true);
  }
  return bytes;
}

async function embedTextChunksForVault(
  chunks: Array<{ content: string; tokenCount: number }>,
): Promise<Array<Uint8Array | null>> {
  if (chunks.length === 0) return [];
  let extractor: Awaited<ReturnType<typeof getEmbedder>>;
  try {
    extractor = await getEmbedder();
  } catch {
    return chunks.map(() => null);
  }

  const embeddings: Array<Uint8Array | null> = [];
  for (const chunk of chunks) {
    try {
      const output = await extractor(chunk.content, { pooling: 'mean', normalize: true });
      embeddings.push(packEmbedding(new Float32Array(output.data)));
    } catch (err) {
      logger.warn({ err: String(err) }, 'vault.add.embed_chunk_failed');
      embeddings.push(null);
    }
  }
  return embeddings;
}

async function syncAddedTextToCloud(
  entry: {
    id: string;
    title: string;
    content: string;
    scopeType: 'global' | 'project';
    scopeProjectId: string | null;
    memoryType: VaultMemoryType;
    pinned: boolean;
    tags: string[];
    sizeBytes: number;
    createdAt: number;
    updatedAt: number;
  },
  vaultAuth?: VaultAuthConfig,
): Promise<'synced' | 'failed'> {
  const endpoint = vaultAuth?.endpoint?.replace(/\/+$/, '');
  const token = vaultAuth?.idToken;
  if (!endpoint || !token) {
    return 'failed';
  }

  const response = await fetch(`${endpoint}/vault/entries`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      id: entry.id,
      kind: 'note',
      subkind: 'agent_memory',
      title: entry.title,
      content: entry.content,
      source_path: null,
      vault_blob_path: null,
      scope_type: entry.scopeType,
      scope_project_id: entry.scopeProjectId,
      memory_type: entry.memoryType,
      pinned: entry.pinned ? 1 : 0,
      tags: JSON.stringify(entry.tags),
      mime: 'text/plain',
      size_bytes: entry.sizeBytes,
      index_status: 'indexed',
      cloud_sync_state: 'synced',
      classifier_confidence: 1,
      hit_count: 0,
      last_retrieved_at: null,
      created_at: entry.createdAt,
      updated_at: entry.updatedAt,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`cloud vault add failed (${response.status}): ${body}`);
  }
  return 'synced';
}

export async function addTextToVault(
  text: string,
  opts: {
    title?: string;
    projectId?: string;
    scope?: 'global' | 'project';
    memoryType?: VaultMemoryType;
    pinned?: boolean;
    tags?: string[];
    syncToCloud?: boolean;
    vaultAuth?: VaultAuthConfig;
  } = {},
): Promise<AddedVaultEntry> {
  const content = text.trim();
  if (!content) {
    throw new Error('Vault memory text cannot be empty');
  }

  const db = openWritableDb();
  if (!db) {
    throw new Error('Vault database is not initialized yet');
  }

  const id = randomUUID();
  const title = inferTextTitle(content, opts.title);
  const now = unixNow();
  const scopeType = opts.scope === 'project' ? 'project' : 'global';
  const scopeProjectId = scopeType === 'project' ? (opts.projectId ?? null) : null;
  if (scopeType === 'project' && !scopeProjectId) {
    db.close();
    throw new Error('Project-scoped vault memories require an active project id');
  }
  const memoryType = opts.memoryType ?? (scopeType === 'project' ? 'project' : 'user');
  const pinned = opts.pinned ?? false;
  const tags = Array.from(new Set(['agent', ...(opts.tags ?? [])].map((tag) => tag.trim()).filter(Boolean))).slice(0, 12);
  const chunks = chunkTextForVault(content);
  const embeddings = await embedTextChunksForVault(chunks);
  const embeddedCount = embeddings.filter(Boolean).length;
  const initialCloudState = opts.syncToCloud ? 'pending' : 'offline';

  try {
    db.run('BEGIN IMMEDIATE');
    db.run(
      `INSERT INTO entries (
        id, kind, subkind, title, content, source_path, vault_blob_path,
        scope_type, scope_project_id, memory_type, pinned, tags,
        mime, size_bytes, index_status, cloud_sync_state,
        classifier_confidence, hit_count, last_retrieved_at,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        'note',
        'agent_memory',
        title,
        content,
        null,
        null,
        scopeType,
        scopeProjectId,
        memoryType,
        pinned ? 1 : 0,
        JSON.stringify(tags),
        'text/plain',
        Buffer.byteLength(content, 'utf8'),
        'indexed',
        initialCloudState,
        1,
        0,
        null,
        now,
        now,
      ],
    );

    chunks.forEach((chunk, index) => {
      const chunkId = `${id}:${index}`;
      db.run(
        `INSERT INTO chunks (id, entry_id, chunk_index, content, token_count, embedding)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          chunkId,
          id,
          index,
          chunk.content,
          chunk.tokenCount,
          embeddings[index] ?? null,
        ],
      );
      db.run(
        'INSERT INTO chunks_fts (content, entry_id, chunk_id) VALUES (?, ?, ?)',
        [chunk.content, id, chunkId],
      );
    });
    db.run('COMMIT');
  } catch (err) {
    try {
      db.run('ROLLBACK');
    } catch {
      /* transaction may already be closed */
    }
    db.close();
    throw err;
  }

  let cloudSyncState: AddedVaultEntry['cloudSyncState'] = initialCloudState;
  if (opts.syncToCloud) {
    try {
      cloudSyncState = await syncAddedTextToCloud(
        {
          id,
          title,
          content,
          scopeType,
          scopeProjectId,
          memoryType,
          pinned,
          tags,
          sizeBytes: Buffer.byteLength(content, 'utf8'),
          createdAt: now,
          updatedAt: now,
        },
        opts.vaultAuth,
      );
    } catch (err) {
      cloudSyncState = 'failed';
      logger.warn({ err: String(err), entryId: id }, 'vault.add.cloud_sync_failed');
    }
    try {
      db.run(
        'UPDATE entries SET cloud_sync_state = ?, updated_at = ? WHERE id = ?',
        [cloudSyncState, unixNow(), id],
      );
    } catch (err) {
      logger.warn({ err: String(err), entryId: id }, 'vault.add.cloud_state_update_failed');
    }
  }

  db.close();
  invalidateEmbeddingsCache();
  logger.info(
    {
      entry_id: id,
      title,
      scope: scopeProjectId ? `project:${scopeProjectId}` : 'global',
      chunks: chunks.length,
      embedded: embeddedCount,
      cloud_sync_state: cloudSyncState,
    },
    'vault.add.done',
  );

  return {
    id,
    title,
    scopeType,
    scopeProjectId,
    chunkCount: chunks.length,
    embeddedCount,
    cloudSyncState,
  };
}

// ============================================================================
// SDK tools — the model can search and update vault memory.
// ============================================================================

export function createVaultSearchTool(
  getVaultAuth?: () => VaultAuthConfig | undefined,
  getProjectId?: () => string | undefined,
) {
  return tool(
    'vault_search',
    "Search the user's personal vault (agent memory) for indexed content. " +
      'The vault holds documents, code, screenshots, and data the user has ' +
      'chosen to remember across sessions. ALWAYS use this tool before asking ' +
      'the user to re-explain something they\'ve indexed — especially when they ' +
      'refer to "that spec", "the schema I shared", "my notes on X", or ask ' +
      '"did I put X in the vault?". ' +
      'Use source="hybrid" and mode="hybrid" by default. Use source="local" ' +
      'when the user asks to avoid cloud retrieval. Use source="cloud" only ' +
      'when the user specifically wants cloud-indexed vault content. Cloud ' +
      'retrieval sends the search query to the cloud.',
    {
      query: z
        .string()
        .min(2)
        .describe(
          'Free-text search query. Keywords work well for fts; natural-language phrases work better for semantic/hybrid.',
        ),
      mode: z
        .enum(['fts', 'semantic', 'hybrid'])
        .default('hybrid')
        .describe(
          'Retrieval strategy. "fts" = BM25 keyword match. "semantic" = vector similarity. "hybrid" = rank-fused fts + semantic.',
        ),
      source: z
        .enum(['local', 'cloud', 'hybrid'])
        .default('hybrid')
        .describe(
          'Retrieval source. "local" searches on-device vault data. "cloud" searches cloud embeddings/FTS and requires sign-in. "hybrid" merges local and cloud when available.',
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
      const mode = args.mode ?? 'hybrid';
      const topK = args.top_k ?? 6;
      const vaultAuth = getVaultAuth?.();
      const source = args.source ?? vaultAuth?.retrievalSource ?? 'hybrid';

      if (source === 'cloud' && (!vaultAuth?.endpoint || !vaultAuth?.idToken)) {
        return {
          content: [
            {
              type: 'text',
              text: 'Cloud vault search requires the user to be signed in. Retry with source="local" or source="hybrid" to use local vault retrieval.',
            },
          ],
        };
      }

      const hits = await searchVaultBySource(args.query, {
        projectId: getProjectId?.(),
        topK,
        mode,
        source,
        vaultAuth,
      });

      logger.info(
        {
          mode,
          source,
          query_len: args.query.length,
          top_k: topK,
          ms: Date.now() - start,
          returned: hits.length,
          top_scores: hits.slice(0, 5).map((h) => ({
            title: h.entryTitle,
            source: h.source,
            score: Math.round(h.score * 1000) / 1000,
          })),
        },
        'vault.tool.search',
      );

      if (hits.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: `No vault entries matched "${args.query}" (source: ${source}, mode: ${mode}).`,
            },
          ],
        };
      }

      const body = hits
        .map(
          (h) =>
            `### ${h.entryTitle}${h.pinned ? ' [pinned]' : ''} (${h.kind}, ${h.source}/${h.mode})\n` +
            `score: ${(h.score * 100).toFixed(0)}%\n` +
            `${h.content.trim()}`,
        )
        .join('\n\n---\n\n');

      const debugFooter = VAULT_DEBUG
        ? `\n\n---\n<vault-debug>\nsource=${source} mode=${mode} top_k=${topK} returned=${hits.length} ms=${Date.now() - start}\n${hits.map((h) => `  ${h.entryTitle} [${h.source}/${h.mode}] -> ${h.score.toFixed(4)}`).join('\n')}\n</vault-debug>`
        : '';

      return {
        content: [{ type: 'text', text: body + debugFooter }],
      };
    },
  );
}

export function createVaultAddTool(
  getVaultAuth?: () => VaultAuthConfig | undefined,
  getProjectId?: () => string | undefined,
) {
  return tool(
    'vault_add',
    "Add a durable note to the user's personal vault. Use this when the user " +
      'asks you to remember something, save a note, add something to the vault, ' +
      'or preserve an instruction/preference for future sessions. Do not use it ' +
      'for incidental facts unless the user explicitly asks you to remember/save ' +
      'them. By default this saves locally. Set sync_to_cloud=true only when the ' +
      'user asks for cloud sync or explicitly wants the memory available through cloud retrieval.',
    {
      text: z
        .string()
        .min(1)
        .max(50000)
        .describe('The exact memory text to save. Include enough context for future retrieval.'),
      title: z
        .string()
        .min(1)
        .max(500)
        .optional()
        .describe('Short human-readable title. If omitted, a title is inferred from the text.'),
      scope: z
        .enum(['global', 'project'])
        .default('global')
        .describe('Use "global" for cross-project user memory. Use "project" only for project-specific facts.'),
      memory_type: z
        .enum(['project', 'user', 'pinned_source_of_truth'])
        .optional()
        .describe('Memory classification. Defaults to "user" for global memories and "project" for project scope.'),
      pinned: z
        .boolean()
        .default(false)
        .describe('Pin only when the user says this is a source of truth or should always be prioritized.'),
      tags: z
        .array(z.string().min(1).max(40))
        .max(10)
        .default([])
        .describe('Optional lightweight tags for the saved memory.'),
      sync_to_cloud: z
        .boolean()
        .default(false)
        .describe('When true, also sync this memory to cloud. Requires sign-in and sends the saved text to cloud.'),
    },
    async (args) => {
      const start = Date.now();
      const vaultAuth = getVaultAuth?.();
      const result = await addTextToVault(args.text, {
        title: args.title,
        projectId: getProjectId?.(),
        scope: args.scope ?? 'global',
        memoryType: args.memory_type,
        pinned: args.pinned ?? false,
        tags: args.tags ?? [],
        syncToCloud: args.sync_to_cloud ?? false,
        vaultAuth,
      });

      logger.info(
        {
          entry_id: result.id,
          scope: result.scopeProjectId ? 'project' : 'global',
          sync_to_cloud: args.sync_to_cloud ?? false,
          cloud_sync_state: result.cloudSyncState,
          ms: Date.now() - start,
        },
        'vault.tool.add',
      );

      const cloudNote =
        args.sync_to_cloud && result.cloudSyncState !== 'synced'
          ? '\nCloud sync was requested but did not complete; the memory was saved locally.'
          : '';

      return {
        content: [
          {
            type: 'text',
            text:
              `Saved to vault: "${result.title}"\n` +
              `entry_id: ${result.id}\n` +
              `scope: ${result.scopeProjectId ? `project:${result.scopeProjectId}` : 'global'}\n` +
              `chunks: ${result.chunkCount}, embedded locally: ${result.embeddedCount}\n` +
              `cloud_sync_state: ${result.cloudSyncState}` +
              cloudNote,
          },
        ],
      };
    },
  );
}

export const vaultSearchTool = createVaultSearchTool();
export const vaultAddTool = createVaultAddTool();
