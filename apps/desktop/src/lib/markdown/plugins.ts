/**
 * Shared remark/rehype plugin configuration for markdown rendering.
 * Used by both AgentNarrative and MarkdownPreview.
 */

import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PluginList = any[];

/** Remark plugins shared across all markdown renderers. */
export const sharedRemarkPlugins: PluginList = [remarkGfm, remarkMath];

/** Rehype plugins shared across all markdown renderers. */
export const sharedRehypePlugins: PluginList = [rehypeKatex];
