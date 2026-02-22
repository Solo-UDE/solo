# Fix: Sidebar tab slide animation on workspace open

## Context

When opening a folder, the sidebar should smoothly slide from the explorer tab to the sessions tab. The previous fix (setTimeout 300ms) causes a **blank screen** followed by a delayed animation - the user sees the workspace fade in with an empty explorer panel, then 300ms later the reel slides to sessions. This feels broken.

**Root cause:** The setTimeout approach decouples the animation from the mount lifecycle. The sidebar mounts showing explorer (which is loading/empty), sits there for 300ms, then slides. The blank gap is the problem.

## Solution: Use framer-motion's `initial` prop to drive the animation on mount

Instead of delaying the state change, we **pre-set** `activeTab` to `'sessions'` synchronously AND tell PrimarySidebar to start its reel at the explorer position (`x: 0%`). Framer-motion then spring-animates from explorer to sessions **during** the workspace fade-in - no blank gap, no setTimeout.

The key mechanism is a one-shot boolean flag `sidebarMountAnimation` in uiStore:
- Set to `true` by `switchWorkspace` before the workspace view mounts
- Read once by PrimarySidebar via a `useRef` (no subscription, no extra re-renders)
- Cleared in a `useEffect` after mount

### Why this works

1. `switchWorkspace` sets the flag + activeTab **before** `setRootPath` resolves
2. When `setRootPath` sets `rootPath`, React mounts the workspace view (including PrimarySidebar)
3. PrimarySidebar sees `sidebarMountAnimation = true`, renders motion.div with `initial={{ x: "0%" }}` (explorer position) and `animate={{ x: "-33.333%" }}` (sessions position)
4. Spring animation fires immediately on mount, overlapping with the 150ms workspace fade-in
5. Flag is cleared so future mounts (e.g. returning from settings) don't replay the animation

## Changes

### 1. `apps/desktop/src/stores/uiStore.ts` - Add mount animation flag

Add to state:
```ts
sidebarMountAnimation: false,
```

Add to actions interface + implementation:
```ts
setSidebarMountAnimation: (value: boolean) => void;
// ...
setSidebarMountAnimation: (value: boolean): void => {
  set((state) => { state.sidebarMountAnimation = value; });
},
```

### 2. `apps/desktop/src/stores/workspaceStore.ts` - Set flag, revert setTimeout

Replace the current step 7 (setTimeout block) with:
```ts
// 7. Pre-set sidebar to animate from explorer -> sessions on mount
useUIStore.getState().setSidebarMountAnimation(true);
useUIStore.getState().setActiveTab('sessions');
```

Move this **before** `setRootPath` so both values are set before React mounts the sidebar:
```ts
// 5. Close current folder
useFileExplorerStore.getState().closeFolder();

// 6. Pre-set sidebar to animate from explorer -> sessions on mount
useUIStore.getState().setSidebarMountAnimation(true);
useUIStore.getState().setActiveTab('sessions');

// 7. Open new workspace (triggers re-mount of sidebar)
await useFileExplorerStore.getState().setRootPath(path);

// 8. Track in recents
get().addRecent(path);

// 9. Re-detect git
useGitStore.getState().startPolling();
```

### 3. `apps/desktop/src/components/sidebar/PrimarySidebar.tsx` - Consume flag for `initial` prop

Read the flag once via `useRef` (avoids subscription/re-render) and clear it in a `useEffect`:

```tsx
import { useCallback, useMemo, useEffect, useRef, forwardRef } from 'react';
// ...

// Inside the component, before the return:
const shouldAnimateFromExplorer = useRef(
  useUIStore.getState().sidebarMountAnimation
);

useEffect(() => {
  if (shouldAnimateFromExplorer.current) {
    useUIStore.getState().setSidebarMountAnimation(false);
  }
}, []);
```

Update the motion.div:
```tsx
<motion.div
  className="flex h-full"
  style={{ width: '300%' }}
  initial={shouldAnimateFromExplorer.current ? { x: '0%' } : false}
  animate={{ x: `${reelOffsetPercent}%` }}
  transition={{ type: 'spring', stiffness: 400, damping: 35 }}
>
```

## Verification

1. `bun run dev` -> open a folder from WelcomeScreen
2. The sidebar should smoothly slide from explorer to sessions **during** the workspace fade-in (no blank screen gap)
3. Open settings and return - sidebar should restore tab position instantly (no unwanted slide animation)
4. Manually clicking sidebar tabs should still animate normally
5. Switch between workspaces (File > Open) - slide animation should play each time
