# Skill Reconciliation

This document captures how `@solo/ui` handles the rules defined in the Inspirations UI skill at `/Users/sachin/Developer/Orbit_Main/Inspirations/Skills/ui/design-guidelines/`. The authoritative, always-current version lives with the design skill:

**→ `solo/.solo/skills/design/reconciliation.md`**

That's the file to read and update. This file exists only as a local pointer so developers browsing `packages/ui/src/` find it without leaving the package.

## Summary

Solo follows most skill rules verbatim. The documented deviations are:

- **Fonts**: SF Pro (native macOS) over Inter (skill default).
- **Body text size**: `text-xs` and `text-2xs` permitted in dev-tool chrome (status bars, kbd chips, file-tree labels) — app baseline is still `text-sm` (13px).
- **Button sizes**: four sizes (xs/sm/md/lg) over the skill's recommended two — justified by dev-tool density needs.
- **Touch targets**: 48×48 minimum does not apply (desktop mouse-only).
- **Dark-mode shadows**: softened, not removed — essential for floating-panel elevation.
- **Hover transitions**: color-only hover transitions permitted on primary actions and code-block hover affordances (the skill discourages these generically).

Every deviation has a rationale in the full reconciliation doc.
