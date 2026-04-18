# codex-extract

Captures the visual DNA of Codex.app (or any Electron app) as structured JSON for Solo's design system. Part of Layer 0 of the `design` skill — see `.solo/skills/design/extraction.md`.

## Quick start

```bash
# Automated — launches Codex with remote debugging and runs every extractor
cd solo && bun scripts/codex-extract/launch.ts

# Dry run — prints what would happen without spawning Codex
cd solo && bun scripts/codex-extract/launch.ts --dry-run

# Attach to an already-running instance
cd solo && bun scripts/codex-extract/extract.ts --attach ws://127.0.0.1:9222/devtools/page/...

# Manual dev-console fallback
#   1. Open Codex DevTools (Cmd+Opt+I)
#   2. Paste solo/.solo/skills/design/dev-console-snippet.js into Console
#   3. Drop the downloaded codex-dump-*.json into packages/ui/design-dump/codex/manual/
#   4. Run:
cd solo && bun scripts/codex-extract/post-process.ts
```

## Output

All extraction runs produce the same layout:

```
solo/packages/ui/design-dump/codex/
├── stylesheets/NN-<hash>.css    # raw CSS texts, one per source stylesheet
├── computed-styles.json         # { archetype: { selector, states: {default, hover, focus, ...} } }
├── tokens.json                  # CSS custom properties with resolved values
├── fonts.json                   # @font-face + loaded FontFace inventory
├── keyframes.json               # { name: { definition, consumers: [...] } }
├── assets/                      # gitignored — icon/image downloads
└── README.md                    # date, Codex version, mode, archetypes hit/missed
```

## Archetype catalog

Selectors live in `archetypes.json`. Each archetype has multiple fallback selectors — the first match wins. Update when Codex ships a new layout or when you discover a better heuristic.

## Files

- `launch.ts` — spawns Codex.app with `--remote-debugging-port` + user-data-dir isolation
- `extract.ts` — orchestrator; enables CDP domains and runs every extractor in sequence
- `cdp.ts` — thin WebSocket CDP client using Bun's `WebSocket` global
- `post-process.ts` — splits a manual `codex-dump.json` into the same layout as CDP mode
- `types.ts` — shared interfaces (ExtractorContext, CDP message shapes, archetype schema)
- `archetypes.json` — hand-curated selector catalog
- `extractors/stylesheets.ts`
- `extractors/computed.ts`
- `extractors/fonts.ts`
- `extractors/tokens.ts`
- `extractors/keyframes.ts`
- `extractors/assets.ts`

## Requirements

- Bun ≥ 1.1 (WebSocket globals)
- Codex.app installed at `/Applications/Codex.app` (or `--codex-path` flag)
- macOS (Linux/Windows paths not yet supported — contribute if needed)
