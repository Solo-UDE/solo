/**
 * Lazy-loaded Mermaid diagram renderer.
 * Renders ```mermaid fenced blocks as inline SVG.
 */

import {
	useEffect,
	useState,
	useRef,
	useId,
	type FC,
} from 'react';
import { cn } from '@/lib/utils';

export interface MermaidBlockProps {
	code: string;
	className?: string;
}

let mermaidInstance: typeof import('mermaid') | null = null;
let mermaidInitialized = false;

async function getMermaid() {
	if (!mermaidInstance) {
		mermaidInstance = await import('mermaid');
	}
	return mermaidInstance.default;
}

async function initMermaid(dark: boolean) {
	const mermaid = await getMermaid();
	mermaid.initialize({
		startOnLoad: false,
		theme: dark ? 'dark' : 'default',
		securityLevel: 'strict',
		fontFamily: 'var(--font-mono)',
	});
	mermaidInitialized = true;
}

export const MermaidBlock: FC<MermaidBlockProps> = ({
	code,
	className = '',
}) => {
	const [svg, setSvg] = useState<string>('');
	const [error, setError] = useState<string>('');
	const [isLoading, setIsLoading] = useState(true);
	const containerRef = useRef<HTMLDivElement>(null);
	const uniqueId = useId().replace(/:/g, '-');

	useEffect(() => {
		let mounted = true;

		const render = async () => {
			try {
				const mermaid = await getMermaid();
				const isDark =
					document.documentElement.classList.contains('dark');

				if (!mermaidInitialized) {
					await initMermaid(isDark);
				}

				const { svg: rendered } = await mermaid.render(
					`mermaid-${uniqueId}`,
					code,
				);

				if (mounted) {
					setSvg(rendered);
					setError('');
					setIsLoading(false);
				}
			} catch (err) {
				if (mounted) {
					setError(
						err instanceof Error
							? err.message
							: 'Failed to render diagram',
					);
					setSvg('');
					setIsLoading(false);
				}
			}
		};

		void render();
		return () => {
			mounted = false;
		};
	}, [code, uniqueId]);

	if (isLoading) {
		return (
			<div
				className={cn(
					'mermaid-block mermaid-loading',
					className,
				)}
			>
				<div className="mermaid-skeleton">
					<div className="mermaid-skeleton-bar" />
					<div className="mermaid-skeleton-bar short" />
					<div className="mermaid-skeleton-bar" />
				</div>
			</div>
		);
	}

	if (error) {
		return (
			<div className={cn('mermaid-block mermaid-error', className)}>
				<div className="mermaid-error-banner">
					Diagram syntax error
				</div>
				<pre className="mermaid-error-source">
					<code>{code}</code>
				</pre>
			</div>
		);
	}

	return (
		<div
			ref={containerRef}
			className={cn('mermaid-block', className)}
			dangerouslySetInnerHTML={{ __html: svg }}
		/>
	);
};
