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
  titlebar: 48,
  statusbar: 24,
} as const;

export const TRANSITIONS = {
  sidebar: '150ms ease-in-out',
} as const;

/**
 * Model ID constants — single source of truth for the frontend.
 * Must match the IDs in the backend registry (crates/solo-agent/src/models.rs).
 */

// Anthropic
export const CLAUDE_OPUS_4_5 = 'claude-opus-4-5-20251101';
export const CLAUDE_SONNET_4_5 = 'claude-sonnet-4-5-20250929';
export const CLAUDE_HAIKU_4_5 = 'claude-haiku-4-5-20251001';

// OpenAI
export const GPT_5_2_HIGH = 'gpt-5.2-high';
export const GPT_5_2_MEDIUM = 'gpt-5.2-medium';
export const GPT_5_2_LOW = 'gpt-5.2-low';

// Google
export const GEMINI_3_PRO = 'gemini-3-pro';
export const GEMINI_3_FLASH = 'gemini-3-flash';

// Default model used across the application
export const DEFAULT_MODEL_ID = CLAUDE_OPUS_4_5;

/**
 * Model option for simple model selectors (e.g. Claude-only dropdown)
 */
export interface ModelOption {
  id: string;
  name: string;
  description: string;
}

export const CLAUDE_MODELS: ModelOption[] = [
  { id: CLAUDE_OPUS_4_5, name: 'Claude Opus 4.5', description: 'Most capable model' },
  { id: CLAUDE_SONNET_4_5, name: 'Claude Sonnet 4.5', description: 'Balanced performance' },
  { id: CLAUDE_HAIKU_4_5, name: 'Claude Haiku 4.5', description: 'Fastest responses' },
];

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
    value: CLAUDE_OPUS_4_5,
    label: 'Claude Opus 4.5',
    description: 'Most capable model',
    provider: 'anthropic',
    iconType: 'claude',
  },
  {
    value: CLAUDE_SONNET_4_5,
    label: 'Claude Sonnet 4.5',
    description: 'Balanced speed and intelligence',
    provider: 'anthropic',
    iconType: 'claude',
  },
  {
    value: CLAUDE_HAIKU_4_5,
    label: 'Claude Haiku 4.5',
    description: 'Fast and efficient',
    provider: 'anthropic',
    iconType: 'claude',
  },
  // OpenAI models
  {
    value: GPT_5_2_HIGH,
    label: 'GPT-5.2 High',
    description: 'Most capable reasoning',
    provider: 'openai',
    iconType: 'openai',
  },
  {
    value: GPT_5_2_MEDIUM,
    label: 'GPT-5.2 Medium',
    description: 'Balanced performance',
    provider: 'openai',
    iconType: 'openai',
  },
  {
    value: GPT_5_2_LOW,
    label: 'GPT-5.2 Low',
    description: 'Fast and cost-effective',
    provider: 'openai',
    iconType: 'openai',
  },
  // Google Gemini models
  {
    value: GEMINI_3_PRO,
    label: 'Gemini 3 Pro',
    description: 'Advanced reasoning',
    provider: 'google',
    iconType: 'gemini',
  },
  {
    value: GEMINI_3_FLASH,
    label: 'Gemini 3 Flash',
    description: 'Fast multimodal model',
    provider: 'google',
    iconType: 'gemini',
  },
];
