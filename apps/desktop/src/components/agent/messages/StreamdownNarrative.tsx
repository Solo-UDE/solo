/**
 * Streaming-optimized markdown renderer powered by Streamdown.
 *
 * Replaces react-markdown + useStreamingText + fixUnterminatedFences
 * with a single component that handles all of these natively:
 * - Progressive text reveal (isAnimating + caret)
 * - Unterminated fence handling (built-in)
 * - Syntax highlighting (@streamdown/code with Shiki)
 * - Math rendering (@streamdown/math with KaTeX)
 * - Mermaid diagrams (@streamdown/mermaid)
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

export const StreamdownNarrative: FC<StreamdownNarrativeProps> = ({
	content,
	isStreaming = false,
	className = '',
}) => (
	<div className={`prose prose-sm dark:prose-invert max-w-none ${className}`}>
		<Streamdown
			plugins={{ code, math, mermaid }}
			isAnimating={isStreaming}
			animated={{
				animation: 'fadeIn',
				duration: 150,
				sep: 'word',
			}}
			caret="block"
			shikiTheme={['github-light', 'github-dark']}
			controls={{
				table: true,
				code: true,
				mermaid: { download: true, copy: true },
			}}
		>
			{content}
		</Streamdown>
	</div>
);
