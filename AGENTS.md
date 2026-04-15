# Repository Rules

## Master Merge Gate

- Before opening or merging any PR into `master`, run `bun run premerge:master` from the repository root on macOS.
- `SOLO_SUPABASE_URL` and `SOLO_SUPABASE_ANON_KEY` must be set before running that command.
- Do not recommend or complete a merge to `master` unless `bun run premerge:master` has passed end to end in the current branch state.
- If the command cannot be run fully, treat that as a blocker and report exactly what was not validated.
- If a merge from `dev` introduces failures, fix them in the source branch and rerun the gate before merging.
- Treat the `Pre-Merge Master Gate` GitHub Actions workflow as the CI equivalent of this local check. Treat the `Build Master DMG` workflow as a post-merge artifact build, not as merge validation.
