/**
 * Model Router — Routes requests to appropriate models based on complexity.
 *
 * Uses a fast/cheap classifier to route:
 * - Most requests → primary model (default)
 * - Simple UI fixes, copy changes, trivial updates → fast model
 *
 * Uses OpenRouter for classification.
 */

import { generateText } from 'ai';
import { resolveModel } from '../../lib/model-mapping';

export type ModelSlug = 'fast' | 'primary';

export interface RoutingDecision {
  model: ModelSlug;
  reasoning: string;
}

const ROUTER_SYSTEM_PROMPT = `You route coding requests to the optimal model. Default to the primary (most capable) model for most tasks.

**primary** — The default choice for most requests: feature development, backend work, API endpoints, database queries, complex bug fixes, refactoring, architectural changes, and general coding tasks.

**fast** — Use ONLY for simple tasks:
1. Minor UI fixes (styling tweaks, color changes, spacing adjustments)
2. Simple questions or clarifications about the codebase
3. Copy/text changes
4. Trivial component updates with no logic changes

When uncertain, ALWAYS choose primary.

Respond with ONLY the word "primary" or "fast". Nothing else.`;

export interface RouteRequestOptions {
  userPrompt: string;
  hasAttachments?: boolean;
  isFixingErrors?: boolean;
  conversationHistory?: string;
}

export async function routeRequest(options: RouteRequestOptions): Promise<RoutingDecision> {
  const { userPrompt, isFixingErrors = false, conversationHistory } = options;

  if (isFixingErrors) {
    return { model: 'fast', reasoning: 'Error fixing routed to fast model' };
  }

  let prompt = `User request to route: "${userPrompt}"`;

  if (conversationHistory) {
    prompt += `\n\n<conversation_history_context>\n${conversationHistory}\n</conversation_history_context>`;
  }

  try {
    const routerModel = resolveModel('gemini-3-flash');
    const { text } = await generateText({
      model: routerModel,
      system: ROUTER_SYSTEM_PROMPT,
      prompt,
    });

    if (text.trim().toLowerCase().includes('fast')) {
      return { model: 'fast', reasoning: text };
    }

    return { model: 'primary', reasoning: text };
  } catch (error) {
    console.error('[ModelRouter] Classification failed:', error);
    return { model: 'primary', reasoning: 'Router failed, defaulting to primary' };
  }
}

export async function getModelForRequest(options: RouteRequestOptions): Promise<ModelSlug> {
  const decision = await routeRequest(options);
  return decision.model;
}

export const INITIAL_ROUTER_SYSTEM_PROMPT = `You route initial project requests to the optimal model based on complexity.

**primary** — The default for most projects: apps with multiple features, backend functionality, database integration, authentication, or any non-trivial logic.

**fast** — Use ONLY for very simple requests: basic landing pages, single static components, or simple UI mockups with no backend.

Default to primary when uncertain.

Respond with ONLY the word "primary" or "fast". Nothing else.`;

export async function routeInitialRequest(
  options: Pick<RouteRequestOptions, 'userPrompt'>
): Promise<RoutingDecision> {
  const { userPrompt } = options;
  const prompt = `Initial project request: "${userPrompt}"`;

  try {
    const routerModel = resolveModel('gemini-3-flash');
    const { text } = await generateText({
      model: routerModel,
      system: INITIAL_ROUTER_SYSTEM_PROMPT,
      prompt,
    });

    if (text.trim().toLowerCase().includes('fast')) {
      return { model: 'fast', reasoning: text };
    }

    return { model: 'primary', reasoning: text };
  } catch (error) {
    console.error('[InitialRouter] Classification failed:', error);
    return { model: 'primary', reasoning: 'Router failed, defaulting to primary' };
  }
}
