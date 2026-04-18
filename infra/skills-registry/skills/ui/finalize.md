# Organize

Use this when the user wants to clean up, componentize, or organize their UI code.

## Activation

Activate when the user asks to:

- clean up, organize, or refactor code structure
- extract or componentize a page or section
- reduce duplication in UI code

Do not activate when:

- the user wants a new design or layout
- the request is about visual changes, not code structure
- the user wants to clean up Tailwind classes (that's a design-guidelines/general concern)

## User-facing progress updates

Keep the user informed so longer runs do not look stuck.

- One-line status update before each major phase.
- Concrete and lightweight: what you are doing now, not verbose logs.

## Rules

- Break designs into small, focused components instead of rendering everything in a single large component — extract repeated patterns, logical sections, and self-contained UI blocks into their own components
- Never bake margins into components — apply margins at the call site instead; every component must accept a `class` attribute and merge it with the classes on the component's top-level element
- Use `clsx` or similar to merge classes together in client-side components
- Always extract form controls into reusable components organized by HTML element — one `Input` component for all `<input>` types (text, email, password, etc.), one `Select` for `<select>`, one `Textarea` for `<textarea>`; never create type-specific components like `EmailInput` or `PasswordInput`; check the project for existing ones before creating new ones
- When two or more elements share the same structure and styling but differ only in props like labels, placeholders, or types — extract them into a single reusable component parameterized by those differences
- After extracting components, scan them for duplicated patterns and extract shared elements into reusable components — e.g. repeated section container/max-width/padding wrappers, repeated heading group structures (eyebrow + heading + subheading), repeated card shells, repeated button styles
- Always use existing project components when they are available — reuse or extend them instead of creating new ones; buttons and form elements are especially common candidates
- Use `npx @tailwindcss/cli canonicalize` to clean up Tailwind class lists — collapses shorthands (`mt-2 mr-2 mb-2 ml-2` → `m-2`), resolves overrides (`py-3 p-1 px-3` → `p-3`), canonicalizes arbitrary values to named utilities, and sorts classes; pass `--css path/to/input.css` if the project uses a custom CSS entry file

  Single class string:

  ```sh
  npx @tailwindcss/cli canonicalize "mt-2 mr-2 mb-2 ml-2"
  # m-2
  ```

  Multiple class strings as positional args (each returned on its own line):

  ```sh
  npx @tailwindcss/cli canonicalize "py-3 p-1 px-3" "mt-2 mr-2 mb-2 ml-2"
  # p-3
  # m-2
  ```

  Pipe class strings via stdin (one per line):

  ```sh
  echo "py-3 p-1 px-3\nmt-2 mr-2 mb-2 ml-2" | npx @tailwindcss/cli canonicalize
  # p-3
  # m-2
  ```

  Use `--format json` or `--format jsonl` for structured output with `input`/`output`/`changed` fields:

  ```sh
  npx @tailwindcss/cli canonicalize --format json "py-3 p-1 px-3"
  # [{ "input": "py-3 p-1 px-3", "output": "p-3", "changed": true }]
  ```

  Use `--stream` to process stdin line-by-line without buffering:

  ```sh
  npx @tailwindcss/cli canonicalize --stream
  ```
