/**
 * Unified Shiki-based code block used across agent messages and markdown preview.
 * Features: syntax highlighting, line numbers, line highlighting, filename/title,
 * copy button, language badge, diff coloring, word wrap toggle.
 */

import { useEffect, useState, useMemo, useCallback, type FC } from 'react';
import { codeToHtml } from 'shiki';

// Ensure code block, callout, mermaid, and KaTeX CSS is always loaded
import '@/components/editor/markdown-preview.css';
import { CopyIcon, CheckIcon } from '@radix-ui/react-icons';
import { IndentIncrease } from 'lucide-react';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { cn } from '@/lib/utils';
import { getSoloTheme } from '@/lib/markdown/shiki-theme';

import type { ShikiTransformer } from 'shiki';

export interface CodeBlockProps {
	code: string;
	language?: string;
	filename?: string;
	title?: string;
	showLineNumbers?: boolean;
	highlightLines?: Set<number>;
	className?: string;
}

const COPY_FEEDBACK_MS = 2000;

/** Parse meta string for highlight ranges like {5-7,10} */
export function parseHighlightMeta(meta: string): Set<number> {
	const match = /\{([\d,\s-]+)\}/.exec(meta);
	if (!match) return new Set();

	const lines = new Set<number>();
	for (const part of match[1].split(',')) {
		const trimmed = part.trim();
		const range = trimmed.split('-');
		if (range.length === 2) {
			const start = parseInt(range[0], 10);
			const end = parseInt(range[1], 10);
			for (let i = start; i <= end; i++) lines.add(i);
		} else {
			lines.add(parseInt(trimmed, 10));
		}
	}
	return lines;
}

/** Parse meta string for title/filename: ```ts title="utils.ts" */
export function parseTitleMeta(meta: string): string | undefined {
	const match = /title="([^"]+)"/.exec(meta);
	return match?.[1];
}

export const CodeBlock: FC<CodeBlockProps> = ({
	code,
	language = 'text',
	filename,
	title,
	showLineNumbers = false,
	highlightLines,
	className = '',
}) => {
	const [html, setHtml] = useState<string>('');
	const [isLoading, setIsLoading] = useState(true);
	const [copied, setCopied] = useState(false);
	const [wordWrap, setWordWrap] = useState(false);

	const displayName = title ?? filename;
	const isDiff = language === 'diff';

	const transformers = useMemo(() => {
		const list: ShikiTransformer[] = [];

		// Line metadata transformer
		list.push({
			line(node, line) {
				node.properties['data-line'] = line;

				if (highlightLines?.has(line)) {
					const existing =
						(node.properties.class as string) ?? '';
					node.properties.class =
						`${existing} highlighted-line`.trim();
				}

				// Diff line coloring
				if (isDiff) {
					const text = node.children
						.map((c: { type: string; value?: string }) =>
							c.type === 'text' ? c.value : '',
						)
						.join('');
					if (text.startsWith('+')) {
						node.properties.class = `${(node.properties.class as string) ?? ''} diff-add`.trim();
					} else if (text.startsWith('-')) {
						node.properties.class = `${(node.properties.class as string) ?? ''} diff-remove`.trim();
					}
				}
			},
		});

		return list;
	}, [highlightLines, isDiff]);

	useEffect(() => {
		let mounted = true;

		const highlight = async (): Promise<void> => {
			try {
				const theme = getSoloTheme();
				const lang = isDiff ? 'text' : language;

				const highlighted = await codeToHtml(code, {
					lang,
					theme,
					transformers,
				});

				if (mounted) {
					setHtml(highlighted);
					setIsLoading(false);
				}
			} catch {
				if (mounted) {
					// Fallback: render as plain text
					const escaped = code
						.replace(/&/g, '&amp;')
						.replace(/</g, '&lt;')
						.replace(/>/g, '&gt;');
					setHtml(`<pre><code>${escaped}</code></pre>`);
					setIsLoading(false);
				}
			}
		};

		void highlight();
		return () => {
			mounted = false;
		};
	}, [code, language, isDiff, transformers]);

	const handleCopy = useCallback(async () => {
		try {
			await writeText(code);
			setCopied(true);
			setTimeout(() => setCopied(false), COPY_FEEDBACK_MS);
		} catch (err) {
			console.error('Failed to copy code:', err);
		}
	}, [code]);

	return (
		<div
			className={cn(
				'code-block-wrapper group',
				className,
			)}
		>
			{/* Header: language badge + filename + actions */}
			{(displayName || language !== 'text') && (
				<div className="code-block-header">
					<div className="flex items-center gap-2 min-w-0">
						{language !== 'text' && (
							<span className="code-block-language">
								{language}
							</span>
						)}
						{displayName && (
							<>
								{language !== 'text' && (
									<span className="text-muted-foreground text-xs">
										·
									</span>
								)}
								<span className="code-block-filename truncate">
									{displayName}
								</span>
							</>
						)}
					</div>
					<div className="flex items-center gap-1">
						<button
							onClick={() => setWordWrap((w) => !w)}
							className={cn(
								'code-action-button',
								wordWrap && 'active',
							)}
							title={
								wordWrap
									? 'Disable word wrap'
									: 'Enable word wrap'
							}
						>
							<IndentIncrease className="w-3.5 h-3.5" size={14} />
						</button>
						<button
							onClick={handleCopy}
							className={cn(
								'code-action-button',
								copied && 'copied',
							)}
							title={copied ? 'Copied!' : 'Copy code'}
						>
							{copied ? (
								<CheckIcon className="w-3.5 h-3.5" />
							) : (
								<CopyIcon className="w-3.5 h-3.5" />
							)}
						</button>
					</div>
				</div>
			)}

			{/* Code content */}
			<div
				className={cn(
					'code-block-content',
					showLineNumbers && 'with-line-numbers',
					wordWrap && 'word-wrap',
				)}
			>
				{isLoading ? (
					<div className="p-4 text-sm text-muted-foreground font-mono animate-pulse">
						···
					</div>
				) : (
					<div dangerouslySetInnerHTML={{ __html: html }} />
				)}
			</div>
		</div>
	);
};
