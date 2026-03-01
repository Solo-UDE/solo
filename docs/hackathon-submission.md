## Inspiration

We kept asking ourselves the same question: why does every AI coding tool feel like a chatbot duct-taped to the side of an editor? You type a question, get a code snippet, copy-paste it, hope it works. The agent can't see your file tree. It can't run your tests. It can't even tell you if your project compiles. Meanwhile, the editor itself is an Electron app burning through half a gigabyte of RAM just to display a blinking cursor.

We imagined something different. An IDE built from the ground up where AI agents aren't passengers - they're co-pilots with real access to your workspace. They can read your files, search your codebase, execute commands, and write code, all with your explicit approval on every action. And we wanted the whole thing to ship as a 15 MB native binary that launches in under a second.

## What it does

Solo is a native desktop IDE where AI agents are co-pilots with real access to your workspace. Open a project and your agent already understands the full context - file structure, git history, language, dependencies. Ask it to refactor a module and it doesn't just suggest code in a chat bubble. It reads the relevant files, writes the changes, runs your linter, and shows you a diff for approval. Three AI providers (Claude, GPT, Gemini) plug into the same unified tool system, so you pick the model that fits the task without changing your workflow. You stay in control of every action.

Under the agent layer is a complete development environment: a terminal emulator with multi-tab sessions, a file explorer with real-time filesystem watching, a Monaco-powered code editor with syntax highlighting and symbol navigation, and native git integration with 16 commands covering staging, commits, push, pull, branching, and side-by-side diffs. The panel system lets you tile everything - editor, terminal, agent, and diff views - exactly the way you work. Everything runs local-first. Your code never leaves your machine. Credentials live in the macOS Keychain. The entire app weighs 15 MB and idles at 60-100 MB of RAM.

## How we built it

The most interesting architectural decision was running the AI agent as a separate Node.js sidecar process, communicating with the Rust backend through structured JSON over stdin/stdout. This gives us fault isolation, independent restartability, and direct access to the Claude Agent SDK without compromising the Rust-native architecture. Six built-in tools (Bash, Glob, Grep, ReadFile, WriteFile, EditFile) give agents real workspace access, and every destructive action flows through a permission gate before execution.

The two halves of the application connect through a fully typed IPC bridge. The backend is pure Rust, organized as a Cargo workspace of seven crates covering protocol types, file operations, git commands, OAuth, tree-sitter parsing, and semantic search - with TypeScript bindings auto-generated through `ts-rs` as a single source of truth across languages. All of this ships inside a Tauri 2 shell that produces a single native binary.

The frontend is React 19 with Vite, styled in Tailwind CSS 4 using an OKLCH perceptually-uniform color system that makes light and dark themes look equally intentional. State management runs through ten Zustand stores with Immer middleware, one per domain. The editor is Monaco. The terminal is xterm.js. The panel layout uses react-mosaic for a fully tiled, draggable workspace.

## Challenges we ran into

The biggest realization of this hackathon was counterintuitive: building something from scratch would have been easier than continuing to build on what already existed. These two days were not greenfield development. They were surgery on a living system. Every new feature we introduced meant tearing down existing structures first - ripping out a two-panel sidebar to replace it with a unified accordion, gutting a polling-based git system to rewire it as event-driven, replacing an entire font sizing approach across 24 files. And every teardown surfaced errors we did not expect. Components that depended on the old structure broke in subtle ways. State that flowed cleanly through the previous architecture needed new paths through the replacement. The work was not just building - it was demolition, error recovery, and reconstruction in a codebase that had to keep running through all of it.

Light mode exposed every shortcut we had taken in the design system. We had built a glassmorphism aesthetic with backdrop blur and semi-transparent backgrounds that looked stunning in dark mode. Then we switched to light mode and half the UI disappeared - indicators that should communicate state became invisible, muted text vanished, and font sizes that had been set component-by-component rendered inconsistently. The fix required a full audit across 24 files, but the root cause was the same everywhere: visual decisions that were never abstracted into a system.

The sidebar restructuring was a UX-driven decision that turned into an architecture problem. The old two-panel layout - one view for repos, another for worktrees - created constant confusion about where you were in the navigation. Collapsing it into a single unified accordion meant restructuring how repository state flows through the component tree. Every repo card needed to show branch badges, worktree counts, dirty indicators, and loading states in a compact space without feeling cramped.

TTS had a subtle timing bug that took longer to find than to fix. The stop button was reverting its UI state the moment the user clicked it, but the audio buffer was still playing for another second or two. We had to track the audio playback lifecycle separately from the control state so the UI only resets after the last buffer actually finishes.

## Accomplishments that we're proud of

Two days of work touched nearly every surface of the application - 24 files normalized, both Rust and TypeScript layers refactored - and users can feel the difference.

The git worktree integration is what we are most proud of as a feature. Solo does not just support basic git operations - it gives you full worktree management built directly into the sidebar. You can create, switch, and monitor worktrees without ever leaving the IDE or opening a terminal. Each worktree shows its branch, dirty state, and agent session binding at a glance. The dirty worktree indicator that was invisible yesterday now uses semantic warning tokens that the design system manages automatically. Commits, pushes, pulls, staging, and branch creation are all automated through the UI with streaming progress feedback. The source control panel reacts to filesystem changes in real time through event-driven updates instead of polling, so the moment you save a file, the diff is already there. This is not a git GUI bolted onto an editor - it is git woven into the fabric of the development experience.

We normalized font sizes across 24 files, replacing scattered pixel values with a consistent typographic scale. We built a theme-aware color system where every indicator, every badge, every piece of muted text adapts correctly in both light and dark mode without a single manual override.

The sidebar went from confusing to intuitive. A unified accordion with inline worktree rows, status badges, and expandable repo cards replaced a disjointed two-panel layout. You can now see your entire workspace context - repos, branches, worktree counts, dirty state - in a single glance without switching views.

The TTS stop button taught us something about UI honesty. The fix was small - tracking audio playback lifecycle separately from control state - but the principle matters: a button should reflect what the user is experiencing, not what the code has scheduled. Getting that right is the kind of detail that separates software that feels polished from software that feels close.

And through all of this, nothing broke. The typed IPC pipeline caught every mismatch at build time. The Zustand stores absorbed new state shapes without regressions. Eight phases of accumulated architecture held up under a sweeping two-day polish pass, and that might be the accomplishment we are most proud of.

## What we learned

Continuing development is harder than starting fresh. That is not an excuse to rewrite everything, but it is a truth we felt deeply over these two days. Every improvement required understanding what existed, why it was built that way, what depended on it, and how to replace it without breaking the chain. New features did not just slot in - they displaced old ones, and the displacement created errors that had to be traced, understood, and resolved before we could move forward. The cognitive overhead of building on top of existing structures, especially when those structures need to change, is fundamentally different from building on a blank canvas. Greenfield feels like drawing. Brownfield feels like editing someone else's essay in a language you are still learning.

The focus of these two days was UX-driven feature introduction and UI/UX improvement, and that framing changed how we thought about every decision. We were not adding capabilities for the sake of technical completeness. We were asking: does this feel right when you use it? Does the sidebar make sense at a glance? Does the dirty indicator actually communicate state? Does the stop button tell the truth? That lens forced us to care about details we might have deprioritized in a feature-first sprint.

Design systems pay for themselves in moments like this. When we needed to fix light mode contrast across the entire app, having OKLCH semantic tokens meant we could change a few variable definitions and watch corrections cascade through every component. Small visual bugs - an invisible indicator, a stop button that lies, font sizes that shift with no logic - erode trust faster than missing features. Fixing them made the app feel like it jumped a version number overnight. And the best refactors are the ones where you delete special cases: replacing `text-[10px]`, `text-[11px]`, `text-[9px]`, and `text-[12.5px]` with `text-2xs`, `text-xs`, and `text-sm` was not just cleanup - it was eliminating decisions that should never have been made individually in the first place.

## What's next for Solo IDE

Phase 9 opens the door to cloud-connected workflows. A checkpoint system will let you save and restore full workspace states, so you can branch your entire development context the way you branch code. A Solo Server backend will enable project management, persistent chat history, and team collaboration. We are building integrations for Vercel deployment, GitHub App access, and Supabase provisioning so that agents can not only write your code but ship it.

The most ambitious direction is voice-first development powered by ElevenLabs. We are building toward a coding experience where every interaction can be spoken instead of typed. Commit your changes by saying so. Approve a tool permission with your voice. Create a GitHub issue by describing it in conversation. Push to production by confirming out loud. The STT and TTS foundation is already in place - the next step is wiring voice as a first-class input channel across every action in the IDE. Solo would be the first IDE where you can build an entire feature without touching your keyboard.

Brand management is coming to Solo. We want teams to be able to define brand guidelines - colors, typography, voice, component patterns - and have the AI agent enforce them automatically during code generation. No more manually checking if a new component matches the design system. The agent knows the brand and writes code that respects it from the first line.

Further out, we are exploring an extension system, LSP integration for full language intelligence, and cross-platform support for Windows and Linux. The foundation is built. Now we scale it.
