# Zustand State Management

Zustand is our state management library. We use pure functions without middleware for simplicity and reliability.

## Installation

```bash
bun add zustand
```

---

## Store Structure

```typescript
// src/stores/example-store.ts
import { create } from "zustand";

// 1. Define state interface
interface ExampleState {
  count: number;
  items: string[];
  isLoading: boolean;
}

// 2. Define actions interface
interface ExampleActions {
  increment: () => void;
  addItem: (item: string) => void;
  setLoading: (loading: boolean) => void;
  reset: () => void;
}

// 3. Combine into store type
type ExampleStore = ExampleState & ExampleActions;

// 4. Default state for reset
const defaultState: ExampleState = {
  count: 0,
  items: [],
  isLoading: false,
};

// 5. Create store
export const useExampleStore = create<ExampleStore>()((set) => ({
  ...defaultState,

  increment: () => set((state) => ({ count: state.count + 1 })),

  addItem: (item) => set((state) => ({
    items: [...state.items, item]
  })),

  setLoading: (isLoading) => set({ isLoading }),

  reset: () => set(defaultState),
}));
```

---

## UI Store Example

```typescript
// src/stores/ui-store.ts
import { create } from "zustand";
import { SIDEBAR } from "../lib/constants";

type AppTab = "agent" | "editor" | "canvas";

interface UIState {
  activeTab: AppTab;
  leftSidebarWidth: number;
  leftSidebarOpen: boolean;
  rightPanelOpen: boolean;
  bottomPanelOpen: boolean;
  bottomPanelHeight: number;
  commandPaletteOpen: boolean;
}

interface UIActions {
  setActiveTab: (tab: AppTab) => void;
  setLeftSidebarWidth: (width: number) => void;
  toggleLeftSidebar: () => void;
  toggleRightPanel: () => void;
  toggleBottomPanel: () => void;
  setBottomPanelHeight: (height: number) => void;
  setCommandPaletteOpen: (open: boolean) => void;
}

type UIStore = UIState & UIActions;

const DEFAULT_UI_STATE: UIState = {
  activeTab: "agent",
  leftSidebarWidth: SIDEBAR.expanded,
  leftSidebarOpen: true,
  rightPanelOpen: false,
  bottomPanelOpen: false,
  bottomPanelHeight: 200,
  commandPaletteOpen: false,
};

export const useUIStore = create<UIStore>()((set) => ({
  ...DEFAULT_UI_STATE,

  setActiveTab: (activeTab) => set({ activeTab }),

  setLeftSidebarWidth: (leftSidebarWidth) => set({ leftSidebarWidth }),

  toggleLeftSidebar: () =>
    set((state) => {
      if (state.leftSidebarWidth > SIDEBAR.collapsed) {
        return { leftSidebarWidth: SIDEBAR.collapsed, leftSidebarOpen: false };
      }
      return { leftSidebarWidth: SIDEBAR.expanded, leftSidebarOpen: true };
    }),

  toggleRightPanel: () =>
    set((state) => ({ rightPanelOpen: !state.rightPanelOpen })),

  toggleBottomPanel: () =>
    set((state) => ({ bottomPanelOpen: !state.bottomPanelOpen })),

  setBottomPanelHeight: (bottomPanelHeight) => set({ bottomPanelHeight }),

  setCommandPaletteOpen: (commandPaletteOpen) => set({ commandPaletteOpen }),
}));
```

---

## Selector Hooks Pattern

Create specific selector hooks to optimize re-renders:

```typescript
// Export specific selectors for better performance
export const useActiveTab = () => useUIStore((state) => state.activeTab);

export const useLeftSidebarWidth = () => useUIStore((state) => state.leftSidebarWidth);

export const useIsLeftSidebarCollapsed = () =>
  useUIStore((state) => state.leftSidebarWidth <= SIDEBAR.collapsed);

export const useIsRightPanelOpen = () => useUIStore((state) => state.rightPanelOpen);

export const useIsBottomPanelOpen = () => useUIStore((state) => state.bottomPanelOpen);

export const useCommandPaletteOpen = () => useUIStore((state) => state.commandPaletteOpen);
```

---

## Usage in Components

```tsx
import { useUIStore, useActiveTab, useIsLeftSidebarCollapsed } from "../stores/ui-store";

function Sidebar() {
  // Option 1: Destructure what you need
  const { toggleLeftSidebar, setActiveTab } = useUIStore();

  // Option 2: Use specific selector hooks (better for perf)
  const isCollapsed = useIsLeftSidebarCollapsed();
  const activeTab = useActiveTab();

  return (
    <div className={isCollapsed ? "w-10" : "w-64"}>
      <button onClick={toggleLeftSidebar}>
        Toggle
      </button>
      <button onClick={() => setActiveTab("editor")}>
        Editor
      </button>
    </div>
  );
}
```

---

## Stores in Solo IDE

| Store | Purpose | Key State |
|-------|---------|-----------|
| `ui-store` | Layout/panels | sidebar width, panel visibility, active tab |
| `chat-store` | Conversations | messages, active conversation, loading |
| `file-store` | Workspace | file tree, open files, workspace path |
| `terminal-store` | Terminal | sessions, active session |

---

## File Store Example

```typescript
// src/stores/file-store.ts
import { create } from "zustand";

interface FileNode {
  id: string;
  name: string;
  type: "file" | "folder";
  path: string;
  children?: FileNode[];
}

interface OpenFile {
  id: string;
  path: string;
  name: string;
  content: string;
  isDirty: boolean;
}

interface FileState {
  workspacePath: string | null;
  fileTree: FileNode[];
  openFiles: OpenFile[];
  activeFileId: string | null;
}

interface FileActions {
  setWorkspacePath: (path: string | null) => void;
  setFileTree: (tree: FileNode[]) => void;
  openFile: (file: Omit<OpenFile, "isDirty">) => void;
  closeFile: (id: string) => void;
  setActiveFile: (id: string | null) => void;
  updateFileContent: (id: string, content: string) => void;
  markFileSaved: (id: string) => void;
}

type FileStore = FileState & FileActions;

export const useFileStore = create<FileStore>()((set) => ({
  workspacePath: null,
  fileTree: [],
  openFiles: [],
  activeFileId: null,

  setWorkspacePath: (workspacePath) => set({ workspacePath }),

  setFileTree: (fileTree) => set({ fileTree }),

  openFile: (file) =>
    set((state) => {
      const exists = state.openFiles.find((f) => f.id === file.id);
      if (exists) {
        return { activeFileId: file.id };
      }
      return {
        openFiles: [...state.openFiles, { ...file, isDirty: false }],
        activeFileId: file.id,
      };
    }),

  closeFile: (id) =>
    set((state) => {
      const newFiles = state.openFiles.filter((f) => f.id !== id);
      return {
        openFiles: newFiles,
        activeFileId:
          state.activeFileId === id
            ? newFiles[newFiles.length - 1]?.id ?? null
            : state.activeFileId,
      };
    }),

  setActiveFile: (activeFileId) => set({ activeFileId }),

  updateFileContent: (id, content) =>
    set((state) => ({
      openFiles: state.openFiles.map((f) =>
        f.id === id ? { ...f, content, isDirty: true } : f
      ),
    })),

  markFileSaved: (id) =>
    set((state) => ({
      openFiles: state.openFiles.map((f) =>
        f.id === id ? { ...f, isDirty: false } : f
      ),
    })),
}));
```

---

## Best Practices

1. **No middleware** - Use pure zustand, avoid immer (caused issues)
2. **Spread operator** - Use `{ ...state, key: newValue }` for immutability
3. **Selector hooks** - Create specific hooks to minimize re-renders
4. **Default state** - Define separately for easy reset functionality
5. **Type separation** - Keep State, Actions, and Store types separate
6. **Shallow updates** - Zustand does shallow comparison by default

```typescript
// DO: Spread for immutability
set((state) => ({ items: [...state.items, newItem] }))

// DON'T: Mutate directly
set((state) => { state.items.push(newItem); return state; })
```

---

## DevTools (Optional)

```typescript
import { create } from "zustand";
import { devtools } from "zustand/middleware";

export const useStore = create<Store>()(
  devtools(
    (set) => ({
      // store definition
    }),
    { name: "MyStore" }
  )
);
```
