/**
 * AI Tool Definitions
 *
 * Defines tools that the AI agent can use. Tools are defined with Zod schemas
 * for type-safe parameter validation. Actual execution happens in the Rust backend,
 * but these definitions are used for UI display and approval flows.
 */

import { z } from 'zod';
import { invoke } from '@tauri-apps/api/core';

// =============================================================================
// Tool Definition Types
// =============================================================================

export interface ToolDefinition<T extends z.ZodType = z.ZodType> {
	/** Unique tool name */
	name: string;
	/** Human-readable description */
	description: string;
	/** Zod schema for parameters */
	parameters: T;
	/** Whether this tool requires user approval before execution */
	needsApproval: boolean;
	/** Category for grouping in UI */
	category: ToolCategory;
	/** Optional icon name */
	icon?: string;
}

export type ToolCategory =
	| 'file'
	| 'search'
	| 'execution'
	| 'git'
	| 'database'
	| 'web'
	| 'system';

export interface ToolCall {
	id: string;
	name: string;
	arguments: Record<string, unknown>;
	status: 'pending' | 'approved' | 'rejected' | 'running' | 'completed' | 'failed';
	result?: string;
	error?: string;
}

export interface ToolApprovalRequest {
	toolCall: ToolCall;
	definition: ToolDefinition;
}

// =============================================================================
// File Operations Tools
// =============================================================================

export const readFileTool: ToolDefinition = {
	name: 'read_file',
	description: 'Read the contents of a file',
	parameters: z.object({
		path: z.string().describe('Absolute path to the file'),
		encoding: z.enum(['utf-8', 'base64']).default('utf-8').describe('File encoding'),
	}),
	needsApproval: false,
	category: 'file',
	icon: 'FileText',
};

export const writeFileTool: ToolDefinition = {
	name: 'write_file',
	description: 'Write content to a file (creates or overwrites)',
	parameters: z.object({
		path: z.string().describe('Absolute path to the file'),
		content: z.string().describe('Content to write'),
	}),
	needsApproval: true,
	category: 'file',
	icon: 'FilePlus',
};

export const editFileTool: ToolDefinition = {
	name: 'edit_file',
	description: 'Edit a file by replacing specific content',
	parameters: z.object({
		path: z.string().describe('Absolute path to the file'),
		oldContent: z.string().describe('Content to find and replace'),
		newContent: z.string().describe('New content to replace with'),
	}),
	needsApproval: true,
	category: 'file',
	icon: 'FileEdit',
};

export const createFileTool: ToolDefinition = {
	name: 'create_file',
	description: 'Create a new file or directory',
	parameters: z.object({
		path: z.string().describe('Path for the new file/directory'),
		isDir: z.boolean().default(false).describe('Whether to create a directory'),
		content: z.string().optional().describe('Initial content (for files)'),
	}),
	needsApproval: true,
	category: 'file',
	icon: 'FolderPlus',
};

export const deleteFileTool: ToolDefinition = {
	name: 'delete_file',
	description: 'Delete a file or directory',
	parameters: z.object({
		path: z.string().describe('Path to delete'),
		recursive: z.boolean().default(false).describe('Delete directories recursively'),
	}),
	needsApproval: true,
	category: 'file',
	icon: 'Trash2',
};

export const listDirectoryTool: ToolDefinition = {
	name: 'list_directory',
	description: 'List contents of a directory',
	parameters: z.object({
		path: z.string().describe('Directory path'),
		depth: z.number().int().min(0).max(5).default(1).describe('Depth of subdirectories to include'),
	}),
	needsApproval: false,
	category: 'file',
	icon: 'Folder',
};

// =============================================================================
// Search Tools
// =============================================================================

export const grepTool: ToolDefinition = {
	name: 'grep',
	description: 'Search for a pattern in files',
	parameters: z.object({
		pattern: z.string().describe('Regex pattern to search'),
		path: z.string().optional().describe('Directory to search in'),
		fileGlob: z.string().default('**/*').describe('File glob pattern'),
		maxResults: z.number().int().default(50).describe('Maximum results to return'),
	}),
	needsApproval: false,
	category: 'search',
	icon: 'Search',
};

export const globTool: ToolDefinition = {
	name: 'glob',
	description: 'Find files matching a glob pattern',
	parameters: z.object({
		pattern: z.string().describe('Glob pattern (e.g., "**/*.ts")'),
		path: z.string().optional().describe('Base directory'),
	}),
	needsApproval: false,
	category: 'search',
	icon: 'FileSearch',
};

// =============================================================================
// Execution Tools
// =============================================================================

export const bashTool: ToolDefinition = {
	name: 'bash',
	description: 'Execute a bash command',
	parameters: z.object({
		command: z.string().describe('Command to execute'),
		cwd: z.string().optional().describe('Working directory'),
		timeout: z.number().int().optional().describe('Timeout in milliseconds'),
	}),
	needsApproval: true,
	category: 'execution',
	icon: 'Terminal',
};

// =============================================================================
// Git Tools
// =============================================================================

export const gitStatusTool: ToolDefinition = {
	name: 'git_status',
	description: 'Get the current git status',
	parameters: z.object({
		path: z.string().optional().describe('Repository path'),
	}),
	needsApproval: false,
	category: 'git',
	icon: 'GitBranch',
};

export const gitDiffTool: ToolDefinition = {
	name: 'git_diff',
	description: 'Get git diff for changes',
	parameters: z.object({
		path: z.string().optional().describe('Repository path'),
		staged: z.boolean().default(false).describe('Show staged changes'),
	}),
	needsApproval: false,
	category: 'git',
	icon: 'GitCompare',
};

export const gitCommitTool: ToolDefinition = {
	name: 'git_commit',
	description: 'Create a git commit',
	parameters: z.object({
		message: z.string().describe('Commit message'),
		path: z.string().optional().describe('Repository path'),
	}),
	needsApproval: true,
	category: 'git',
	icon: 'GitCommit',
};

// =============================================================================
// Tool Registry
// =============================================================================

/**
 * All available tools
 */
export const allTools: ToolDefinition[] = [
	// File operations
	readFileTool,
	writeFileTool,
	editFileTool,
	createFileTool,
	deleteFileTool,
	listDirectoryTool,
	// Search
	grepTool,
	globTool,
	// Execution
	bashTool,
	// Git
	gitStatusTool,
	gitDiffTool,
	gitCommitTool,
];

/**
 * Tools grouped by category
 */
export const toolsByCategory = allTools.reduce((acc, tool) => {
	if (!acc[tool.category]) {
		acc[tool.category] = [];
	}
	acc[tool.category].push(tool);
	return acc;
}, {} as Record<ToolCategory, ToolDefinition[]>);

/**
 * Get a tool by name
 */
export function getTool(name: string): ToolDefinition | undefined {
	return allTools.find((t) => t.name === name);
}

/**
 * Get tools that require approval
 */
export function getApprovalRequiredTools(): ToolDefinition[] {
	return allTools.filter((t) => t.needsApproval);
}

// =============================================================================
// Tool Execution Helpers
// =============================================================================

/**
 * Execute a tool through the Tauri backend
 * Note: The backend handles actual execution - this just invokes the command
 */
export async function executeTool(
	toolName: string,
	args: Record<string, unknown>
): Promise<string> {
	return invoke<string>('execute_tool', { toolName, args });
}

/**
 * Approve a pending tool call
 */
export async function approveToolCall(toolCallId: string): Promise<void> {
	return invoke('approve_tool_call', { toolCallId });
}

/**
 * Reject a pending tool call
 */
export async function rejectToolCall(toolCallId: string): Promise<void> {
	return invoke('reject_tool_call', { toolCallId });
}

/**
 * Convert a tool definition to JSON Schema format (for sending to AI providers)
 */
export function toolToJsonSchema(tool: ToolDefinition): object {
	// Get the JSON schema from the Zod schema
	const zodToJsonSchema = (schema: z.ZodType): object => {
		// Simple implementation - in production, use zod-to-json-schema library
		if (schema instanceof z.ZodObject) {
			const shape = schema.shape;
			const properties: Record<string, object> = {};
			const required: string[] = [];

			for (const [key, value] of Object.entries(shape)) {
				const zodValue = value as z.ZodType;
				properties[key] = zodToJsonSchema(zodValue);

				// Check if required (not optional, not with default)
				if (
					!(zodValue instanceof z.ZodOptional) &&
					!(zodValue instanceof z.ZodDefault)
				) {
					required.push(key);
				}
			}

			return {
				type: 'object',
				properties,
				required: required.length > 0 ? required : undefined,
			};
		}

		if (schema instanceof z.ZodString) {
			return { type: 'string', description: schema.description };
		}

		if (schema instanceof z.ZodNumber) {
			return { type: 'number', description: schema.description };
		}

		if (schema instanceof z.ZodBoolean) {
			return { type: 'boolean', description: schema.description };
		}

		if (schema instanceof z.ZodEnum) {
			return {
				type: 'string',
				enum: schema.options,
				description: schema.description,
			};
		}

		if (schema instanceof z.ZodOptional) {
			return zodToJsonSchema(schema.unwrap());
		}

		if (schema instanceof z.ZodDefault) {
			const inner = zodToJsonSchema(schema.removeDefault());
			return { ...inner, default: schema._def.defaultValue() };
		}

		return { type: 'string' };
	};

	return {
		name: tool.name,
		description: tool.description,
		parameters: zodToJsonSchema(tool.parameters),
	};
}

/**
 * Convert all tools to JSON Schema format
 */
export function allToolsToJsonSchema(): object[] {
	return allTools.map(toolToJsonSchema);
}
