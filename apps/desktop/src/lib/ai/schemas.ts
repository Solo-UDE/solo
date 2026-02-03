/**
 * Zod Schemas for Structured AI Responses
 *
 * Defines type-safe schemas for validating AI-generated structured data.
 * These schemas can be used with AI SDK's generateObject/streamObject
 * or for validating responses from the Rust backend.
 */

import { z } from 'zod';

// =============================================================================
// Code Edit Schemas
// =============================================================================

/**
 * Schema for a code edit operation
 */
export const codeEditSchema = z.object({
	filePath: z.string().describe('Absolute path to the file to edit'),
	operation: z.enum(['insert', 'replace', 'delete']).describe('Type of edit operation'),
	lineStart: z.number().int().min(1).describe('Starting line number (1-indexed)'),
	lineEnd: z.number().int().min(1).optional().describe('Ending line number (1-indexed, for replace/delete)'),
	newContent: z.string().optional().describe('New content to insert or replace with'),
	explanation: z.string().describe('Why this edit is being made'),
});

export type CodeEdit = z.infer<typeof codeEditSchema>;

/**
 * Schema for multiple code edits (batch operation)
 */
export const codeEditsSchema = z.object({
	edits: z.array(codeEditSchema).describe('List of code edits to apply'),
	summary: z.string().describe('Summary of all changes being made'),
});

export type CodeEdits = z.infer<typeof codeEditsSchema>;

// =============================================================================
// File Analysis Schemas
// =============================================================================

/**
 * Schema for file analysis result
 */
export const fileAnalysisSchema = z.object({
	language: z.string().describe('Programming language of the file'),
	purpose: z.string().describe('What this file does'),
	dependencies: z.array(z.string()).describe('External dependencies/imports'),
	exports: z.array(z.object({
		name: z.string().describe('Exported symbol name'),
		type: z.enum(['function', 'class', 'variable', 'type', 'interface', 'constant', 'enum']),
		description: z.string().optional().describe('What this export does'),
	})).describe('What this file exports'),
	complexity: z.enum(['simple', 'moderate', 'complex']).describe('Code complexity assessment'),
	suggestions: z.array(z.string()).optional().describe('Improvement suggestions'),
});

export type FileAnalysis = z.infer<typeof fileAnalysisSchema>;

// =============================================================================
// Code Generation Schemas
// =============================================================================

/**
 * Schema for generated code
 */
export const generatedCodeSchema = z.object({
	code: z.string().describe('The generated code'),
	language: z.string().describe('Programming language'),
	explanation: z.string().describe('Explanation of the generated code'),
	dependencies: z.array(z.string()).optional().describe('Required dependencies'),
	testCode: z.string().optional().describe('Test code for the generated code'),
});

export type GeneratedCode = z.infer<typeof generatedCodeSchema>;

// =============================================================================
// Error Diagnosis Schemas
// =============================================================================

/**
 * Schema for error diagnosis
 */
export const errorDiagnosisSchema = z.object({
	errorType: z.string().describe('Type/category of the error'),
	rootCause: z.string().describe('Root cause of the error'),
	affectedFiles: z.array(z.object({
		path: z.string(),
		line: z.number().optional(),
		relevance: z.string(),
	})).describe('Files related to this error'),
	suggestedFixes: z.array(z.object({
		description: z.string(),
		code: z.string().optional(),
		confidence: z.enum(['high', 'medium', 'low']),
	})).describe('Suggested fixes for the error'),
	preventionTips: z.array(z.string()).optional().describe('How to prevent this error in the future'),
});

export type ErrorDiagnosis = z.infer<typeof errorDiagnosisSchema>;

// =============================================================================
// Task Planning Schemas
// =============================================================================

/**
 * Schema for a planned task step
 */
export const taskStepSchema = z.object({
	step: z.number().int().min(1).describe('Step number'),
	action: z.string().describe('What to do in this step'),
	toolsNeeded: z.array(z.string()).optional().describe('Tools required for this step'),
	dependencies: z.array(z.number()).optional().describe('Steps that must be completed first'),
	estimatedComplexity: z.enum(['trivial', 'simple', 'moderate', 'complex']).optional(),
});

export type TaskStep = z.infer<typeof taskStepSchema>;

/**
 * Schema for a complete task plan
 */
export const taskPlanSchema = z.object({
	goal: z.string().describe('The overall goal to achieve'),
	approach: z.string().describe('High-level approach to the task'),
	steps: z.array(taskStepSchema).describe('Ordered list of steps'),
	risks: z.array(z.string()).optional().describe('Potential risks or challenges'),
	successCriteria: z.array(z.string()).describe('How to verify the task is complete'),
});

export type TaskPlan = z.infer<typeof taskPlanSchema>;

// =============================================================================
// Code Search Result Schemas
// =============================================================================

/**
 * Schema for semantic code search results
 */
export const codeSearchResultSchema = z.object({
	filePath: z.string().describe('Path to the file'),
	lineStart: z.number().int().describe('Starting line of the match'),
	lineEnd: z.number().int().describe('Ending line of the match'),
	snippet: z.string().describe('Code snippet'),
	relevance: z.number().min(0).max(1).describe('Relevance score (0-1)'),
	explanation: z.string().optional().describe('Why this result is relevant'),
});

export type CodeSearchResult = z.infer<typeof codeSearchResultSchema>;

/**
 * Schema for search results collection
 */
export const codeSearchResultsSchema = z.object({
	query: z.string().describe('The original search query'),
	results: z.array(codeSearchResultSchema).describe('Matching results'),
	totalMatches: z.number().int().describe('Total number of matches found'),
	searchStrategy: z.string().optional().describe('Strategy used for the search'),
});

export type CodeSearchResults = z.infer<typeof codeSearchResultsSchema>;

// =============================================================================
// Refactoring Schemas
// =============================================================================

/**
 * Schema for refactoring suggestions
 */
export const refactoringSuggestionSchema = z.object({
	type: z.enum([
		'extract_function',
		'extract_variable',
		'inline',
		'rename',
		'move',
		'simplify',
		'remove_duplication',
		'improve_types',
		'other',
	]).describe('Type of refactoring'),
	description: z.string().describe('What the refactoring does'),
	location: z.object({
		filePath: z.string(),
		lineStart: z.number().int(),
		lineEnd: z.number().int(),
	}).describe('Where the refactoring applies'),
	before: z.string().describe('Code before refactoring'),
	after: z.string().describe('Code after refactoring'),
	impact: z.enum(['low', 'medium', 'high']).describe('Impact on codebase'),
	reasoning: z.string().describe('Why this refactoring is beneficial'),
});

export type RefactoringSuggestion = z.infer<typeof refactoringSuggestionSchema>;

// =============================================================================
// AI Response Metadata Schema
// =============================================================================

/**
 * Schema for AI response metadata
 */
export const aiResponseMetadataSchema = z.object({
	model: z.string().describe('Model that generated the response'),
	promptTokens: z.number().int().optional().describe('Number of tokens in the prompt'),
	completionTokens: z.number().int().optional().describe('Number of tokens in the completion'),
	totalTokens: z.number().int().optional().describe('Total tokens used'),
	latencyMs: z.number().optional().describe('Response latency in milliseconds'),
	cached: z.boolean().optional().describe('Whether the response was cached'),
});

export type AIResponseMetadata = z.infer<typeof aiResponseMetadataSchema>;

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Parse and validate data against a schema
 * @param schema - Zod schema to validate against
 * @param data - Data to validate
 * @returns Validated and typed data
 * @throws ZodError if validation fails
 */
export function parseStructured<T extends z.ZodType>(
	schema: T,
	data: unknown
): z.infer<T> {
	return schema.parse(data);
}

/**
 * Safely parse data against a schema, returning null on failure
 * @param schema - Zod schema to validate against
 * @param data - Data to validate
 * @returns Validated data or null
 */
export function safeParseStructured<T extends z.ZodType>(
	schema: T,
	data: unknown
): z.infer<T> | null {
	const result = schema.safeParse(data);
	return result.success ? result.data : null;
}
