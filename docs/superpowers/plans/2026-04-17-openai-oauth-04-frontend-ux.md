# Plan 4: Frontend UX — Grouped Model Picker, Multi-Account, OpenAI Warning

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the multi-provider capability through three UI changes: group the model picker by provider, let users see/switch/remove OpenAI profiles in Settings, and warn users that OpenAI sessions don't support tools (v1 limitation from Plan 3).

**Architecture:** All three changes are additive to existing components — no component rewrites. The `provider-store.ts` already exposes `profiles`/`activeProfile` (from Plan 2) and `selectedModel` (existing), so the UI work is purely presentation. We don't introduce new onboarding screens — users still sign in via Settings → AI as they do today.

**Tech Stack:** React 19, Zustand, Radix UI, Tailwind, Motion (framer-motion).

## v1 Scope

- ✅ Model picker groups models by provider with a visible "Text only" badge on OpenAI entries.
- ✅ AITab's ProviderCard shows a list of OpenAI profiles with radio-select for active profile, "Add another account" button, and per-profile remove.
- ✅ When the selected model is OpenAI, the chat input shows a subtle informational banner ("OpenAI sessions don't support tools yet — Claude for file edits"). Dismissible per-session.

## Deferred (intentional)

- ❌ **Startup onboarding wall.** The spec mentioned a first-run dual-provider card, but Anthropic doesn't have one today (Claude login is triggered from Settings), so there's no existing pattern to match. Users continue to sign in via Settings on first run.
- ❌ **Cross-provider session resumption UX.** Not in v1.
- ❌ **Any changes to commit-message, session-title, or refine-transcript UIs.** Those still use Anthropic under the hood.

---

## File Structure

**New files:**
- `apps/desktop/src/components/settings/ProfileRow.tsx` — a single profile row (radio, email, remove button) used inside `ProviderCard`.
- `apps/desktop/src/components/agent/input/OpenAICapabilityBanner.tsx` — dismissible info banner shown in the chat input area when an OpenAI model is selected.

**Modified files:**
- `apps/desktop/src/components/agent/input/model-picker.tsx` — reshape the dropdown to group items by provider; add "Text only" badge next to OpenAI models.
- `apps/desktop/src/components/settings/tabs/AITab.tsx` — ProviderCard renders a profile sub-list (using `ProfileRow`) for providers that support OAuth profiles; "Add another account" button triggers an additional OAuth flow.
- `apps/desktop/src/components/agent/input/chat-input-container.tsx` (or wherever the chat input is assembled) — render `OpenAICapabilityBanner` conditionally.
- `apps/desktop/src/lib/constants.ts` (or `MODEL_OPTIONS` source) — add a `textOnly?: boolean` flag to the OpenAI entries.

**Unchanged:**
- `WelcomeScreen.tsx` — stays the folder-picker it is today.
- All of Plan 3's sidecar code.
- Anthropic's `ClaudeLoginModal.tsx`.

---

## Task 1: Add a "text only" flag to OpenAI model entries

The picker needs a flag to render the "Text only" badge. Put this flag in the existing `MODEL_OPTIONS` source so the picker stays declarative.

**Files:**
- Modify: `apps/desktop/src/lib/constants.ts` — locate the `MODEL_OPTIONS` array and the `ProviderIconType` export.

- [ ] **Step 1: Locate the existing MODEL_OPTIONS**

```bash
cd /Users/sachin/Developer/Orbit_Main/solo/.claude/worktrees/mercury-openai-oauth
grep -n "MODEL_OPTIONS\|ProviderIconType" apps/desktop/src/lib/constants.ts
```

Read the existing shape. Each entry probably has `{ id, label, icon, ... }`.

- [ ] **Step 2: Add a `textOnly` optional field to the type**

Find the type definition for a model option (probably `interface ModelOption` or similar). Add:

```typescript
  /**
   * When true, the model's UI surfaces a "Text only" badge and the chat
   * input shows a capability banner. Set on all OpenAI entries in v1
   * because the sidecar's OpenAI adapter doesn't support tool calls yet
   * (see Plan 3 deferred scope).
   */
  textOnly?: boolean;
```

Then in the `MODEL_OPTIONS` array, add `textOnly: true` to every OpenAI entry. Example:

```typescript
{
  id: 'gpt-5.4-medium',
  label: 'GPT-5.4 (Medium)',
  icon: 'openai',
  textOnly: true,
  // ... existing fields ...
},
```

Apply to `gpt-5.4-low`, `gpt-5.4-medium`, `gpt-5.4-extra-high` (or whatever OpenAI IDs exist in the file).

- [ ] **Step 3: Typecheck**

```bash
mkdir -p apps/desktop/dist && touch apps/desktop/dist/index.html
bun run check 2>&1 | tail -10
rm -rf apps/desktop/dist
git checkout -- apps/desktop/src-tauri/gen/ 2>/dev/null || true
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/lib/constants.ts
git commit -m "feat(solo-desktop): add textOnly flag to MODEL_OPTIONS

Declarative metadata consumed by the model picker (for the 'Text only'
badge) and the chat input (for the capability banner). Set on all
OpenAI entries in v1 since the sidecar doesn't support tool calls on
OpenAI sessions yet."
```

No Claude attribution.

---

## Task 2: Group the model picker by provider

The current picker (`apps/desktop/src/components/agent/input/model-picker.tsx`) renders a flat list. Reshape to group by provider with a label header for each group and a "Text only" badge on OpenAI items.

**Files:**
- Modify: `apps/desktop/src/components/agent/input/model-picker.tsx`

- [ ] **Step 1: Read the current component**

```bash
cat apps/desktop/src/components/agent/input/model-picker.tsx | head -200
```

Understand where the dropdown items are rendered.

- [ ] **Step 2: Build a grouped structure via useMemo**

Near the top of the `ModelPicker` component body, compute a grouped shape:

```typescript
const groupedModels = useMemo(() => {
  const groups: Record<string, typeof MODEL_OPTIONS> = {
    claude: [],
    openai: [],
    gemini: [],
  };
  for (const model of MODEL_OPTIONS) {
    const key = model.icon as keyof typeof groups;
    if (groups[key]) {
      groups[key].push(model);
    }
  }
  return groups;
}, []);

const groupOrder: Array<{ key: 'claude' | 'openai' | 'gemini'; label: string }> = [
  { key: 'claude', label: 'Claude (Anthropic)' },
  { key: 'openai', label: 'ChatGPT (OpenAI)' },
  { key: 'gemini', label: 'Gemini (Google)' },
];
```

(Adjust `icon` vs `provider` field name to match what the existing MODEL_OPTIONS uses — `icon` is a reasonable bet given the existing `ProviderIconType` export.)

- [ ] **Step 3: Render the groups**

Find where the `DropdownMenuContent` block renders items today (it's likely a single `.map(...)` over `MODEL_OPTIONS`). Replace with a nested render: one section per non-empty group with a header label, then the items.

Example replacement (adapt to the file's exact JSX shape):

```tsx
<DropdownMenuContent side={side} className="min-w-[260px] p-1">
  {groupOrder.map(({ key, label }, groupIdx) => {
    const models = groupedModels[key];
    if (!models.length) return null;
    return (
      <div key={key}>
        {groupIdx > 0 && <div className="h-px bg-border my-1 mx-2" />}
        <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </div>
        {models.map((model) => (
          <DropdownMenuItem
            key={model.id}
            onClick={() => {
              setSelectedModel(model.id);
              onModelSelect?.();
            }}
            className={cn(
              'flex items-center gap-2 px-3 py-1.5',
              model.id === selectedModel && 'bg-accent/60'
            )}
          >
            {renderModelIcon(model.icon, 13)}
            <span className="text-sm flex-1">{model.label}</span>
            {model.textOnly && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                Text only
              </span>
            )}
          </DropdownMenuItem>
        ))}
      </div>
    );
  })}
</DropdownMenuContent>
```

Key points:
- Group headers are `<div>` with small uppercase label styling.
- Thin divider between groups (not before the first group).
- "Text only" badge only when `model.textOnly` is true — small, muted, inline-right.
- The selected model still gets the `bg-accent/60` highlight.

If the existing file wraps items in additional components (e.g. `Tooltip`), preserve the wrapping — just slot the badge inside the existing row.

- [ ] **Step 4: Typecheck**

```bash
mkdir -p apps/desktop/dist && touch apps/desktop/dist/index.html
bun run check 2>&1 | tail -10
rm -rf apps/desktop/dist
git checkout -- apps/desktop/src-tauri/gen/ 2>/dev/null || true
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/components/agent/input/model-picker.tsx
git commit -m "feat(solo-desktop): group model picker by provider with Text-only badge

Models are rendered in three labeled sections (Claude, ChatGPT,
Gemini). Each OpenAI entry shows a 'Text only' badge inline so users
see at a glance that OpenAI sessions don't support tools yet."
```

---

## Task 3: Profile row component

A small presentational component for one profile inside a `ProviderCard`. Reused for every profile in Task 4.

**Files:**
- Create: `apps/desktop/src/components/settings/ProfileRow.tsx`

- [ ] **Step 1: Create the component**

```tsx
import { Trash2 } from 'lucide-react';

import type { FC } from 'react';
import type { ProfileSummary } from '../../lib/backend';

export interface ProfileRowProps {
  profile: ProfileSummary;
  onSetActive: () => void;
  onRemove: () => void;
  disabled?: boolean;
}

/**
 * One profile row inside a ProviderCard. Radio indicates active profile;
 * email is the display label; trash button removes it.
 */
export const ProfileRow: FC<ProfileRowProps> = ({
  profile,
  onSetActive,
  onRemove,
  disabled,
}) => {
  return (
    <div
      className={`flex items-center gap-3 px-3 py-2 rounded-none border transition-colors ${
        profile.isActive
          ? 'border-primary/40 bg-primary/5'
          : 'border-border hover:border-border/80'
      }`}
    >
      <button
        type="button"
        onClick={onSetActive}
        disabled={disabled || profile.isActive}
        aria-label={profile.isActive ? 'Active profile' : 'Set as active'}
        className={`w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center transition-colors ${
          profile.isActive
            ? 'border-primary bg-primary'
            : 'border-muted-foreground/40 hover:border-muted-foreground'
        }`}
      >
        {profile.isActive && <div className="w-1.5 h-1.5 rounded-full bg-primary-foreground" />}
      </button>

      <div className="flex-1 min-w-0">
        <div className="text-sm text-foreground truncate">
          {profile.email || profile.name}
        </div>
        {profile.isActive && (
          <div className="text-[10px] text-primary/80 uppercase tracking-wider">
            Active
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={onRemove}
        disabled={disabled}
        aria-label="Remove account"
        className="p-1.5 text-muted-foreground hover:text-destructive transition-colors disabled:opacity-40"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};
```

- [ ] **Step 2: Typecheck**

```bash
mkdir -p apps/desktop/dist && touch apps/desktop/dist/index.html
bun run check 2>&1 | tail -10
rm -rf apps/desktop/dist
git checkout -- apps/desktop/src-tauri/gen/ 2>/dev/null || true
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/components/settings/ProfileRow.tsx
git commit -m "feat(solo-desktop): ProfileRow component for multi-account settings UI

Presentational — radio for active, email label, trash icon to remove.
Used by ProviderCard in the next commit."
```

---

## Task 4: Add multi-account UI to AITab's ProviderCard

Render a profile sub-list inside `ProviderCard` whenever the provider has at least one OAuth profile. Add an "Add another account" button that triggers a fresh OAuth flow.

**Files:**
- Modify: `apps/desktop/src/components/settings/tabs/AITab.tsx`

- [ ] **Step 1: Extend the `useProviderStore` selectors used in AITab**

Near the top of the AITab component (where existing `useProviderStore` hooks are called — around the body of the main component), add subscriptions to profile state and actions:

```typescript
const profiles = useProviderStore((s) => s.profiles);
const refreshProfiles = useProviderStore((s) => s.refreshProfiles);
const setActiveProfile = useProviderStore((s) => s.setActiveProfile);
const removeProfile = useProviderStore((s) => s.removeProfile);
```

- [ ] **Step 2: Call `refreshProfiles` in the existing mount effect**

Find where the component's useEffect calls `initialize()` / `refreshProviderStatus()` on mount. Add two calls (inside the same effect):

```typescript
refreshProfiles('anthropic');
refreshProfiles('openai');
```

- [ ] **Step 3: Extend `ProviderCardProps` and `ProviderCard` to accept profile props**

In `AITab.tsx`, find the `ProviderCardProps` interface (around line 75). Add:

```typescript
  profiles?: ProfileSummary[];
  onSetActiveProfile?: (name: string) => Promise<void>;
  onRemoveProfile?: (name: string) => Promise<void>;
  onAddAnotherAccount?: () => Promise<void>;
```

Also add the import:

```typescript
import type { ProfileSummary } from '../../../lib/backend';
import { ProfileRow } from '../ProfileRow';
```

- [ ] **Step 4: Render the profile sub-list inside ProviderCard**

In the `ProviderCard` function body (after the "Connected notice" block and before the API Key Input block), add:

```tsx
{profiles && profiles.length > 0 && (
  <div className="space-y-1.5">
    <div className="text-xs text-muted-foreground">Accounts</div>
    <div className="space-y-1.5">
      {profiles.map((p) => (
        <ProfileRow
          key={p.name}
          profile={p}
          onSetActive={() => {
            void onSetActiveProfile?.(p.name);
          }}
          onRemove={() => {
            void onRemoveProfile?.(p.name);
          }}
        />
      ))}
    </div>
    {onAddAnotherAccount && (
      <button
        type="button"
        onClick={() => void onAddAnotherAccount()}
        className="w-full text-xs text-primary hover:text-primary/80 py-1.5 border border-dashed border-border hover:border-primary/40 rounded-none transition-colors"
      >
        + Add another account
      </button>
    )}
  </div>
)}
```

- [ ] **Step 5: Wire the OpenAI card at the callsite**

Find where `ProviderCard` is rendered with `provider="openai"` (around line 664). Add the new props:

```tsx
<ProviderCard
  provider="openai"
  isActive={activeProvider === 'openai'}
  onSetActive={() => setActiveProvider('openai')}
  authInfo={authMethodInfo['openai']}
  onOAuthLogin={handleOpenAIOAuthLogin}
  onDisconnect={() => handleDisconnect('openai')}
  isOAuthPending={isOpenAIOAuthPending}
  apiKeyInput={apiKeyInputs.openai}
  onApiKeyChange={(value) => handleApiKeyChange('openai', value)}
  onApiKeySave={() => handleApiKeySubmit('openai')}
  isSaving={savingProvider === 'openai'}
  hasCredentials={allProviderStatus['openai']?.has_credentials ?? false}
  profiles={profiles.openai ?? []}
  onSetActiveProfile={async (name) => {
    await setActiveProfile('openai', name);
  }}
  onRemoveProfile={async (name) => {
    await removeProfile('openai', name);
  }}
  onAddAnotherAccount={handleOpenAIOAuthLogin}
/>
```

The `onAddAnotherAccount` points to the same handler as `onOAuthLogin` — starting another OAuth flow creates a new profile under the `openai.oauth` vault key. (The backend auto-picks a profile name; future UX can let the user rename it.)

- [ ] **Step 6: Wire the Anthropic card with profiles too (optional, consistent)**

Same as Step 5 but for the Anthropic ProviderCard. For Anthropic the `onAddAnotherAccount` handler should open the Claude login modal. Pattern:

```tsx
<ProviderCard
  provider="anthropic"
  // ... existing props ...
  profiles={profiles.anthropic ?? []}
  onSetActiveProfile={async (name) => {
    await setActiveProfile('anthropic', name);
  }}
  onRemoveProfile={async (name) => {
    await removeProfile('anthropic', name);
  }}
  onAddAnotherAccount={() => {
    setIsClaudeLoginOpen(true);
    return Promise.resolve();
  }}
/>
```

- [ ] **Step 7: Typecheck**

```bash
mkdir -p apps/desktop/dist && touch apps/desktop/dist/index.html
bun run check 2>&1 | tail -15
rm -rf apps/desktop/dist
git checkout -- apps/desktop/src-tauri/gen/ 2>/dev/null || true
```

Expected: zero errors.

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src/components/settings/tabs/AITab.tsx
git commit -m "feat(solo-desktop): multi-account sub-list in AITab ProviderCard

Each provider card that has OAuth profiles now shows them as a list of
ProfileRow components with radio-select for active and a remove button.
An 'Add another account' button triggers another OAuth flow, appending
the new account to the existing profile list. Single-account users see
zero UI change (the sub-list is hidden when profiles are empty)."
```

---

## Task 5: OpenAI capability banner on chat input

When the user has an OpenAI model selected, show a subtle info banner above/inside the chat input reminding them OpenAI sessions don't support tools.

**Files:**
- Create: `apps/desktop/src/components/agent/input/OpenAICapabilityBanner.tsx`
- Modify: `apps/desktop/src/components/agent/input/chat-input-container.tsx` (or wherever the chat input is assembled — grep if unsure).

- [ ] **Step 1: Create the banner component**

```tsx
import { useState, useEffect } from 'react';
import { Info, X } from 'lucide-react';

import type { FC } from 'react';

export interface OpenAICapabilityBannerProps {
  /** Session ID — used as a key so dismissal is per-session. */
  sessionId: string;
}

const DISMISSED_KEY = 'solo.openai-banner-dismissed';

/**
 * Subtle banner shown above the chat input when an OpenAI model is
 * selected. Reminds the user that tool-calling features don't work on
 * OpenAI sessions yet (v1 limitation from Plan 3).
 *
 * Dismissible per-session: once the user clicks X, the banner stays
 * hidden for that sessionId. Refreshing the app brings it back for
 * other sessions.
 */
export const OpenAICapabilityBanner: FC<OpenAICapabilityBannerProps> = ({ sessionId }) => {
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(DISMISSED_KEY);
      const dismissedSessions: string[] = raw ? JSON.parse(raw) : [];
      setDismissed(dismissedSessions.includes(sessionId));
    } catch {
      setDismissed(false);
    }
  }, [sessionId]);

  const handleDismiss = () => {
    try {
      const raw = sessionStorage.getItem(DISMISSED_KEY);
      const dismissedSessions: string[] = raw ? JSON.parse(raw) : [];
      if (!dismissedSessions.includes(sessionId)) {
        dismissedSessions.push(sessionId);
        sessionStorage.setItem(DISMISSED_KEY, JSON.stringify(dismissedSessions));
      }
    } catch {
      // sessionStorage may be unavailable — fall back to in-memory only.
    }
    setDismissed(true);
  };

  if (dismissed) return null;

  return (
    <div className="mx-2 mb-1 flex items-center gap-2 px-2 py-1.5 rounded-none bg-muted/40 border border-border/60 text-xs text-muted-foreground">
      <Info className="w-3.5 h-3.5 flex-shrink-0" />
      <span className="flex-1">
        OpenAI chat is text-only in this build. Switch to Claude if you need file
        edits or tool use.
      </span>
      <button
        type="button"
        onClick={handleDismiss}
        aria-label="Dismiss"
        className="p-0.5 hover:text-foreground transition-colors"
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  );
};
```

- [ ] **Step 2: Find where the chat input is rendered**

```bash
grep -rn "ModelPicker\|chatInputBar\|ChatInputBar" apps/desktop/src/components/agent/ | head -10
```

The container that holds the ModelPicker is where the banner goes — right above (or right below) the text area.

- [ ] **Step 3: Wire the banner**

In the chat-input container file, import the banner and the selected model:

```typescript
import { OpenAICapabilityBanner } from './OpenAICapabilityBanner';
import { useProviderStore } from '../../../stores/provider-store';
import { MODEL_OPTIONS } from '../../../lib/constants';
```

In the component body, compute whether to show it:

```typescript
const selectedModel = useProviderStore((s) => s.selectedModel);
const showOpenAIBanner = useMemo(() => {
  const entry = MODEL_OPTIONS.find((m) => m.id === selectedModel);
  return entry?.textOnly === true;
}, [selectedModel]);
```

Render above the input (or wherever visually natural):

```tsx
{showOpenAIBanner && sessionId && (
  <OpenAICapabilityBanner sessionId={sessionId} />
)}
```

Use whatever `sessionId` prop/variable already exists in that container (the banner needs a stable key for dismissal persistence).

- [ ] **Step 4: Typecheck**

```bash
mkdir -p apps/desktop/dist && touch apps/desktop/dist/index.html
bun run check 2>&1 | tail -10
rm -rf apps/desktop/dist
git checkout -- apps/desktop/src-tauri/gen/ 2>/dev/null || true
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/components/agent/input/OpenAICapabilityBanner.tsx \
        apps/desktop/src/components/agent/input/chat-input-container.tsx
git commit -m "feat(solo-desktop): OpenAI capability banner on chat input

Shown above the chat input when the selected model is flagged
textOnly (currently all OpenAI entries). Warns users that file reads,
bash, and other tool calls don't work on OpenAI sessions yet.
Dismissible per-session via sessionStorage; returns for new sessions."
```

---

## Task 6: Manual smoke test

Human-gated. Prove the three UI changes render and behave correctly.

- [ ] **Step 1: Launch Solo from the worktree**

```bash
cd /Users/sachin/Developer/Orbit_Main/solo/.claude/worktrees/mercury-openai-oauth
bun run dev
```

Hard refresh (⌘R) once the dev server is ready.

- [ ] **Step 2: Model picker grouping**

Open the model picker dropdown in the chat. Expect:
- Three labeled sections: Claude (Anthropic), ChatGPT (OpenAI), Gemini (Google) (if Gemini has entries).
- Each OpenAI model row shows a small "Text only" badge on the right.
- Selecting a model still works; the trigger button reflects the selection.

- [ ] **Step 3: Capability banner**

Select `gpt-5.4-medium` (or any OpenAI model). Expect:
- A subtle info banner appears above the chat input: "OpenAI chat is text-only in this build…"
- Banner is dismissible via the × button.
- After dismissal, refresh the app — banner comes back (dismissal is per-session).

Switch back to a Claude model — banner disappears entirely (not dismissed, just not applicable).

- [ ] **Step 4: Profile sub-list — single account**

Open Settings → AI. On the OpenAI card, expect (if signed in with one ChatGPT account):
- A single profile row with your email, radio-selected as active, trash button on the right.
- "+ Add another account" button below.

- [ ] **Step 5: Profile sub-list — two accounts (optional)**

If you have a second ChatGPT account willing to sign in:
- Click "Add another account" on the OpenAI card.
- Complete the second OAuth flow in the browser.
- Back in Settings: two rows now visible, first is active.
- Click the radio on the second row → it becomes active, first becomes inactive.
- Click trash on an inactive row → it disappears, other stays active.

- [ ] **Step 6: Report**

If all steps pass → Plan 4 complete and the whole OpenAI OAuth feature set is shipping. If any UI glitches, paste a screenshot + the error description.

---

## Plan 4 complete — what's shipped across all four plans

At the end of Plan 4, the entire feature from the original spec is live (modulo explicit deferrals):

| Area | State |
|---|---|
| Vault storage | Profile-keyed, migrates legacy blobs on first read (Plan 1) |
| OpenAI OAuth | Full dance end-to-end; email on profile; browser-open → callback → token exchange (Plan 2) |
| Multi-account | Backend commands (list/set active/remove/sign out), frontend store actions, Settings UI with profile rows (Plans 2 + 4) |
| API key validation | Pre-store ping; 401/403 rejects, 5xx accepts (Plan 2) |
| Chat routing | OpenAI text-only works; Anthropic unchanged (Plan 3) |
| Model picker | Grouped by provider with "Text only" badge (Plan 4) |
| OpenAI limitation UX | Dismissible banner on chat input (Plan 4) |

**Acknowledged deferrals for future plans:**
- Tool calls on OpenAI sessions.
- MCP on OpenAI sessions.
- Commit-message / session-title / refine-transcript generalized across providers.
- Dual-provider first-run onboarding card.
- Cross-provider session resumption.
