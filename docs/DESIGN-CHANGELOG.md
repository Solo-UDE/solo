# Design Changelog

## 2026-03-06 — Stars Background + Sidebar Redesign

### Stars Background (WelcomeScreen)
- Added canvas-based `StarsBackground` component with parallax mouse tracking
- Integrated into WelcomeScreen as first layer (z-0), glow bumped to z-1, content to z-10
- Dark mode only — auto-hides in light mode via MutationObserver
- Respects `prefers-reduced-motion` (static frame, no animation loop)
- Props: count=150, speed=30, starColor=rgba(255,255,255,0.6)

### Sidebar Visual Refinements
- **SidebarHeader**: height h-9 to h-10, repo name text-[13px] tracking-tight, border-border/15
- **ModeToggle**: mx-3 my-2.5 spacing, border border-border/10, shadow-sm on active indicator, font-semibold active label
- **PrimarySidebar**: motion.aside with spring-animated width (disabled during drag), larger empty state icon (w-12 h-12 rounded-2xl), entry animation on empty state
- **RepoRail**: separator between add button and repo list, scaleY entrance on accent bar, spring tooltip transition
- **DevSidebar**: section header text-[11px] font-semibold (removed uppercase), h-8 height, AnimatePresence on create form, py-1.5 scroll padding
- **StudioSidebar**: layoutId sliding nav indicator, rounded-xl nav items, bg-primary/8 "Soon" badge, gradient fade divider

### CSS Utilities
- Added `.sidebar-section-separator` gradient utility class

### Documentation
- Updated design-system.md with StarsBackground, layoutId indicator, and sidebar spacing conventions
- Updated animations.md with canvas-based animation pattern, parallax docs, RAIL_SPRING constant
