/**
 * Re-export the polymorphic ToolCallBlock from tool-call/ directory.
 * This file exists for backward compatibility with the barrel export.
 */
export { ToolCallBlock, type ToolCallBlockProps } from './tool-call';
export type { AgentToolCall } from './agent-message';
