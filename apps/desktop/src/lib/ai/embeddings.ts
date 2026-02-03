/**
 * Embedding Utilities for Semantic Search
 *
 * Frontend utilities for working with the embedding backend.
 * Provides functions for indexing code and performing semantic search.
 */

import { invoke } from '@tauri-apps/api/core';

// =============================================================================
// Types
// =============================================================================

export interface CodeChunk {
	path: string;
	startLine: number;
	endLine: number;
	content: string;
	language?: string;
	symbolName?: string;
}

export interface CodeSearchResult {
	path: string;
	startLine: number;
	endLine: number;
	content: string;
	language?: string;
	symbolName?: string;
	score: number;
}

export interface EmbeddingStats {
	initialized: boolean;
	modelName?: string;
	dimensions?: number;
	indexedChunks: number;
}

export type EmbeddingModel =
	| 'text-embedding-3-small'
	| 'text-embedding-3-large'
	| 'text-embedding-ada-002';

// =============================================================================
// Backend API
// =============================================================================

/**
 * Initialize the embedding provider with an OpenAI API key
 * @param apiKey - OpenAI API key
 * @param model - Embedding model to use (default: text-embedding-3-small)
 */
export async function initEmbeddings(
	apiKey: string,
	model?: EmbeddingModel
): Promise<void> {
	return invoke('embedding_init', { apiKey, model });
}

/**
 * Index code chunks for semantic search
 * @param chunks - Code chunks to index
 * @returns Number of total indexed chunks
 */
export async function indexCode(chunks: CodeChunk[]): Promise<number> {
	const backendChunks = chunks.map((c) => ({
		path: c.path,
		start_line: c.startLine,
		end_line: c.endLine,
		content: c.content,
		language: c.language,
		symbol_name: c.symbolName,
	}));

	return invoke<number>('embedding_index_code', { chunks: backendChunks });
}

/**
 * Search for similar code using semantic search
 * @param query - Search query
 * @param limit - Maximum number of results (default: 10)
 * @returns Array of matching code chunks with similarity scores
 */
export async function searchCode(
	query: string,
	limit?: number
): Promise<CodeSearchResult[]> {
	const results = await invoke<Array<{
		path: string;
		start_line: number;
		end_line: number;
		content: string;
		language: string | null;
		symbol_name: string | null;
		score: number;
	}>>('embedding_search_code', { query, limit });

	return results.map((r) => ({
		path: r.path,
		startLine: r.start_line,
		endLine: r.end_line,
		content: r.content,
		language: r.language ?? undefined,
		symbolName: r.symbol_name ?? undefined,
		score: r.score,
	}));
}

/**
 * Get embedding for a single text
 * @param text - Text to embed
 * @returns Embedding vector
 */
export async function embedText(text: string): Promise<number[]> {
	return invoke<number[]>('embedding_embed_text', { text });
}

/**
 * Clear the embedding index
 */
export async function clearIndex(): Promise<void> {
	return invoke('embedding_clear_index');
}

/**
 * Get embedding stats
 */
export async function getEmbeddingStats(): Promise<EmbeddingStats> {
	const stats = await invoke<{
		initialized: boolean;
		model_name: string | null;
		dimensions: number | null;
		indexed_chunks: number;
	}>('embedding_get_stats');

	return {
		initialized: stats.initialized,
		modelName: stats.model_name ?? undefined,
		dimensions: stats.dimensions ?? undefined,
		indexedChunks: stats.indexed_chunks,
	};
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Calculate cosine similarity between two vectors
 */
export function cosineSimilarity(a: number[], b: number[]): number {
	if (a.length !== b.length) {
		throw new Error('Vectors must have the same length');
	}

	let dotProduct = 0;
	let normA = 0;
	let normB = 0;

	for (let i = 0; i < a.length; i++) {
		dotProduct += a[i] * b[i];
		normA += a[i] * a[i];
		normB += b[i] * b[i];
	}

	const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
	if (magnitude === 0) return 0;

	return dotProduct / magnitude;
}

/**
 * Split a file into chunks for indexing
 * @param content - File content
 * @param path - File path
 * @param options - Chunking options
 */
export function chunkFile(
	content: string,
	path: string,
	options: {
		language?: string;
		maxChunkLines?: number;
		overlapLines?: number;
	} = {}
): CodeChunk[] {
	const { language, maxChunkLines = 50, overlapLines = 5 } = options;

	const lines = content.split('\n');
	const chunks: CodeChunk[] = [];

	let startLine = 1;
	while (startLine <= lines.length) {
		const endLine = Math.min(startLine + maxChunkLines - 1, lines.length);
		const chunkContent = lines.slice(startLine - 1, endLine).join('\n');

		chunks.push({
			path,
			startLine,
			endLine,
			content: chunkContent,
			language,
		});

		startLine = endLine + 1 - overlapLines;
		if (startLine <= endLine) {
			startLine = endLine + 1;
		}
	}

	return chunks;
}

/**
 * Extract language from file extension
 */
export function getLanguageFromPath(path: string): string | undefined {
	const ext = path.split('.').pop()?.toLowerCase();

	const languageMap: Record<string, string> = {
		ts: 'typescript',
		tsx: 'typescript',
		js: 'javascript',
		jsx: 'javascript',
		py: 'python',
		rs: 'rust',
		go: 'go',
		java: 'java',
		rb: 'ruby',
		cpp: 'cpp',
		c: 'c',
		cs: 'csharp',
		swift: 'swift',
		kt: 'kotlin',
		php: 'php',
		md: 'markdown',
		json: 'json',
		yaml: 'yaml',
		yml: 'yaml',
		toml: 'toml',
		html: 'html',
		css: 'css',
		scss: 'scss',
		sql: 'sql',
	};

	return ext ? languageMap[ext] : undefined;
}
