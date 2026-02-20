/**
 * Streaming UI Components — Barrel export
 *
 * Glass-morphism tool cards, loading indicators, tool approval,
 * and the tool registry for mapping tool names to components.
 */

// Re-export StreamdownNarrative from messages (it's used directly too)
export { StreamdownNarrative } from '../messages/StreamdownNarrative';

// Base component
export { ToolCard } from './ToolCard';
export type { ToolCardProps, ToolStatus } from './ToolCard';

// Specialized tool cards
export { BashToolCard } from './BashToolCard';
export { FileToolCard } from './FileToolCard';
export { SearchToolCard } from './SearchToolCard';
export { WebToolCard } from './WebToolCard';
export { TaskToolCard } from './TaskToolCard';

// Tool registry
export { getToolWidget, renderToolCard } from './tool-registry';
export type { ToolWidgetProps } from './tool-registry';

// Loading indicators
export { ThinkingDots } from './ThinkingDots';
export { TextShimmer } from './TextShimmer';
export { ThinkingBar } from './ThinkingBar';
export { StreamingSkeleton } from './StreamingSkeleton';

// Tool approval
export { ToolApprovalCard } from './ToolApprovalCard';
