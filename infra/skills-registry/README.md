# Solo Skills Registry

The open-source catalog of skills for [Solo IDE](https://github.com/solo/solo).

A **skill** is a piece of markdown that teaches any AI agent how to do something well — writing poetry, formatting finance reports, generating UI mockups, answering math homework, anything. Skills are domain-agnostic by design. They're not coding assistants; they're reusable expertise packaged as plain text.

This repository is the canonical registry Solo fetches to populate its Marketplace tab. Anyone can contribute a skill — see `CONTRIBUTING.md`.

## How it works

1. Each skill lives at `skills/<skill-id>/` with at minimum an `AGENTS.md` file (YAML frontmatter + markdown body).
2. CI validates every PR and regenerates `registry.json` on merge to `main`.
3. Solo clients fetch `registry.json`, cache it for 24 hours, and install individual skills on demand.

Skills use the [AGENTS.md](https://agents.md) open standard, so they're portable to Cursor, Codex, Windsurf, Aider, and any other AGENTS.md-aware tool.

## What's in a skill

```
skills/my-skill/
├── AGENTS.md              ← the skill body (required)
├── examples/              ← optional supporting markdown files
└── reference.md           ← optional supporting files
```

`AGENTS.md` frontmatter:

```yaml
---
name: my-skill
version: 1.0.0
description: One-line description of when to use this skill.
categories: [writing, finance]
author: your-github-handle
license: MIT
tags: [example, tag]
---

# My Skill

Freeform markdown body the agent reads when the skill activates.
```

Only `name` and `description` are required.

## Install a skill in Solo

Open the vault sidebar → **Skills** → **Marketplace** tab → click **Install**.
Or from the CLI: `solo skills install my-skill`.

Installed skills live at `~/.solo/skills/<id>/` and are automatically available to any agent session.

## Fork the registry

Teams can run their own registry:

1. Fork this repo.
2. Add your skills.
3. In Solo → Settings → Skills → set **Registry URL** to your fork's `registry.json` raw URL.

Solo supports multiple registries simultaneously (Phase 3+).

## License

MIT for this repository's infrastructure (scripts, CI, README). Individual skills declare their own licenses in their frontmatter.
