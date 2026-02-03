/**
 * Layout constants for Solo IDE
 */

export const SIDEBAR = {
  collapsed: 40,
  expanded: 256,
  min: 180,
  max: 400,
  iconColumnWidth: 40,
} as const;

export const HEIGHTS = {
  titlebar: 38,
  statusbar: 24,
} as const;

export const TERMINAL_SECTION = {
  defaultHeight: 200,
  minHeight: 120,
  maxHeight: 600,
  headerHeight: 36,
} as const;

export const TRANSITIONS = {
  sidebar: '150ms ease-in-out',
} as const;

/**
 * Model options for the AI provider picker
 */
export type ProviderIconType = 'claude' | 'openai' | 'gemini';

export interface ModelOptionConfig {
  /** Model ID used by the backend */
  value: string;
  /** Display label */
  label: string;
  /** Short description */
  description: string;
  /** Provider type for grouping */
  provider: 'anthropic' | 'openai' | 'google';
  /** Icon type for rendering */
  iconType: ProviderIconType;
}

export const MODEL_OPTIONS: ModelOptionConfig[] = [
  // Anthropic Claude models
  {
    value: 'claude-opus-4-5-20250514',
    label: 'Claude Opus 4.5',
    description: 'Most capable model',
    provider: 'anthropic',
    iconType: 'claude',
  },
  {
    value: 'claude-sonnet-4-5-20250514',
    label: 'Claude Sonnet 4.5',
    description: 'Balanced speed and intelligence',
    provider: 'anthropic',
    iconType: 'claude',
  },
  {
    value: 'claude-haiku-4-5-20250514',
    label: 'Claude Haiku 4.5',
    description: 'Fast and efficient',
    provider: 'anthropic',
    iconType: 'claude',
  },
  // OpenAI models
  {
    value: 'gpt-5.2-high',
    label: 'GPT-5.2 High',
    description: 'Most capable reasoning',
    provider: 'openai',
    iconType: 'openai',
  },
  {
    value: 'gpt-5.2-medium',
    label: 'GPT-5.2 Medium',
    description: 'Balanced performance',
    provider: 'openai',
    iconType: 'openai',
  },
  {
    value: 'gpt-5.2-low',
    label: 'GPT-5.2 Low',
    description: 'Fast and cost-effective',
    provider: 'openai',
    iconType: 'openai',
  },
  // Google Gemini models
  {
    value: 'gemini-3-pro',
    label: 'Gemini 3 Pro',
    description: 'Advanced reasoning',
    provider: 'google',
    iconType: 'gemini',
  },
  {
    value: 'gemini-3-flash',
    label: 'Gemini 3 Flash',
    description: 'Fast multimodal model',
    provider: 'google',
    iconType: 'gemini',
  },
] as const;
