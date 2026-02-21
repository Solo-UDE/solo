# 07 - Tool Definitions

Source: Reference prompt system — `agents/coding/tools/prompts.ts` (338 lines)

## Overview

This file exports description strings for all 19 tools available to the coding agent. These descriptions are passed to the LLM as part of tool registration so the model understands when and how to use each tool. The descriptions include argument specifications, return value documentation, security constraints, and usage examples.

---

## All 19 Tool Description Exports

### File Operations

**1. READ_FILE_DESCRIPTION**
Read the contents of a file. Takes `file_path`, returns file contents as string.

**2. EDIT_FILE_DESCRIPTION**
Propose an edit to an existing file using abbreviated edit snippets. Uses `<code_edit_instructions>` format where unchanged sections are replaced with comments like `// ... rest of code ...` or `// ... keep existing code ...`. A less intelligent model merges the edit snippet. Takes `target_file` and `code_edit`.

**3. CREATE_FILE_DESCRIPTION**
Create a new source file by writing provided code. Does not generate code -- writes supplied `code` to `file_path`, then validates for runtime/type errors.

**4. DELETE_FILE_DESCRIPTION**
Delete a file from the sandbox. Takes `file_path`, returns confirmation or error.

### Search Operations

**5. GREP_SEARCH_DESCRIPTION**
Search for exact text matches across files using native grep. Args: `search_term`, `file_glob` (default `**/*.ts*`), `case_insensitive`. Returns matches in `path:lineNo:line` format (max 200 matches).

**6. GLOB_SEARCH_DESCRIPTION**
Find all files matching a glob pattern using native find. Args: `glob_pattern`, `base_path` (default project root). Returns file paths sorted alphabetically.

**7. LIST_DIR_DESCRIPTION**
List directory contents. Quick discovery tool before using more targeted tools. Takes `relative_workspace_path` and optional `explanation`. Returns formatted directory listing.

### Web & External

**8. WEB_SEARCH_DESCRIPTION**
Search the web for real-time information using Exa AI. For up-to-date information not in training data. Args: `search_term` (specific, include version numbers). Returns formatted results with titles, URLs, content summaries.

**9. WEB_RESEARCH_TOOL_DESCRIPTION**
Agentic web research agent for deeper research. Used for third-party integration docs, real-time events, technology updates. Single arg: topic to research.

**10. CURL_DESCRIPTION**
Execute HTTP requests using curl. Default base URL: `http://localhost:3000` for relative paths. Args: `url`, `method` (GET/POST/PUT/DELETE/PATCH), `data` (JSON string), `headers` (newline-separated). Returns status code, headers, body.

### Package Management

**11. NPM_INSTALL_DESCRIPTION**
Execute npm install commands inside the project directory. Security hardened: only "npm install" commands allowed, dangerous operations rejected. Args: `command` (e.g., `npm install react-icons`).

### Code Execution

**12. RUN_BASH_COMMAND_DESCRIPTION**
Execute bash commands with security restrictions. Runs from project root.

Allowed: shell commands, read-only git, package management, build tools, testing, utilities, npx, chained commands.

Prohibited:
- `cat/head/tail` -> use read_file
- `ls` -> use list_dir
- `grep` -> use grep_search
- `find` -> use glob_search
- Destructive git (commit, reset, push --force, rm, clean, rebase, etc.)
- Destructive operations (rm -rf /, sudo, etc.)

### AI Generation

**13. GENERATE_IMAGE_DESCRIPTION**
Generate AI images based on prompts, returning publicly accessible Supabase Storage URLs. Args: `prompt` (vivid description), `negative_prompt`, `aspect_ratio` (1:1, 16:9, 9:16, 3:4, 4:3). Includes prompt crafting guidelines: use modifiers, include aspect ratio hints, prefer vivid language over vague adjectives.

**14. GENERATE_VIDEO_DESCRIPTION**
Generate 5-second video clips (540p, non-looping) using Luma's Ray2 Flash model. Args: `prompt`, `aspect_ratio` (16:9, 9:16, 4:3, 3:4, 21:9, 9:21). Returns public URL or error.

### Task Management

**15. TODO_WRITE_DESCRIPTION**
Create and manage structured task lists. Args: `todos` (array of `{ id, content, status }` where status is pending/in_progress/completed/cancelled), `merge` (boolean). Returns updated todo list.

### Environment & Integration

**16. ASK_ENVIRONMENTAL_VARIABLES_DESCRIPTION**
Request environment variables from the user. Halts execution immediately after calling, allowing user to provide values. Args: `variable_names` (list of env var names). Must be called BEFORE implementing integration work.

### Sub-Agent Delegation

**17. USE_DATABASE_AGENT_DESCRIPTION**
Delegate all database operations to specialized DatabaseAgent. Handles setup, schemas, migrations, seeding, API routes. Always use integer IDs (never UUID).

Key behavior: "Trust database agent outputs completely -- use schemas, APIs, and seeders exactly as provided. Never validate or modify database agent results."

For seeder requests: first analyze UI components to find mock data/placeholder text, pass this context to the database agent for realistic seeds.

After database operations: immediately integrate API endpoints with UI (loading states, error handling, data fetching patterns, optimistic updates).

**18. USE_AUTH_AGENT_DESCRIPTION**
Delegate authentication setup to AuthAgent. Sets up complete email/password auth with better-auth. Args: `prompt`, `protected_routes` (list of routes like `["/dashboard", "/profile"]`).

**19. USE_PAYMENTS_AGENT_DESCRIPTION**
Delegate payments setup to PaymentsAgent. Installs packages, adds Autumn provider files and API routes, configures Stripe env vars. Args: `prompt` (natural language description of products/pricing).

---

## Edit File Format Detail

The `EDIT_FILE_DESCRIPTION` defines a specific format where edits use abbreviated snippets:

```
Rules for code edit snippets:
- Abbreviate unchanged sections with: "// ... rest of code ...",
  "// ... keep existing code ...", "// ... code remains the same"
- Be precise with comment placement -- a less intelligent model uses
  context clues to merge
- Include concise info: "// ... keep calculateTotalFunction ..."
- For deletions, provide surrounding context
- Use language-appropriate comment format
- Preserve indentation of final expected code
- Be length-efficient without omitting key context
```

This pattern is reused across multiple agents (coding, template, database, clone).

---

## Security Notes

- npm_install: only allows `npm install` commands; rejects dangerous operations
- bash: explicit allow/deny lists with tool-specific alternatives
- File tools: operate within project sandbox
- Sub-agents: trusted outputs (especially database agent results are used as-is)
- Environment variables: halting pattern forces user interaction before using secrets
