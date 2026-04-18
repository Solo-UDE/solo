# Contributing a Skill

Thank you for adding to the skills catalog. Skills are for **every domain, not just coding** — poetry, finance, photography, design, mathematics, cooking, legal research, whatever. If you can describe expertise in markdown, you can package it as a skill.

## Quick start

1. Fork this repo.
2. Create `skills/<your-skill-id>/AGENTS.md` with the frontmatter below.
3. Open a PR. CI validates the structure; a reviewer checks the content.
4. On merge, `registry.json` is regenerated and Solo clients pick up your skill within 24 hours.

## Required fields

```yaml
---
name: your-skill-id                       # must match the folder name
version: 1.0.0                            # semver; bump on each change
description: >                            # one-line, ends a sentence like
  Use when ...                            # "Use when the user asks to X."
                                          # This is what the agent reads to
                                          # decide whether to activate.
---
```

## Optional fields

- `categories: [design, writing, finance, science, life, code, …]` — drives the Marketplace tab grouping.
- `author: your-github-handle`
- `license: MIT` (or any OSI-approved)
- `tags: [searchable, keywords]`

## Naming rules

- **Folder name === `name` field.** `skills/poetry-writer/AGENTS.md` ⇒ `name: poetry-writer`.
- Lowercase, hyphen-separated, alphanumeric. No spaces.
- Unique across the registry.

## Content rules

- **Markdown only.** No shell scripts, no Python, no JavaScript, no binaries. Solo enforces this on install. If you need executable behavior, describe the steps in markdown and let the agent run them via its built-in tools.
- **Size limit: 5 MB per skill.**
- **No credentials, API keys, or private data.**
- **No prompt-injection attempts against reviewers or future users.**

## What makes a good skill

- **Clear activation signal.** The `description` tells the agent when to use this skill. Be specific: "Use when the user asks to write a sonnet or haiku" beats "Poetry helper."
- **Self-contained.** Assume the agent has never read this skill before. Include the full reasoning, not pointers to external docs.
- **Examples.** Show, don't tell. Include 2–3 concrete examples of input → ideal output.
- **Scoped.** A skill is a specialty, not a toolkit. Prefer several small skills over one omnibus.

## Review criteria

- Passes CI: `bun run validate` locally.
- Frontmatter fields present and well-formed.
- Folder name matches `name`.
- No executables or binaries.
- Content is genuinely useful for the described scope.
- No attempt to jailbreak or prompt-inject downstream users.

## Updating a skill

- Bump `version` in the frontmatter.
- Explain the change in the PR description.
- Semantically-versioned: patch for clarifications, minor for additions, major for breaking changes to activation behavior.

## Licensing

Each skill declares its own license via `license:` frontmatter. If absent, we assume MIT. Solo users see the license in the Marketplace tab before installing.

## Governance

Disputes and edge cases are resolved by the Solo team for this registry. Anyone can fork and self-govern.
