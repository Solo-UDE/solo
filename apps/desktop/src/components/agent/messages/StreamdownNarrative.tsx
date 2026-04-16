/**
 * Streaming-optimized markdown renderer powered by Streamdown.
 *
 * Wraps Streamdown with Solo's chat animation + component overrides.
 * with a single component that handles all of these natively:
 * - Progressive text reveal (isAnimating + caret) with word-level fadeIn
 * - Unterminated fence handling (built-in)
 * - Syntax highlighting (@streamdown/code with Shiki)
 * - Math rendering (@streamdown/math with KaTeX)
 * - Mermaid diagrams (@streamdown/mermaid)
 * - Custom component overrides for Solo design system
 */

import { type FC } from 'react';
import { Streamdown } from 'streamdown';
import { code } from '@streamdown/code';
import { math } from '@streamdown/math';
import { mermaid } from '@streamdown/mermaid';
import 'streamdown/styles.css';

export interface StreamdownNarrativeProps {
	content: string;
	isStreaming?: boolean;
	className?: string;
}

/** Custom component overrides for Solo design system integration */
const components = {
	a: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => {
		// Handle streamdown:incomplete-link as muted text during streaming
		if (href?.startsWith('streamdown:')) {
			return <span className="text-muted-foreground">{children}</span>;
		}
		return (
			<a
				href={href}
				target="_blank"
				rel="noopener noreferrer"
				className="text-primary underline underline-offset-2 decoration-primary/30 hover:decoration-primary/60 transition-colors"
				{...props}
			>
				{children}
			</a>
		);
	},
	code: ({ children, className, ...props }: React.HTMLAttributes<HTMLElement>) => {
		// Only style inline code — block code is handled by @streamdown/code plugin
		if (className?.includes('language-') || className?.includes('shiki')) {
			return <code className={className} {...props}>{children}</code>;
		}
		return (
			<code
				className="bg-muted/50 rounded px-1.5 py-0.5 text-[0.85em] font-mono text-foreground"
				{...props}
			>
				{children}
			</code>
		);
	},
	blockquote: ({ children, ...props }: React.HTMLAttributes<HTMLQuoteElement>) => (
		<blockquote
			className="border-l-3 border-primary/30 bg-muted/20 rounded-r-lg pl-4 pr-3 py-2 my-3 text-muted-foreground not-italic"
			{...props}
		>
			{children}
		</blockquote>
	),
	table: ({ children, ...props }: React.HTMLAttributes<HTMLTableElement>) => (
		<div className="overflow-x-auto rounded-xl border border-border/20 my-3">
			<table className="w-full text-sm" {...props}>{children}</table>
		</div>
	),
	th: ({ children, ...props }: React.HTMLAttributes<HTMLTableCellElement>) => (
		<th
			className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground bg-muted/30 border-b border-border/20"
			{...props}
		>
			{children}
		</th>
	),
	td: ({ children, ...props }: React.HTMLAttributes<HTMLTableCellElement>) => (
		<td
			className="px-3 py-2 text-sm border-b border-border/10 even:bg-muted/10"
			{...props}
		>
			{children}
		</td>
	),
};

export const StreamdownNarrative: FC<StreamdownNarrativeProps> = ({
	content,
	isStreaming = false,
	className = '',
}) => (
	<div
		className={`chat-markdown prose prose-sm dark:prose-invert max-w-none ${className}`}
		data-streaming={isStreaming ? 'true' : 'false'}
	>
		<Streamdown
			plugins={{ code, math, mermaid }}
			isAnimating={isStreaming}
			animated={{
				animation: 'blurIn',
				duration: 200,
				easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
				sep: 'word',
			}}
			caret="circle"
			shikiTheme={['github-light', 'github-dark']}
			controls={{
				table: true,
				code: true,
				mermaid: { download: true, copy: true },
			}}
			components={components}
			remend={{ linkMode: 'text-only' }}
		>
			{content}
		</Streamdown>
	</div>
);
