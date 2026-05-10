#!/usr/bin/env node
import {
  __require,
  configureFileLogging,
  createLogger,
  setCorrelationId,
  shutdownFileLogging
} from "./chunk-PI2SZOW3.js";

// src/index.ts
import * as readline from "readline";

// src/session-manager.ts
import { createHash, randomUUID as randomUUID2 } from "crypto";
import { appendFileSync, mkdirSync as mkdirSync2 } from "fs";
import { homedir as homedir5 } from "os";
import { join as join7 } from "path";

// src/agent.ts
import { query, createSdkMcpServer as createSdkMcpServer2 } from "@anthropic-ai/claude-agent-sdk";

// src/vault.ts
import { Database } from "bun:sqlite";
import { randomUUID } from "crypto";
import { homedir } from "os";
import { join } from "path";
import { existsSync } from "fs";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
var logger = createLogger("vault");
var VAULT_DB = join(homedir(), ".solo", "vault", "index.sqlite");
var EMBEDDING_DIM = 384;
var WRITE_CHUNK_WORDS = 500;
var WRITE_CHUNK_OVERLAP_WORDS = 50;
var VAULT_DEBUG = process.env.VAULT_DEBUG === "1" || process.env.VAULT_DEBUG === "true";
function openDb() {
  if (!existsSync(VAULT_DB)) {
    return null;
  }
  try {
    const db = new Database(VAULT_DB);
    db.run("PRAGMA busy_timeout = 5000");
    ensureVaultMetadataColumns(db);
    return db;
  } catch (err) {
    logger.warn({ err: String(err), path: VAULT_DB }, "vault: open failed");
    return null;
  }
}
function openWritableDb() {
  if (!existsSync(VAULT_DB)) {
    return null;
  }
  try {
    const db = new Database(VAULT_DB);
    db.run("PRAGMA busy_timeout = 5000");
    ensureVaultMetadataColumns(db);
    return db;
  } catch (err) {
    logger.warn({ err: String(err), path: VAULT_DB }, "vault: writable open failed");
    return null;
  }
}
function ensureVaultMetadataColumns(db) {
  try {
    const columns = new Set(
      db.query("PRAGMA table_info(entries)").all().map((row) => row.name)
    );
    if (!columns.has("label_ids")) {
      db.run("ALTER TABLE entries ADD COLUMN label_ids TEXT NOT NULL DEFAULT '[]'");
    }
    if (!columns.has("expires_at")) {
      db.run("ALTER TABLE entries ADD COLUMN expires_at INTEGER");
    }
    db.run("CREATE INDEX IF NOT EXISTS idx_entries_expires ON entries(expires_at)");
  } catch (err) {
    logger.warn({ err: String(err) }, "vault: metadata migration failed");
  }
}
function defaultExpiry() {
  return unixNow() + 7 * 24 * 60 * 60;
}
function searchVault(query2, opts = {}) {
  const { projectId, topK = 6, includeExpired = false } = opts;
  const db = openDb();
  if (!db) return [];
  try {
    const ftsQuery = sanitizeFts(query2);
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
        AND (? = 1 OR e.expires_at IS NULL OR e.expires_at > ?)
      ORDER BY rank
      LIMIT ?
    `);
    const includeFlag = includeExpired ? 1 : 0;
    const now = unixNow();
    const rows = stmt.all(ftsQuery, projectId ?? null, includeFlag, now, topK);
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
      source: "local",
      mode: "fts"
    }));
  } catch (err) {
    logger.warn({ err: String(err), query: query2 }, "vault: search failed");
    try {
      db.close();
    } catch {
    }
    return [];
  }
}
function pinnedEntries(opts = {}) {
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
        AND (e.expires_at IS NULL OR e.expires_at > ?)
      ORDER BY e.updated_at DESC
      LIMIT ?
    `);
    const rows = stmt.all(projectId ?? null, unixNow(), limit);
    db.close();
    return rows.map((r) => ({
      chunkId: r.chunk_id,
      entryId: r.entry_id,
      entryTitle: r.title,
      kind: r.kind,
      pinned: true,
      chunkIndex: r.chunk_index,
      content: r.content,
      score: 1,
      source: "local",
      mode: "fts"
    }));
  } catch (err) {
    logger.warn({ err: String(err) }, "vault: pinned fetch failed");
    try {
      db.close();
    } catch {
    }
    return [];
  }
}
async function fetchVaultContext(userMessage, opts = {}) {
  const { projectId, maxChunks = 5 } = opts;
  const mode = opts.mode ?? "hybrid";
  const source = opts.source ?? opts.vaultAuth?.retrievalSource ?? (opts.vaultAuth?.endpoint && opts.vaultAuth?.idToken ? "hybrid" : "local");
  const pinned = pinnedEntries({ projectId, limit: 3 });
  const hits = await searchVaultBySource(userMessage, {
    projectId,
    topK: maxChunks,
    mode,
    source,
    vaultAuth: opts.vaultAuth,
    includePinned: false
  });
  const seen = /* @__PURE__ */ new Set();
  const merged = [];
  for (const h of [...pinned, ...hits]) {
    const key = `${h.entryId}:${h.chunkIndex}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(h);
    if (merged.length >= maxChunks + pinned.length) break;
  }
  if (merged.length === 0) return "";
  const sections = merged.map((h) => {
    const badge = h.pinned ? " [pinned]" : "";
    return `### ${h.entryTitle}${badge} (${h.kind}, ${h.source}/${h.mode}, chunk ${h.chunkIndex})
${h.content.trim()}`;
  });
  return [
    "<vault-memory>",
    "The following context was auto-retrieved from the user's vault. Treat it",
    "as authoritative when answering. If none of it is relevant to the user's",
    "current question, ignore it silently rather than mentioning that you",
    "received it.",
    "",
    sections.join("\n\n"),
    "</vault-memory>"
  ].join("\n");
}
function sanitizeFts(raw) {
  const cleaned = raw.replace(/["']/g, " ").replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  const terms = cleaned.split(" ").filter((t) => t.length >= 2).map((t) => t.replace(/[^\p{L}\p{N}_-]/gu, "")).filter(Boolean).map((t) => `"${t}"`);
  if (terms.length === 0) return "";
  return terms.join(" OR ");
}
var semanticCache = null;
var semanticCacheScope = null;
var semanticCacheLoading = null;
async function loadEmbeddingsCache(projectId) {
  const scopeKey = projectId ? `project:${projectId}` : "global";
  if (semanticCache !== null && semanticCacheScope === scopeKey) {
    return;
  }
  if (semanticCacheLoading) {
    return semanticCacheLoading;
  }
  const p = (async () => {
    const start = Date.now();
    logger.info({ scope: scopeKey }, "vault.cache.load.start");
    const db = openDb();
    if (!db) {
      semanticCache = [];
      semanticCacheScope = scopeKey;
      logger.warn({ path: VAULT_DB }, "vault.cache.load.no_db");
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
          AND (e.expires_at IS NULL OR e.expires_at > ?)
      `);
      const rows = stmt.all(projectId ?? null, unixNow());
      const out = [];
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
          embedding: vec
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
          scope: scopeKey
        },
        "vault.cache.loaded"
      );
    } catch (err) {
      logger.error({ err: String(err) }, "vault.cache.load_failed");
      semanticCache = [];
      semanticCacheScope = scopeKey;
    } finally {
      try {
        db.close();
      } catch {
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
function invalidateEmbeddingsCache() {
  semanticCache = null;
  semanticCacheScope = null;
}
function decodeEmbedding(bytes, expectedDim) {
  if (bytes.byteLength % 4 !== 0) return null;
  const gotDim = bytes.byteLength / 4;
  if (gotDim !== expectedDim) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Float32Array(gotDim);
  for (let i = 0; i < gotDim; i++) {
    out[i] = view.getFloat32(
      i * 4,
      /* littleEndian */
      true
    );
  }
  return out;
}
function cosine(a, b) {
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
var QUERY_CACHE_MAX = 128;
var queryEmbedCache = /* @__PURE__ */ new Map();
var embedderPromise = null;
async function getEmbedder() {
  if (embedderPromise) return embedderPromise;
  embedderPromise = (async () => {
    const start = Date.now();
    logger.info({ model: "Xenova/all-MiniLM-L6-v2" }, "vault.embedder.init.start");
    try {
      const { pipeline, env } = await import("@xenova/transformers");
      env.allowRemoteModels = true;
      const extractor = await pipeline(
        "feature-extraction",
        "Xenova/all-MiniLM-L6-v2"
      );
      logger.info(
        { ms: Date.now() - start },
        "vault.embedder.init.done"
      );
      return extractor;
    } catch (err) {
      logger.error({ err: String(err) }, "vault.embedder.init.failed");
      embedderPromise = null;
      throw err;
    }
  })();
  return embedderPromise;
}
async function embedQuery(text) {
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
        tokens_est: Math.ceil(trimmed.length / 4)
      },
      "vault.query.embed"
    );
    return cached;
  }
  let extractor;
  try {
    extractor = await getEmbedder();
  } catch {
    return null;
  }
  const inferenceStart = Date.now();
  let vec;
  try {
    const output = await extractor(trimmed, { pooling: "mean", normalize: true });
    vec = new Float32Array(output.data);
  } catch (err) {
    logger.error({ err: String(err) }, "vault.query.embed.failed");
    return null;
  }
  if (queryEmbedCache.size >= QUERY_CACHE_MAX) {
    const firstKey = queryEmbedCache.keys().next().value;
    if (firstKey !== void 0) queryEmbedCache.delete(firstKey);
  }
  queryEmbedCache.set(trimmed, vec);
  logger.info(
    {
      cached: false,
      ms: Date.now() - start,
      inference_ms: Date.now() - inferenceStart,
      tokens_est: Math.ceil(trimmed.length / 4),
      dim: vec.length
    },
    "vault.query.embed"
  );
  return vec;
}
async function searchVaultSemantic(query2, opts = {}) {
  const start = Date.now();
  const { projectId, topK = 6 } = opts;
  await loadEmbeddingsCache(projectId);
  if (!semanticCache || semanticCache.length === 0) {
    logger.warn(
      { reason: "cache_empty", candidates: 0 },
      "vault.tool.semantic_unavailable"
    );
    return [];
  }
  const queryVec = await embedQuery(query2);
  if (!queryVec) {
    logger.warn(
      { reason: "query_embed_failed" },
      "vault.tool.semantic_unavailable"
    );
    return [];
  }
  const rankStart = Date.now();
  const scored = semanticCache.map((c) => ({
    c,
    score: cosine(queryVec, c.embedding)
  }));
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, topK);
  const rankMs = Date.now() - rankStart;
  const hits = top.map(({ c, score }) => ({
    chunkId: c.chunkId,
    entryId: c.entryId,
    entryTitle: c.entryTitle,
    kind: c.kind,
    pinned: c.pinned,
    chunkIndex: c.chunkIndex,
    content: c.content,
    score,
    source: "local",
    mode: "semantic",
    embeddingModel: "Xenova/all-MiniLM-L6-v2"
  }));
  logger.info(
    {
      mode: "semantic",
      query_len: query2.length,
      top_k: topK,
      candidates: semanticCache.length,
      rank_ms: rankMs,
      total_ms: Date.now() - start,
      top_scores: hits.slice(0, 5).map((h) => ({
        title: h.entryTitle,
        score: Math.round(h.score * 1e3) / 1e3
      }))
    },
    "vault.tool.search"
  );
  return hits;
}
function fuseHits(lists, mode, markCrossSourceDuplicates, topK) {
  const RRF_K = 60;
  const fused = /* @__PURE__ */ new Map();
  for (const list of lists) {
    list.forEach((hit, index) => {
      const key = `${hit.entryId}:${hit.chunkIndex}`;
      const contribution = 1 / (RRF_K + index + 1);
      const current = fused.get(key);
      if (current) {
        current.fusedScore += contribution;
        if (current.hit.source === "cloud" && hit.source === "local") {
          current.hit = { ...hit };
        }
        if (markCrossSourceDuplicates && current.hit.source !== hit.source) {
          current.hit.source = "hybrid";
        }
        current.hit.mode = mode;
      } else {
        fused.set(key, {
          hit: { ...hit, mode },
          fusedScore: contribution
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
    score: topScore > 0 ? fusedScore / topScore : 0
  }));
}
async function searchVaultLocal(query2, opts = {}) {
  const { projectId, topK = 6, mode = "fts" } = opts;
  if (mode === "semantic") {
    return searchVaultSemantic(query2, { projectId, topK });
  }
  if (mode === "hybrid") {
    const fts = searchVault(query2, { projectId, topK });
    const semantic = await searchVaultSemantic(query2, { projectId, topK });
    return fuseHits([fts, semantic], "hybrid", false, topK);
  }
  return searchVault(query2, { projectId, topK });
}
async function searchVaultCloud(queryText, opts = {}) {
  const { projectId, topK = 6, mode = "fts", vaultAuth } = opts;
  const endpoint = vaultAuth?.endpoint?.replace(/\/+$/, "");
  const token = vaultAuth?.idToken;
  if (!endpoint || !token) {
    throw new Error("Cloud vault search requires sign-in");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5e3);
  try {
    const response = await fetch(`${endpoint}/vault/search`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        query: queryText,
        limit: topK,
        mode,
        scope_type: projectId ? "project" : "global",
        scope_project_id: projectId,
        include_expired: false
      }),
      signal: controller.signal
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`cloud search failed (${response.status}): ${body}`);
    }
    const payload = await response.json();
    if (payload.cloud_error) {
      logger.warn({ error: payload.cloud_error }, "vault.cloud.partial_error");
    }
    return (payload.results ?? []).filter((row) => row.entry?.id && row.entry?.title && row.snippet).map((row) => ({
      chunkId: row.chunk_id,
      entryId: String(row.entry?.id),
      entryTitle: String(row.entry?.title),
      kind: String(row.entry?.kind ?? "document"),
      pinned: row.entry?.pinned === true || Number(row.entry?.pinned ?? 0) !== 0,
      chunkIndex: Number(row.chunk_index ?? 0),
      content: String(row.snippet ?? ""),
      score: Number(row.score ?? 0),
      source: row.source ?? "cloud",
      mode: row.mode ?? mode,
      embeddingModel: row.embedding_model
    }));
  } finally {
    clearTimeout(timeout);
  }
}
async function searchVaultBySource(queryText, opts = {}) {
  const { projectId, topK = 6, mode = "hybrid", includePinned = false } = opts;
  const source = opts.source ?? opts.vaultAuth?.retrievalSource ?? (opts.vaultAuth?.endpoint && opts.vaultAuth?.idToken ? "hybrid" : "local");
  const pinned = includePinned ? pinnedEntries({ projectId, limit: 3 }) : [];
  if (source === "local") {
    return fuseHits([pinned, await searchVaultLocal(queryText, { projectId, topK, mode })], mode, false, topK + pinned.length);
  }
  if (source === "cloud") {
    const cloud = await searchVaultCloud(queryText, { projectId, topK, mode, vaultAuth: opts.vaultAuth });
    return fuseHits([pinned, cloud], mode, false, topK + pinned.length);
  }
  const local = await searchVaultLocal(queryText, { projectId, topK, mode });
  try {
    const cloud = await searchVaultCloud(queryText, { projectId, topK, mode, vaultAuth: opts.vaultAuth });
    return fuseHits([pinned, local, cloud], mode, true, topK + pinned.length);
  } catch (err) {
    logger.warn({ err: String(err) }, "vault.cloud.degraded_to_local");
    return fuseHits([pinned, local], mode, false, topK + pinned.length);
  }
}
function unixNow() {
  return Math.floor(Date.now() / 1e3);
}
function inferTextTitle(text, title) {
  const explicit = title?.trim();
  if (explicit) return explicit.slice(0, 500);
  const firstLine = text.split("\n").map((line) => line.trim()).find(Boolean);
  if (!firstLine) return "Agent memory";
  return firstLine.length > 96 ? `${firstLine.slice(0, 96)}...` : firstLine;
}
function chunkTextForVault(text) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const step = Math.max(1, WRITE_CHUNK_WORDS - WRITE_CHUNK_OVERLAP_WORDS);
  const chunks = [];
  for (let i = 0; i < words.length; ) {
    const end = Math.min(words.length, i + WRITE_CHUNK_WORDS);
    const content = words.slice(i, end).join(" ");
    chunks.push({
      content,
      tokenCount: Math.round(content.split(/\s+/).filter(Boolean).length * 1.3)
    });
    if (end === words.length) break;
    i += step;
  }
  return chunks;
}
function packEmbedding(vec) {
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
async function embedTextChunksForVault(chunks) {
  if (chunks.length === 0) return [];
  let extractor;
  try {
    extractor = await getEmbedder();
  } catch {
    return chunks.map(() => null);
  }
  const embeddings = [];
  for (const chunk of chunks) {
    try {
      const output = await extractor(chunk.content, { pooling: "mean", normalize: true });
      embeddings.push(packEmbedding(new Float32Array(output.data)));
    } catch (err) {
      logger.warn({ err: String(err) }, "vault.add.embed_chunk_failed");
      embeddings.push(null);
    }
  }
  return embeddings;
}
async function syncAddedTextToCloud(entry, vaultAuth) {
  const endpoint = vaultAuth?.endpoint?.replace(/\/+$/, "");
  const token = vaultAuth?.idToken;
  if (!endpoint || !token) {
    return "failed";
  }
  const response = await fetch(`${endpoint}/vault/entries`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      id: entry.id,
      kind: "note",
      subkind: "agent_memory",
      title: entry.title,
      content: entry.content,
      source_path: null,
      vault_blob_path: null,
      scope_type: entry.scopeType,
      scope_project_id: entry.scopeProjectId,
      memory_type: entry.memoryType,
      pinned: entry.pinned ? 1 : 0,
      tags: JSON.stringify(entry.tags),
      label_ids: JSON.stringify(entry.labelIds),
      expires_at: entry.expiresAt,
      mime: "text/plain",
      size_bytes: entry.sizeBytes,
      index_status: "indexed",
      cloud_sync_state: "synced",
      classifier_confidence: 1,
      hit_count: 0,
      last_retrieved_at: null,
      created_at: entry.createdAt,
      updated_at: entry.updatedAt
    })
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`cloud vault add failed (${response.status}): ${body}`);
  }
  return "synced";
}
async function addTextToVault(text, opts = {}) {
  const content = text.trim();
  if (!content) {
    throw new Error("Vault memory text cannot be empty");
  }
  const db = openWritableDb();
  if (!db) {
    throw new Error("Vault database is not initialized yet");
  }
  const id = randomUUID();
  const title = inferTextTitle(content, opts.title);
  const now = unixNow();
  const scopeType = opts.scope === "project" ? "project" : "global";
  const scopeProjectId = scopeType === "project" ? opts.projectId ?? null : null;
  if (scopeType === "project" && !scopeProjectId) {
    db.close();
    throw new Error("Project-scoped vault memories require an active project id");
  }
  const memoryType = opts.memoryType ?? (scopeType === "project" ? "project" : "user");
  const pinned = opts.pinned ?? false;
  const tags = Array.from(new Set(["agent", ...opts.tags ?? []].map((tag) => tag.trim()).filter(Boolean))).slice(0, 12);
  const labelIds = Array.from(new Set((opts.labelIds ?? []).map((id2) => id2.trim()).filter(Boolean))).slice(0, 24);
  const expiresAt = opts.expiresAt ?? defaultExpiry();
  const chunks = chunkTextForVault(content);
  const embeddings = await embedTextChunksForVault(chunks);
  const embeddedCount = embeddings.filter(Boolean).length;
  const initialCloudState = opts.syncToCloud ? "pending" : "offline";
  try {
    db.run("BEGIN IMMEDIATE");
    db.run(
      `INSERT INTO entries (
        id, kind, subkind, title, content, source_path, vault_blob_path,
        scope_type, scope_project_id, memory_type, pinned, tags, label_ids, expires_at,
        mime, size_bytes, index_status, cloud_sync_state,
        classifier_confidence, hit_count, last_retrieved_at,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        "note",
        "agent_memory",
        title,
        content,
        null,
        null,
        scopeType,
        scopeProjectId,
        memoryType,
        pinned ? 1 : 0,
        JSON.stringify(tags),
        JSON.stringify(labelIds),
        expiresAt,
        "text/plain",
        Buffer.byteLength(content, "utf8"),
        "indexed",
        initialCloudState,
        1,
        0,
        null,
        now,
        now
      ]
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
          embeddings[index] ?? null
        ]
      );
      db.run(
        "INSERT INTO chunks_fts (content, entry_id, chunk_id) VALUES (?, ?, ?)",
        [chunk.content, id, chunkId]
      );
    });
    db.run("COMMIT");
  } catch (err) {
    try {
      db.run("ROLLBACK");
    } catch {
    }
    db.close();
    throw err;
  }
  let cloudSyncState = initialCloudState;
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
          labelIds,
          expiresAt,
          sizeBytes: Buffer.byteLength(content, "utf8"),
          createdAt: now,
          updatedAt: now
        },
        opts.vaultAuth
      );
    } catch (err) {
      cloudSyncState = "failed";
      logger.warn({ err: String(err), entryId: id }, "vault.add.cloud_sync_failed");
    }
    try {
      db.run(
        "UPDATE entries SET cloud_sync_state = ?, updated_at = ? WHERE id = ?",
        [cloudSyncState, unixNow(), id]
      );
    } catch (err) {
      logger.warn({ err: String(err), entryId: id }, "vault.add.cloud_state_update_failed");
    }
  }
  db.close();
  invalidateEmbeddingsCache();
  logger.info(
    {
      entry_id: id,
      title,
      scope: scopeProjectId ? `project:${scopeProjectId}` : "global",
      chunks: chunks.length,
      embedded: embeddedCount,
      cloud_sync_state: cloudSyncState
    },
    "vault.add.done"
  );
  return {
    id,
    title,
    scopeType,
    scopeProjectId,
    chunkCount: chunks.length,
    embeddedCount,
    cloudSyncState
  };
}
function createVaultSearchTool(getVaultAuth, getProjectId) {
  return tool(
    "vault_search",
    `Search the user's personal vault (agent memory) for indexed content. The vault holds documents, code, screenshots, and data the user has chosen to remember across sessions. ALWAYS use this tool before asking the user to re-explain something they've indexed \u2014 especially when they refer to "that spec", "the schema I shared", "my notes on X", or ask "did I put X in the vault?". Use source="hybrid" and mode="hybrid" by default. Use source="local" when the user asks to avoid cloud retrieval. Use source="cloud" only when the user specifically wants cloud-indexed vault content. Cloud retrieval sends the search query to the cloud.`,
    {
      query: z.string().min(2).describe(
        "Free-text search query. Keywords work well for fts; natural-language phrases work better for semantic/hybrid."
      ),
      mode: z.enum(["fts", "semantic", "hybrid"]).default("hybrid").describe(
        'Retrieval strategy. "fts" = BM25 keyword match. "semantic" = vector similarity. "hybrid" = rank-fused fts + semantic.'
      ),
      source: z.enum(["local", "cloud", "hybrid"]).default("hybrid").describe(
        'Retrieval source. "local" searches on-device vault data. "cloud" searches cloud embeddings/FTS and requires sign-in. "hybrid" merges local and cloud when available.'
      ),
      top_k: z.number().int().min(1).max(20).default(6).describe("Maximum chunks to return (default 6).")
    },
    async (args) => {
      const start = Date.now();
      const mode = args.mode ?? "hybrid";
      const topK = args.top_k ?? 6;
      const vaultAuth = getVaultAuth?.();
      const source = args.source ?? vaultAuth?.retrievalSource ?? "hybrid";
      if (source === "cloud" && (!vaultAuth?.endpoint || !vaultAuth?.idToken)) {
        return {
          content: [
            {
              type: "text",
              text: 'Cloud vault search requires the user to be signed in. Retry with source="local" or source="hybrid" to use local vault retrieval.'
            }
          ]
        };
      }
      const hits = await searchVaultBySource(args.query, {
        projectId: getProjectId?.(),
        topK,
        mode,
        source,
        vaultAuth
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
            score: Math.round(h.score * 1e3) / 1e3
          }))
        },
        "vault.tool.search"
      );
      if (hits.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `No vault entries matched "${args.query}" (source: ${source}, mode: ${mode}).`
            }
          ]
        };
      }
      const body = hits.map(
        (h) => `### ${h.entryTitle}${h.pinned ? " [pinned]" : ""} (${h.kind}, ${h.source}/${h.mode})
score: ${(h.score * 100).toFixed(0)}%
${h.content.trim()}`
      ).join("\n\n---\n\n");
      const debugFooter = VAULT_DEBUG ? `

---
<vault-debug>
source=${source} mode=${mode} top_k=${topK} returned=${hits.length} ms=${Date.now() - start}
${hits.map((h) => `  ${h.entryTitle} [${h.source}/${h.mode}] -> ${h.score.toFixed(4)}`).join("\n")}
</vault-debug>` : "";
      return {
        content: [{ type: "text", text: body + debugFooter }]
      };
    }
  );
}
function createVaultAddTool(getVaultAuth, getProjectId) {
  return tool(
    "vault_add",
    "Add a durable note to the user's personal vault. Use this when the user asks you to remember something, save a note, add something to the vault, or preserve an instruction/preference for future sessions. Do not use it for incidental facts unless the user explicitly asks you to remember/save them. New memories expire into archive-only retrieval after expiry_days. By default this saves locally. Set sync_to_cloud=true only when the user asks for cloud sync or explicitly wants the memory available through cloud retrieval.",
    {
      text: z.string().min(1).max(5e4).describe("The exact memory text to save. Include enough context for future retrieval."),
      title: z.string().min(1).max(500).optional().describe("Short human-readable title. If omitted, a title is inferred from the text."),
      scope: z.enum(["global", "project"]).default("global").describe('Use "global" for cross-project user memory. Use "project" only for project-specific facts.'),
      memory_type: z.enum(["project", "user", "pinned_source_of_truth"]).optional().describe('Memory classification. Defaults to "user" for global memories and "project" for project scope.'),
      pinned: z.boolean().default(false).describe("Pin only when the user says this is a source of truth or should always be prioritized."),
      tags: z.array(z.string().min(1).max(40)).max(10).default([]).describe("Optional lightweight tags for the saved memory."),
      label_ids: z.array(z.string().min(1).max(120)).max(24).default([]).describe("Optional shared Vault/Tasks label ids that group this memory with an idea workspace."),
      expiry_days: z.number().int().min(1).max(365).default(7).describe("How many days this memory should stay active before moving to archive-only retrieval."),
      sync_to_cloud: z.boolean().default(false).describe("When true, also sync this memory to cloud. Requires sign-in and sends the saved text to cloud.")
    },
    async (args) => {
      const start = Date.now();
      const vaultAuth = getVaultAuth?.();
      const result = await addTextToVault(args.text, {
        title: args.title,
        projectId: getProjectId?.(),
        scope: args.scope ?? "global",
        memoryType: args.memory_type,
        pinned: args.pinned ?? false,
        tags: args.tags ?? [],
        labelIds: args.label_ids ?? [],
        expiresAt: unixNow() + (args.expiry_days ?? 7) * 24 * 60 * 60,
        syncToCloud: args.sync_to_cloud ?? false,
        vaultAuth
      });
      logger.info(
        {
          entry_id: result.id,
          scope: result.scopeProjectId ? "project" : "global",
          sync_to_cloud: args.sync_to_cloud ?? false,
          cloud_sync_state: result.cloudSyncState,
          ms: Date.now() - start
        },
        "vault.tool.add"
      );
      const cloudNote = args.sync_to_cloud && result.cloudSyncState !== "synced" ? "\nCloud sync was requested but did not complete; the memory was saved locally." : "";
      return {
        content: [
          {
            type: "text",
            text: `Saved to vault: "${result.title}"
entry_id: ${result.id}
scope: ${result.scopeProjectId ? `project:${result.scopeProjectId}` : "global"}
chunks: ${result.chunkCount}, embedded locally: ${result.embeddedCount}
cloud_sync_state: ${result.cloudSyncState}` + cloudNote
          }
        ]
      };
    }
  );
}
var vaultSearchTool = createVaultSearchTool();
var vaultAddTool = createVaultAddTool();

// src/agent.ts
import * as fs4 from "fs";
import * as path4 from "path";

// src/credentials.ts
import { execFileSync } from "child_process";
import { readFileSync } from "fs";
import { join as join2 } from "path";
import { homedir as homedir2 } from "os";
var logger2 = createLogger("ClaudeCredentials");
var CLAUDE_CODE_OAUTH_CLIENT_ID = "claude-desktop";
var CLAUDE_CODE_TOKEN_ENDPOINT = "https://api.anthropic.com/v1/oauth/token";
var EXPIRY_BUFFER_MS = 3e5;
function isClaudeCredentialsFile(value) {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const obj = value;
  if (obj.claudeAiOauth === void 0) {
    return true;
  }
  if (typeof obj.claudeAiOauth !== "object" || obj.claudeAiOauth === null) {
    return false;
  }
  return true;
}
async function refreshOAuthToken(refreshToken) {
  try {
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: CLAUDE_CODE_OAUTH_CLIENT_ID,
      refresh_token: refreshToken
    });
    const resp = await fetch(CLAUDE_CODE_TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(15e3)
    });
    if (!resp.ok) {
      logger2.warn({ status: resp.status }, "Claude Code token refresh failed");
      return null;
    }
    const data = await resp.json();
    const accessToken = data.access_token;
    if (typeof accessToken === "string" && accessToken !== "") {
      logger2.info("Successfully refreshed Claude Code OAuth token");
      return accessToken;
    }
    logger2.warn("Token refresh response missing access_token");
    return null;
  } catch (error) {
    logger2.error({ error }, "Error refreshing OAuth token");
    return null;
  }
}
function isTokenExpired(expiryMs) {
  return Date.now() >= expiryMs - EXPIRY_BUFFER_MS;
}
async function resolveOAuthFromParsed(parsed, source) {
  const claudeAuth = parsed.claudeAiOauth;
  if (claudeAuth === void 0) {
    logger2.debug(`No Claude OAuth credentials in ${source}`);
    return null;
  }
  const accessToken = claudeAuth.accessToken;
  const expiresAt = claudeAuth.expiresAt;
  if (accessToken === void 0 || accessToken === "") {
    logger2.debug(`OAuth token missing in ${source} credentials`);
    return null;
  }
  if (expiresAt !== void 0 && expiresAt !== "") {
    const expiryMs = typeof expiresAt === "number" ? expiresAt : parseInt(expiresAt, 10);
    if (isTokenExpired(expiryMs)) {
      logger2.warn({ expiryDate: new Date(expiryMs).toISOString() }, `OAuth token expired in ${source}, attempting refresh`);
      const refreshToken = claudeAuth.refreshToken;
      if (refreshToken !== void 0 && refreshToken !== "") {
        const newToken = await refreshOAuthToken(refreshToken);
        if (newToken !== null) {
          return newToken;
        }
        logger2.warn(`Failed to refresh OAuth token from ${source}`);
      } else {
        logger2.debug(`No refreshToken in ${source} credentials`);
      }
      return null;
    }
    logger2.debug({ expiryDate: new Date(expiryMs).toISOString() }, `OAuth token valid from ${source}`);
  }
  return accessToken;
}
async function getOAuthTokenFromFile() {
  try {
    const credPath = join2(homedir2(), ".claude", ".credentials.json");
    const content = readFileSync(credPath, "utf-8");
    const parsed = JSON.parse(content);
    if (!isClaudeCredentialsFile(parsed)) {
      logger2.debug("Invalid credentials structure in ~/.claude/.credentials.json");
      return null;
    }
    return resolveOAuthFromParsed(parsed, "~/.claude/.credentials.json");
  } catch {
    logger2.debug("Could not read ~/.claude/.credentials.json");
    return null;
  }
}
async function getOAuthTokenFromKeychain() {
  if (process.platform !== "darwin") {
    logger2.debug("Keychain lookup skipped \u2014 not macOS");
    return null;
  }
  try {
    const raw = execFileSync(
      "security",
      ["find-generic-password", "-s", "Claude Code-credentials", "-w"],
      { encoding: "utf-8", timeout: 5e3, stdio: ["pipe", "pipe", "pipe"] }
    ).trim();
    const parsed = JSON.parse(raw);
    if (!isClaudeCredentialsFile(parsed)) {
      logger2.debug("Invalid credentials structure in macOS Keychain");
      return null;
    }
    return resolveOAuthFromParsed(parsed, "macOS Keychain");
  } catch {
    logger2.debug("Could not read credentials from macOS Keychain");
    return null;
  }
}
function getApiKeyFromEnv() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey === void 0 || apiKey === "") {
    logger2.debug("ANTHROPIC_API_KEY not found in environment");
    return null;
  }
  return apiKey;
}
async function getCredentials() {
  const fileToken = await getOAuthTokenFromFile();
  if (fileToken !== null) {
    logger2.info("OAuth token available from ~/.claude/.credentials.json");
    return { type: "oauth", hasCredentials: true };
  }
  const keychainToken = await getOAuthTokenFromKeychain();
  if (keychainToken !== null) {
    logger2.info("OAuth token available from macOS Keychain");
    return { type: "oauth", hasCredentials: true };
  }
  const apiKey = getApiKeyFromEnv();
  if (apiKey !== null) {
    logger2.info("API key available from environment");
    return { type: "apikey", hasCredentials: true };
  }
  logger2.error("No credentials found (checked ~/.claude/.credentials.json, macOS Keychain, and env)");
  return { type: "apikey", hasCredentials: false };
}
var ClaudeCredentials = {
  getOAuthTokenFromFile,
  getOAuthTokenFromKeychain,
  getApiKeyFromEnv,
  getCredentials
};

// src/permission-pipeline.ts
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
var logger3 = createLogger("PermissionPipeline");
var DEFAULT_TOOL_TIERS = /* @__PURE__ */ new Map([
  // Read-only
  ["Read", "read"],
  ["Glob", "read"],
  ["Grep", "read"],
  ["WebSearch", "read"],
  ["WebFetch", "read"],
  ["BashOutput", "read"],
  ["AskUserQuestion", "read"],
  ["TodoWrite", "read"],
  ["ExitPlanMode", "read"],
  ["ToolSearch", "read"],
  ["Skill", "read"],
  ["Task", "mutate"],
  ["TaskCreate", "read"],
  ["TaskUpdate", "read"],
  ["TaskGet", "read"],
  ["TaskList", "read"],
  ["ListMcpResourcesTool", "read"],
  ["ReadMcpResourceTool", "read"],
  // Mutating
  ["Write", "mutate"],
  ["Edit", "mutate"],
  ["NotebookEdit", "mutate"],
  ["Bash", "mutate"],
  ["KillShell", "mutate"]
]);
function defaultTier(toolName) {
  if (toolName === "mcp__vault__vault_search" || toolName === "mcp__solo_skills__skill_list" || toolName === "mcp__solo_skills__skill_read") {
    return "read";
  }
  return DEFAULT_TOOL_TIERS.get(toolName) ?? "mutate";
}
function unescape(s) {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "\\" && i + 1 < s.length) {
      const next = s[i + 1];
      if (next === "(" || next === ")" || next === "\\") {
        out += next;
        i++;
        continue;
      }
    }
    out += c;
  }
  return out;
}
function compileGlob(pattern) {
  let re = "^";
  for (const c of pattern) {
    if (c === "*") re += ".*";
    else if (c === "?") re += ".";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  re += "$";
  const compiled = new RegExp(re);
  return (input) => compiled.test(input);
}
var DEFAULT_BASH_DENY_PATTERNS = [
  "rm -rf *",
  "sudo rm *",
  "chmod -R *",
  "chown -R *",
  "dd *",
  "mkfs*",
  "diskutil erase*",
  "git reset --hard*",
  "git clean -fd*",
  "curl * | sh*",
  "curl * | bash*",
  "wget * | sh*",
  "wget * | bash*"
];
function matchesAnyGlob(input, patterns) {
  for (const pattern of patterns) {
    if (compileGlob(pattern)(input)) return pattern;
  }
  return null;
}
function isEditTool(toolName) {
  return toolName === "Write" || toolName === "Edit" || toolName === "NotebookEdit";
}
function parseRule(raw) {
  const trimmed = raw.trim();
  const open = trimmed.indexOf("(");
  if (open > 0 && trimmed.endsWith(")")) {
    const tool3 = trimmed.slice(0, open);
    const content = unescape(trimmed.slice(open + 1, trimmed.length - 1));
    let matcher = null;
    try {
      matcher = compileGlob(content);
    } catch {
      matcher = null;
    }
    return { tool: tool3, content, matcher };
  }
  return { tool: trimmed, content: null, matcher: null };
}
function ruleMatches(rule, toolName, content) {
  if (rule.tool !== toolName) return false;
  if (rule.content === null) return true;
  if (rule.matcher) return rule.matcher(content);
  return false;
}
function formatRule(rule) {
  return rule.content === null ? rule.tool : `${rule.tool}(${rule.content})`;
}
function contentFor(toolName, input) {
  const key = (() => {
    switch (toolName) {
      case "Bash":
        return "command";
      case "BashOutput":
        return "bash_id";
      case "Write":
      case "Edit":
      case "Read":
        return "file_path";
      case "NotebookEdit":
        return "notebook_path";
      case "WebFetch":
        return "url";
      case "WebSearch":
        return "query";
      case "Glob":
      case "Grep":
        return "pattern";
      default:
        return null;
    }
  })();
  if (key === null) return "";
  const value = input[key];
  return typeof value === "string" ? value : "";
}
function checkPermission(toolName, toolInput, mode, config) {
  const content = contentFor(toolName, toolInput);
  const tier = defaultTier(toolName);
  const denyRules = config.deny.map(parseRule);
  const askRules = config.ask.map(parseRule);
  const allowRules = config.allow.map(parseRule);
  for (const r of denyRules) {
    if (ruleMatches(r, toolName, content)) {
      return {
        behavior: "deny",
        message: `Tool '${toolName}' is denied by rule '${formatRule(r)}'.`
      };
    }
  }
  if (toolName === "Bash") {
    const matched = matchesAnyGlob(content, DEFAULT_BASH_DENY_PATTERNS);
    if (matched) {
      return {
        behavior: "deny",
        message: `Bash command is denied by built-in safety rule '${matched}'.`
      };
    }
  }
  for (const r of allowRules) {
    if (ruleMatches(r, toolName, content)) {
      return {
        behavior: "allow",
        reason: `Allowed by rule '${formatRule(r)}'.`
      };
    }
  }
  for (const r of askRules) {
    if (ruleMatches(r, toolName, content)) {
      return {
        behavior: "ask",
        message: `Tool '${toolName}' requires approval (rule '${formatRule(r)}').`,
        tier
      };
    }
  }
  if (tier === "destructive") {
    return {
      behavior: "ask",
      message: `'${toolName}' is a destructive operation and requires approval.`,
      tier
    };
  }
  if (mode === "plan" && tier === "mutate") {
    return {
      behavior: "deny",
      message: `Plan mode is active. '${toolName}' mutates state; write a plan and call ExitPlanMode to proceed.`
    };
  }
  if (mode === "accept" && !config.disableAcceptMode && isEditTool(toolName)) {
    return {
      behavior: "allow",
      reason: "Accept mode (file edit)."
    };
  }
  if (tier === "read") {
    return { behavior: "allow", reason: "Read-only tool." };
  }
  return { behavior: "ask", message: `Approval required for '${toolName}'.`, tier };
}
var SETTINGS_DIR = ".solo";
var SETTINGS_FILE = "settings.json";
var LOCAL_SETTINGS_FILE = "settings.local.json";
var EMPTY_SETTINGS = Object.freeze({
  permissions: {
    defaultMode: null,
    allow: [],
    deny: [],
    ask: [],
    additionalDirectories: [],
    disableAcceptMode: false
  },
  modes: {
    debug: { reviewInterval: 3, initialGoalCapture: "firstMessage" }
  }
});
function readJsonOr(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    const raw = fs.readFileSync(file, "utf-8").trim();
    if (raw.length === 0) return fallback;
    return JSON.parse(raw);
  } catch (err) {
    logger3.warn({ file, err }, "Failed to read settings file \u2014 falling back to defaults");
    return fallback;
  }
}
function union(a, b) {
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const v of a) {
    if (!seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  for (const v of b) {
    if (!seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}
function mergeInto(dst, src) {
  if (src.permissions) {
    if (src.permissions.defaultMode !== void 0 && src.permissions.defaultMode !== null) {
      dst.permissions.defaultMode = src.permissions.defaultMode;
    }
    dst.permissions.allow = union(dst.permissions.allow, src.permissions.allow ?? []);
    dst.permissions.deny = union(dst.permissions.deny, src.permissions.deny ?? []);
    dst.permissions.ask = union(dst.permissions.ask, src.permissions.ask ?? []);
    dst.permissions.additionalDirectories = union(
      dst.permissions.additionalDirectories,
      src.permissions.additionalDirectories ?? []
    );
    if (src.permissions.disableAcceptMode) {
      dst.permissions.disableAcceptMode = true;
    }
  }
  if (src.modes?.debug) {
    if (src.modes.debug.reviewInterval && src.modes.debug.reviewInterval > 0) {
      dst.modes.debug.reviewInterval = src.modes.debug.reviewInterval;
    }
    if (src.modes.debug.initialGoalCapture) {
      dst.modes.debug.initialGoalCapture = src.modes.debug.initialGoalCapture;
    }
  }
}
function loadMergedSettings(workspace) {
  const userPath = path.join(os.homedir(), SETTINGS_DIR, SETTINGS_FILE);
  const projectPath = path.join(workspace, SETTINGS_DIR, SETTINGS_FILE);
  const localPath = path.join(workspace, SETTINGS_DIR, LOCAL_SETTINGS_FILE);
  const merged = JSON.parse(JSON.stringify(EMPTY_SETTINGS));
  mergeInto(merged, readJsonOr(userPath, {}));
  mergeInto(merged, readJsonOr(projectPath, {}));
  mergeInto(merged, readJsonOr(localPath, {}));
  return merged;
}

// src/nls.ts
function localize(_key, message) {
  return message;
}

// src/permissions.ts
var logger4 = createLogger("PermissionManager");
var PermissionManager = class _PermissionManager {
  requestCallback;
  snapshotCallback;
  alwaysAllowedTools = /* @__PURE__ */ new Set();
  acceptModeGetter;
  planModeGetter;
  planFilePathGetter;
  /** Resolver for the workspace path — used to locate `.solo/settings.json`. */
  workspaceGetter;
  /** Resolver for an optional Debug-mode flag. */
  debugModeGetter;
  toolPolicy;
  /** Small in-memory cache of parsed settings, keyed by workspace path. */
  settingsCache = /* @__PURE__ */ new Map();
  // Tools allowed through in plan mode (planning/reading tools that reach canUseTool)
  static PLAN_MODE_ALLOWED_TOOLS = /* @__PURE__ */ new Set([
    "ExitPlanMode",
    "EnterPlanMode",
    "AskUserQuestion",
    "TaskCreate",
    "TaskUpdate",
    "TaskGet",
    "TaskList",
    "ToolSearch",
    "Skill"
  ]);
  constructor(requestCallback, snapshotCallback, acceptModeGetter, planModeGetter, planFilePathGetter, workspaceGetter, debugModeGetter, toolPolicy) {
    if (requestCallback !== void 0) {
      this.requestCallback = requestCallback;
    }
    if (snapshotCallback !== void 0) {
      this.snapshotCallback = snapshotCallback;
    }
    if (acceptModeGetter !== void 0) {
      this.acceptModeGetter = acceptModeGetter;
    }
    if (planModeGetter !== void 0) {
      this.planModeGetter = planModeGetter;
    }
    if (planFilePathGetter !== void 0) {
      this.planFilePathGetter = planFilePathGetter;
    }
    if (workspaceGetter !== void 0) {
      this.workspaceGetter = workspaceGetter;
    }
    if (debugModeGetter !== void 0) {
      this.debugModeGetter = debugModeGetter;
    }
    if (toolPolicy !== void 0) {
      this.toolPolicy = {
        ...toolPolicy,
        allow: toolPolicy.allow ? [...toolPolicy.allow] : void 0,
        deny: toolPolicy.deny ? [...toolPolicy.deny] : void 0,
        ask: toolPolicy.ask ? [...toolPolicy.ask] : void 0,
        bashAllowPrefixes: toolPolicy.bashAllowPrefixes ? [...toolPolicy.bashAllowPrefixes] : void 0
      };
    }
  }
  /**
   * Resolve the active mode by consulting all overlay flags.
   *
   * Mutually exclusive — the first truthy flag wins. This matches the
   * frontend's `useSessionMode` selector, keeping the UI and backend in sync.
   */
  resolveMode() {
    if (this.acceptModeGetter?.()) return "accept";
    if (this.planModeGetter?.()) return "plan";
    if (this.debugModeGetter?.()) return "debug";
    const settings = this.loadSettings();
    const defaultMode = settings?.permissions.defaultMode;
    if (defaultMode) return defaultMode;
    return "default";
  }
  effectivePermissions(settings) {
    const base = settings?.permissions ?? {
      defaultMode: null,
      allow: [],
      deny: [],
      ask: [],
      additionalDirectories: [],
      disableAcceptMode: false
    };
    const bashPrefixRules = this.toolPolicy?.bashAllowPrefixes?.map((prefix) => `Bash(${prefix}*)`) ?? [];
    return {
      defaultMode: base.defaultMode,
      allow: [...this.toolPolicy?.allow ?? [], ...bashPrefixRules, ...base.allow],
      deny: [...this.toolPolicy?.deny ?? [], ...base.deny],
      ask: [...this.toolPolicy?.ask ?? [], ...base.ask],
      additionalDirectories: [...base.additionalDirectories],
      disableAcceptMode: base.disableAcceptMode
    };
  }
  shouldBypassAskDecision(decision) {
    if (decision.behavior !== "ask") return false;
    if (!this.toolPolicy?.bypassEnabled || this.toolPolicy.isWorktreeSession !== true) {
      return false;
    }
    return decision.message.startsWith("Approval required for ");
  }
  /**
   * Load (with a small on-disk mtime cache) the merged settings for the
   * current workspace. Returns `null` when no workspace is configured.
   *
   * We re-check the settings file's mtime on every call so external edits
   * (user hand-editing `.solo/settings.json`) are reflected immediately
   * without a session restart.
   */
  loadSettings() {
    const ws = this.workspaceGetter?.();
    if (!ws) return null;
    try {
      const fs5 = __require("fs");
      const path5 = __require("path");
      const os2 = __require("os");
      const paths = [
        path5.join(os2.homedir(), ".solo", "settings.json"),
        path5.join(ws, ".solo", "settings.json"),
        path5.join(ws, ".solo", "settings.local.json")
      ];
      let combinedMtime = 0;
      for (const p of paths) {
        try {
          const stat = fs5.statSync(p);
          combinedMtime = Math.max(combinedMtime, stat.mtimeMs);
        } catch {
        }
      }
      const cached = this.settingsCache.get(ws);
      if (cached && cached.mtime === combinedMtime) {
        return cached.settings;
      }
      const settings = loadMergedSettings(ws);
      this.settingsCache.set(ws, { mtime: combinedMtime, settings });
      return settings;
    } catch (err) {
      logger4.warn({ err }, "Failed to load settings \u2014 falling back to mode-only gating");
      return null;
    }
  }
  /**
   * Reset the always-allowed tools set.
   */
  resetAlwaysAllowed() {
    this.alwaysAllowedTools.clear();
  }
  /**
   * Add a tool to the always-allowed list.
   */
  addAlwaysAllowed(toolName) {
    this.alwaysAllowedTools.add(toolName);
  }
  /**
   * Check if a tool is always allowed.
   */
  isAlwaysAllowed(toolName) {
    return this.alwaysAllowedTools.has(toolName);
  }
  /**
   * Preview the permission decision for a tool call WITHOUT invoking any
   * side-effects (no snapshot, no request callback, no UI event).
   *
   * Used by the session-manager's SDK-message consumer to pick the correct
   * INITIAL `status` for a `tool_use` event: `'running'` for tools that will
   * be auto-allowed, `'awaiting-permission'` only for tools that will
   * legitimately prompt the user. This eliminates the 1-frame flash of the
   * approval card that users previously saw on every auto-approved tool.
   *
   * Returns the same three outcomes as `createCallback`, reduced to the
   * behavior axis (message detail is not needed for a preview):
   *
   *   - `'allow'` — the callback will allow without prompting
   *   - `'ask'`   — the callback will emit a permission_request event
   *   - `'deny'`  — the callback will deny and the tool_result will carry the error
   *
   * Mirrors `createCallback` stage-for-stage; keep the two in sync.
   */
  previewDecision(toolName, toolInput) {
    const mode = this.resolveMode();
    if (mode === "plan" && (toolName === "Write" || toolName === "Edit")) {
      const filePath = toolInput.file_path;
      const planPath = this.planFilePathGetter?.();
      if (planPath && filePath === planPath) {
        return "allow";
      }
    }
    const settings = this.loadSettings();
    {
      const decision = checkPermission(
        toolName,
        toolInput,
        mode,
        this.effectivePermissions(settings)
      );
      if (decision.behavior === "allow") return "allow";
      if (decision.behavior === "deny") return "deny";
      if (this.shouldBypassAskDecision(decision)) return "allow";
    }
    if (mode === "plan") {
      if (toolName !== "Write" && toolName !== "Edit" && !_PermissionManager.PLAN_MODE_ALLOWED_TOOLS.has(toolName)) {
        return "deny";
      }
    }
    if (this.isAlwaysAllowed(toolName)) return "allow";
    if (!this.requestCallback) return "allow";
    return "ask";
  }
  /**
   * Create permission callback for the SDK.
   *
   * This is now a three-stage pipeline:
   *
   * 1. Plan-mode special case for edits targeting the active plan file
   *    (this is Solo-specific and not expressible as a generic rule —
   *    the plan file path is dynamic per session).
   * 2. The settings-driven decision pipeline (mirror of `solo-core::permissions::check`).
   *    This is the single source of truth for allow/ask/deny rules and
   *    the Accept/Plan/Default/Debug mode overlays.
   * 3. Fall-through to the UI permission prompt (requestCallback).
   *
   * **Key property**: under Accept mode, stages 1-2 ALWAYS short-circuit
   * with an Allow (unless a deny/ask rule or the destructive tier blocks
   * it), so `requestCallback` is never invoked and no permission modal
   * is emitted to the frontend. This fixes the modal-flash bug where the
   * UI briefly rendered a permission card before being auto-resolved.
   */
  createCallback() {
    return async (toolName, toolInput, options) => {
      const mode = this.resolveMode();
      logger4.debug({ toolName, mode }, "Permission callback invoked");
      try {
        if (mode === "plan" && (toolName === "Write" || toolName === "Edit")) {
          const filePath = toolInput.file_path;
          const planPath = this.planFilePathGetter?.();
          if (planPath && filePath === planPath) {
            logger4.info({ toolName, filePath }, "Plan mode \u2014 auto-approving write to plan file");
            return { behavior: "allow", updatedInput: toolInput };
          }
        }
        const settings = this.loadSettings();
        const decision = checkPermission(
          toolName,
          toolInput,
          mode,
          this.effectivePermissions(settings)
        );
        logger4.debug({ toolName, mode, decision }, "Pipeline decision");
        if (decision.behavior === "allow") {
          if ((toolName === "Write" || toolName === "Edit") && this.snapshotCallback) {
            try {
              await this.snapshotCallback(toolName, toolInput, null);
            } catch (err) {
              logger4.warn({ toolName, err }, "Snapshot capture failed \u2014 continuing anyway");
            }
          }
          return { behavior: "allow", updatedInput: toolInput };
        }
        if (decision.behavior === "deny") {
          return {
            behavior: "deny",
            message: decision.message,
            interrupt: false
          };
        }
        if (this.shouldBypassAskDecision(decision)) {
          logger4.info({ toolName }, "Bypass policy in worktree \u2014 auto-approving non-denied tool");
          return { behavior: "allow", updatedInput: toolInput };
        }
        if (mode === "plan") {
          if (toolName !== "Write" && toolName !== "Edit" && !_PermissionManager.PLAN_MODE_ALLOWED_TOOLS.has(toolName)) {
            logger4.info({ toolName }, "Plan mode \u2014 denying non-planning tool");
            return {
              behavior: "deny",
              message: "Plan mode is active. Only read-only tools and plan file edits are allowed. Use ExitPlanMode to switch back."
            };
          }
        }
        if ((toolName === "Write" || toolName === "Edit") && this.snapshotCallback) {
          try {
            await this.snapshotCallback(toolName, toolInput, null);
          } catch (err) {
            logger4.warn({ toolName, err }, "Snapshot capture failed \u2014 continuing anyway");
          }
        }
        if (this.isAlwaysAllowed(toolName)) {
          return { behavior: "allow", updatedInput: toolInput };
        }
        if (this.requestCallback) {
          try {
            const result = await this.requestCallback(toolName, toolInput, options);
            if (result.always && toolName !== "AskUserQuestion") {
              this.addAlwaysAllowed(toolName);
            }
            if (result.decision === "approve") {
              const updatedPermissions = toolName === "ExitPlanMode" ? [{ type: "setMode", mode: "default", destination: "session" }] : void 0;
              let updatedInput = toolInput;
              if (toolName === "AskUserQuestion" && result.answers) {
                updatedInput = {
                  ...toolInput,
                  answers: result.answers
                };
                logger4.debug({ answers: result.answers }, "AskUserQuestion answers received");
              }
              return {
                behavior: "allow",
                updatedInput,
                updatedPermissions
              };
            }
            return {
              behavior: "deny",
              message: localize("orbit.permissionDenied", "User denied permission"),
              interrupt: false
            };
          } catch (error) {
            logger4.error({ toolName, error }, "Permission request failed - DENYING");
            return {
              behavior: "deny",
              message: localize(
                "orbit.permissionFailed",
                "Permission request failed. Please try again."
              ),
              interrupt: false
            };
          }
        }
        return {
          behavior: "allow",
          updatedInput: toolInput
        };
      } catch (error) {
        logger4.error(
          { error },
          "CRITICAL: Permission callback crashed - DENYING to prevent silent approval"
        );
        return {
          behavior: "deny",
          message: localize(
            "orbit.permissionSystemError",
            "Permission system error. Please try again."
          ),
          interrupt: false
        };
      }
    };
  }
};

// src/plan-names.ts
import * as fs2 from "fs";
import * as path2 from "path";
var ADJECTIVES = [
  "cozy",
  "woolly",
  "jazzy",
  "sunny",
  "misty",
  "calm",
  "bold",
  "crisp",
  "dusty",
  "eager",
  "frosty",
  "gentle",
  "happy",
  "keen",
  "lively",
  "mellow",
  "nimble",
  "plucky",
  "quiet",
  "rustic",
  "sleek",
  "tender",
  "vivid",
  "warm",
  "zesty",
  "amber",
  "bright",
  "coral",
  "dainty",
  "elfin",
  "fair",
  "golden",
  "humble",
  "ivory",
  "jolly",
  "kind",
  "lunar",
  "mossy",
  "noble",
  "olive",
  "pastel",
  "quaint",
  "rosy",
  "silver",
  "tawny",
  "urban",
  "velvet",
  "wild"
];
var VERBS = [
  "stirring",
  "crafting",
  "snuggling",
  "drifting",
  "gliding",
  "humming",
  "jumping",
  "knitting",
  "leaping",
  "melting",
  "nesting",
  "orbiting",
  "pacing",
  "quilting",
  "roaming",
  "sailing",
  "ticking",
  "unfolding",
  "vaulting",
  "winding",
  "yielding",
  "arching",
  "blazing",
  "climbing",
  "dancing",
  "echoing",
  "flowing",
  "grazing",
  "hiking",
  "inching",
  "jogging",
  "kicking",
  "lacing",
  "mapping",
  "nudging",
  "opening",
  "picking",
  "racing",
  "shaping",
  "tracing",
  "turning",
  "walking",
  "bending",
  "curving",
  "diving",
  "easing",
  "folding",
  "growing"
];
var NOUNS = [
  "hopper",
  "reef",
  "falcon",
  "meadow",
  "brook",
  "canyon",
  "delta",
  "ember",
  "fjord",
  "grove",
  "haven",
  "inlet",
  "jungle",
  "knoll",
  "lagoon",
  "mesa",
  "nexus",
  "oasis",
  "plume",
  "quartz",
  "ridge",
  "summit",
  "tundra",
  "updraft",
  "valley",
  "whisper",
  "zenith",
  "atlas",
  "beacon",
  "cedar",
  "dune",
  "echo",
  "flint",
  "glacier",
  "harbor",
  "iris",
  "jasper",
  "kelp",
  "lantern",
  "marble",
  "nimbus",
  "orchid",
  "pebble",
  "quill",
  "raven",
  "spruce",
  "timber"
];
function generatePlanName() {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const verb = VERBS[Math.floor(Math.random() * VERBS.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  return `${adj}-${verb}-${noun}`;
}
function plansDir(workspace) {
  if (workspace && workspace.length > 0) {
    return path2.join(workspace, ".solo", "plans");
  }
  const os2 = __require("os");
  return path2.join(os2.homedir(), ".solo", "plans");
}
function getPlanFilePath(name, workspace) {
  return path2.join(plansDir(workspace), `${name}.md`);
}
function ensurePlanDirectory(workspace) {
  fs2.mkdirSync(plansDir(workspace), { recursive: true });
}

// src/session-mode.ts
var MODE_TOOLS = {
  chat: ["Read", "Glob", "Grep", "WebSearch", "WebFetch", "TodoWrite"],
  agent: [
    "Read",
    "Write",
    "Edit",
    "Glob",
    "Grep",
    "NotebookEdit",
    "Bash",
    "BashOutput",
    "KillShell",
    "WebSearch",
    "WebFetch",
    "Task",
    "TodoWrite",
    "ExitPlanMode"
  ]
};
function getAllowedToolsForMode(mode) {
  return MODE_TOOLS[mode];
}

// src/skills-mcp.ts
import { createSdkMcpServer, tool as tool2 } from "@anthropic-ai/claude-agent-sdk";
import { z as z2 } from "zod";

// src/skills.ts
import { readdirSync, readFileSync as readFileSync3, statSync, existsSync as existsSync3 } from "fs";
import { join as join5, basename, extname, resolve, dirname } from "path";
import { homedir as homedir4 } from "os";
var logger5 = createLogger("Skills");
var DEFAULT_CONFIG = {
  importClaudeUser: true,
  importClaudePlugins: true,
  importClaudeProject: true,
  importCodex: true,
  onboardingShown: false
};
var SOURCE_PRIORITY = {
  project: 60,
  user: 50,
  claude_project: 40,
  claude_user: 30,
  claude_plugin: 20,
  codex: 10
};
var FRONTMATTER_RE = /^---\s*\n([\s\S]*?)\n---\s*\n?/;
function parseFrontmatter(raw) {
  const match = raw.match(FRONTMATTER_RE);
  if (!match) {
    return { metadata: {}, body: raw.trim() };
  }
  const frontmatterBlock = match[1];
  const body = raw.slice(match[0].length).trim();
  const metadata = {};
  for (const line of frontmatterBlock.split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    if (!key) continue;
    if (value === "true") metadata[key] = true;
    else if (value === "false") metadata[key] = false;
    else if (/^\d+$/.test(value)) metadata[key] = parseInt(value, 10);
    else metadata[key] = value;
  }
  return { metadata, body };
}
function discoverSkillsFromDir(dirPath, source) {
  if (!existsSync3(dirPath)) return [];
  const skills = [];
  let entries;
  try {
    entries = readdirSync(dirPath);
  } catch {
    return [];
  }
  for (const entry of entries) {
    const fullPath = join5(dirPath, entry);
    let raw;
    let skillFilePath;
    let derivedName;
    try {
      const stat = statSync(fullPath);
      if (stat.isFile() && extname(entry) === ".md") {
        raw = readFileSync3(fullPath, "utf-8");
        skillFilePath = fullPath;
        derivedName = basename(entry, ".md");
      } else if (stat.isDirectory()) {
        const agentsMd = join5(fullPath, "AGENTS.md");
        const skillMd = join5(fullPath, "SKILL.md");
        const chosen = existsSync3(agentsMd) ? agentsMd : existsSync3(skillMd) ? skillMd : null;
        if (!chosen) continue;
        raw = readFileSync3(chosen, "utf-8");
        skillFilePath = chosen;
        derivedName = entry;
      } else {
        continue;
      }
    } catch {
      continue;
    }
    const { metadata, body } = parseFrontmatter(raw);
    skills.push({
      metadata: {
        name: typeof metadata.name === "string" ? metadata.name : derivedName,
        description: typeof metadata.description === "string" ? metadata.description : "",
        enabled: metadata.enabled !== false,
        priority: typeof metadata.priority === "number" ? metadata.priority : 0
      },
      content: body,
      source,
      filePath: skillFilePath
    });
  }
  return skills;
}
function loadSkillsConfig() {
  const settingsPath = join5(homedir4(), ".solo", "settings.json");
  if (!existsSync3(settingsPath)) return DEFAULT_CONFIG;
  try {
    const raw = readFileSync3(settingsPath, "utf-8");
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_CONFIG, ...parsed.skills ?? {} };
  } catch (err) {
    logger5.warn({ err }, "skills settings parse failed, using defaults");
    return DEFAULT_CONFIG;
  }
}
function discoverClaudePlugins() {
  const manifestPath = join5(homedir4(), ".claude", "plugins", "installed_plugins.json");
  if (!existsSync3(manifestPath)) return [];
  let parsed;
  try {
    parsed = JSON.parse(readFileSync3(manifestPath, "utf-8"));
  } catch (err) {
    logger5.warn({ err }, "claude plugins manifest parse failed");
    return [];
  }
  const out = [];
  const plugins = parsed.plugins ?? {};
  for (const installs of Object.values(plugins)) {
    for (const install of installs) {
      if (!install.installPath) continue;
      const skillsDir = join5(install.installPath, "skills");
      out.push(...discoverSkillsFromDir(skillsDir, "claude_plugin"));
    }
  }
  return out;
}
function discoverCodexPluginCache() {
  const cacheRoot = join5(homedir4(), ".codex", "plugins", "cache");
  if (!existsSync3(cacheRoot)) return [];
  const out = [];
  for (const marketplace of safeReadDir(cacheRoot)) {
    const marketplaceDir = join5(cacheRoot, marketplace);
    if (!isDirectory(marketplaceDir)) continue;
    for (const pluginName of safeReadDir(marketplaceDir)) {
      const pluginDir = join5(marketplaceDir, pluginName);
      if (!isDirectory(pluginDir)) continue;
      const version = pickActiveVersion(pluginDir);
      if (!version) continue;
      const root = join5(pluginDir, version);
      const skillsDir = resolvePluginSkillsDir(root);
      if (skillsDir) {
        out.push(...discoverSkillsFromDir(skillsDir, "codex"));
      }
    }
  }
  return out;
}
function resolvePluginSkillsDir(pluginRoot) {
  const manifestPath = [
    join5(pluginRoot, ".solo-plugin", "plugin.json"),
    join5(pluginRoot, ".codex-plugin", "plugin.json"),
    join5(pluginRoot, ".claude-plugin", "plugin.json")
  ].find((candidate) => existsSync3(candidate));
  if (manifestPath) {
    try {
      const parsed = JSON.parse(readFileSync3(manifestPath, "utf-8"));
      if (typeof parsed.skills === "string" && parsed.skills.trim()) {
        const resolved = resolve(pluginRoot, parsed.skills);
        const root = resolve(pluginRoot);
        if (resolved === root || resolved.startsWith(`${root}/`)) {
          return existsSync3(resolved) ? resolved : null;
        }
      }
    } catch (err) {
      logger5.warn({ err, manifestPath }, "codex plugin manifest parse failed");
    }
  }
  const fallback = join5(pluginRoot, "skills");
  return existsSync3(fallback) ? fallback : null;
}
function pickActiveVersion(pluginDir) {
  const versions = safeReadDir(pluginDir).filter((entry) => isDirectory(join5(pluginDir, entry)));
  if (versions.includes("local")) return "local";
  versions.sort();
  return versions.at(-1) ?? null;
}
function safeReadDir(dirPath) {
  try {
    return readdirSync(dirPath);
  } catch {
    return [];
  }
}
function isDirectory(path5) {
  try {
    return statSync(path5).isDirectory();
  } catch {
    return false;
  }
}
function discoverClaudeProjectAncestors(cwd) {
  const home = homedir4();
  const out = [];
  let current = resolve(cwd);
  let hops = 0;
  while (hops < 12) {
    if (current === home) break;
    const candidate = join5(current, ".claude", "skills");
    if (existsSync3(candidate)) {
      out.push(...discoverSkillsFromDir(candidate, "claude_project"));
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
    hops += 1;
  }
  return out;
}
function mergeSkills(all) {
  const map = /* @__PURE__ */ new Map();
  for (const skill of all) {
    const existing = map.get(skill.metadata.name);
    if (!existing || SOURCE_PRIORITY[skill.source] > SOURCE_PRIORITY[existing.source]) {
      map.set(skill.metadata.name, skill);
    }
  }
  return Array.from(map.values()).filter((s) => s.metadata.enabled).sort((a, b) => {
    const pDiff = b.metadata.priority - a.metadata.priority;
    if (pDiff !== 0) return pDiff;
    return a.metadata.name.localeCompare(b.metadata.name);
  });
}
function loadSkills(cwd) {
  const config = loadSkillsConfig();
  const all = [];
  all.push(...discoverSkillsFromDir(join5(homedir4(), ".solo", "skills"), "user"));
  all.push(...discoverSkillsFromDir(join5(cwd, ".solo", "skills"), "project"));
  if (config.importClaudeUser) {
    all.push(...discoverSkillsFromDir(join5(homedir4(), ".claude", "skills"), "claude_user"));
  }
  if (config.importClaudeProject) {
    all.push(...discoverClaudeProjectAncestors(cwd));
  }
  if (config.importClaudePlugins) {
    all.push(...discoverClaudePlugins());
  }
  if (config.importCodex) {
    all.push(...discoverSkillsFromDir(join5(homedir4(), ".codex", "skills"), "codex"));
    all.push(...discoverCodexPluginCache());
  }
  const merged = mergeSkills(all);
  if (merged.length > 0) {
    logger5.info(
      {
        count: merged.length,
        bySource: merged.reduce((acc, s) => {
          acc[s.source] = (acc[s.source] ?? 0) + 1;
          return acc;
        }, {})
      },
      "Skills loaded"
    );
  } else {
    logger5.debug("No skills found");
  }
  return merged;
}

// src/skills-mcp.ts
function loadVisibleSkills(cwd, selectedSkills) {
  const all = loadSkills(cwd);
  if (!selectedSkills || selectedSkills.length === 0) {
    return all;
  }
  const selected = new Set(selectedSkills);
  return all.filter((skill) => selected.has(skill.metadata.name));
}
function renderSkillSummary(skill) {
  const description = skill.metadata.description ? ` - ${skill.metadata.description}` : "";
  return `- ${skill.metadata.name}${description} (${skill.source})`;
}
function createSkillsMcpServer(cwd, selectedSkills) {
  const listTool = tool2(
    "skill_list",
    "List Solo skills available to this session. Use this before reading a skill when the user asks for specialized instructions or references a skill by name.",
    {},
    async () => {
      const skills = loadVisibleSkills(cwd, selectedSkills);
      const body = skills.length === 0 ? "No Solo skills are available for this session." : skills.map(renderSkillSummary).join("\n");
      return {
        content: [{ type: "text", text: body }]
      };
    }
  );
  const readTool = tool2(
    "skill_read",
    "Read the full instructions for one Solo skill by name.",
    {
      name: z2.string().min(1).describe("Exact skill name returned by skill_list.")
    },
    async ({ name }) => {
      const skills = loadVisibleSkills(cwd, selectedSkills);
      const skill = skills.find((candidate) => candidate.metadata.name === name);
      if (!skill) {
        return {
          content: [
            {
              type: "text",
              text: `Skill "${name}" is not available in this session. Call skill_list to see available skills.`
            }
          ]
        };
      }
      return {
        content: [
          {
            type: "text",
            text: `# ${skill.metadata.name}

${skill.content}`
          }
        ]
      };
    }
  );
  return createSdkMcpServer({
    name: "solo_skills",
    version: "0.1.0",
    tools: [listTool, readTool]
  });
}

// src/identity-grounding.ts
var MODEL_IDENTITIES = {
  "claude-opus-4-7": {
    marketingName: "Claude Opus 4.7",
    knowledgeCutoff: "January 2026"
  },
  "claude-opus-4-7[1m]": {
    marketingName: "Claude Opus 4.7 (1M context)",
    knowledgeCutoff: "January 2026"
  },
  "claude-opus-4-6": {
    marketingName: "Claude Opus 4.6",
    knowledgeCutoff: "May 2025"
  },
  "claude-sonnet-4-6": {
    marketingName: "Claude Sonnet 4.6",
    knowledgeCutoff: "August 2025"
  },
  "claude-sonnet-4-5-20250929": {
    marketingName: "Claude Sonnet 4.5",
    knowledgeCutoff: "August 2025"
  },
  "claude-haiku-4-5-20251001": {
    marketingName: "Claude Haiku 4.5",
    knowledgeCutoff: "February 2025"
  }
};
function resolveIdentity(modelId) {
  if (MODEL_IDENTITIES[modelId]) return MODEL_IDENTITIES[modelId];
  const lower = modelId.toLowerCase();
  if (lower.includes("claude-opus-4-7")) return MODEL_IDENTITIES["claude-opus-4-7"];
  if (lower.includes("claude-opus-4-6")) return MODEL_IDENTITIES["claude-opus-4-6"];
  if (lower.includes("claude-sonnet-4-6")) return MODEL_IDENTITIES["claude-sonnet-4-6"];
  if (lower.includes("claude-haiku-4-5")) return MODEL_IDENTITIES["claude-haiku-4-5-20251001"];
  if (lower === "opus") return { marketingName: "the latest Claude Opus model (resolved by the SDK)" };
  if (lower === "sonnet") return { marketingName: "the latest Claude Sonnet model (resolved by the SDK)" };
  if (lower === "haiku") return { marketingName: "the latest Claude Haiku model (resolved by the SDK)" };
  return null;
}
function buildIdentityAppend(modelId) {
  const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  const id = modelId ?? "unknown";
  const identity = modelId ? resolveIdentity(modelId) : null;
  const name = identity?.marketingName ?? `the model \`${id}\``;
  const cutoffLine = identity?.knowledgeCutoff ? `Assistant knowledge cutoff is ${identity.knowledgeCutoff}.` : "";
  return `## Model Identity

You are ${name}. The exact model ID being served is \`${id}\`.${cutoffLine ? `

${cutoffLine}` : ""}

The most recent Claude model family is Claude 4.X. Current model IDs:
- Opus 4.7: \`claude-opus-4-7\` (use \`claude-opus-4-7[1m]\` for the 1M-context variant)
- Sonnet 4.6: \`claude-sonnet-4-6\`
- Haiku 4.5: \`claude-haiku-4-5-20251001\`

**Authoritative identity source:** this section and the model ID in the \`<env>\` block override any earlier "the most recent frontier Claude model is 4.5/4.6" language in this prompt. That earlier language is stale context from a preset that predates the 4.7 release \u2014 ignore it when answering questions about your identity, the current frontier, or which model to recommend.

Today's date is ${today}.`;
}

// src/utils/content.ts
import * as fs3 from "fs";
import * as path3 from "path";
var MAX_IMAGE_SIZE = 20 * 1024 * 1024;
var MAX_DOCUMENT_SIZE = 30 * 1024 * 1024;
var MAX_TEXT_SIZE = 1 * 1024 * 1024;
function buildContentBlocks(message, attachments) {
  if (!attachments || attachments.length === 0) {
    return message;
  }
  const contentBlocks = [];
  for (const attachment of attachments) {
    if (attachment.type === "document" && attachment.source) {
      contentBlocks.push({
        type: "document",
        source: {
          type: "base64",
          media_type: attachment.source.mediaType,
          data: attachment.source.data
        }
      });
    } else if (attachment.type === "image" && attachment.source) {
      contentBlocks.push({
        type: "image",
        source: {
          type: "base64",
          media_type: attachment.source.mediaType,
          data: attachment.source.data
        }
      });
    } else if (attachment.type === "image" && attachment.filePath && !attachment.source) {
      const block = readImageFromPath(attachment.filePath);
      if (block) contentBlocks.push(block);
    } else if (attachment.type === "document" && attachment.filePath && !attachment.source) {
      const docBlock = readDocumentFromPath(attachment.filePath);
      if (docBlock) {
        contentBlocks.push(docBlock);
      } else {
        const fileContent = readTextFromPath(attachment.filePath);
        if (fileContent !== null) {
          const name = attachment.name ?? path3.basename(attachment.filePath);
          const languageHint = getLanguageHint(name);
          contentBlocks.push({
            type: "text",
            text: `File: ${name}
\`\`\`${languageHint}
${fileContent}
\`\`\``
          });
        }
      }
    } else if (attachment.type === "text") {
      let textContent = "";
      if (attachment.filePath !== void 0 && attachment.lineStart !== void 0 && attachment.lineEnd !== void 0) {
        const lineRange = attachment.lineStart === attachment.lineEnd ? `line ${String(attachment.lineStart)}` : `lines ${String(attachment.lineStart)}-${String(attachment.lineEnd)}`;
        textContent = `From: ${attachment.filePath} (${lineRange})
\`\`\`
${attachment.text ?? ""}
\`\`\``;
      } else if (attachment.terminalName !== void 0 && attachment.timestamp !== void 0) {
        textContent = `From: ${attachment.terminalName} (captured at ${attachment.timestamp})
\`\`\`
${attachment.text ?? ""}
\`\`\``;
      } else if (attachment.name !== void 0 && attachment.text !== void 0) {
        const languageHint = getLanguageHint(attachment.name);
        textContent = `File: ${attachment.name}
\`\`\`${languageHint}
${attachment.text}
\`\`\``;
      } else if (attachment.filePath && !attachment.text) {
        const fileContent = readTextFromPath(attachment.filePath);
        if (fileContent !== null) {
          const name = attachment.name ?? path3.basename(attachment.filePath);
          const languageHint = getLanguageHint(name);
          textContent = `File: ${name}
\`\`\`${languageHint}
${fileContent}
\`\`\``;
        }
      } else {
        textContent = attachment.text ?? "";
      }
      if (textContent) {
        contentBlocks.push({
          type: "text",
          text: textContent
        });
      }
    }
  }
  contentBlocks.push({
    type: "text",
    text: message
  });
  return contentBlocks;
}
function getImageMimeType(filename) {
  const ext = filename.split(".").pop()?.toLowerCase();
  const map = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp"
  };
  return map[ext ?? ""] ?? null;
}
function getDocumentMimeType(filename) {
  const ext = filename.split(".").pop()?.toLowerCase();
  if (ext === "pdf") return "application/pdf";
  return null;
}
function readImageFromPath(filePath) {
  const mimeType = getImageMimeType(path3.basename(filePath));
  if (!mimeType) return null;
  try {
    const stat = fs3.statSync(filePath);
    if (stat.size > MAX_IMAGE_SIZE) {
      console.warn(`Skipping image attachment: file too large (${stat.size} bytes): ${filePath}`);
      return null;
    }
    const data = fs3.readFileSync(filePath).toString("base64");
    return {
      type: "image",
      source: { type: "base64", media_type: mimeType, data }
    };
  } catch (err) {
    console.warn(`Failed to read image attachment: ${filePath}`, err);
    return null;
  }
}
function readDocumentFromPath(filePath) {
  const mimeType = getDocumentMimeType(path3.basename(filePath));
  if (!mimeType) return null;
  try {
    const stat = fs3.statSync(filePath);
    if (stat.size > MAX_DOCUMENT_SIZE) {
      console.warn(`Skipping document attachment: file too large (${stat.size} bytes): ${filePath}`);
      return null;
    }
    const data = fs3.readFileSync(filePath).toString("base64");
    return {
      type: "document",
      source: { type: "base64", media_type: mimeType, data }
    };
  } catch (err) {
    console.warn(`Failed to read document attachment: ${filePath}`, err);
    return null;
  }
}
function readTextFromPath(filePath) {
  try {
    const stat = fs3.statSync(filePath);
    if (stat.size > MAX_TEXT_SIZE) {
      console.warn(`Skipping text attachment: file too large (${stat.size} bytes): ${filePath}`);
      return null;
    }
    return fs3.readFileSync(filePath, "utf-8");
  } catch (err) {
    console.warn(`Failed to read text attachment: ${filePath}`, err);
    return null;
  }
}
function getLanguageHint(filename) {
  const ext = filename.split(".").pop()?.toLowerCase();
  const languageMap = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    py: "python",
    rb: "ruby",
    go: "go",
    rs: "rust",
    java: "java",
    cpp: "cpp",
    c: "c",
    cs: "csharp",
    php: "php",
    swift: "swift",
    kt: "kotlin",
    scala: "scala",
    sh: "bash",
    bash: "bash",
    zsh: "bash",
    yaml: "yaml",
    yml: "yaml",
    json: "json",
    md: "markdown",
    html: "html",
    css: "css",
    scss: "scss",
    sql: "sql"
  };
  return languageMap[ext ?? ""] ?? "";
}

// src/utils/formatter.ts
function contentToString(content) {
  if (content === null || content === void 0) {
    return "";
  }
  if (typeof content === "string") {
    return content;
  }
  if (typeof content === "number" || typeof content === "boolean" || typeof content === "bigint") {
    return String(content);
  }
  if (typeof content === "object") {
    try {
      return JSON.stringify(content);
    } catch {
      return "[Object]";
    }
  }
  return "[Unknown]";
}
function formatToolResult(toolName, toolInput, resultContent, isError = false) {
  if (isError) {
    return formatError(resultContent);
  }
  switch (toolName) {
    case "Read":
      return formatRead(resultContent);
    case "Write":
      return formatWrite(resultContent);
    case "Edit":
      return formatEdit(toolInput, resultContent);
    case "Bash":
      return formatBash(resultContent);
    case "Grep":
      return formatGrep(resultContent);
    case "Glob":
      return formatGlob(resultContent);
    case "TodoWrite":
      return formatTodoWrite(toolInput);
    case "WebFetch":
    case "WebSearch":
      return formatWebTool(resultContent);
    default:
      return formatGeneric(resultContent);
  }
}
function formatRead(resultContent) {
  if (resultContent === null || resultContent === void 0) {
    return "Completed";
  }
  const contentStr = contentToString(resultContent);
  const lineCount = contentStr.split("\n").length;
  return `Read ${String(lineCount)} lines`;
}
function formatWrite(resultContent) {
  if (resultContent === null || resultContent === void 0) {
    return "Completed";
  }
  const contentStr = contentToString(resultContent).toLowerCase();
  if (contentStr.includes("created")) {
    return "Created new file";
  }
  return "File written successfully";
}
function formatEdit(toolInput, resultContent) {
  if (resultContent === null || resultContent === void 0) {
    return "Completed";
  }
  const oldStringValue = toolInput.old_string;
  const newStringValue = toolInput.new_string;
  const oldString = typeof oldStringValue === "string" ? oldStringValue : "";
  const newString = typeof newStringValue === "string" ? newStringValue : "";
  const oldLines = oldString.length > 0 ? oldString.split("\n").length : 0;
  const newLines = newString.length > 0 ? newString.split("\n").length : 0;
  return `Updated with ${String(newLines)} addition${newLines !== 1 ? "s" : ""} and ${String(oldLines)} removal${oldLines !== 1 ? "s" : ""}`;
}
function formatBash(resultContent) {
  if (resultContent === null || resultContent === void 0) {
    return "Completed";
  }
  const contentStr = contentToString(resultContent);
  const lines = contentStr.split("\n");
  const MAX_LINES = 50;
  if (lines.length <= MAX_LINES) {
    return lines.join("\n");
  }
  const displayLines = lines.slice(0, MAX_LINES).join("\n");
  return `${displayLines}
... (${String(lines.length - MAX_LINES)} more lines)`;
}
function formatGrep(resultContent) {
  if (resultContent === null || resultContent === void 0) {
    return "Completed";
  }
  const contentStr = contentToString(resultContent);
  const matches = contentStr.split("\n").filter((line) => line.trim().length > 0);
  const MAX_MATCHES = 10;
  const lines = [`Found ${String(matches.length)} matches`];
  const displayMatches = matches.slice(0, MAX_MATCHES);
  for (const match of displayMatches) {
    lines.push(match);
  }
  if (matches.length > MAX_MATCHES) {
    lines.push(`... (${String(matches.length - MAX_MATCHES)} more matches)`);
  }
  return lines.join("\n");
}
function formatGlob(resultContent) {
  if (resultContent === null || resultContent === void 0) {
    return "Completed";
  }
  const contentStr = contentToString(resultContent);
  const files = contentStr.split("\n").filter((line) => line.trim().length > 0);
  const MAX_FILES = 15;
  const lines = [`Found ${String(files.length)} files`];
  const displayFiles = files.slice(0, MAX_FILES);
  for (const file of displayFiles) {
    lines.push(file);
  }
  if (files.length > MAX_FILES) {
    lines.push(`... (${String(files.length - MAX_FILES)} more files)`);
  }
  return lines.join("\n");
}
function formatTodoWrite(toolInput) {
  const todos = toolInput.todos;
  if (Array.isArray(todos)) {
    return `Updated ${String(todos.length)} todo items`;
  }
  return "Completed";
}
function formatWebTool(resultContent) {
  if (resultContent === null || resultContent === void 0) {
    return "Completed";
  }
  return contentToString(resultContent);
}
function formatError(resultContent) {
  if (resultContent === null || resultContent === void 0) {
    return "Error occurred";
  }
  const contentStr = contentToString(resultContent);
  const lines = contentStr.split("\n");
  const MAX_LINES = 10;
  if (lines.length <= MAX_LINES) {
    return lines.join("\n");
  }
  const displayLines = lines.slice(0, MAX_LINES).join("\n");
  return `${displayLines}
... (${String(lines.length - MAX_LINES)} more lines)`;
}
function formatGeneric(resultContent) {
  if (resultContent === null || resultContent === void 0) {
    return "Completed";
  }
  const contentStr = contentToString(resultContent);
  const lines = contentStr.split("\n");
  const MAX_LINES = 10;
  if (lines.length <= MAX_LINES) {
    return lines.join("\n");
  }
  const displayLines = lines.slice(0, MAX_LINES).join("\n");
  return `${displayLines}
... (${String(lines.length - MAX_LINES)} more lines)`;
}

// src/agent.ts
var logger6 = createLogger("OrbitAgent");
function isToolResultBlock(block) {
  if (typeof block !== "object" || block === null) {
    return false;
  }
  const obj = block;
  return obj.type === "tool_result" && typeof obj.tool_use_id === "string" && typeof obj.content === "string";
}
function isToolUseBlock(block) {
  if (typeof block !== "object" || block === null) {
    return false;
  }
  const obj = block;
  return obj.type === "tool_use" && typeof obj.id === "string" && typeof obj.name === "string" && typeof obj.input === "object" && obj.input !== null;
}
function getMessageContentArray(message) {
  if (message.type !== "assistant" && message.type !== "user") {
    return null;
  }
  const msg = message;
  const content = msg.message?.content;
  if (!Array.isArray(content)) {
    return null;
  }
  return content;
}
function isExecutable(candidate) {
  try {
    fs4.accessSync(candidate, fs4.constants.X_OK);
    return fs4.statSync(candidate).isFile();
  } catch {
    return false;
  }
}
function resolveClaudeCodeExecutable() {
  const envOverride = process.env.SOLO_CLAUDE_CODE_EXECUTABLE ?? process.env.CLAUDE_CODE_EXECUTABLE ?? process.env.CLAUDE_CODE_PATH;
  if (envOverride) {
    if (isExecutable(envOverride)) {
      return envOverride;
    }
    logger6.warn({ path: envOverride }, "Configured Claude Code executable is not executable");
  }
  const homeDir = process.env.HOME ?? "";
  const pathDirs = (process.env.PATH ?? "").split(path4.delimiter).filter(Boolean);
  const candidates = [
    ...pathDirs.map((dir) => path4.join(dir, "claude")),
    path4.join(homeDir, ".local", "bin", "claude"),
    path4.join(homeDir, ".bun", "bin", "claude"),
    path4.join(homeDir, ".npm-global", "bin", "claude"),
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude"
  ];
  for (const candidate of [...new Set(candidates)]) {
    if (isExecutable(candidate)) {
      return candidate;
    }
  }
  return void 0;
}
var MessageQueue = class {
  queue = [];
  resolvers = [];
  stopped = false;
  /**
   * Add a message to the queue.
   * If a consumer is waiting, resolve immediately.
   * Otherwise, add to queue for later consumption.
   */
  add(message, attachments) {
    if (this.stopped) {
      throw new Error("Message queue has been stopped");
    }
    const content = buildContentBlocks(message, attachments);
    const sdkMessage = {
      type: "user",
      message: {
        role: "user",
        content
        // Can be string or array of content blocks
      },
      parent_tool_use_id: null,
      session_id: ""
      // SDK will assign the real session_id
    };
    if (this.resolvers.length > 0) {
      const resolve2 = this.resolvers.shift();
      if (resolve2) {
        resolve2({ value: sdkMessage, done: false });
      }
    } else {
      this.queue.push(sdkMessage);
    }
  }
  /**
   * Stop the queue (marks as complete).
   * Resolves any waiting consumers with done: true.
   */
  stop() {
    this.stopped = true;
    for (const resolve2 of this.resolvers) {
      resolve2({ value: void 0, done: true });
    }
    this.resolvers = [];
  }
  /**
   * Async iterator implementation.
   * Yields messages from queue or waits for new messages.
   */
  async *[Symbol.asyncIterator]() {
    while (!this.stopped) {
      if (this.queue.length > 0) {
        const message = this.queue.shift();
        if (message) {
          yield message;
        }
      } else {
        const result = await new Promise((resolve2) => {
          this.resolvers.push(resolve2);
        });
        if (result.done) {
          break;
        }
        yield result.value;
      }
    }
  }
};
var OrbitAgent = class {
  currentQuery = null;
  permissionManager;
  cwd;
  _thinkingMode;
  _thinkingBudget;
  // 0=off, 4096=think, 10240=hard, 32768=ultra
  _planMode;
  _planFilePath = null;
  _acceptMode;
  _debugMode = false;
  /** Captured goal text for Debug mode — set on first user prompt when debug is on. */
  _debugGoal = null;
  /** Counts assistant turns since the last Debug-mode review question. */
  _debugTurnsSinceReview = 0;
  /** Turns-between-reviews cadence — overridden from merged settings at startup. */
  _debugReviewInterval = 3;
  _critiqueMode;
  model;
  _fallbackModel;
  _maxTokens;
  _allowedTools;
  _sessionMode;
  _vaultAuth;
  // Session resume/fork fields
  _resumeSessionId;
  _forkSession;
  _currentSessionId;
  // Streaming input mode fields
  messageQueue = null;
  sessionActive = false;
  // MCP servers (DevTools, custom tools, etc.)
  _mcpServers;
  _selectedSkills;
  // Structured output format (JSON Schema)
  _outputFormat;
  // Custom subagents for Task tool
  _agents;
  constructor(config = {}) {
    this.permissionManager = new PermissionManager(
      config.permissionRequestCallback,
      config.snapshotCallback,
      () => this._acceptMode,
      // Accept mode (dynamic)
      () => this._planMode,
      // Plan mode (dynamic)
      () => this._planFilePath,
      // Plan file path for Plan-mode write special case
      () => this.cwd,
      // Workspace for loading .solo/settings.json
      () => this._debugMode,
      // Debug mode (dynamic)
      config.toolPolicy
    );
    this.cwd = config.cwd ?? process.cwd();
    this._thinkingMode = config.thinkingEnabled ?? false;
    this._thinkingBudget = config.maxThinkingTokens ?? 0;
    this._planMode = config.planEnabled ?? config.permissionMode === "plan";
    if (this._planMode) {
      const planName = generatePlanName();
      this._planFilePath = getPlanFilePath(planName, this.cwd);
      ensurePlanDirectory(this.cwd);
      logger6.info({ planName, planFilePath: this._planFilePath }, "Plan file path generated during construction");
    }
    this._acceptMode = config.acceptEnabled ?? config.permissionMode === "accept";
    this._debugMode = config.debugEnabled ?? config.permissionMode === "debug";
    this._critiqueMode = config.critiqueEnabled ?? false;
    this._sessionMode = config.sessionMode ?? "agent";
    this._vaultAuth = config.vaultAuth;
    this._resumeSessionId = config.resumeSessionId;
    this._forkSession = config.forkSession ?? false;
    if (config.model !== void 0) {
      this.model = config.model;
    }
    if (config.fallbackModel !== void 0) {
      this._fallbackModel = config.fallbackModel;
    }
    if (config.maxTokens !== void 0) {
      this._maxTokens = config.maxTokens;
    }
    if (config.allowedTools !== void 0) {
      this._allowedTools = [...config.allowedTools];
    }
    this._mcpServers = config.mcpServers ?? {};
    this._selectedSkills = config.selectedSkills ? [...config.selectedSkills] : void 0;
    this._outputFormat = config.outputFormat;
    this._agents = config.agents;
    try {
      const settings = loadMergedSettings(this.cwd);
      const interval = settings.modes.debug.reviewInterval;
      if (typeof interval === "number" && interval > 0) {
        this._debugReviewInterval = interval;
      }
    } catch {
    }
    logger6.info(
      {
        sessionMode: this._sessionMode,
        mcpServerCount: Object.keys(this._mcpServers).length,
        selectedSkillCount: this._selectedSkills?.length ?? 0,
        hasOutputFormat: !!this._outputFormat,
        agentCount: this._agents ? Object.keys(this._agents).length : 0
      },
      "OrbitAgent created with session mode"
    );
  }
  /**
   * Register an MCP server dynamically (before session start)
   */
  registerMcpServer(name, server) {
    if (this.sessionActive) {
      logger6.warn("Cannot register MCP server after session has started");
      return;
    }
    this._mcpServers[name] = server;
    logger6.info({ name }, "MCP server registered");
  }
  /**
   * Unregister an MCP server
   */
  unregisterMcpServer(name) {
    const { [name]: _removed, ...rest } = this._mcpServers;
    void _removed;
    this._mcpServers = rest;
    logger6.info({ name }, "MCP server unregistered");
  }
  /**
   * Set or remove the browser MCP server.
   * Call with server when browser panel is opened and session is active.
   * Call with null when browser panel is closed.
   */
  setBrowserMcpServer(server) {
    if (server) {
      this.registerMcpServer("browser", server);
    } else {
      this.unregisterMcpServer("browser");
    }
  }
  /**
   * Check if browser MCP server is registered
   */
  hasBrowserMcpServer() {
    return Object.hasOwn(this._mcpServers, "browser");
  }
  /**
   * Get the permission manager instance
   */
  getPermissionManager() {
    return this.permissionManager;
  }
  /**
   * Preview what the permission pipeline would decide for a tool call, without
   * invoking any side effects. Used by the session-manager to pick the right
   * initial `status` on streamed `tool_use` events so auto-approved tools
   * never flash an approval card.
   */
  previewPermission(toolName, toolInput) {
    return this.permissionManager.previewDecision(toolName, toolInput);
  }
  _createOptions() {
    const options = {
      // Use Claude Code's official system prompt with browser automation docs
      systemPrompt: {
        type: "preset",
        preset: "claude_code",
        append: `
${buildIdentityAppend(this.model)}

## Browser Automation

You have access to browser automation tools via MCP. Use mcp__browser__open_browser to start a browser session.

### Panel Control
- **mcp__browser__open_browser**: Open the browser panel and navigate to URL. Use this first if browser is not open.
- **mcp__browser__close_browser**: Close the browser panel when done with automation.

### Navigation
- **mcp__browser__navigate**: Go to URL (returns accessibility snapshot with element refs)
- **mcp__browser__go_back / mcp__browser__go_forward / mcp__browser__reload**: History navigation
- **mcp__browser__url**: Get current URL

### Interaction
- **mcp__browser__click**: Click by CSS selector
- **mcp__browser__click_ref**: Click by accessibility ref (preferred - more reliable)
- **mcp__browser__type**: Type text character by character
- **mcp__browser__fill**: Fill form field (clears first, more reliable for inputs)
- **mcp__browser__select**: Select dropdown option
- **mcp__browser__hover**: Hover over element
- **mcp__browser__press_key**: Press keyboard key (Enter, Tab, Escape, ArrowDown, etc.)
- **mcp__browser__scroll**: Scroll page or element

### Observation
- **mcp__browser__snapshot**: Get accessibility tree showing all interactive elements with refs
- **mcp__browser__screenshot**: Capture visual screenshot
- **mcp__browser__wait**: Wait for element to appear

### JavaScript
- **mcp__browser__evaluate**: Execute JavaScript in page context

### Console/Network
- **mcp__browser__console_logs**: Get console messages (errors, warnings, logs)
- **mcp__browser__network_requests**: Get network requests (useful for debugging API calls)

### Recommended Workflow
1. Use mcp__browser__open_browser to start a browser session (or mcp__browser__navigate if already open)
2. Read the snapshot to find elements and their refs (e.g., ref="ref-5")
3. Use mcp__browser__click_ref with refs for reliable clicking (not CSS selectors)
4. After interactions, call mcp__browser__snapshot to see updated page state
5. Use mcp__browser__console_logs to check for JavaScript errors
6. Use mcp__browser__close_browser when done

### Tips
- **Use open_browser first** - it opens the panel and navigates in one step
- **Prefer refs over CSS selectors** - accessibility refs from snapshots are more reliable
- **Always check snapshot after navigation** to understand page structure
- **For forms**: use mcp__browser__fill for inputs, mcp__browser__select for dropdowns
- **Check console for errors** after page loads or after interactions fail

## Chrome DevTools (Advanced)

When browser is open, you also have access to Chrome DevTools Protocol tools via mcp__orbit-devtools__*:

### Console
- **devtools_console_get**: Get console logs with filtering by type (log/warn/error/info/debug)
- **devtools_console_clear**: Clear console messages
- **devtools_console_eval**: Execute JavaScript in console context

### Network (Detailed)
- **devtools_network_get**: Get network requests with filtering (url pattern, method, status)
- **devtools_network_detail**: Get full request/response details including headers and body
- **devtools_network_clear**: Clear network logs

### DOM Inspection
- **devtools_dom_query**: Query DOM with CSS selectors, get element structure
- **devtools_dom_html**: Get outer HTML of elements
- **devtools_dom_styles**: Get computed CSS styles for elements
- **devtools_dom_attributes**: Get all attributes of an element

### Performance
- **devtools_perf_metrics**: Get performance metrics (memory, DOM stats, rendering times)
- **devtools_perf_trace_start**: Start recording performance trace
- **devtools_perf_trace_stop**: Stop trace and get timeline events

### Storage
- **devtools_storage_local / devtools_storage_session**: Get localStorage/sessionStorage
- **devtools_storage_cookies**: Get cookies (optionally filter by domain)
- **devtools_storage_set_local / devtools_storage_set_session**: Set storage items
- **devtools_storage_set_cookie**: Set a cookie with full options
- **devtools_storage_clear**: Clear storage (local/session/cookies/all)

### General
- **devtools_eval**: Execute JavaScript with full page access, can await promises
- **devtools_page_info**: Get current page title and URL

### When to Use DevTools vs Browser Tools
- **Browser tools (mcp__browser__)**: Page interaction, navigation, clicking, typing
- **DevTools tools (mcp__orbit-devtools__)**: Deep inspection, debugging, storage, performance analysis

## Vault \u2014 Agent Memory

The user maintains a personal **vault** of indexed knowledge (documents, code,
data, screenshots, notes). It functions as your durable memory across sessions.

- **Auto-injected context**: if relevant vault chunks are found for the
  current turn, they are prepended to the user message inside a
  \`<vault-memory>\` block. Treat those chunks as authoritative. If none are
  relevant to the user's question, ignore them silently \u2014 do NOT tell the
  user "I received vault context but it wasn't relevant".
- **On-demand lookup**: when the user refers to something they previously
  indexed ("the schema I added", "my notes on X", "did I put Y in the
  vault?"), call the \`mcp__vault__vault_search\` tool with keywords from
  their message. Prefer this over re-asking the user or grepping the
  filesystem for vault content. Default to \`source="hybrid"\` and
  \`mode="hybrid"\`; use \`source="local"\` when the user wants to keep
  retrieval local. Cloud retrieval sends the query to the cloud and requires
  sign-in.
- **Memory writes**: when the user asks you to remember something, save a
  note, or add content to the vault, call \`mcp__vault__vault_add\`. Save
  locally by default. Use \`sync_to_cloud=true\` only when the user explicitly
  asks for cloud sync or cloud-backed retrieval of that saved memory.
- **Pinned entries** appear with a \`[pinned]\` badge. They are
  user-designated sources of truth \u2014 treat them as higher priority than
  other retrieved chunks.
`
      },
      // Working directory
      cwd: this.cwd,
      // Load CLAUDE.md from project directory for project-specific instructions
      settingSources: ["project"]
    };
    const claudeCodeExecutable = resolveClaudeCodeExecutable();
    if (claudeCodeExecutable) {
      options.pathToClaudeCodeExecutable = claudeCodeExecutable;
      logger6.info({ path: claudeCodeExecutable }, "Using Claude Code executable");
    } else {
      logger6.warn("Claude Code executable not found on PATH; SDK will try its bundled CLI");
    }
    if (this._thinkingMode && this._thinkingBudget > 0) {
      options.maxThinkingTokens = this._thinkingBudget;
      const modeName = this._thinkingBudget <= 4096 ? "think" : this._thinkingBudget <= 10240 ? "hard" : "ultra";
      logger6.info(
        { thinkingMode: modeName, thinkingBudget: this._thinkingBudget },
        "Extended thinking ENABLED"
      );
    } else {
      logger6.info({ thinkingMode: "off" }, "Extended thinking DISABLED");
    }
    if (this._allowedTools !== void 0) {
      options.allowedTools = [...this._allowedTools];
      logger6.info(
        { tools: this._allowedTools, sessionMode: this._sessionMode },
        "Explicit tool allow-list installed"
      );
    } else if (this._sessionMode === "chat") {
      const chatTools = getAllowedToolsForMode("chat");
      options.allowedTools = chatTools;
      logger6.info({ mode: "chat", tools: chatTools }, "Chat mode - read-only tools auto-approved");
    } else {
      const permissionCallback = this.permissionManager.createCallback();
      logger6.debug("Using SDK permission flow with canUseTool callback");
      options.canUseTool = async (toolName, toolInput, canUseToolOptions) => {
        logger6.debug({ toolName }, "canUseTool callback invoked");
        try {
          const result = await permissionCallback(toolName, toolInput, {
            signal: canUseToolOptions.signal,
            suggestions: canUseToolOptions.suggestions ?? []
          });
          return result;
        } catch (error) {
          logger6.error({ toolName, error }, "canUseTool callback error");
          return {
            behavior: "deny",
            message: "Permission request failed"
          };
        }
      };
      const subagentStartTimes = /* @__PURE__ */ new Map();
      const SAFE_TOOLS = /* @__PURE__ */ new Set([
        "Read",
        "Glob",
        "Grep",
        "WebSearch",
        "WebFetch",
        "ListMcpResourcesTool",
        "ReadMcpResourceTool",
        // Vault memory tool — read-only, safe to auto-approve
        "mcp__vault__vault_search",
        // Skill discovery is read-only and session-scoped
        "mcp__solo_skills__skill_list",
        "mcp__solo_skills__skill_read"
      ]);
      options.hooks = {
        // PreToolUse hook - auto-approve safe tools, let SDK handle others
        PreToolUse: [
          {
            // No matcher means match ALL tools
            timeout: 86400,
            // 24 hours for indefinite waiting
            hooks: [
              (input) => {
                const preToolInput = input;
                const toolName = preToolInput.tool_name;
                const toolInput = preToolInput.tool_input;
                logger6.info(
                  {
                    toolName,
                    inputKeys: Object.keys(toolInput)
                  },
                  "Hook: PreToolUse \u2014 tool requested"
                );
                if (SAFE_TOOLS.has(toolName)) {
                  logger6.debug({ toolName }, "Hook: PreToolUse \u2014 auto-approved (safe tool)");
                  return Promise.resolve({
                    hookSpecificOutput: {
                      hookEventName: "PreToolUse",
                      permissionDecision: "allow",
                      updatedInput: toolInput
                    }
                  });
                }
                logger6.debug({ toolName }, "Hook: PreToolUse \u2014 delegating to SDK permission flow");
                return Promise.resolve({});
              }
            ]
          }
        ],
        // PostToolUse hook - log tool response + duration
        PostToolUse: [
          {
            timeout: 30,
            hooks: [
              (input, toolUseId) => {
                const postInput = input;
                const response = postInput.tool_response;
                const responseStr = typeof response === "string" ? response : JSON.stringify(response);
                logger6.info(
                  {
                    toolName: postInput.tool_name,
                    toolUseId,
                    responsePreview: responseStr?.slice(0, 500),
                    responseLength: responseStr?.length ?? 0
                  },
                  "Hook: PostToolUse \u2014 tool completed"
                );
                return Promise.resolve({});
              }
            ]
          }
        ],
        // PostToolUseFailure hook - log full error + context
        PostToolUseFailure: [
          {
            timeout: 30,
            hooks: [
              (input, toolUseId) => {
                const failureInput = input;
                logger6.warn(
                  {
                    toolName: failureInput.tool_name,
                    toolUseId,
                    error: failureInput.error,
                    isInterrupt: failureInput.is_interrupt,
                    toolInput: failureInput.tool_input ? JSON.stringify(failureInput.tool_input).slice(0, 300) : void 0
                  },
                  "Hook: PostToolUseFailure \u2014 tool failed"
                );
                return Promise.resolve({});
              }
            ]
          }
        ],
        // Notification hook - track agent status updates
        Notification: [
          {
            timeout: 30,
            hooks: [
              (input) => {
                const notifInput = input;
                logger6.info(
                  {
                    message: notifInput.message,
                    title: notifInput.title
                  },
                  "Hook: Notification"
                );
                return Promise.resolve({});
              }
            ]
          }
        ],
        // PreCompact hook - log trigger reason and context
        PreCompact: [
          {
            timeout: 30,
            hooks: [
              (input) => {
                const compactInput = input;
                logger6.info(
                  {
                    trigger: compactInput.trigger,
                    customInstructions: compactInput.custom_instructions ? `${compactInput.custom_instructions.slice(0, 100)}...` : void 0
                  },
                  "Hook: PreCompact \u2014 context compaction starting"
                );
                return Promise.resolve({});
              }
            ]
          }
        ],
        // SubagentStart hook - track subagent spawning with timing
        SubagentStart: [
          {
            timeout: 30,
            hooks: [
              (input) => {
                const startInput = input;
                const agentId = startInput.agent_id;
                subagentStartTimes.set(agentId, Date.now());
                logger6.info(
                  {
                    agentId,
                    agentType: startInput.agent_type
                  },
                  "Hook: SubagentStart \u2014 subagent spawned"
                );
                return Promise.resolve({});
              }
            ]
          }
        ],
        // SubagentStop hook - compute subagent duration
        SubagentStop: [
          {
            timeout: 30,
            hooks: [
              (input) => {
                const stopInput = input;
                logger6.info(
                  {
                    stopHookActive: stopInput.stop_hook_active
                  },
                  "Hook: SubagentStop \u2014 subagent completed"
                );
                return Promise.resolve({});
              }
            ]
          }
        ],
        // SessionStart hook - log session config snapshot
        SessionStart: [
          {
            timeout: 30,
            hooks: [
              (input) => {
                const sessionInput = input;
                logger6.info(
                  {
                    source: sessionInput.source,
                    model: this.model ?? "sonnet",
                    thinkingMode: this._thinkingMode,
                    thinkingBudget: this._thinkingBudget,
                    planMode: this._planMode,
                    acceptMode: this._acceptMode,
                    sessionMode: this._sessionMode,
                    mcpServers: Object.keys(this._mcpServers)
                  },
                  "Hook: SessionStart \u2014 session config snapshot"
                );
                return Promise.resolve({});
              }
            ]
          }
        ],
        // SessionEnd hook - log end reason
        SessionEnd: [
          {
            timeout: 30,
            hooks: [
              (input) => {
                const sessionInput = input;
                logger6.info(
                  {
                    reason: sessionInput.reason
                  },
                  "Hook: SessionEnd \u2014 session ended"
                );
                return Promise.resolve({});
              }
            ]
          }
        ],
        // UserPromptSubmit hook - injects mode-specific context per-turn.
        //
        // Handles three cases (composable):
        //   1. Plan mode: inject the plan-mode directive + plan file path
        //   2. Debug mode (first turn): capture the user's prompt as the
        //      session goal and inject the Debug-mode preamble
        //   3. Debug mode (every N turns): inject a review-checkpoint
        //      directive asking the agent to call AskUserQuestion
        UserPromptSubmit: [
          {
            timeout: 30,
            hooks: [
              (input) => {
                const parts = [];
                if (this._planMode && this._planFilePath) {
                  const planExists = fs4.existsSync(this._planFilePath);
                  parts.push(
                    `Plan mode is active. The user indicated that they do not want you to execute yet -- you MUST NOT make any edits (with the exception of the plan file mentioned below), run any non-readonly tools (including changing configs or making commits), or otherwise make any changes to the system. This supercedes any other instructions you have received.

## Plan File Info:
${planExists ? `Your plan is at ${this._planFilePath}. Edit it incrementally.` : `No plan file exists yet. You should create your plan at ${this._planFilePath} using the Write tool.`}
You should build your plan incrementally by writing to or editing this file. NOTE that this is the only file you are allowed to edit - other than this you are only allowed to take READ-ONLY actions.`
                  );
                }
                if (this._debugMode) {
                  const promptText = (() => {
                    const p = input?.prompt;
                    return typeof p === "string" ? p : "";
                  })();
                  if (this._debugGoal === null && promptText.trim().length > 0) {
                    this._debugGoal = promptText.trim();
                    this._debugTurnsSinceReview = 0;
                    logger6.info(
                      { goalPreview: this._debugGoal.slice(0, 120) },
                      "Debug mode \u2014 captured session goal from first prompt"
                    );
                  }
                  parts.push(
                    `Debug mode is active. Continuously evaluate your work against the user's stated goal for this session:

"""
${this._debugGoal ?? "(goal will be captured from this message)"}
"""

When you complete a coherent unit of work, invoke the AskUserQuestion tool to run a structured review. Prefer 3\u20135 targeted questions picked from:
- Problems the user has flagged or you suspect
- Improvements to propose
- What the user actually wants (vs. what you inferred)
- Whether the goal has been met (yes/no + evidence)
- Whether the technical implementation satisfies the goal
- Software improvements worth making now
- Business / UX / correctness gaps

Do NOT overwhelm the user with a full checklist every time \u2014 pick the most important items given the current session state.`
                  );
                  this._debugTurnsSinceReview += 1;
                  if (this._debugTurnsSinceReview >= this._debugReviewInterval) {
                    parts.push(
                      `[Debug-mode review checkpoint] It has been ${this._debugTurnsSinceReview} turns since the last user-facing check-in. Before processing further, invoke the AskUserQuestion tool with a concise review aligned to the session goal above.`
                    );
                    this._debugTurnsSinceReview = 0;
                  }
                }
                if (parts.length === 0) return Promise.resolve({});
                logger6.info(
                  {
                    planMode: this._planMode,
                    debugMode: this._debugMode,
                    goalCaptured: this._debugGoal !== null
                  },
                  "Hook: UserPromptSubmit \u2014 injecting mode-specific context"
                );
                return Promise.resolve({
                  hookSpecificOutput: {
                    hookEventName: "UserPromptSubmit",
                    additionalContext: parts.join("\n\n")
                  }
                });
              }
            ]
          }
        ]
      };
    }
    if (this.model) {
      options.model = this.model;
      logger6.info({ model: this.model }, "Using model");
    }
    if (this._fallbackModel) {
      options.fallbackModel = this._fallbackModel;
      logger6.info({ fallbackModel: this._fallbackModel }, "Fallback model configured");
    }
    if (this._maxTokens !== void 0) {
      options.env = {
        ...process.env,
        CLAUDE_CODE_MAX_OUTPUT_TOKENS: String(this._maxTokens)
      };
      logger6.info({ maxTokens: this._maxTokens }, "Output-token cap configured");
    }
    options.permissionMode = "default";
    logger6.info(
      {
        acceptMode: this._acceptMode,
        planMode: this._planMode,
        debugMode: this._debugMode
      },
      "Permission mode set to 'default' \u2014 runtime gating via canUseTool"
    );
    options.includePartialMessages = true;
    if (this._resumeSessionId) {
      options.resume = this._resumeSessionId;
      if (this._forkSession) {
        options.forkSession = true;
      }
      logger6.info(
        { resumeFrom: this._resumeSessionId, fork: this._forkSession },
        "Session resume/fork configured"
      );
    }
    const vaultMcp = createSdkMcpServer2({
      name: "vault",
      version: "0.1.0",
      tools: [
        createVaultSearchTool(() => this._vaultAuth, () => this.cwd),
        createVaultAddTool(() => this._vaultAuth, () => this.cwd)
      ]
    });
    const skillsMcp = createSkillsMcpServer(this.cwd, this._selectedSkills);
    const mergedMcp = { ...this._mcpServers, vault: vaultMcp, solo_skills: skillsMcp };
    options.mcpServers = mergedMcp;
    logger6.info({ servers: Object.keys(mergedMcp) }, "MCP servers configured");
    if (this._outputFormat) {
      options.outputFormat = this._outputFormat;
      logger6.info({ type: this._outputFormat.type }, "Structured output format configured");
    }
    if (this._agents && Object.keys(this._agents).length > 0) {
      options.agents = this._agents;
      logger6.info({ agents: Object.keys(this._agents) }, "Custom subagents configured");
    }
    return options;
  }
  async startSession() {
    if (this.sessionActive) {
      logger6.warn("Session already active");
      return;
    }
    loadEmbeddingsCache(this.cwd).catch((err) => {
      logger6.warn({ err: String(err) }, "vault.cache.preload_failed");
    });
    const currentPath = process.env.PATH ?? "";
    const homeDir = process.env.HOME ?? "";
    const additionalPaths = [
      "/opt/homebrew/bin",
      // Homebrew on Apple Silicon
      "/usr/local/bin",
      // Homebrew on Intel Macs
      "/usr/bin",
      // System binaries
      `${homeDir}/.local/bin`,
      // Claude Code self-managed install path
      `${homeDir}/.bun/bin`,
      // Bun-installed CLIs
      `${homeDir}/.npm-global/bin`,
      // npm prefix configured under HOME
      `${homeDir}/.nvm/versions/node/v22.11.0/bin`,
      // Common nvm path
      `${homeDir}/.nvm/versions/node/v20.18.0/bin`,
      // Another common nvm path
      `${homeDir}/.fnm/node-versions/v22.11.0/installation/bin`
      // fnm path
    ].filter((p) => !currentPath.includes(p));
    if (additionalPaths.length > 0) {
      process.env.PATH = [...additionalPaths, currentPath].join(":");
      logger6.debug({ addedPaths: additionalPaths }, "Fixed PATH for Electron app");
    }
    const credentials = await ClaudeCredentials.getCredentials();
    if (!credentials.hasCredentials) {
      throw new Error(
        'No credentials found. Please either:\n1. Run "claude /login" to set up OAuth credentials in ~/.claude/.credentials.json, OR\n2. Set ANTHROPIC_API_KEY in .env file'
      );
    }
    if (credentials.type === "oauth") {
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.ANTHROPIC_AUTH_TOKEN;
      logger6.info("Using Claude Code OAuth (CLI reads from ~/.claude/.credentials.json)");
      logger6.info("Note: Using your Claude subscription quota, not API credits");
    } else {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        throw new Error("API key was detected but is no longer available");
      }
      logger6.info("Using API key from .env (will consume API credits)");
    }
    process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT = "86400000";
    logger6.debug(
      { thinkingMode: this._thinkingMode, thinkingBudget: this._thinkingBudget },
      "Starting session"
    );
    this.messageQueue = new MessageQueue();
    this.sessionActive = true;
    this.currentQuery = query({
      prompt: this.messageQueue[Symbol.asyncIterator](),
      options: this._createOptions()
    });
    logger6.info("Session started successfully");
  }
  /**
   * Check if the session is ready to receive messages
   */
  isSessionReady() {
    return this.sessionActive && this.messageQueue !== null;
  }
  updateVaultAuth(vaultAuth) {
    this._vaultAuth = vaultAuth;
  }
  async queueMessage(message, attachments, vaultAuth) {
    if (!this.sessionActive || !this.messageQueue) {
      throw new Error("Session not started. Call startSession() first.");
    }
    if (vaultAuth !== void 0) {
      this.updateVaultAuth(vaultAuth);
    }
    const thinkingModeName = this._thinkingMode && this._thinkingBudget > 0 ? this._thinkingBudget <= 4096 ? "think" : this._thinkingBudget <= 10240 ? "hard" : "ultra" : "off";
    logger6.info(
      {
        model: this.model ?? "sonnet",
        thinkingMode: thinkingModeName,
        thinkingBudget: this._thinkingBudget,
        thinkingEnabled: this._thinkingMode,
        planMode: this._planMode,
        acceptMode: this._acceptMode,
        critiqueMode: this._critiqueMode,
        sessionMode: this._sessionMode,
        messagePreview: message.substring(0, 80) + (message.length > 80 ? "..." : ""),
        attachmentCount: attachments?.length ?? 0
      },
      // allow-any-unicode-next-line
      "\u{1F4E4} Sending message to Claude"
    );
    let finalMessage = message;
    try {
      const ctx = await fetchVaultContext(message, {
        projectId: this.cwd,
        maxChunks: 5,
        mode: "hybrid",
        source: this._vaultAuth?.retrievalSource ?? "hybrid",
        vaultAuth: this._vaultAuth
      });
      if (ctx) {
        finalMessage = `${ctx}

${message}`;
        logger6.info(
          { ctxLen: ctx.length, msgPreview: message.substring(0, 60) },
          "\u{1F9E0} vault: context prepended"
        );
      }
    } catch (err) {
      logger6.warn({ err: String(err) }, "vault: pre-flight injection skipped");
    }
    this.messageQueue.add(finalMessage, attachments);
  }
  async *receiveResponse() {
    if (!this.currentQuery) {
      throw new Error("No active query. Call startSession() first.");
    }
    const toolUseMap = /* @__PURE__ */ new Map();
    for await (const message of this.currentQuery) {
      if (message.type === "system" && message.subtype === "init") {
        const initMessage = message;
        if (initMessage.session_id) {
          this._currentSessionId = initMessage.session_id;
        }
      }
      if (message.type === "assistant") {
        const contentArray = getMessageContentArray(message);
        if (contentArray !== null) {
          for (const block of contentArray) {
            if (isToolUseBlock(block)) {
              toolUseMap.set(block.id, {
                name: block.name,
                input: block.input
              });
            }
          }
        }
      }
      if (message.type === "user") {
        const contentArray = getMessageContentArray(message);
        if (contentArray !== null) {
          const msg = message;
          const formattedContent = contentArray.map((block) => {
            if (isToolResultBlock(block)) {
              const toolInfo = toolUseMap.get(block.tool_use_id);
              if (toolInfo !== void 0) {
                const formatted = formatToolResult(
                  toolInfo.name,
                  toolInfo.input,
                  block.content,
                  block.is_error === true
                );
                return { ...block, content: formatted };
              }
            }
            return block;
          });
          const formattedMessage = {
            ...message,
            message: { ...msg.message, content: formattedContent }
          };
          yield formattedMessage;
        } else {
          yield message;
        }
      } else {
        yield message;
      }
    }
    logger6.debug("Query session completed");
    this.sessionActive = false;
    this.currentQuery = null;
  }
  async stopSession() {
    if (!this.sessionActive) {
      logger6.debug("Session not active");
      return;
    }
    logger6.debug("Stopping session");
    if (this.messageQueue) {
      this.messageQueue.stop();
      this.messageQueue = null;
    }
    if (this.currentQuery) {
      try {
        await this.currentQuery.interrupt();
      } catch (error) {
        logger6.error({ error }, "Error interrupting query");
      }
      this.currentQuery = null;
    }
    this.sessionActive = false;
    logger6.info("Session stopped");
  }
  async interrupt() {
    if (!this.currentQuery) {
      throw new Error("No active query to interrupt.");
    }
    logger6.info("Interrupting current query");
    await this.currentQuery.interrupt();
  }
  async setPermissionMode(mode) {
    if (!this.currentQuery) {
      throw new Error("No active query.");
    }
    await this.currentQuery.setPermissionMode(mode);
  }
  isConnected() {
    return this.currentQuery !== null;
  }
  async setThinkingMode(enabled, maxTokens) {
    this._thinkingMode = enabled;
    if (maxTokens !== void 0) {
      this._thinkingBudget = maxTokens;
    }
    if (this.currentQuery) {
      const budget = enabled && this._thinkingBudget > 0 ? this._thinkingBudget : null;
      await this.currentQuery.setMaxThinkingTokens(budget);
      const modeName = budget === null ? "off" : budget <= 4096 ? "think" : budget <= 10240 ? "hard" : "ultra";
      logger6.info({ thinkingMode: modeName, budget }, "Thinking mode updated mid-session");
    }
  }
  getThinkingMode() {
    return this._thinkingMode;
  }
  setPlanMode(enabled) {
    this._planMode = enabled;
    if (enabled) {
      this._acceptMode = false;
      if (!this._planFilePath) {
        const planName = generatePlanName();
        this._planFilePath = getPlanFilePath(planName, this.cwd);
        ensurePlanDirectory(this.cwd);
        logger6.info({ planName, planFilePath: this._planFilePath }, "Plan file path generated");
      }
    } else {
      this._planFilePath = null;
    }
    logger6.info({ enabled, planFilePath: this._planFilePath }, "Plan mode changed - will take effect on next tool use");
  }
  getPlanMode() {
    return this._planMode;
  }
  getPlanFilePath() {
    return this._planFilePath;
  }
  setAcceptMode(enabled) {
    this._acceptMode = enabled;
    if (enabled) {
      this._planMode = false;
    }
    logger6.info({ enabled }, "Accept mode changed - will take effect on next tool use");
  }
  getAcceptMode() {
    return this._acceptMode;
  }
  /**
   * Enable/disable Debug mode. Turning it on captures the next user prompt
   * as the session goal; turning it off clears any captured goal.
   */
  setDebugMode(enabled) {
    this._debugMode = enabled;
    if (!enabled) {
      this._debugGoal = null;
      this._debugTurnsSinceReview = 0;
    } else {
      this._planMode = false;
      this._acceptMode = false;
    }
    logger6.info({ enabled }, "Debug mode changed");
  }
  getDebugMode() {
    return this._debugMode;
  }
  /** Read the captured goal (set lazily by the UserPromptSubmit hook). */
  getDebugGoal() {
    return this._debugGoal;
  }
  setCritiqueMode(enabled) {
    this._critiqueMode = enabled;
  }
  getCritiqueMode() {
    return this._critiqueMode;
  }
  async setModel(model) {
    this.model = model;
    if (this.currentQuery) {
      await this.currentQuery.setModel(model);
      logger6.info({ model }, "Model updated mid-session via Query.setModel()");
    }
  }
  getModel() {
    return this.model ?? "sonnet";
  }
  /**
   * Get the current SDK session ID
   * This is captured from the system:init message when the session starts
   */
  getCurrentSessionId() {
    return this._currentSessionId;
  }
};

// src/events.ts
var Disposable = class {
  _isDisposed = false;
  _disposables = [];
  get isDisposed() {
    return this._isDisposed;
  }
  /**
   * Register a disposable to be cleaned up when this object is disposed
   */
  _register(disposable) {
    this._disposables.push(disposable);
    return disposable;
  }
  /**
   * Dispose all registered disposables
   */
  dispose() {
    if (this._isDisposed) {
      return;
    }
    this._isDisposed = true;
    for (const d of this._disposables) {
      d.dispose();
    }
    this._disposables = [];
  }
};
var Emitter = class {
  _listeners = /* @__PURE__ */ new Set();
  _disposed = false;
  /**
   * The event that can be subscribed to
   */
  event = (listener) => {
    if (this._disposed) {
      return {
        dispose: () => {
        }
      };
    }
    this._listeners.add(listener);
    return {
      dispose: () => {
        this._listeners.delete(listener);
      }
    };
  };
  /**
   * Fire the event with a value
   */
  fire(event) {
    if (this._disposed) {
      return;
    }
    for (const listener of this._listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error("[Emitter] Error in event listener:", error);
      }
    }
  }
  /**
   * Dispose the emitter and clear all listeners
   */
  dispose() {
    this._disposed = true;
    this._listeners.clear();
  }
};

// src/session-manager.ts
var logger7 = createLogger("SessionManager");
var LEDGER_DIR = join7(homedir5(), ".solo", "agent-ledger");
var PROVIDER_CAPABILITIES = {
  anthropic: { chat: true, agent: true, tools: true, mcp: true, resume: true },
  openai: { chat: true, agent: true, tools: true, mcp: true, resume: true },
  google: { chat: true, agent: true, tools: true, mcp: true, resume: true },
  gemini: { chat: true, agent: true, tools: true, mcp: true, resume: true }
};
function configHash(config) {
  return createHash("sha256").update(JSON.stringify(config ?? {})).digest("hex").slice(0, 16);
}
function isToolResultBlock2(block) {
  if (typeof block !== "object" || block === null) {
    return false;
  }
  const obj = block;
  return obj.type === "tool_result" && typeof obj.tool_use_id === "string";
}
function getString(value, fallback = "") {
  return typeof value === "string" ? value : fallback;
}
function generateToolId() {
  return `tool_${String(Date.now())}_${Math.random().toString(36).substring(2, 11)}`;
}
var SessionManager = class extends Disposable {
  // Event emitters
  _onError = this._register(new Emitter());
  onError = this._onError.event;
  _onPermissionRequest = this._register(new Emitter());
  onPermissionRequest = this._onPermissionRequest.event;
  _onAgentMessage = this._register(
    new Emitter()
  );
  onAgentMessage = this._onAgentMessage.event;
  _onPlanModeChanged = this._register(
    new Emitter()
  );
  onPlanModeChanged = this._onPlanModeChanged.event;
  _onAcceptModeChanged = this._register(
    new Emitter()
  );
  onAcceptModeChanged = this._onAcceptModeChanged.event;
  _onDebugModeChanged = this._register(
    new Emitter()
  );
  onDebugModeChanged = this._onDebugModeChanged.event;
  _onSessionGoalCaptured = this._register(
    new Emitter()
  );
  onSessionGoalCaptured = this._onSessionGoalCaptured.event;
  _onSessionInit = this._register(new Emitter());
  onSessionInit = this._onSessionInit.event;
  _onTurnStart = this._register(
    new Emitter()
  );
  onTurnStart = this._onTurnStart.event;
  // Session tracking
  activeSessions = /* @__PURE__ */ new Map();
  /**
   * Parallel map of non-Anthropic provider sessions, keyed by sessionId. These
   * do NOT share state with the Anthropic `activeSessions` map.
   */
  openAISessions = /* @__PURE__ */ new Map();
  sessionConsumers = /* @__PURE__ */ new Map();
  permissionResolvers = /* @__PURE__ */ new Map();
  /**
   * Per-session map of pending permission requestIds → the tool call that
   * triggered them. Stores the tool name + input so `drainPendingPermissions`
   * can re-run the pipeline against each pending prompt under the new mode
   * — we only auto-resolve prompts whose new decision actually differs
   * (Accept + pipeline→allow, or Plan + pipeline→deny), leaving destructive
   * and ask-ruled prompts in place so the user still sees them.
   */
  pendingRequestsBySession = /* @__PURE__ */ new Map();
  modePreferences = /* @__PURE__ */ new Map();
  /** Last observed goal per session — used to debounce SessionGoalCaptured emissions. */
  sessionGoals = /* @__PURE__ */ new Map();
  /** Polls active agents for a newly-captured Debug goal, emits the event once. */
  goalPollers = /* @__PURE__ */ new Map();
  sessionResumeState = /* @__PURE__ */ new Map();
  sessionInitFired = /* @__PURE__ */ new Set();
  sessionTurns = /* @__PURE__ */ new Map();
  sessionSdkIds = /* @__PURE__ */ new Map();
  sessionConfigHashes = /* @__PURE__ */ new Map();
  /**
   * Per-session tool use maps — shared between the background consumer
   * and the permission callback so the callback can look up the correct
   * toolId when emitting 'running' status.
   */
  sessionToolUseMaps = /* @__PURE__ */ new Map();
  // ==========================================================================
  // Session Lifecycle
  // ==========================================================================
  appendLedger(sessionId, entry) {
    try {
      mkdirSync2(LEDGER_DIR, { recursive: true });
      appendFileSync(
        join7(LEDGER_DIR, `${sessionId}.jsonl`),
        `${JSON.stringify({
          ts: (/* @__PURE__ */ new Date()).toISOString(),
          sessionId,
          configHash: this.sessionConfigHashes.get(sessionId),
          ...entry
        })}
`
      );
    } catch (error) {
      logger7.warn({ sessionId, error: String(error) }, "Failed to append agent ledger");
    }
  }
  emitAgentMessage(sessionId, message) {
    const enriched = {
      ...message,
      eventId: message.eventId ?? randomUUID2(),
      turnNumber: message.turnNumber ?? this.sessionTurns.get(sessionId),
      sdkSessionId: message.sdkSessionId ?? this.sessionSdkIds.get(sessionId)
    };
    this.appendLedger(sessionId, { type: "agent_message", message: enriched });
    this._onAgentMessage.fire({ sessionId, message: enriched });
  }
  emitSessionInit(event) {
    this.sessionSdkIds.set(event.sessionId, event.sdkSessionId);
    this.appendLedger(event.sessionId, { type: "session_init", event });
    this._onSessionInit.fire(event);
  }
  emitTurnStart(sessionId) {
    const turnNumber = (this.sessionTurns.get(sessionId) ?? 0) + 1;
    this.sessionTurns.set(sessionId, turnNumber);
    this.appendLedger(sessionId, { type: "turn_start", turnNumber });
    this._onTurnStart.fire({ sessionId, turnNumber });
    this.emitAgentMessage(sessionId, {
      type: "turn_start",
      content: `Turn ${turnNumber} started`,
      turnNumber
    });
    return turnNumber;
  }
  /**
   * Create a new agent session
   */
  async createSession(sessionId, config) {
    if (this.activeSessions.has(sessionId) || this.openAISessions.has(sessionId)) {
      return;
    }
    const provider = config?.provider ?? "anthropic";
    const sessionMode = config?.sessionMode ?? "agent";
    const capabilities = config?.providerCapabilities ?? PROVIDER_CAPABILITIES[provider];
    this.sessionConfigHashes.set(sessionId, configHash({ ...config, provider, sessionMode }));
    this.appendLedger(sessionId, {
      type: "session_create",
      provider,
      sessionMode,
      capabilities,
      cwd: config?.cwd,
      model: config?.model,
      resumeSessionId: config?.resumeSessionId
    });
    if (sessionMode === "agent" && !capabilities.agent) {
      throw new Error(
        `${provider} does not support Solo agent-mode sessions. Select a model with tool-running support.`
      );
    }
    if (provider === "openai") {
      if (!config?.credentials) {
        throw new Error(
          "OpenAI session requires credentials \u2014 Rust side must pass them via SessionConfig.credentials"
        );
      }
      if (!config?.model) {
        throw new Error("OpenAI session requires a model");
      }
      const { createOpenAISession } = await import("./openai-PM43ACSB.js");
      const openaiSession = await createOpenAISession({
        model: config.model,
        credentials: config.credentials,
        maxTokens: config.maxTokens,
        thinkingEnabled: config.thinkingEnabled,
        agentMode: sessionMode === "agent",
        cwd: config.cwd,
        resumeSessionId: config.resumeSessionId,
        forkSession: config.forkSession
      });
      this.openAISessions.set(sessionId, openaiSession);
      this.sessionToolUseMaps.set(sessionId, /* @__PURE__ */ new Map());
      this.sessionResumeState.set(sessionId, {
        isResumed: !!config.resumeSessionId,
        isForked: !!config.forkSession
      });
      if (sessionMode !== "agent") {
        this.emitSessionInit({
          sessionId,
          sdkSessionId: sessionId,
          isResumed: false,
          isForked: false
        });
      }
      return;
    }
    if (provider === "google" || provider === "gemini") {
      if (!config?.credentials && sessionMode !== "agent") {
        throw new Error(
          "Gemini session requires credentials \u2014 Rust side must pass them via SessionConfig.credentials"
        );
      }
      if (!config?.model) {
        throw new Error("Gemini session requires a model");
      }
      const { createGeminiSession } = await import("./gemini-MBZWSO6P.js");
      const geminiSession = await createGeminiSession({
        model: config.model,
        credentials: config.credentials,
        maxTokens: config.maxTokens,
        agentMode: sessionMode === "agent",
        cwd: config.cwd,
        resumeSessionId: config.resumeSessionId,
        forkSession: config.forkSession,
        mcpServers: config.mcpServers
      });
      this.openAISessions.set(sessionId, geminiSession);
      this.sessionToolUseMaps.set(sessionId, /* @__PURE__ */ new Map());
      this.sessionResumeState.set(sessionId, {
        isResumed: !!config.resumeSessionId,
        isForked: !!config.forkSession
      });
      if (sessionMode !== "agent") {
        this.emitSessionInit({
          sessionId,
          sdkSessionId: sessionId,
          isResumed: false,
          isForked: false
        });
      }
      return;
    }
    const toolUseMap = /* @__PURE__ */ new Map();
    this.sessionToolUseMaps.set(sessionId, toolUseMap);
    const permissionCallback = async (toolName, toolInput, _context) => {
      const requestId = randomUUID2();
      let pendingForSession = this.pendingRequestsBySession.get(sessionId);
      if (!pendingForSession) {
        pendingForSession = /* @__PURE__ */ new Map();
        this.pendingRequestsBySession.set(sessionId, pendingForSession);
      }
      pendingForSession.set(requestId, { toolName, toolInput });
      this._onPermissionRequest.fire({
        sessionId,
        toolName,
        toolInput,
        requestId
      });
      const result = await new Promise((resolve2) => {
        this.permissionResolvers.set(requestId, resolve2);
      });
      pendingForSession.delete(requestId);
      if (pendingForSession.size === 0) {
        this.pendingRequestsBySession.delete(sessionId);
      }
      if (result.decision === "approve") {
        if (toolName === "ExitPlanMode") {
          agent.setPlanMode(false);
          const prefs = this.modePreferences.get(sessionId) ?? {};
          prefs.planEnabled = false;
          this.modePreferences.set(sessionId, prefs);
          this._onPlanModeChanged.fire({ sessionId, enabled: false, planFilePath: null });
        }
        const sessionMap = this.sessionToolUseMaps.get(sessionId);
        if (sessionMap) {
          for (const [toolId, entry] of sessionMap) {
            if (entry.name === toolName && !entry.permissionResolved) {
              entry.permissionResolved = true;
              this.emitAgentMessage(sessionId, {
                type: "tool_use",
                content: `Tool ${toolName} running`,
                metadata: {
                  toolName,
                  toolId,
                  toolInput: entry.input,
                  status: "running"
                }
              });
              break;
            }
          }
        }
      }
      return result;
    };
    const storedPrefs = this.modePreferences.get(sessionId);
    const finalConfig = {
      thinkingEnabled: storedPrefs?.thinkingEnabled ?? config?.thinkingEnabled ?? false,
      maxThinkingTokens: storedPrefs?.maxThinkingTokens ?? config?.maxThinkingTokens,
      planEnabled: storedPrefs?.planEnabled ?? config?.planEnabled ?? false,
      acceptEnabled: storedPrefs?.acceptEnabled ?? config?.acceptEnabled ?? false,
      debugEnabled: storedPrefs?.debugEnabled ?? false,
      critiqueEnabled: storedPrefs?.critiqueEnabled ?? config?.critiqueEnabled ?? false,
      model: storedPrefs?.model ?? config?.model,
      maxTokens: storedPrefs?.maxTokens ?? config?.maxTokens,
      allowedTools: config?.allowedTools,
      selectedSkills: config?.selectedSkills,
      mcpServers: config?.mcpServers,
      outputFormat: config?.outputFormat,
      agents: config?.agents,
      vaultAuth: config?.vaultAuth,
      toolPolicy: config?.toolPolicy,
      permissionMode: config?.permissionMode,
      cwd: config?.cwd,
      sessionMode,
      permissionRequestCallback: permissionCallback,
      resumeSessionId: config?.resumeSessionId,
      forkSession: config?.forkSession
    };
    logger7.info({ sessionId, sessionMode: finalConfig.sessionMode }, "Creating session");
    const agent = new OrbitAgent(finalConfig);
    this.sessionResumeState.set(sessionId, {
      isResumed: !!config?.resumeSessionId,
      isForked: !!config?.forkSession
    });
    this.activeSessions.set(sessionId, agent);
    try {
      await agent.startSession();
      logger7.info({ sessionId }, "Session started successfully");
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger7.error({ sessionId, error: errorMessage }, "Failed to start session");
      throw error;
    }
    this._startBackgroundConsumer(sessionId, agent);
  }
  /**
   * Start a background consumer for streaming messages.
   */
  _startBackgroundConsumer(sessionId, agent) {
    const state = { cancelled: false };
    const cancel = () => {
      state.cancelled = true;
    };
    this.sessionConsumers.set(sessionId, { cancel });
    void (async () => {
      try {
        const toolUseMap = this.sessionToolUseMaps.get(sessionId);
        let streamedTextForAssistant = "";
        for await (const rawMessage of agent.receiveResponse()) {
          if (state.cancelled) {
            break;
          }
          const sdkMessage = rawMessage;
          if (sdkMessage.type === "system") {
            logger7.debug({ sessionId, subtype: sdkMessage.subtype }, "SDK system message");
            if (sdkMessage.subtype === "init" && sdkMessage.session_id !== void 0) {
              if (this.sessionInitFired.has(sessionId)) {
                continue;
              }
              this.sessionInitFired.add(sessionId);
              const resumeState = this.sessionResumeState.get(sessionId) ?? {
                isResumed: false,
                isForked: false
              };
              this.emitSessionInit({
                sessionId,
                sdkSessionId: sdkMessage.session_id,
                isResumed: resumeState.isResumed,
                isForked: resumeState.isForked
              });
            }
            continue;
          }
          if (sdkMessage.type === "stream_event") {
            const event = sdkMessage.event;
            if (event === void 0) continue;
            if (event.type === "content_block_delta") {
              const deltaType = event.delta?.type;
              if (deltaType === "text_delta") {
                const textDelta = event.delta?.text;
                if (textDelta !== void 0) {
                  streamedTextForAssistant += textDelta;
                  this.emitAgentMessage(sessionId, { type: "text", content: textDelta });
                }
              } else if (deltaType === "thinking_delta") {
                const thinkingDelta = event.delta?.thinking;
                if (thinkingDelta !== void 0) {
                  this.emitAgentMessage(sessionId, { type: "thinking", content: thinkingDelta });
                }
              }
            }
            continue;
          }
          if (sdkMessage.type === "assistant") {
            const content = sdkMessage.message?.content;
            if (content === void 0) continue;
            const assistantText = content.filter((block) => block.type === "text").map((block) => block.text ?? "").join("");
            if (assistantText !== "") {
              if (streamedTextForAssistant === "") {
                this.emitAgentMessage(sessionId, { type: "text", content: assistantText });
              } else if (assistantText.startsWith(streamedTextForAssistant)) {
                const missingTail = assistantText.slice(streamedTextForAssistant.length);
                if (missingTail !== "") {
                  this.emitAgentMessage(sessionId, { type: "text", content: missingTail });
                }
              }
            }
            for (const block of content) {
              if (block.type === "text") {
                continue;
              }
              if (block.type === "thinking") {
                this.emitAgentMessage(sessionId, {
                  type: "thinking",
                  content: block.thinking ?? ""
                });
                continue;
              }
              const toolName = getString(block.name, "unknown");
              const toolId = getString(block.id) || generateToolId();
              const toolInput = block.input ?? {};
              logger7.info({ sessionId, toolName, toolId }, "Tool use block received");
              const previewed = agent.previewPermission(
                toolName,
                toolInput
              );
              const initialStatus = previewed === "ask" ? "awaiting-permission" : "running";
              logger7.debug(
                { sessionId, toolName, previewed, initialStatus },
                "Initial tool_use status resolved from preview"
              );
              const toolMessage = {
                type: "tool_use",
                content: `Using tool: ${toolName}`,
                metadata: {
                  toolName,
                  toolId,
                  toolInput,
                  status: initialStatus
                }
              };
              toolUseMap.set(toolId, {
                name: toolName,
                input: toolInput,
                permissionResolved: false
              });
              this.emitAgentMessage(sessionId, toolMessage);
            }
            streamedTextForAssistant = "";
          } else if (sdkMessage.type === "user") {
            const content = sdkMessage.message?.content;
            if (!Array.isArray(content)) continue;
            for (const block of content) {
              if (isToolResultBlock2(block)) {
                const toolUseId = block.tool_use_id;
                const toolInfo = toolUseMap.get(toolUseId);
                if (toolInfo !== void 0) {
                  const toolOutput = typeof block.content === "string" ? block.content : JSON.stringify(block.content);
                  const isError = block.is_error === true;
                  logger7.info(
                    {
                      sessionId,
                      toolName: toolInfo.name,
                      toolId: toolUseId,
                      isError,
                      outputLength: toolOutput.length
                    },
                    "Tool result received"
                  );
                  this.emitAgentMessage(sessionId, {
                    type: "tool_result",
                    content: isError ? `Tool ${toolInfo.name} failed` : `Tool ${toolInfo.name} completed`,
                    metadata: {
                      toolName: toolInfo.name,
                      toolId: toolUseId,
                      toolInput: toolInfo.input,
                      toolOutput,
                      status: isError ? "error" : "success"
                    }
                  });
                  toolUseMap.delete(toolUseId);
                }
              }
            }
          } else if (sdkMessage.type === "result") {
            const resultMsg = sdkMessage;
            if (resultMsg.usage !== void 0) {
              logger7.info(
                {
                  sessionId,
                  inputTokens: resultMsg.usage.input_tokens,
                  outputTokens: resultMsg.usage.output_tokens,
                  cacheRead: resultMsg.usage.cache_read_input_tokens
                },
                "Turn complete \u2014 token usage"
              );
            }
            this.emitAgentMessage(sessionId, {
              type: "result",
              content: resultMsg.subtype === "error_max_structured_output_retries" ? "Failed to produce valid structured output" : "Turn complete",
              usage: resultMsg.usage !== void 0 ? {
                inputTokens: resultMsg.usage.input_tokens ?? 0,
                outputTokens: resultMsg.usage.output_tokens ?? 0,
                cacheReadInputTokens: resultMsg.usage.cache_read_input_tokens,
                cacheCreationInputTokens: resultMsg.usage.cache_creation_input_tokens
              } : void 0,
              totalCostUsd: resultMsg.total_cost_usd,
              durationMs: resultMsg.duration_ms,
              structuredOutput: resultMsg.structured_output,
              resultSubtype: resultMsg.subtype
            });
            setCorrelationId(void 0);
          } else {
            logger7.debug(
              { sessionId, messageType: rawMessage.type },
              "Ignoring non-result SDK message"
            );
          }
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : "no stack";
        logger7.error({ sessionId, error: errorMessage }, "Background consumer error");
        this._onError.fire({ message: `[SDK Error] ${errorMessage}`, stack: errorStack });
      }
    })();
  }
  /**
   * Delete a session
   */
  async deleteSession(sessionId) {
    const openaiSession = this.openAISessions.get(sessionId);
    if (openaiSession) {
      await openaiSession.close();
      this.openAISessions.delete(sessionId);
      this.sessionToolUseMaps.delete(sessionId);
      this.sessionResumeState.delete(sessionId);
      this.sessionInitFired.delete(sessionId);
      this.sessionTurns.delete(sessionId);
      this.sessionSdkIds.delete(sessionId);
      this.sessionConfigHashes.delete(sessionId);
      return;
    }
    const consumer = this.sessionConsumers.get(sessionId);
    if (consumer) {
      consumer.cancel();
      this.sessionConsumers.delete(sessionId);
    }
    const agent = this.activeSessions.get(sessionId);
    if (agent) {
      await agent.stopSession();
      this.activeSessions.delete(sessionId);
    }
    this.sessionToolUseMaps.delete(sessionId);
    this.sessionResumeState.delete(sessionId);
    this.sessionInitFired.delete(sessionId);
    this.sessionTurns.delete(sessionId);
    this.sessionSdkIds.delete(sessionId);
    this.sessionConfigHashes.delete(sessionId);
  }
  /**
   * Check if a session is ready
   */
  isSessionReady(sessionId) {
    if (this.openAISessions.has(sessionId)) return true;
    const agent = this.activeSessions.get(sessionId);
    return agent?.isSessionReady() ?? false;
  }
  /**
   * Interrupt a session
   */
  async interrupt(sessionId) {
    const openaiSession = this.openAISessions.get(sessionId);
    if (openaiSession) {
      await openaiSession.interrupt();
      return;
    }
    const agent = this.activeSessions.get(sessionId);
    if (!agent) {
      throw new Error(`Session ${sessionId} not found`);
    }
    await agent.interrupt();
  }
  /**
   * Get the SDK session ID for a session
   */
  getSDKSessionId(sessionId) {
    if (this.openAISessions.has(sessionId)) return this.sessionSdkIds.get(sessionId) ?? sessionId;
    const agent = this.activeSessions.get(sessionId);
    return agent?.getCurrentSessionId();
  }
  /**
   * Send a message to a session
   */
  sendMessage(message, sessionId, attachments, vaultAuth) {
    const openaiSession = this.openAISessions.get(sessionId);
    if (openaiSession) {
      this.emitTurnStart(sessionId);
      openaiSession.sendMessage(message, attachments);
      void this.runChatProviderLoop(sessionId, openaiSession);
      return;
    }
    const agent = this.activeSessions.get(sessionId);
    if (agent === void 0) {
      throw new Error(`Session ${sessionId} not found. Call createSession() first.`);
    }
    if (!agent.isSessionReady()) {
      throw new Error(`Session ${sessionId} is not ready.`);
    }
    const correlationId = randomUUID2();
    setCorrelationId(correlationId);
    this.emitTurnStart(sessionId);
    logger7.info(
      {
        sessionId,
        correlationId: correlationId.slice(0, 8),
        messagePreview: message.slice(0, 100) + (message.length > 100 ? "..." : ""),
        attachmentCount: attachments?.length ?? 0
      },
      "Sending message"
    );
    void agent.queueMessage(message, attachments, vaultAuth).catch((err) => {
      logger7.warn({ sessionId, err: String(err) }, "Failed to queue message with vault context");
      try {
        agent.queueMessage(message, attachments).catch((fallbackErr) => {
          logger7.error({ sessionId, err: String(fallbackErr) }, "Failed to queue fallback message");
        });
      } catch (fallbackErr) {
        logger7.error({ sessionId, err: String(fallbackErr) }, "Failed to queue fallback message");
      }
    });
  }
  /**
   * Respond to a permission request
   */
  respondToPermission(response) {
    const resolver = this.permissionResolvers.get(response.requestId);
    if (resolver) {
      resolver({
        decision: response.decision,
        always: response.always,
        answers: response.answers
      });
      this.permissionResolvers.delete(response.requestId);
    }
  }
  /**
   * Set thinking mode for a session
   */
  async setThinkingMode(sessionId, enabled, maxTokens) {
    if (this.openAISessions.has(sessionId)) {
      const prefs2 = this.modePreferences.get(sessionId) ?? {};
      prefs2.thinkingEnabled = enabled;
      prefs2.maxThinkingTokens = maxTokens;
      this.modePreferences.set(sessionId, prefs2);
      return;
    }
    const agent = this.activeSessions.get(sessionId);
    if (!agent) {
      const prefs2 = this.modePreferences.get(sessionId) ?? {};
      prefs2.thinkingEnabled = enabled;
      prefs2.maxThinkingTokens = maxTokens;
      this.modePreferences.set(sessionId, prefs2);
      return;
    }
    await agent.setThinkingMode(enabled, maxTokens);
    const prefs = this.modePreferences.get(sessionId) ?? {};
    prefs.thinkingEnabled = enabled;
    prefs.maxThinkingTokens = maxTokens;
    this.modePreferences.set(sessionId, prefs);
  }
  /**
   * Get thinking mode for a session
   */
  getThinkingMode(sessionId) {
    if (this.openAISessions.has(sessionId)) {
      return this.modePreferences.get(sessionId)?.thinkingEnabled ?? false;
    }
    const agent = this.activeSessions.get(sessionId);
    if (agent === void 0) {
      const prefs = this.modePreferences.get(sessionId);
      return prefs?.thinkingEnabled ?? false;
    }
    return agent.getThinkingMode();
  }
  /**
   * Set model for a session
   */
  async setModel(sessionId, model) {
    const openaiSession = this.openAISessions.get(sessionId);
    if (openaiSession) {
      if (openaiSession.setModel) {
        await openaiSession.setModel(model);
      }
      const prefs2 = this.modePreferences.get(sessionId) ?? {};
      prefs2.model = model;
      this.modePreferences.set(sessionId, prefs2);
      return;
    }
    const agent = this.activeSessions.get(sessionId);
    if (!agent) {
      const prefs2 = this.modePreferences.get(sessionId) ?? {};
      prefs2.model = model;
      this.modePreferences.set(sessionId, prefs2);
      return;
    }
    await agent.setModel(model);
    const prefs = this.modePreferences.get(sessionId) ?? {};
    prefs.model = model;
    this.modePreferences.set(sessionId, prefs);
  }
  /**
   * Re-evaluate every pending permission prompt for a session under the
   * CURRENT mode and auto-resolve any whose decision would now differ.
   *
   * Called when the user toggles a mode mid-turn (Plan / Accept). The
   * pipeline is run via `agent.previewPermission(...)` so destructive /
   * ask-ruled / deny-ruled prompts are preserved (they remain bypass-immune
   * even under Accept) — only prompts whose fresh decision is `allow` get
   * auto-approved, and only prompts whose fresh decision is `deny` get
   * auto-denied. Everything else stays on-screen for the user to resolve.
   *
   * Mirrors Claude Code's semantic: pending prompts re-read the current
   * mode via `getAppState()` and behave accordingly.
   */
  reevaluatePendingPermissions(sessionId) {
    const pending = this.pendingRequestsBySession.get(sessionId);
    if (!pending || pending.size === 0) return;
    const agent = this.activeSessions.get(sessionId);
    if (!agent) return;
    const toDrain = [];
    for (const [requestId, { toolName, toolInput }] of pending) {
      const preview = agent.previewPermission(toolName, toolInput);
      if (preview === "allow") {
        toDrain.push({ requestId, decision: "approve" });
      } else if (preview === "deny") {
        toDrain.push({ requestId, decision: "deny" });
      }
    }
    if (toDrain.length === 0) return;
    logger7.info(
      { sessionId, drained: toDrain.length, pendingTotal: pending.size },
      "Re-evaluated pending permission prompts after mode change"
    );
    for (const { requestId, decision } of toDrain) {
      const resolver = this.permissionResolvers.get(requestId);
      if (resolver) {
        this.permissionResolvers.delete(requestId);
        resolver({ decision, always: false });
      }
      pending.delete(requestId);
    }
    if (pending.size === 0) {
      this.pendingRequestsBySession.delete(sessionId);
    }
  }
  /**
   * Set plan mode for a session
   */
  setPlanMode(sessionId, enabled) {
    if (this.openAISessions.has(sessionId)) {
      logger7.warn({ sessionId, method: "setPlanMode" }, "not supported on provider sessions");
      return;
    }
    const agent = this.activeSessions.get(sessionId);
    if (agent === void 0) {
      const prefs2 = this.modePreferences.get(sessionId) ?? {};
      prefs2.planEnabled = enabled;
      this.modePreferences.set(sessionId, prefs2);
      this._onPlanModeChanged.fire({ sessionId, enabled, planFilePath: null });
      return;
    }
    agent.setPlanMode(enabled);
    const planFilePath = agent.getPlanFilePath();
    const prefs = this.modePreferences.get(sessionId) ?? {};
    prefs.planEnabled = enabled;
    this.modePreferences.set(sessionId, prefs);
    this._onPlanModeChanged.fire({ sessionId, enabled, planFilePath });
    this.reevaluatePendingPermissions(sessionId);
  }
  /**
   * Get plan mode for a session
   */
  getPlanMode(sessionId) {
    if (this.openAISessions.has(sessionId)) return false;
    const agent = this.activeSessions.get(sessionId);
    if (agent === void 0) {
      const prefs = this.modePreferences.get(sessionId);
      return prefs?.planEnabled ?? false;
    }
    return agent.getPlanMode();
  }
  /**
   * Set accept mode for a session
   */
  setAcceptMode(sessionId, enabled) {
    if (this.openAISessions.has(sessionId)) {
      logger7.warn({ sessionId, method: "setAcceptMode" }, "not supported on provider sessions");
      return;
    }
    const agent = this.activeSessions.get(sessionId);
    if (!agent) {
      const prefs2 = this.modePreferences.get(sessionId) ?? {};
      prefs2.acceptEnabled = enabled;
      this.modePreferences.set(sessionId, prefs2);
      this._onAcceptModeChanged.fire({ sessionId, enabled });
      return;
    }
    agent.setAcceptMode(enabled);
    const prefs = this.modePreferences.get(sessionId) ?? {};
    prefs.acceptEnabled = enabled;
    this.modePreferences.set(sessionId, prefs);
    this._onAcceptModeChanged.fire({ sessionId, enabled });
    this.reevaluatePendingPermissions(sessionId);
  }
  /**
   * Get accept mode for a session
   */
  getAcceptMode(sessionId) {
    if (this.openAISessions.has(sessionId)) return false;
    const agent = this.activeSessions.get(sessionId);
    if (agent === void 0) {
      const prefs = this.modePreferences.get(sessionId);
      return prefs?.acceptEnabled ?? false;
    }
    return agent.getAcceptMode();
  }
  /**
   * Enable/disable Debug mode. When enabled, the first user prompt after
   * this call is captured as the session goal; a `sessionGoalCaptured` event
   * is emitted so the UI can pin the goal.
   */
  setDebugMode(sessionId, enabled) {
    if (this.openAISessions.has(sessionId)) {
      logger7.warn({ sessionId, method: "setDebugMode" }, "not supported on provider sessions");
      return;
    }
    const agent = this.activeSessions.get(sessionId);
    if (!agent) {
      const prefs2 = this.modePreferences.get(sessionId) ?? {};
      prefs2.debugEnabled = enabled;
      this.modePreferences.set(sessionId, prefs2);
      this._onDebugModeChanged.fire({ sessionId, enabled });
      return;
    }
    agent.setDebugMode(enabled);
    const prefs = this.modePreferences.get(sessionId) ?? {};
    prefs.debugEnabled = enabled;
    this.modePreferences.set(sessionId, prefs);
    this._onDebugModeChanged.fire({ sessionId, enabled });
    if (enabled) {
      this.startGoalPoller(sessionId);
    } else {
      this.stopGoalPoller(sessionId);
      this.sessionGoals.delete(sessionId);
    }
  }
  /** @internal */
  startGoalPoller(sessionId) {
    this.stopGoalPoller(sessionId);
    const tick = () => {
      const agent = this.activeSessions.get(sessionId);
      if (!agent) {
        this.stopGoalPoller(sessionId);
        return;
      }
      const goal = agent.getDebugGoal();
      if (goal && this.sessionGoals.get(sessionId) !== goal) {
        this.sessionGoals.set(sessionId, goal);
        this._onSessionGoalCaptured.fire({
          sessionId,
          goal,
          capturedAt: Date.now()
        });
        this.stopGoalPoller(sessionId);
      }
    };
    const handle = setInterval(tick, 500);
    this.goalPollers.set(sessionId, handle);
  }
  /** @internal */
  stopGoalPoller(sessionId) {
    const handle = this.goalPollers.get(sessionId);
    if (handle) {
      clearInterval(handle);
      this.goalPollers.delete(sessionId);
    }
  }
  /** Get Debug mode for a session. */
  getDebugMode(sessionId) {
    if (this.openAISessions.has(sessionId)) return false;
    const agent = this.activeSessions.get(sessionId);
    if (agent === void 0) {
      const prefs = this.modePreferences.get(sessionId);
      return prefs?.debugEnabled ?? false;
    }
    return agent.getDebugMode();
  }
  /**
   * Set tool permission policy for a session.
   * - 'approve-all': enable accept mode, which auto-approves file edits only
   * - 'smart': auto-approve read-only tools, prompt for writes
   * - 'ask-all': prompt for every tool (default)
   */
  setToolPolicy(sessionId, mode, _isWorktreeSession) {
    if (this.openAISessions.has(sessionId)) {
      logger7.warn({ sessionId, method: "setToolPolicy" }, "not supported on provider sessions");
      return;
    }
    const agent = this.activeSessions.get(sessionId);
    if (mode === "approve-all") {
      this.setAcceptMode(sessionId, true);
      return;
    }
    if (agent) {
      agent.setAcceptMode(false);
    }
    if (mode === "smart" && agent) {
      const readOnlyTools = [
        "Read",
        "Glob",
        "Grep",
        "WebSearch",
        "WebFetch",
        "mcp__vault__vault_search",
        "mcp__solo_skills__skill_list",
        "mcp__solo_skills__skill_read"
      ];
      const pm = agent.getPermissionManager();
      for (const tool3 of readOnlyTools) {
        pm.addAlwaysAllowed(tool3);
      }
    }
  }
  /**
   * Drive a non-Anthropic provider session's receiveResponse() loop and emit
   * AgentMessage events through the same channel the Anthropic path uses.
   */
  async runChatProviderLoop(sessionId, session) {
    let lastUsage;
    let toolUseMap = this.sessionToolUseMaps.get(sessionId);
    if (!toolUseMap) {
      toolUseMap = /* @__PURE__ */ new Map();
      this.sessionToolUseMaps.set(sessionId, toolUseMap);
    }
    try {
      for await (const ev of session.receiveResponse()) {
        switch (ev.type) {
          case "session_init":
            this.emitSessionInit({
              sessionId,
              sdkSessionId: ev.sdkSessionId,
              isResumed: ev.isResumed,
              isForked: ev.isForked
            });
            break;
          case "text_delta":
            this.emitAgentMessage(sessionId, {
              type: "text",
              content: ev.text
            });
            break;
          case "thinking_delta":
            this.emitAgentMessage(sessionId, {
              type: "thinking",
              content: ev.text
            });
            break;
          case "tool_call":
            toolUseMap.set(ev.id, {
              name: ev.name,
              input: ev.input,
              permissionResolved: true
            });
            this.emitAgentMessage(sessionId, {
              type: "tool_use",
              content: `Using tool: ${ev.name}`,
              metadata: {
                toolName: ev.name,
                toolId: ev.id,
                toolInput: ev.input,
                status: "running"
              }
            });
            break;
          case "tool_result": {
            const toolInfo = toolUseMap.get(ev.toolCallId);
            const toolName = toolInfo?.name ?? "unknown";
            const toolInput = toolInfo?.input ?? {};
            this.emitAgentMessage(sessionId, {
              type: "tool_result",
              content: ev.isError ? `Tool ${toolName} failed` : `Tool ${toolName} completed`,
              metadata: {
                toolName,
                toolId: ev.toolCallId,
                toolInput,
                toolOutput: ev.output,
                status: ev.isError ? "error" : "success"
              }
            });
            toolUseMap.delete(ev.toolCallId);
            break;
          }
          case "usage":
            lastUsage = {
              inputTokens: ev.inputTokens,
              outputTokens: ev.outputTokens,
              cacheReadInputTokens: ev.cacheReadInputTokens,
              cacheCreationInputTokens: ev.cacheCreationInputTokens
            };
            break;
          case "done":
            this.emitAgentMessage(sessionId, {
              type: "result",
              content: "Turn complete",
              usage: lastUsage,
              resultSubtype: ev.stopReason,
              totalCostUsd: ev.totalCostUsd,
              durationMs: ev.durationMs
            });
            lastUsage = void 0;
            break;
          default:
            break;
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.emitAgentMessage(sessionId, { type: "error", content: msg });
    }
  }
  /**
   * Dispose the session manager
   */
  dispose() {
    for (const [, resolver] of this.permissionResolvers.entries()) {
      resolver({ decision: "deny", always: false });
    }
    this.permissionResolvers.clear();
    for (const [, consumer] of this.sessionConsumers.entries()) {
      consumer.cancel();
    }
    this.sessionConsumers.clear();
    for (const [sessionId, agent] of this.activeSessions.entries()) {
      void agent.stopSession().catch((err) => {
        logger7.error({ sessionId, error: err }, "Error stopping session");
      });
    }
    this.activeSessions.clear();
    this.sessionToolUseMaps.clear();
    for (const [sessionId, session] of this.openAISessions.entries()) {
      void session.close().catch((err) => {
        logger7.error({ sessionId, error: err }, "Error closing provider session");
      });
    }
    this.openAISessions.clear();
    super.dispose();
  }
};

// src/commit-message.ts
import Anthropic from "@anthropic-ai/sdk";
var logger8 = createLogger("CommitMessage");
var SYSTEM_PROMPT = `You are a git commit message generator. Given a diff summary, generate a concise commit message following conventional commits format (type: description). Be specific about what changed. Output ONLY the commit message, no explanation.

Rules:
- Use lowercase type prefix: feat, fix, refactor, style, docs, test, chore
- Keep the summary line under 72 characters
- If changes span multiple areas, use the most significant type
- Be specific: "fix: resolve null pointer in user auth flow" not "fix: bug fix"`;
async function generateCommitMessage(diff, apiKey) {
  logger8.info("Generating commit message...");
  let resolvedKey = apiKey;
  if (!resolvedKey) {
    resolvedKey = ClaudeCredentials.getApiKeyFromEnv() ?? void 0;
  }
  if (!resolvedKey) {
    throw new Error("No API key available. Set one in Settings > AI or set ANTHROPIC_API_KEY.");
  }
  const client = new Anthropic({ apiKey: resolvedKey });
  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 300,
    system: SYSTEM_PROMPT,
    messages: [{
      role: "user",
      content: `Generate a commit message for these changes:

${diff}`
    }]
  });
  const text = response.content[0]?.type === "text" ? response.content[0].text.trim() : "";
  logger8.info({ messageLength: text.length }, "Commit message generated");
  return text;
}

// src/refine-transcript.ts
import Anthropic2 from "@anthropic-ai/sdk";
var logger9 = createLogger("RefineTranscript");
var SYSTEM_PROMPT2 = `You are a speech-to-text transcript refiner for a coding IDE. Given a raw voice transcript, clean it up by:
- Fixing obvious transcription errors (homophones, technical terms)
- Correcting casing for proper nouns, programming terms, and file names
- Removing filler words (um, uh, like) and false starts
- Preserving the user's intent and meaning exactly
- Keeping the natural speaking style (do not make it overly formal)

If context from recent chat messages is provided, use it to understand technical terms and proper nouns.

Output ONLY the refined transcript, nothing else. If the transcript is already clean, return it unchanged.`;
async function refineTranscript(transcript, context, apiKey) {
  logger9.info("Refining transcript...");
  let resolvedKey = apiKey;
  if (!resolvedKey) {
    resolvedKey = ClaudeCredentials.getApiKeyFromEnv() ?? void 0;
  }
  if (!resolvedKey) {
    throw new Error("No API key available for transcript refinement.");
  }
  const client = new Anthropic2({ apiKey: resolvedKey });
  let userContent = `Refine this voice transcript:

"${transcript}"`;
  if (context) {
    userContent += `

Recent conversation context:
${context}`;
  }
  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 500,
    system: SYSTEM_PROMPT2,
    messages: [{ role: "user", content: userContent }]
  });
  const text = response.content[0]?.type === "text" ? response.content[0].text.trim() : "";
  logger9.info({ originalLength: transcript.length, refinedLength: text.length }, "Transcript refined");
  return text || transcript;
}

// src/session-title.ts
import Anthropic3 from "@anthropic-ai/sdk";
var logger10 = createLogger("SessionTitle");
var SYSTEM_PROMPT3 = `You are a session title generator. Given a user message and an AI assistant response, generate a concise title that captures the essence of the conversation topic.

Rules:
- Keep the title under 50 characters
- Use title case
- Be specific and descriptive
- Do not use quotes or special formatting
- Do not start with "Help with" or "Question about"
- Output ONLY the title, nothing else`;
async function generateSessionTitle(userMessage, assistantMessage, apiKey) {
  logger10.info("Generating session title...");
  let resolvedKey = apiKey;
  if (!resolvedKey) {
    resolvedKey = ClaudeCredentials.getApiKeyFromEnv() ?? void 0;
  }
  if (!resolvedKey) {
    throw new Error("No API key available. Set one in Settings > AI or set ANTHROPIC_API_KEY.");
  }
  const client = new Anthropic3({ apiKey: resolvedKey });
  const truncatedUser = userMessage.slice(0, 500);
  const truncatedAssistant = assistantMessage.slice(0, 500);
  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 60,
    system: SYSTEM_PROMPT3,
    messages: [{
      role: "user",
      content: `User message:
${truncatedUser}

Assistant response:
${truncatedAssistant}`
    }]
  });
  const text = response.content[0]?.type === "text" ? response.content[0].text.trim() : "";
  logger10.info({ titleLength: text.length }, "Session title generated");
  return text;
}

// src/index.ts
var logger11 = createLogger("AgentBridge");
function sendMessage(message) {
  const json = JSON.stringify(message);
  process.stdout.write(json + "\n");
}
function sendResponse(response) {
  sendMessage(response);
}
function sendEvent(event) {
  sendMessage(event);
}
function main() {
  configureFileLogging();
  logger11.info("Agent Bridge starting...");
  const sessionManager = new SessionManager();
  sessionManager.onAgentMessage((data) => {
    sendEvent({
      type: "agent_message",
      sessionId: data.sessionId,
      message: data.message
    });
  });
  sessionManager.onPermissionRequest((request) => {
    sendEvent({
      type: "permission_request",
      request
    });
  });
  sessionManager.onSessionInit((event) => {
    sendEvent({
      type: "session_init",
      event
    });
  });
  sessionManager.onTurnStart((data) => {
    sendEvent({
      type: "turn_start",
      sessionId: data.sessionId,
      turnNumber: data.turnNumber
    });
  });
  sessionManager.onPlanModeChanged((data) => {
    sendEvent({
      type: "plan_mode_changed",
      sessionId: data.sessionId,
      enabled: data.enabled,
      planFilePath: data.planFilePath
    });
  });
  sessionManager.onAcceptModeChanged((data) => {
    sendEvent({
      type: "accept_mode_changed",
      sessionId: data.sessionId,
      enabled: data.enabled
    });
  });
  sessionManager.onDebugModeChanged((data) => {
    sendEvent({
      type: "debug_mode_changed",
      sessionId: data.sessionId,
      enabled: data.enabled
    });
  });
  sessionManager.onSessionGoalCaptured((data) => {
    sendEvent({
      type: "session_goal_captured",
      sessionId: data.sessionId,
      goal: data.goal,
      capturedAt: data.capturedAt
    });
  });
  sessionManager.onError((error) => {
    sendEvent({
      type: "error_event",
      error
    });
  });
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false
  });
  rl.on("line", (line) => {
    if (!line.trim()) {
      return;
    }
    let request;
    try {
      request = JSON.parse(line);
    } catch (error) {
      logger11.error({ error, line }, "Failed to parse request");
      sendResponse({
        type: "error",
        requestType: "unknown",
        error: `Failed to parse request: ${error instanceof Error ? error.message : String(error)}`
      });
      return;
    }
    logger11.info({ requestType: request.type }, "Received request");
    handleRequest(request, sessionManager).catch((error) => {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger11.error({ requestType: request.type, error: errorMessage }, "Error handling request");
      sendResponse({
        type: "error",
        requestType: request.type,
        error: errorMessage
      });
    });
  });
  rl.on("close", () => {
    logger11.info("stdin closed, shutting down...");
    sessionManager.dispose();
    shutdownFileLogging();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    logger11.info("SIGTERM received, shutting down...");
    sessionManager.dispose();
    shutdownFileLogging();
    process.exit(0);
  });
  process.on("SIGINT", () => {
    logger11.info("SIGINT received, shutting down...");
    sessionManager.dispose();
    shutdownFileLogging();
    process.exit(0);
  });
  sendEvent({ type: "ready" });
  logger11.info("Agent Bridge ready");
}
async function handleRequest(request, sessionManager) {
  switch (request.type) {
    case "create_session": {
      await sessionManager.createSession(request.sessionId, request.config);
      sendResponse({ type: "success", requestType: request.type });
      break;
    }
    case "delete_session": {
      await sessionManager.deleteSession(request.sessionId);
      sendResponse({ type: "success", requestType: request.type });
      break;
    }
    case "send_message": {
      sessionManager.sendMessage(
        request.message,
        request.sessionId,
        request.attachments,
        request.vaultAuth
      );
      sendResponse({ type: "success", requestType: request.type });
      break;
    }
    case "interrupt": {
      await sessionManager.interrupt(request.sessionId);
      sendResponse({ type: "success", requestType: request.type });
      break;
    }
    case "permission_response": {
      sessionManager.respondToPermission(request.response);
      sendResponse({ type: "success", requestType: request.type });
      break;
    }
    case "set_thinking_mode": {
      await sessionManager.setThinkingMode(request.sessionId, request.enabled, request.maxTokens);
      sendResponse({ type: "success", requestType: request.type });
      break;
    }
    case "get_thinking_mode": {
      const enabled = sessionManager.getThinkingMode(request.sessionId);
      sendResponse({ type: "boolean", requestType: request.type, value: enabled });
      break;
    }
    case "set_model": {
      await sessionManager.setModel(request.sessionId, request.model);
      sendResponse({ type: "success", requestType: request.type });
      break;
    }
    case "set_plan_mode": {
      sessionManager.setPlanMode(request.sessionId, request.enabled);
      sendResponse({ type: "success", requestType: request.type });
      break;
    }
    case "get_plan_mode": {
      const enabled = sessionManager.getPlanMode(request.sessionId);
      sendResponse({ type: "boolean", requestType: request.type, value: enabled });
      break;
    }
    case "set_accept_mode": {
      sessionManager.setAcceptMode(request.sessionId, request.enabled);
      sendResponse({ type: "success", requestType: request.type });
      break;
    }
    case "get_accept_mode": {
      const enabled = sessionManager.getAcceptMode(request.sessionId);
      sendResponse({ type: "boolean", requestType: request.type, value: enabled });
      break;
    }
    case "set_debug_mode": {
      sessionManager.setDebugMode(request.sessionId, request.enabled);
      sendResponse({ type: "success", requestType: request.type });
      break;
    }
    case "get_debug_mode": {
      const enabled = sessionManager.getDebugMode(request.sessionId);
      sendResponse({ type: "boolean", requestType: request.type, value: enabled });
      break;
    }
    case "set_tool_policy": {
      sessionManager.setToolPolicy(request.sessionId, request.mode, request.isWorktreeSession);
      sendResponse({ type: "success", requestType: request.type });
      break;
    }
    case "is_session_ready": {
      const ready = sessionManager.isSessionReady(request.sessionId);
      sendResponse({ type: "boolean", requestType: request.type, value: ready });
      break;
    }
    case "get_sdk_session_id": {
      const sdkSessionId = sessionManager.getSDKSessionId(request.sessionId);
      sendResponse({ type: "string", requestType: request.type, value: sdkSessionId ?? null });
      break;
    }
    case "generate_commit_message": {
      const message = await generateCommitMessage(request.diff, request.apiKey);
      sendResponse({ type: "string", requestType: request.type, value: message });
      break;
    }
    case "refine_transcript": {
      const refined = await refineTranscript(request.transcript, request.context, request.apiKey);
      sendResponse({ type: "string", requestType: request.type, value: refined });
      break;
    }
    case "generate_session_title": {
      const title = await generateSessionTitle(request.userMessage, request.assistantMessage, request.apiKey);
      sendResponse({ type: "string", requestType: request.type, value: title });
      break;
    }
    case "shutdown": {
      logger11.info("Shutdown requested");
      sendResponse({ type: "success", requestType: request.type });
      sessionManager.dispose();
      process.exit(0);
      break;
    }
    default: {
      const exhaustiveCheck = request;
      sendResponse({
        type: "error",
        requestType: exhaustiveCheck.type,
        error: `Unknown request type: ${exhaustiveCheck.type}`
      });
    }
  }
}
try {
  main();
} catch (error) {
  logger11.error({ error }, "Fatal error");
  process.exit(1);
}
//# sourceMappingURL=index.js.map