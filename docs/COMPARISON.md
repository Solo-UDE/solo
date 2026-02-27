# Solo IDE — Tech Stack Comparison

Solo vs a typical modern web-based IDE reference stack (e.g., Orbit-web SaaS patterns). This document covers each major technology layer, the tradeoffs of Solo's choices, and recommendations.

---

## 1. Desktop Framework: Tauri 2 vs Electron


| &nbsp;           | Solo (Tauri 2)                                                     | Reference (Electron)                               |
| ---------------- | ------------------------------------------------------------------ | -------------------------------------------------- |
| **Language**     | Rust backend, JS frontend via webview                              | Node.js backend, Chromium + JS frontend            |
| **Binary size**  | ~10–15 MB                                                          | ~150–200 MB                                        |
| **Memory usage** | ~60–100 MB typical                                                 | ~300–600 MB typical                                |
| **Startup time** | ~0.5–1s                                                            | ~2–4s                                              |
| **IPC**          | `#[tauri::command]` with serde, type-safe                          | `ipcMain` / `ipcRenderer`, loosely typed           |
| **Security**     | Capability-based permissions, no full Node.js in renderer          | Full Node.js access in renderer (unless sandboxed) |
| **Ecosystem**    | Growing (Tauri 2 stable since late 2024), smaller plugin ecosystem | Mature, vast plugin/tooling ecosystem              |
| **Multi-window** | Supported (Tauri 2)                                                | Native support                                     |
| **Auto-update**  | tauri-plugin-updater                                               | electron-updater (mature)                          |


**Tradeoffs**: Tauri gives Solo a 10x memory advantage and faster startup, but Electron has a larger ecosystem and more battle-tested tooling (crash reporting, protocol handlers, native module support). Tauri's Rust backend is an advantage for Solo since the backend crates (fs, git, parse, embeddings) benefit from Rust's performance and safety.

**Recommendation**: Tauri is the correct choice for Solo. The performance characteristics matter for an IDE that runs alongside user projects, and the Rust backend aligns with compute-heavy workloads (tree-sitter parsing, file watching, git operations).

---

## 2. Routing: Panel-Based Mosaic vs React Router


| &nbsp;                | Solo (Mosaic Layout)                                      | Reference (React Router) |
| --------------------- | --------------------------------------------------------- | ------------------------ |
| **Pattern**           | `react-mosaic-component` tiled layout with panel registry | URL-based page routing   |
| **Navigation**        | Tab-based within tiles, sidebar switches context          | URL paths map to views   |
| **State persistence** | Mosaic tree in localStorage                               | URL + session storage    |
| **Deep linking**      | Not applicable (desktop app)                              | URL-addressable views    |
| **Back/forward**      | N/A                                                       | Browser history API      |


**Tradeoffs**: React Router is designed for multi-page web apps with URL-addressable views. Solo is a single-window desktop IDE where users arrange panels spatially. The mosaic layout enables split-view editing (editor + terminal + agent side by side), which URL routing cannot express.

**Recommendation**: Panel-based routing is correct for an IDE. No adoption of React Router needed. If Solo ever adds a web version, consider a hybrid approach where URL state encodes the mosaic layout configuration.

---

## 3. Headless UI: Radix UI vs Radix + cmdk


| &nbsp;              | Solo (Radix UI)                                             | Reference (Radix + cmdk)                                |
| ------------------- | ----------------------------------------------------------- | ------------------------------------------------------- |
| **Primitives**      | Dialog, DropdownMenu, Tooltip, Popover, Collapsible, Switch | Same Radix primitives + cmdk command palette            |
| **Command palette** | Not yet implemented                                         | cmdk provides fuzzy search, keyboard nav, nested groups |
| **Accessibility**   | ARIA roles via Radix, some gaps (see UX audit)              | Full a11y from both libraries                           |


**Tradeoffs**: Solo uses Radix for accessible primitives but lacks a command palette — a critical feature for any IDE (VS Code's Cmd+Shift+P). cmdk (by Paco) provides exactly this: a composable, accessible command menu with fuzzy matching.

**Recommendation**: **Adopt cmdk** (or build an equivalent). A command palette is high priority for IDE UX. It should index: file open, panel actions, settings toggles, terminal commands, agent actions, and keyboard shortcut discovery. cmdk is ~4KB gzipped and integrates cleanly with Radix.

---

## 4. Styling: Tailwind CSS 4


| &nbsp;           | Solo                                           | Reference                           |
| ---------------- | ---------------------------------------------- | ----------------------------------- |
| **Framework**    | Tailwind CSS 4.0                               | Tailwind CSS 4.0                    |
| **Color system** | OKLCH custom properties                        | Typically HSL or hex                |
| **Theme**        | Light/dark via `.dark` class + `data-vibrancy` | Light/dark via class or media query |
| **Utilities**    | tailwind-merge + clsx + CVA                    | Same pattern                        |


**Tradeoffs**: Both stacks use Tailwind 4. Solo's OKLCH color system is more perceptually uniform than HSL — colors maintain consistent perceived brightness across hues, which matters for an IDE with many UI surfaces at different hierarchy levels. The `data-vibrancy` attribute for macOS translucency is a desktop-specific enhancement.

**Recommendation**: No changes needed. Solo's approach is arguably stronger than the reference due to OKLCH and vibrancy support.

---

## 5. Animations: Framer Motion


| &nbsp;       | Solo                                                                                                           | Reference                           |
| ------------ | -------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| **Library**  | framer-motion 12.x + tw-animate-css                                                                            | framer-motion                       |
| **Patterns** | Spring-based easing, custom curves (spring, smooth, snappy)                                                    | Layout animations, page transitions |
| **Gaps**     | Settings tab transitions are instant; no entrance animations on lists; ToolCallBlock expands without animation | Typically more consistent           |


**Tradeoffs**: Both use Framer Motion. Solo has the library but underutilizes it in several areas (settings transitions, list animations, tool call expansions).

**Recommendation**: No library change needed. Incrementally apply `AnimatePresence` and `motion.div` to the identified gaps: settings tab content, agent message list entrance, and tool call expansion.

---

## 6. State Management: Zustand + Immer vs TanStack Store


| &nbsp;                | Solo (Zustand 5 + Immer)                                   | Reference (TanStack Store)                    |
| --------------------- | ---------------------------------------------------------- | --------------------------------------------- |
| **API**               | `create()(immer(set => ...))`                              | `new Store({ state, ... })`                   |
| **Devtools**          | Zustand devtools middleware                                | TanStack devtools                             |
| **Bundle size**       | ~1.1KB (Zustand) + ~6KB (Immer)                            | ~2KB                                          |
| **Ecosystem**         | Very mature, widely adopted                                | Newer, part of TanStack ecosystem             |
| **Immutable updates** | Immer enables mutable-style writes                         | Manual immutable updates or Immer integration |
| **Middleware**        | persist, devtools, immer, subscribeWithSelector            | Plugin-based                                  |
| **React integration** | `useStore(selector)` with automatic re-render optimization | `useStore()` hook                             |


**Tradeoffs**: Zustand is the most popular React state management library and pairs naturally with Immer for ergonomic immutable updates. TanStack Store is newer and lighter but has a smaller ecosystem. Solo already has 10 well-structured Zustand stores; migration would be costly with no clear benefit.

**Recommendation**: Keep Zustand + Immer. The stores are well-organized (one per domain) and the pattern is established. Consider adding the `persist` middleware to more stores for layout/preference persistence beyond the current localStorage approach.

---

## 7. Data Fetching: Direct Tauri IPC vs TanStack Query


| &nbsp;                   | Solo (Direct IPC)                              | Reference (TanStack Query)               |
| ------------------------ | ---------------------------------------------- | ---------------------------------------- |
| **Pattern**              | `invoke("command", args)` → Promise            | `useQuery({ queryKey, queryFn })`        |
| **Caching**              | Manual (store state)                           | Automatic with stale-while-revalidate    |
| **Deduplication**        | None                                           | Automatic request deduplication          |
| **Retry**                | Manual                                         | Built-in exponential backoff             |
| **Optimistic updates**   | Manual                                         | `useMutation` with `onMutate`            |
| **Loading/error states** | Manual per component                           | Automatic `isLoading`, `isError`, `data` |
| **Streaming**            | Custom `use*Stream` hooks via Tauri `listen()` | Not designed for event streams           |


**Tradeoffs**: TanStack Query excels at HTTP request lifecycle management (caching, deduplication, retry, pagination). Solo's IPC calls are local function calls to the Rust backend — they're sub-millisecond and don't benefit from HTTP-style caching strategies. Solo's streaming data (agent responses, terminal output, file watcher events) uses Tauri's event system, which TanStack Query doesn't handle.

**Recommendation**: **Do not adopt TanStack Query.** The overhead of query keys, cache invalidation, and stale-time configuration adds complexity without benefit for local IPC. Solo's direct `invoke()` pattern with Zustand stores is simpler and sufficient. If specific commands become expensive (e.g., file search, embedding generation), add targeted caching in the Zustand store rather than introducing a query layer.

---

## 8. Rich Text Editing: Lexical + TipTap


| &nbsp;               | Solo                                                  | Reference               |
| -------------------- | ----------------------------------------------------- | ----------------------- |
| **Chat input**       | Lexical (PlainTextPlugin, forwardRef for clear)       | Lexical                 |
| **Markdown editing** | TipTap (11 packages, WYSIWYG markdown)                | Lexical or Slate        |
| **Rendering**        | react-markdown + remark-gfm + Shiki + KaTeX + Mermaid | Similar rendering stack |


**Tradeoffs**: Solo uses two rich text editors for different purposes: Lexical for the lightweight chat input (plain text with keyboard handling), and TipTap for full markdown WYSIWYG editing. This is reasonable — Lexical's PlainTextPlugin is minimal (~5KB) for chat, while TipTap provides a complete markdown editing experience with extensions.

**Recommendation**: No changes needed. The dual-editor approach avoids loading TipTap's 11 packages for simple chat input. If the chat input later needs rich features (mentions, file references), Lexical's plugin architecture supports incremental addition.

---

## 9. Code Editing: Monaco Editor vs ProseMirror


| &nbsp;                    | Solo (Monaco)                       | Reference (ProseMirror)            |
| ------------------------- | ----------------------------------- | ---------------------------------- |
| **Engine**                | Monaco Editor (VS Code's editor)    | ProseMirror (document model)       |
| **Bundle size**           | ~2–4 MB (with workers)              | ~150KB core                        |
| **LSP support**           | Native (monaco-languageclient)      | Via external integration           |
| **Multi-cursor**          | Built-in                            | Plugin-based                       |
| **Minimap**               | Built-in                            | Not available                      |
| **IntelliSense**          | Built-in                            | Custom implementation needed       |
| **Theming**               | VS Code theme format                | Custom theme API                   |
| **Collaborative editing** | Not native (requires OT/CRDT layer) | Designed for collaborative editing |
| **Mobile/touch**          | Poor                                | Better touch support               |
| **Customization**         | Limited (VS Code opinions baked in) | Fully customizable document model  |


**Tradeoffs**: Monaco is the natural choice for a desktop IDE — it provides IntelliSense, LSP integration, multi-cursor, minimap, and the full VS Code editing experience out of the box. ProseMirror is a document editing framework better suited for collaborative text editing, CMS, or rich content editors. ProseMirror would require building IDE features from scratch.

**Recommendation**: Monaco is correct for Solo's code editor. ProseMirror would only make sense if Solo needed custom document types or collaborative editing as a primary feature. The bundle size penalty (~2–4 MB) is acceptable in a desktop app where it's loaded once from disk.

---

## 10. Internationalization: None vs Format.js


| &nbsp;                | Solo (None)               | Reference (Format.js / react-intl)      |
| --------------------- | ------------------------- | --------------------------------------- |
| **i18n support**      | No internationalization   | Full ICU message format, plurals, dates |
| **String management** | Hardcoded English strings | Extracted message catalogs              |
| **RTL support**       | Not considered            | Typically included                      |


**Tradeoffs**: Format.js adds ~12KB gzipped and requires wrapping all user-visible strings in `<FormattedMessage>` or `intl.formatMessage()`. For a desktop IDE, the user base is predominantly English-speaking developers, and IDE-specific terminology (commit, branch, terminal, editor) is often left in English even in localized tools.

**Recommendation**: **Defer i18n.** The cost of retrofitting i18n is moderate (string extraction), so it can be added later if Solo targets non-English markets. For now, hardcoded strings keep the codebase simpler. If i18n is eventually needed, consider `i18next` (more popular in desktop/Electron apps) over Format.js.

---

## 11. Observability: Tracing (Rust) vs Sentry + Statsig


| &nbsp;                     | Solo (tracing)                        | Reference (Sentry + Statsig)                  |
| -------------------------- | ------------------------------------- | --------------------------------------------- |
| **Error tracking**         | Rust `tracing` crate, structured logs | Sentry (crash reports, breadcrumbs, releases) |
| **Feature flags**          | None                                  | Statsig (A/B testing, feature gates)          |
| **Performance monitoring** | None (could add tracing spans)        | Sentry Performance (transactions, spans)      |
| **User analytics**         | None                                  | Statsig events, Sentry user context           |
| **Frontend errors**        | Console errors, no capture            | Sentry JS SDK, source maps                    |


**Tradeoffs**: Solo currently has Rust-side structured logging via `tracing` but no frontend error tracking, crash reporting, or analytics. For a desktop IDE in active development, this means bugs in production are invisible unless users report them. Sentry provides automatic crash reporting with stack traces and breadcrumbs. Statsig provides feature flags for gradual rollouts.

**Recommendation**: **Adopt Sentry** (or PostHog, which combines error tracking + analytics + feature flags). Desktop apps need crash reporting more than web apps because users can't easily share browser console output. For feature flags, evaluate whether the complexity is warranted at Solo's current stage — a simple local config toggle may suffice until the user base grows. OpenTelemetry is an option for the Rust backend (via `tracing-opentelemetry`) if Solo wants vendor-neutral telemetry.

---

## Adoption Summary


| Technology                 | Solo Status          | Action          | Priority |
| -------------------------- | -------------------- | --------------- | -------- |
| **Tauri 2**                | Adopted              | Keep            | —        |
| **Panel-based routing**    | Adopted              | Keep            | —        |
| **Radix UI**               | Adopted              | Keep            | —        |
| **cmdk (command palette)** | Missing              | **Adopt**       | High     |
| **Tailwind CSS 4**         | Adopted              | Keep            | —        |
| **OKLCH color system**     | Adopted              | Keep (strength) | —        |
| **Framer Motion**          | Adopted (underused)  | Apply to gaps   | Medium   |
| **Zustand + Immer**        | Adopted              | Keep            | —        |
| **TanStack Query**         | Not used             | **Skip**        | —        |
| **Lexical**                | Adopted (chat input) | Keep            | —        |
| **TipTap**                 | Adopted (markdown)   | Keep            | —        |
| **Monaco Editor**          | Adopted              | Keep            | —        |
| **Format.js (i18n)**       | Not used             | **Defer**       | Low      |
| **Sentry / PostHog**       | Not used             | **Adopt**       | High     |
| **Feature flags**          | Not used             | **Defer**       | Low      |
| **OpenTelemetry**          | Not used             | **Consider**    | Medium   |


### Key Takeaways

1. Solo's stack is well-chosen for a desktop IDE. The Tauri + Rust backend provides genuine performance and safety advantages over Electron + Node.js.
2. The two highest-priority gaps are a **command palette** (cmdk) and **error/crash reporting** (Sentry or equivalent). Both are table-stakes for a production IDE.
3. TanStack Query and React Router are designed for web apps and would add complexity without benefit in Solo's desktop IPC architecture.
4. The OKLCH color system and macOS vibrancy support are differentiators that most reference stacks lack.
5. i18n and feature flags can be deferred until Solo's user base warrants the investment.

&nbsp;