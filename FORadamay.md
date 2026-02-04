# Solo IDE: Building Your Own Development Environment

*A deep dive into building an AI-native IDE from scratch*

---

## What is Solo?

Solo is an AI-native development environment. Not just an editor with a chatbot bolted on, but an IDE where AI assistance is woven into every interaction—from file operations to terminal commands to code understanding.

Think of it like building a house from the foundation up, rather than moving into a prefab home and trying to renovate. You get exactly what you want, understand every nail and wire, and learn architectural principles along the way.

The ambitious goal: build something approaching VS Code's capability with integrated AI assistance, while keeping the codebase small enough that one person can understand it all.

---

## The Big Picture: A Three-Layer Cake

Solo's architecture splits into three distinct layers:

```
┌─────────────────────────────────────────────────────────────────┐
│                     React Frontend (Webview)                    │
│                     Zustand stores, UI components               │
└────────────────────────────────┬────────────────────────────────┘
                                 │ Tauri IPC (JSON)
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Tauri Bridge (Translator)                   │
│                     Commands, Events, State                     │
└────────────────────────────────┬────────────────────────────────┘
                                 │ Rust function calls
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Rust Backend (Engine Room)                  │
│                     solo-fs, solo-protocol, solo-core           │
└─────────────────────────────────────────────────────────────────┘
```

**The Rust Backend (the "engine room")**: Does the heavy lifting—file system operations, terminal management, AI API calls. This is where performance and safety matter most.

**The Tauri Bridge (the "translator")**: Converts between the frontend's JavaScript world and the backend's Rust world. It handles IPC (Inter-Process Communication), state management, and event broadcasting.

**The React Frontend (the "dashboard")**: What the user sees and interacts with. Modern React 19, Tailwind CSS for styling, Zustand for state management.

### Why This Architecture?

1. **Performance**: Rust handles CPU-intensive work (file scanning, text processing) without blocking the UI
2. **Type Safety**: Rust's compiler catches bugs at compile time, not at 2am in production
3. **Modern UI**: React lets us build the interface we actually want, with the ecosystem we know
4. **Small Bundle**: Tauri produces ~10MB apps vs Electron's ~150MB

---

## The Tech Stack: Why These Choices?

### Tauri vs Electron: The Lightweight Champion


| Aspect           | Electron             | Tauri                |
| ---------------- | -------------------- | -------------------- |
| Bundle Size      | ~150MB               | ~10MB                |
| Memory Usage     | High (full Chromium) | Low (native webview) |
| Backend Language | JavaScript/Node.js   | Rust                 |
| Startup Time     | Slower               | Faster               |


Electron bundles an entire Chromium browser. Tauri uses your OS's native webview (WebKit on macOS, WebView2 on Windows). It's like driving a sports car vs hauling a semi-truck for groceries.

### Rust: The Memory-Safe Powerhouse

Rust is hard to learn. So why bother?

1. **No garbage collector pauses** — smooth 60fps scrolling through huge file trees
2. **Memory safety without runtime cost** — the compiler prevents data races and null pointer bugs
3. **Zero-cost abstractions** — high-level code compiles to the same assembly as hand-written C

For an IDE where responsiveness matters (typing, scrolling, file operations), Rust's performance model is ideal.

### React 19: The Familiar Friend

React's component model maps perfectly to IDE panels: file explorer, editor tabs, terminal panes. React 19's improvements (better concurrent rendering, improved hooks) make complex UIs smoother.

### Zustand over Redux: Less Boilerplate, More Direct

Redux requires: action types, action creators, reducers, selectors, middleware configuration...

Zustand requires:

```typescript
const useStore = create((set) => ({
  count: 0,
  increment: () => set((s) => ({ count: s.count + 1 })),
}));
```

For a team of one, Zustand's simplicity wins.

### Bun over npm: The Speed Demon

Bun installs dependencies 20-30x faster than npm. When you're iterating quickly, waiting 30 seconds vs 1 second per install adds up.

### ts-rs: The Rosetta Stone

This is the secret weapon. The `ts-rs` crate auto-generates TypeScript types from Rust structs:

```rust
#[derive(Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct FileTreeEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub children: Option<Vec<FileTreeEntry>>,
    // ...
}
```

Run `cargo test` and TypeScript bindings appear in `src/bindings/`. Change the Rust struct, regenerate, and TypeScript compilation fails if the frontend is out of sync. No more runtime JSON mismatches.

---

## Codebase Structure: The Map

```
solo/
├── crates/                       # Rust crates (the engine room)
│   ├── solo-core/                # Core traits, types, errors
│   ├── solo-protocol/            # IPC types (generates TypeScript)
│   └── solo-fs/                  # File system operations, watchers
│
├── apps/
│   └── desktop/                  # Tauri desktop app
│       ├── src-tauri/            # Rust Tauri code
│       │   └── src/
│       │       ├── lib.rs        # App initialization
│       │       ├── commands.rs   # Simple commands (ping, config)
│       │       └── fs_commands.rs # File system IPC handlers
│       └── src/                  # React frontend
│           ├── stores/           # Zustand state
│           ├── components/       # React components
│           └── lib/tauri/        # Tauri invoke wrappers
│
├── packages/
│   └── ui/                       # Shared React components
│
└── docs/                         # Architecture decisions
```

How they connect:

1. **Frontend calls** `fs.readDirectory(path, depth)` from `lib/tauri/fs.ts`
2. **Tauri IPC** serializes this to JSON and invokes the Rust command
3. **fs_commands.rs** receives the call, validates, and calls into `solo-fs`
4. **solo-fs/tree.rs** does the actual file system work
5. **Response flows back** as JSON, deserialized using `ts-rs`-generated types

---

## The File Explorer Deep Dive

The file explorer is Solo's most developed feature. Let's trace through how it works.

### Lazy Loading: Loading a Directory Like a Webpage

Imagine if Google loaded the entire internet before showing search results. That's what happens if you load an entire file tree at once—node_modules alone has thousands of files.

Instead, Solo uses **lazy loading**:

```rust
pub fn read_directory(path: &Path, depth: u32) -> FsResult<FileTreeEntry> {
    // depth=1 means: load this dir + immediate children only
    let children = if depth > 0 {
        Some(read_directory_children(path, depth - 1)?)
    } else {
        None  // Signals "not loaded yet" to the frontend
    };
    // ...
}
```

When you expand a folder:

1. Frontend calls `readDirectory(path, 1)`
2. Backend returns just that folder's immediate children
3. Children with `children: None` show expand arrows but haven't loaded their contents yet
4. Click to expand, load on demand

This keeps the initial load fast regardless of project size.

### File Watching: A Security Camera for Your Filesystem

When you create a file in Finder or another editor, Solo needs to know. The `FileWatcher` uses the `notify` crate to subscribe to filesystem events:

```rust
pub struct FileWatcher {
    event_tx: broadcast::Sender<FileWatchEvent>,
    debounce_duration: Duration,  // Default: 100ms
}
```

**Key insight: debouncing**. Text editors save files in multiple writes. Without debouncing, you'd get dozens of "file changed" events for a single save. The watcher collects events for 100ms, then emits the final state.

Events flow from Rust to the frontend via Tauri's event system:

```rust
app_handle.emit("backend-event", &BackendEvent::FileCreated { path })
```

The frontend listens with `listen("backend-event", callback)` and updates Zustand state accordingly.

### The Zustand Store: Where State Lives

The file explorer store (`fileExplorerStore.ts`) maintains:

```typescript
interface FileTreeState {
  rootPath: string | null;
  entries: Map<string, FileTreeEntry>;  // O(1) lookups by path
  expanded: Set<string>;                 // Which folders are open
  selected: Set<string>;                 // Multi-select support
  loading: Set<string>;                  // Folders currently loading
  renamingPath: string | null;           // Inline rename state
  error: string | null;
}
```

The `entries` Map enables O(1) updates when file events arrive. Without this, updating a deeply nested file would require walking the tree.

---

## The IPC Protocol: Frontend to Backend Communication

Think of IPC like a restaurant:

- **Customer (frontend)**: "I'd like the file contents, please"
- **Waiter (Tauri)**: Takes the order, writes it down (JSON serialization)
- **Kitchen (Rust backend)**: Prepares the response
- **Waiter**: Brings it back (JSON deserialization)

### Commands (Frontend → Backend)

```rust
#[tauri::command]
pub async fn read_directory(
    request: DirectoryReadRequest,
    state: State<'_, FsState>,
) -> Result<DirectoryReadResponse, FileOperationError> {
    // ...
}
```

The `#[tauri::command]` macro makes this callable from JavaScript. The types are defined in `solo-protocol` and auto-exported to TypeScript.

### Events (Backend → Frontend)

For real-time updates (file changes, terminal output), the backend emits events:

```rust
#[serde(tag = "type", content = "payload")]
pub enum BackendEvent {
    #[serde(rename = "file:changed")]
    FileChanged { path: String },

    #[serde(rename = "terminal:data")]
    TerminalData { id: String, data: String },
    // ...
}
```

The `#[serde(tag = "type")]` creates discriminated union types in TypeScript, enabling proper pattern matching on event types.

---

## Security Considerations

### Path Traversal: The Classic Attack

Imagine this request: `readFile("../../../etc/passwd")`. If the backend naively reads whatever path it receives, an attacker can read any file on the system.

Solo prevents this with workspace boundaries:

```rust
pub fn validate_path(path: &Path, workspace_root: &Path) -> FsResult<PathBuf> {
    let canonical = path.canonicalize()?;  // Resolves .. and symlinks
    let canonical_root = workspace_root.canonicalize()?;

    if !canonical.starts_with(&canonical_root) {
        return Err(FsError::PathOutsideWorkspace(path.display().to_string()));
    }
    Ok(canonical)
}
```

The key is `canonicalize()`. It resolves `..` segments and symlinks to the real absolute path, so `workspace/../../../etc/passwd` becomes `/etc/passwd`, which clearly doesn't start with the workspace root.

### Filename Validation: Edge Cases Galore

Did you know Windows reserves certain filenames?

```rust
let reserved = ["CON", "PRN", "AUX", "NUL", "COM1", "COM2", ...];
```

Try creating a file called `CON.txt` on Windows—it's a reserved name for the console device. Solo blocks these to prevent cross-platform issues.

Other checks:

- No null bytes (can truncate paths in C-based systems)
- No leading/trailing whitespace (causes confusion in terminals)
- No path separators in filenames

---

## Lessons Learned: The Real Gold

### Bug Story #1: The TOCTOU Race Condition

**TOCTOU** = "Time Of Check to Time Of Use"

Original code:

```rust
// Check if directory is empty
if fs::read_dir(&path)?.count() > 0 {
    return Err(DirectoryNotEmpty);
}
// Delete it
fs::remove_dir(&path)?;
```

The bug: between checking and deleting, another process could add a file. The check passes, but the delete fails.

**Fix**: Let the OS tell you what happened:

```rust
fs::remove_dir(&validated_path).map_err(|e| {
    #[cfg(unix)]
    let is_not_empty = e.raw_os_error() == Some(libc::ENOTEMPTY);

    if is_not_empty {
        FsError::DirectoryNotEmpty(path.display().to_string())
    } else {
        FsError::from_io_error(e, &path.display().to_string())
    }
})
```

No check-then-act. Just act, and handle the result.

### Bug Story #2: The Blocking Channel Fiasco

The file watcher callback runs in a `notify` crate thread. Original code:

```rust
move |res: Result<Event, notify::Error>| {
    if let Ok(event) = res {
        tx.blocking_send(event).unwrap();  // BLOCKS
    }
}
```

Problem: If the channel buffer fills up (256 events), `blocking_send` blocks. But this is a `notify` callback—blocking here freezes the watcher thread, and you miss subsequent events.

**Fix**: Use `try_send` and accept dropped events:

```rust
if tx.try_send(event).is_err() {
    // Channel full or closed - event will be dropped
    // This is acceptable as we're debouncing anyway
}
```

Since we're debouncing (coalescing events over 100ms), dropping occasional events during a burst is fine.

### Bug Story #3: Silent Watcher Failures

What if starting the file watcher fails (permissions, OS limits)?

Bad approach: Crash the folder-open operation.

**Good approach**: Graceful degradation:

```typescript
try {
    await fs.startWatching(path, true);
} catch (watchError) {
    console.warn('Failed to start file watcher:', watchError);
    // Continue without live updates - the folder is still usable
}
```

The folder opens, you can browse files, you just don't get real-time updates. 90% functionality is better than 0%.

### Pattern: Promise.allSettled for Bulk Deletions

When deleting multiple files:

```typescript
// BAD: One failure stops everything
await Promise.all(paths.map(p => fs.deleteFile(p)));

// GOOD: Complete what we can, report failures
const results = await Promise.allSettled(paths.map(p => fs.deleteFile(p)));

results.forEach((result, index) => {
    if (result.status === 'rejected') {
        errors.push(`${paths[index]}: ${result.reason}`);
    }
});
```

Deleting 10 files shouldn't fail because file #3 had a permission error. Delete the 9 that work, report the 1 that didn't.

### Pattern: Configuration Structs with Presets

For complex operations, use configuration structs with preset factories:

```rust
pub struct CountConfig {
    pub max_count: u32,
    pub timeout: Duration,
    pub respect_gitignore: bool,
    pub include_hidden: bool,
}

impl CountConfig {
    /// Quick UI feedback - lower limits, faster response
    pub fn quick() -> Self {
        Self {
            max_count: 10_000,
            timeout: Duration::from_millis(100),
            ..Default::default()
        }
    }

    /// Thorough counting - higher limits, more accurate
    pub fn thorough() -> Self {
        Self {
            max_count: 1_000_000,
            timeout: Duration::from_secs(5),
            ..Default::default()
        }
    }
}
```

Callers pick `CountConfig::quick()` or `CountConfig::thorough()` without understanding all the fields.

### Pattern: Atomic Operations for Thread-Safe Counting

When multiple threads count files in parallel:

```rust
let count = AtomicU32::new(0);

walker.run(|| {
    let count_ref = &count;
    Box::new(move |entry_result| {
        if entry_result.is_ok() {
            count_ref.fetch_add(1, Ordering::Relaxed);
        }
        WalkState::Continue
    })
});
```

`AtomicU32` with `Ordering::Relaxed` is perfect here—we just need the final total, not ordering between threads.

### Anti-Pattern: Don't Use Browser confirm() in Tauri

```javascript
// DOESN'T WORK IN TAURI
if (confirm("Delete this file?")) {
    // ...
}
```

Tauri's webview doesn't support `window.confirm()`. Use the Tauri dialog plugin or build your own modal component (which Solo does with `ConfirmDialog.tsx`).

### Anti-Pattern: Don't Pre-Check Before OS Operations

```rust
// BAD: Check-then-act
if path.exists() {
    fs::remove_file(path)?;
}

// GOOD: Act and handle errors
match fs::remove_file(path) {
    Ok(_) => Ok(()),
    Err(e) if e.kind() == ErrorKind::NotFound => Ok(()), // Already gone, that's fine
    Err(e) => Err(e),
}
```

The file could be deleted between your check and your action. Just do the operation and handle the result.

---

## What's Next: The Roadmap

### Terminal Integration

Using `portable-pty` for cross-platform PTY (pseudo-terminal) management. The terminal panel will embed `xterm.js` for the UI.

Challenges:

- PTY resizing when panel resizes
- Flow control (what if output comes faster than we can render?)
- Shell integration (detecting current directory, command status)

### Code Editor

CodeMirror 6 for the editor—it's fast, extensible, and has good TypeScript support. Key features to implement:

- Syntax highlighting via TreeSitter
- Multiple cursors
- Find/replace with regex
- Language Server Protocol integration

### AI Agent Integration

The core vision: Claude as an integrated assistant that can:

- See your file tree and current file
- Execute commands (with permission)
- Edit files with proposed diffs
- Answer questions about the codebase

This requires careful UI/UX design—the AI needs to be helpful without being intrusive.

---

## Closing Thoughts: What Building This Teaches

### Systems Thinking

An IDE isn't a single program—it's a system. Frontend talks to backend through an IPC layer. File watcher events flow through broadcast channels to state stores to UI updates. Understanding these flows is systems thinking.

### Trade-offs Everywhere

- **Performance vs simplicity**: Lazy loading adds complexity but enables large projects
- **Safety vs convenience**: Path validation slows things down but prevents security holes
- **Rust vs JavaScript**: Rust is harder to write but catches more bugs at compile time

There are no perfect choices, only trade-offs made consciously.

### The Importance of Good Error Handling

80% of code in a production system is error handling. What happens when:

- The file doesn't exist?
- Permission is denied?
- The disk is full?
- The network times out?

Robust error handling with clear error types (`FileErrorCode`, `FsError`) makes debugging possible and users less frustrated.

### Learn by Building

Reading about file watchers and IPC and state management is one thing. Building them yourself—debugging the race conditions, hitting the edge cases, figuring out why your watcher stopped working—is where real understanding happens.

Solo exists because the best way to understand an IDE is to build one.

---

*Built with Rust, Tauri, React, and an unreasonable amount of coffee.*