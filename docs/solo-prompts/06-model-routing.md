# 06 - Model Routing

Source: Reference prompt system — `agents/coding/router.ts` (167 lines)

## Overview

The router system classifies incoming coding requests and routes them to the optimal model. It uses Gemini 2.5 Flash Lite (on Google Vertex) as a fast, cheap classifier to decide between two execution models. The system includes two router variants (ongoing requests and initial project requests), fast-path bypasses, and a logging mechanism.

---

## Types

```typescript
type ModelSlug = 'gemini-3-flash' | 'claude-opus-4.5';

interface RoutingDecision {
  model: ModelSlug;
  reasoning: string;
}

interface RouteRequestOptions {
  userPrompt: string;
  hasAttachments?: boolean;
  hasVideoAttachment?: boolean;
  isFixingErrors?: boolean;
  conversationHistory?: string;
}

interface RouteInitialRequestOptions {
  userPrompt: string;
  hasAttachments?: boolean;
}
```

---

## ROUTER_SYSTEM_PROMPT

```
You route coding requests to the optimal model. Default to claude-opus-4.5 for most tasks.

**claude-opus-4.5** -- The default choice for most requests: feature development, backend
work, API endpoints, database queries, complex bug fixes, refactoring, architectural
changes, and general coding tasks.

**gemini-3-flash** -- Use ONLY for simple tasks:
1. Minor UI fixes (styling tweaks, color changes, spacing adjustments)
2. Simple questions or clarifications about the codebase
3. Copy/text changes
4. Trivial component updates with no logic changes

When uncertain, ALWAYS choose claude-opus-4.5.
```

---

## INITIAL_ROUTER_SYSTEM_PROMPT

```
You route initial project requests to the optimal model based on complexity.

**claude-opus-4.5** -- The default for most projects: apps with multiple features,
backend functionality, database integration, authentication, or any non-trivial logic.

**gemini-3-flash** -- Use ONLY for very simple requests: basic landing pages, single
static components, or simple UI mockups with no backend.

Default to claude-opus-4.5 when uncertain.
```

---

## routeRequest() Function

**Purpose:** Routes ongoing coding requests to the optimal model.

**Fast-paths (skip LLM classification):**

| Condition | Route | Reasoning |
|-----------|-------|-----------|
| `hasVideoAttachment === true` | gemini-3-flash | "Video attachment requires Gemini" |
| `isFixingErrors === true` | gemini-3-flash | "Error fixing routed to gemini" |

**LLM classification path:**
1. Build prompt: `User request to route: "${userPrompt}"`
2. Append conversation history if available (wrapped in `<conversation_history_context>`)
3. Call `generateText()` with Gemini 2.5 Flash Lite router model
4. Parse response: if text contains "gemini" -> gemini-3-flash, otherwise -> claude-opus-4.5
5. On error: default to claude-opus-4.5 with reasoning "Router failed, defaulting to Opus"

**Response parsing logic:**
```typescript
// Check for gemini first - if it mentions gemini, use gemini
// (otherwise the model might say "use gemini, not opus" which would match opus)
if (text.trim().toLowerCase().includes('gemini')) {
  return { model: 'gemini-3-flash', reasoning: text };
}
return { model: 'claude-opus-4.5', reasoning: text };
```

---

## routeInitialRequest() Function

**Purpose:** Routes initial project creation requests.

Same pattern as `routeRequest()` but:
- No fast-paths (no video/error bypasses)
- Uses `INITIAL_ROUTER_SYSTEM_PROMPT` instead
- Prompt format: `Initial project request: "${userPrompt}"`
- Returns empty reasoning string on success

---

## getModelForRequest() Function

Convenience wrapper that calls `routeRequest()` and returns only the model slug.

---

## logRouterDecision() Function

Logs routing decisions to Supabase `router_logs` table:
```typescript
await supabase.from('router_logs').insert({
  user_prompt: userPrompt,
  routed_model: model,
  project_id: projectId,
});
```

---

## Infrastructure

- **Router model:** Gemini 2.5 Flash Lite on Google Vertex AI
- **Provider:** `@ai-sdk/google-vertex` with `createVertex()`
- **Configuration:** `GOOGLE_VERTEX_PROJECT` env var, location defaults to `us-central1`
- **SDK:** Vercel AI SDK `generateText()` for the classification call

---

## Routing Summary

```
Incoming Request
      |
      +-- hasVideoAttachment? --> gemini-3-flash (fast-path)
      +-- isFixingErrors? -----> gemini-3-flash (fast-path)
      |
      v
  Gemini 2.5 Flash Lite (classifier)
      |
      +-- response mentions "gemini"? --> gemini-3-flash
      +-- otherwise ------------------> claude-opus-4.5
      +-- error ----------------------> claude-opus-4.5 (default)
```

**Design philosophy:** Default to the most capable model (claude-opus-4.5). Only route to the faster/cheaper model (gemini-3-flash) when the task is clearly simple or when multimodal capabilities are needed (video). When in doubt, always choose the more capable model.
