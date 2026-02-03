import { useState, useCallback } from 'react';
import { Copy, Check } from '@phosphor-icons/react';

import type { FC } from 'react';

export interface CodeBlockProps {
	code: string;
	language?: string;
	filename?: string;
	showLineNumbers?: boolean;
	className?: string;
}

/**
 * Simple code block component with copy functionality
 *
 * For full syntax highlighting, add shiki and update this component.
 */
export const CodeBlock: FC<CodeBlockProps> = ({
	code,
	language = 'text',
	filename,
	showLineNumbers = false,
	className = '',
}) => {
	const [copied, setCopied] = useState(false);

	const handleCopy = useCallback(async () => {
		try {
			await navigator.clipboard.writeText(code);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		} catch (err) {
			console.error('Failed to copy:', err);
		}
	}, [code]);

	const lines = code.split('\n');

	return (
		<div className={`rounded-lg border border-border bg-muted/50 overflow-hidden ${className}`}>
			{/* Header */}
			<div className="flex items-center justify-between px-4 py-2 bg-muted border-b border-border">
				<div className="flex items-center gap-2">
					{filename && (
						<span className="text-xs text-muted-foreground font-mono">
							{filename}
						</span>
					)}
					<span className="text-xs font-medium text-muted-foreground uppercase">
						{language}
					</span>
				</div>
				<button
					onClick={handleCopy}
					className="p-1.5 rounded hover:bg-muted-foreground/10 transition-colors"
					title={copied ? 'Copied!' : 'Copy code'}
				>
					{copied ? (
						<Check className="w-4 h-4 text-green-500" />
					) : (
						<Copy className="w-4 h-4 text-muted-foreground hover:text-foreground" />
					)}
				</button>
			</div>

			{/* Code content */}
			<div className="relative overflow-x-auto">
				<pre className="p-4 text-sm font-mono">
					{showLineNumbers ? (
						<table className="w-full">
							<tbody>
								{lines.map((line, i) => (
									<tr key={i}>
										<td className="pr-4 text-right text-muted-foreground select-none">
											{i + 1}
										</td>
										<td className="text-foreground whitespace-pre">{line}</td>
									</tr>
								))}
							</tbody>
						</table>
					) : (
						<code className="text-foreground">{code}</code>
					)}
				</pre>
			</div>
		</div>
	);
};

/**
 * Inline code component
 */
export interface InlineCodeProps {
	children: React.ReactNode;
	className?: string;
}

export const InlineCode: FC<InlineCodeProps> = ({ children, className = '' }) => {
	return (
		<code
			className={`px-1.5 py-0.5 rounded bg-muted border border-border text-sm font-mono text-foreground ${className}`}
		>
			{children}
		</code>
	);
};
