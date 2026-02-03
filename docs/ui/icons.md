# Icons

Icon libraries used:
- **lucide-react** — primary UI icons (87 unique icons)
- **@icons-pack/react-simple-icons** — AI provider brand icons
- **@react-symbols/icons** — file/folder icons in the explorer tree

---

## Lucide React

### Navigation & Layout

| Icon | Used In |
|------|---------|
| `ChevronRight` | dropdown-menu, FileTreeNode, SymbolOutline, Breadcrumbs, TabBar, tool-call-block, progress-updates |
| `ChevronDown` | dropdown-menu, FileTreeNode, SymbolOutline, SelectDropdown, tool-call-block, progress-updates, model-picker, model-selector, mode-selector, ChatInput, ToolApprovalDialog |
| `ChevronUp` | model-picker |
| `ChevronLeft` | TabBar |
| `PanelLeft` | SidebarToggle |
| `PanelLeftClose` | SidebarToggle |
| `PanelRight` | MarkdownToggle |
| `PanelRightClose` | MarkdownToggle |

### Actions & Controls

| Icon | Used In |
|------|---------|
| `X` | EditorTabs, ConfirmDialog, InputDialog, ApiKeyDialog, SidebarTerminal, dialog, KeybindingInput, PasswordInput, UnsavedChangesDialog, TabContextMenu, Tab, FileExplorer, ToolApprovalDialog, progress-step |
| `XCircle` | TabContextMenu, notify-user-card |
| `Plus` | SidebarTerminal, AgentWindowHeader, NumberInput, SessionList, AgentWindow, context-menu |
| `Minus` | NumberInput |
| `Check` | CodeBlockWithCopy, dropdown-menu, CodeBlock, copy-button, progress-step, ToolApprovalDialog |
| `Copy` | CodeBlockWithCopy, CodeBlock, copy-button, FileContextMenu |
| `Pin` | TabContextMenu, Tab |
| `PinOff` | TabContextMenu |

### Files & Folders

| Icon | Used In |
|------|---------|
| `FileText` | FileViewer, CodeEditor, EditorTabs, Breadcrumbs, ToolApprovalDialog |
| `File` | files-edited-list |
| `FilePlus` | FileExplorer, files-edited-list, FileContextMenu |
| `FileEdit` | files-edited-list |
| `FileX` | files-edited-list |
| `Folder` | ToolApprovalDialog |
| `FolderOpen` | FileExplorer, FileContextMenu, SettingsModal |
| `FolderPlus` | FileExplorer, FileContextMenu |

### Status & Feedback

| Icon | Used In |
|------|---------|
| `Loader2` | FileViewer, CodeEditor, AuthGuard, ApiKeyDialog, SymbolOutline, FileTreeNode, ClaudeLoginModal, AITab, progress-step, AgentMessage, LoginScreen, FileViewerPanel |
| `AlertCircle` | FileViewer, CodeEditor, EditorErrorBoundary, FileViewerPanel, ClaudeLoginModal, AITab, LoginScreen |
| `AlertTriangle` | ConfirmDialog, UnsavedChangesDialog, notify-user-card, ToolApprovalDialog |
| `CheckCircle` | notify-user-card, ClaudeLoginModal, AITab |
| `Info` | notify-user-card |
| `Circle` | dropdown-menu, progress-step |

### System & Tools

| Icon | Used In |
|------|---------|
| `Terminal` | PrimarySidebar, ClaudeLoginModal, AITab, tool-call-block, ToolApprovalDialog |
| `TerminalSquare` | SidebarTerminal |
| `Settings` | App, AgentWindowHeader, SettingsModal |
| `Bot` | AgentWindowHeader, SettingsModal, agent-message, AgentMessage |
| `Keyboard` | KeybindingInput, SettingsModal |
| `Code` | SettingsModal |

### Search & Edit

| Icon | Used In |
|------|---------|
| `Search` | SessionList, ShortcutsTab, ToolApprovalDialog |
| `RefreshCw` | EditorErrorBoundary, ClaudeLoginModal, FileExplorer |
| `RotateCcw` | KeybindingInput, ShortcutsTab |
| `Trash2` | SessionList, FileContextMenu |
| `Pencil` | SessionList, FileContextMenu |

### User & Auth

| Icon | Used In |
|------|---------|
| `User` | UserMessage, user-message |
| `Github` | LoginScreen |
| `Mail` | LoginScreen |
| `LogOut` | App, SettingsModal |
| `Key` | ApiKeyDialog |
| `Eye` | ApiKeyDialog, PasswordInput |
| `EyeOff` | ApiKeyDialog, PasswordInput |

### Communication

| Icon | Used In |
|------|---------|
| `MessageSquare` | SessionList |
| `MoreHorizontal` | SessionList |
| `Send` | ChatInput |
| `ArrowUp` | submit-button |
| `AtSign` | context-menu |
| `Image` | context-menu |

### AI & Intelligence

| Icon | Used In |
|------|---------|
| `Brain` | mode-selector, ChatInput |
| `Zap` | proceed-indicator, mode-selector, ChatInput |
| `Sparkles` | AITab, model-selector |

### Misc

| Icon | Used In |
|------|---------|
| `BookOpen` | SettingsModal |
| `ExternalLink` | LoginScreen, SettingsModal, tool-call-block |
| `ThumbsUp` | message-feedback |
| `ThumbsDown` | message-feedback |
| `GitBranch` | ToolApprovalDialog |
| `Sun` | SettingsModal |
| `Clock` | AITab |

---

## Brand Icons (@icons-pack/react-simple-icons)

Used in `model-picker.tsx`:

| Icon | Provider | Color |
|------|----------|-------|
| `SiClaude` | Anthropic / Claude | `#D97757` |
| `SiGooglegemini` | Google Gemini | `#60a9ed` |
| `SiOpenai` | OpenAI | — |

---

## File & Folder Icons (@react-symbols/icons)

Used in `FileTreeNode.tsx`:

| Icon | Source | Purpose |
|------|--------|---------|
| `FileIcon` | `@react-symbols/icons` | Auto-assigns icon by filename |
| `FolderIcon` | `@react-symbols/icons` | Auto-assigns icon by folder name |
| `Git` | `@react-symbols/icons/files` | Git internal files (COMMIT_EDITMSG, HEAD, config, etc.) |
| `FolderGray` | `@react-symbols/icons/folders` | Git internal folders (info, logs, objects) |
| `FolderGithub` | `@react-symbols/icons/folders` | Git ref folders (refs, worktrees, heads, remotes, tags) |

---

## Text Symbol Icons

Defined in `lib/tauri/parse.ts` via `getSymbolIcon()`. Single-character glyphs used for code symbol outlines:

| Symbol | Meaning |
|--------|---------|
| `f` | function |
| `m` | method |
| `C` | class |
| `S` | struct |
| `E` | enum |
| `I` | interface |
| `T` | type alias |
| `c` | constant |
| `v` | variable |
| `M` | module |
| `p` | property |
| `e` | enum member |
| `t` | trait |
| `i` | impl |
| `!` | macro |
| `?` | unknown |

---

## Panel Icon References

String-based icon names in `lib/panels/builtinPanels.ts`, resolved by the panel system:

| String | Panel |
|--------|-------|
| `file-text` | File viewer |
| `home` | Welcome |
| `message-square` | Agent session |
| `terminal` | Terminal |
