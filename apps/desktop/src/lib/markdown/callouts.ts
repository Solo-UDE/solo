/**
 * GitHub-style callout/alert blocks for markdown.
 * Supports: NOTE, TIP, IMPORTANT, WARNING, CAUTION
 *
 * Syntax:
 *   > [!NOTE]
 *   > Content here
 */

import { createElement, type ReactNode } from 'react';
import type { Icon } from '@phosphor-icons/react';
import {
	Info,
	Lightbulb,
	Warning,
	WarningOctagon,
	Fire,
} from '@phosphor-icons/react';

export type CalloutType = 'NOTE' | 'TIP' | 'IMPORTANT' | 'WARNING' | 'CAUTION';

interface CalloutConfig {
	icon: Icon;
	label: string;
	className: string;
}

const CALLOUT_CONFIG: Record<CalloutType, CalloutConfig> = {
	NOTE: { icon: Info, label: 'Note', className: 'callout-note' },
	TIP: { icon: Lightbulb, label: 'Tip', className: 'callout-tip' },
	IMPORTANT: { icon: WarningOctagon, label: 'Important', className: 'callout-important' },
	WARNING: { icon: Warning, label: 'Warning', className: 'callout-warning' },
	CAUTION: { icon: Fire, label: 'Caution', className: 'callout-caution' },
};

const CALLOUT_REGEX = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/;

interface ReactElementLike {
	type: string | ((...args: unknown[]) => unknown);
	props: Record<string, unknown>;
	key: string | null;
}

/** Check if a blockquote's first text child matches callout syntax. */
export function parseCalloutType(
	children: ReactNode[],
): { type: CalloutType; strippedChildren: ReactNode[] } | null {
	if (!children || children.length === 0) return null;

	const first = children[0] as ReactElementLike | null;
	if (!first || typeof first !== 'object' || !('props' in first)) return null;

	const pChildren = first.props?.children as ReactNode;
	if (!pChildren) return null;

	const textParts: ReactNode[] = Array.isArray(pChildren) ? pChildren : [pChildren];
	const firstText = textParts[0];
	if (typeof firstText !== 'string') return null;

	const match = CALLOUT_REGEX.exec(firstText);
	if (!match) return null;

	const calloutType = match[1] as CalloutType;
	const remainingText = firstText.slice(match[0].length);

	const newTextParts: ReactNode[] =
		remainingText.length > 0
			? [remainingText, ...textParts.slice(1)]
			: textParts.slice(1);

	const newFirstChild =
		newTextParts.length > 0
			? createElement(
					first.type as string,
					{ ...(first.props as object), key: 'callout-p' },
					...newTextParts,
				)
			: null;

	const strippedChildren = [
		...(newFirstChild ? [newFirstChild] : []),
		...children.slice(1),
	];

	return { type: calloutType, strippedChildren };
}

/** Render a callout block. */
export function renderCallout(
	type: CalloutType,
	children: ReactNode[],
): ReactNode {
	const config = CALLOUT_CONFIG[type];
	const IconComponent = config.icon;

	return createElement(
		'div',
		{ className: `callout ${config.className}` },
		createElement(
			'div',
			{ className: 'callout-title' },
			createElement(IconComponent, {
				className: 'callout-icon',
				weight: 'bold' as const,
			}),
			createElement('span', null, config.label),
		),
		createElement('div', { className: 'callout-content' }, ...children),
	);
}
