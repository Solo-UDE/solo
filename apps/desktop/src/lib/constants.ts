/**
 * Layout constants for Solo IDE
 */

export const SIDEBAR = {
  collapsed: 0,
  expanded: 304,
  min: 272,
  max: 400,
  iconColumnWidth: 40,
  /** Width of the repo icon rail (always visible) */
  railWidth: 64,
  /** Width of the repo rail when expanded to show details */
  railExpandedWidth: 224,
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
  sidebar: '200ms ease-in-out',
} as const;

/**
 * Model ID constants — single source of truth for the frontend.
 * Must match the IDs in the backend registry (crates/solo-agent/src/models.rs).
 */

// Anthropic
// [1m] suffix selects the 1M-context variant of Opus 4.7 (Claude CLI syntax).
export const CLAUDE_OPUS_4_7 = 'claude-opus-4-7[1m]';
export const CLAUDE_SONNET_4_6 = 'claude-sonnet-4-6';
export const CLAUDE_HAIKU_4_5 = 'claude-haiku-4-5-20251001';

// OpenAI
export const GPT_5_4 = 'gpt-5.4';
export const GPT_5_3_CODEX_SPARK = 'gpt-5.3-codex-spark';
export const GPT_5_4_MINI = 'gpt-5.4-mini';

// Google
export const GEMINI_3_PRO = 'gemini-3-pro';
export const GEMINI_3_FLASH = 'gemini-3-flash';

// Default model used across the application
export const DEFAULT_MODEL_ID = CLAUDE_OPUS_4_7;

/**
 * Model option for simple model selectors (e.g. Claude-only dropdown)
 */
export interface ModelOption {
  id: string;
  name: string;
  description: string;
}

export const CLAUDE_MODELS: ModelOption[] = [
  { id: CLAUDE_OPUS_4_7, name: 'Opus 4.7 (1M)', description: 'Most capable model, 1M context' },
  { id: CLAUDE_SONNET_4_6, name: 'Sonnet 4.6', description: 'Balanced performance' },
  { id: CLAUDE_HAIKU_4_5, name: 'Haiku 4.5', description: 'Fastest responses' },
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
  provider: 'anthropic' | 'openai' | 'gemini';
  /** Icon type for rendering */
  iconType: ProviderIconType;
  /**
   * When true, the model's UI surfaces a "Chat only" badge and the input
   * shows a capability banner. Set on non-Anthropic entries in v1 because
   * those adapters don't support tool calls yet.
   */
  textOnly?: boolean;
}

export const PROVIDER_CAPABILITIES = {
  anthropic: { chat: true, agent: true, tools: true, mcp: true, resume: true },
  openai: { chat: true, agent: false, tools: false, mcp: false, resume: false },
  gemini: { chat: true, agent: false, tools: false, mcp: false, resume: false },
} as const;

export type ModelProvider = keyof typeof PROVIDER_CAPABILITIES;

export function providerForModel(modelId: string): ModelProvider {
  return MODEL_OPTIONS.find((option) => option.value === modelId)?.provider ?? 'anthropic';
}

export function capabilitiesForModel(modelId: string) {
  return PROVIDER_CAPABILITIES[providerForModel(modelId)];
}

export const MODEL_OPTIONS: ModelOptionConfig[] = [
  // Anthropic Claude models
  {
    value: CLAUDE_OPUS_4_7,
    label: 'Opus 4.7 (1M)',
    description: 'Most capable model, 1M context',
    provider: 'anthropic',
    iconType: 'claude',
  },
  {
    value: CLAUDE_SONNET_4_6,
    label: 'Sonnet 4.6',
    description: 'Balanced speed and intelligence',
    provider: 'anthropic',
    iconType: 'claude',
  },
  {
    value: CLAUDE_HAIKU_4_5,
    label: 'Haiku 4.5',
    description: 'Fast and efficient',
    provider: 'anthropic',
    iconType: 'claude',
  },
  // OpenAI models
  {
    value: GPT_5_4,
    label: 'GPT-5.4',
    description: 'Flagship reasoning model',
    provider: 'openai',
    iconType: 'openai',
    textOnly: true,
  },
  {
    value: GPT_5_3_CODEX_SPARK,
    label: 'Codex Spark',
    description: 'Coding-tuned on GPT-5.3',
    provider: 'openai',
    iconType: 'openai',
    textOnly: true,
  },
  {
    value: GPT_5_4_MINI,
    label: 'GPT-5.4 Mini',
    description: 'Fast and cost-effective',
    provider: 'openai',
    iconType: 'openai',
    textOnly: true,
  },
  // Google Gemini models
  {
    value: GEMINI_3_PRO,
    label: '3 Pro',
    description: 'Advanced reasoning',
    provider: 'gemini',
    iconType: 'gemini',
    textOnly: true,
  },
  {
    value: GEMINI_3_FLASH,
    label: '3 Flash',
    description: 'Fast multimodal model',
    provider: 'gemini',
    iconType: 'gemini',
    textOnly: true,
  },
];
