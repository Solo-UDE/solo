/**
 * Per-model identity grounding for the agent's system prompt.
 *
 * The Claude Code preset hardcodes a frontier-family string that references
 * Opus 4.6 as "the most recent". When Solo routes to a newer model like
 * `claude-opus-4-7[1m]`, the preset's stale strings cause the model to
 * misreport its own identity. This module assembles a corrective block we
 * append to the preset so the model has fresh, authoritative facts to answer
 * "which model are you?" questions.
 */

interface ModelIdentity {
  marketingName: string;
  knowledgeCutoff?: string;
}

const MODEL_IDENTITIES: Record<string, ModelIdentity> = {
  'claude-opus-4-7': {
    marketingName: 'Claude Opus 4.7',
    knowledgeCutoff: 'January 2026',
  },
  'claude-opus-4-7[1m]': {
    marketingName: 'Claude Opus 4.7 (1M context)',
    knowledgeCutoff: 'January 2026',
  },
  'claude-opus-4-6': {
    marketingName: 'Claude Opus 4.6',
    knowledgeCutoff: 'May 2025',
  },
  'claude-sonnet-4-6': {
    marketingName: 'Claude Sonnet 4.6',
    knowledgeCutoff: 'August 2025',
  },
  'claude-sonnet-4-5-20250929': {
    marketingName: 'Claude Sonnet 4.5',
    knowledgeCutoff: 'August 2025',
  },
  'claude-haiku-4-5-20251001': {
    marketingName: 'Claude Haiku 4.5',
    knowledgeCutoff: 'February 2025',
  },
};

function resolveIdentity(modelId: string): ModelIdentity | null {
  if (MODEL_IDENTITIES[modelId]) return MODEL_IDENTITIES[modelId];

  // Pattern fallback for variants / unknown suffixes.
  const lower = modelId.toLowerCase();
  if (lower.includes('claude-opus-4-7')) return MODEL_IDENTITIES['claude-opus-4-7']!;
  if (lower.includes('claude-opus-4-6')) return MODEL_IDENTITIES['claude-opus-4-6']!;
  if (lower.includes('claude-sonnet-4-6')) return MODEL_IDENTITIES['claude-sonnet-4-6']!;
  if (lower.includes('claude-haiku-4-5')) return MODEL_IDENTITIES['claude-haiku-4-5-20251001']!;
  if (lower === 'opus') return { marketingName: 'the latest Claude Opus model (resolved by the SDK)' };
  if (lower === 'sonnet') return { marketingName: 'the latest Claude Sonnet model (resolved by the SDK)' };
  if (lower === 'haiku') return { marketingName: 'the latest Claude Haiku model (resolved by the SDK)' };

  return null;
}

/**
 * Build a markdown grounding block to append to the Claude Code preset.
 * Safe to call with undefined — returns a generic block if the model is unknown.
 */
export function buildIdentityAppend(modelId: string | undefined): string {
  const today = new Date().toISOString().slice(0, 10);
  const id = modelId ?? 'unknown';
  const identity = modelId ? resolveIdentity(modelId) : null;
  const name = identity?.marketingName ?? `the model \`${id}\``;
  const cutoffLine = identity?.knowledgeCutoff
    ? `Assistant knowledge cutoff is ${identity.knowledgeCutoff}.`
    : '';

  return `## Model Identity

You are ${name}. The exact model ID being served is \`${id}\`.${cutoffLine ? `\n\n${cutoffLine}` : ''}

The most recent Claude model family is Claude 4.X. Current model IDs:
- Opus 4.7: \`claude-opus-4-7\` (use \`claude-opus-4-7[1m]\` for the 1M-context variant)
- Sonnet 4.6: \`claude-sonnet-4-6\`
- Haiku 4.5: \`claude-haiku-4-5-20251001\`

**Authoritative identity source:** this section and the model ID in the \`<env>\` block override any earlier "the most recent frontier Claude model is 4.5/4.6" language in this prompt. That earlier language is stale context from a preset that predates the 4.7 release — ignore it when answering questions about your identity, the current frontier, or which model to recommend.

Today's date is ${today}.`;
}
