/**
 * AI SDK Integration Module
 *
 * Provides AI-related utilities including:
 * - Zod schemas for structured AI responses
 * - Tool definitions with Zod parameter schemas
 * - Custom Tauri transport for useChat integration
 *
 * @module lib/ai
 */

// =============================================================================
// Schemas - Structured output validation
// =============================================================================
export {
	// Code editing
	codeEditSchema,
	codeEditsSchema,
	type CodeEdit,
	type CodeEdits,

	// File analysis
	fileAnalysisSchema,
	type FileAnalysis,

	// Code generation
	generatedCodeSchema,
	type GeneratedCode,

	// Error diagnosis
	errorDiagnosisSchema,
	type ErrorDiagnosis,

	// Task planning
	taskStepSchema,
	taskPlanSchema,
	type TaskStep,
	type TaskPlan,

	// Code search
	codeSearchResultSchema,
	codeSearchResultsSchema,
	type CodeSearchResult,
	type CodeSearchResults,

	// Refactoring
	refactoringSuggestionSchema,
	type RefactoringSuggestion,

	// Metadata
	aiResponseMetadataSchema,
	type AIResponseMetadata,

	// Utilities
	parseStructured,
	safeParseStructured,
} from './schemas';

// =============================================================================
// Embeddings - Semantic search and RAG
// =============================================================================
export {
	// Types
	type CodeChunk as EmbeddingCodeChunk,
	type CodeSearchResult as EmbeddingSearchResult,
	type EmbeddingStats,
	type EmbeddingModel,

	// API
	initEmbeddings,
	indexCode,
	searchCode,
	embedText,
	clearIndex,
	getEmbeddingStats,

	// Utilities
	cosineSimilarity,
	chunkFile,
	getLanguageFromPath,
} from './embeddings';
