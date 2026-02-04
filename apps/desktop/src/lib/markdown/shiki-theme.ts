/**
 * CSS-variable-based Shiki theme that adapts to Solo's light/dark mode.
 * Uses getComputedStyle to read --syntax-* variables at render time.
 */

import type { ThemeRegistration } from 'shiki';

function cssVar(name: string): string {
	return getComputedStyle(document.documentElement)
		.getPropertyValue(name)
		.trim();
}

/** Build a Shiki theme from the current CSS variable values. */
export function getSoloTheme(): ThemeRegistration {
	const fg = cssVar('--foreground') || '#d4d4d4';
	const bg = cssVar('--muted') || '#1e1e1e';
	const keyword = cssVar('--syntax-keyword') || '#569cd6';
	const string = cssVar('--syntax-string') || '#ce9178';
	const type = cssVar('--syntax-type') || '#4ec9b0';
	const fn = cssVar('--syntax-function') || '#dcdcaa';
	const variable = cssVar('--syntax-variable') || '#9cdcfe';
	const comment = cssVar('--syntax-comment') || '#6a9955';
	const number = cssVar('--syntax-number') || '#b5cea8';
	const control = cssVar('--syntax-control') || '#c586c0';
	const operator = cssVar('--syntax-operator') || '#d4d4d4';
	const bracket = cssVar('--syntax-bracket') || '#ffd700';

	return {
		name: 'solo-dynamic',
		type: document.documentElement.classList.contains('dark')
			? 'dark'
			: 'light',
		colors: {
			'editor.foreground': fg,
			'editor.background': bg,
		},
		settings: [
			{ settings: { foreground: fg } },
			{
				scope: [
					'keyword',
					'storage',
					'storage.type',
					'storage.modifier',
				],
				settings: { foreground: keyword },
			},
			{
				scope: ['string', 'string.quoted', 'string.template'],
				settings: { foreground: string },
			},
			{
				scope: [
					'entity.name.type',
					'support.type',
					'entity.name.class',
				],
				settings: { foreground: type },
			},
			{
				scope: [
					'entity.name.function',
					'support.function',
					'meta.function-call',
				],
				settings: { foreground: fn },
			},
			{
				scope: [
					'variable',
					'variable.other',
					'variable.parameter',
					'meta.object-literal.key',
				],
				settings: { foreground: variable },
			},
			{
				scope: ['comment', 'punctuation.definition.comment'],
				settings: { foreground: comment, fontStyle: 'italic' },
			},
			{
				scope: ['constant.numeric', 'constant.language'],
				settings: { foreground: number },
			},
			{
				scope: [
					'keyword.control',
					'keyword.operator.expression',
					'keyword.control.flow',
				],
				settings: { foreground: control },
			},
			{
				scope: [
					'keyword.operator',
					'keyword.operator.assignment',
					'punctuation',
				],
				settings: { foreground: operator },
			},
			{
				scope: [
					'punctuation.bracket',
					'punctuation.definition.block',
					'meta.brace',
				],
				settings: { foreground: bracket },
			},
			{
				scope: ['entity.name.tag', 'support.class.component'],
				settings: { foreground: keyword },
			},
			{
				scope: ['entity.other.attribute-name'],
				settings: { foreground: fn },
			},
			{
				scope: ['constant.other', 'support.constant'],
				settings: { foreground: number },
			},
			{
				scope: ['meta.decorator', 'punctuation.decorator'],
				settings: { foreground: control },
			},
		],
	};
}
