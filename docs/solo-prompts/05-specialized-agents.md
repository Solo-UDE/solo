# 05 - Specialized Agents

Sources:
- Reference prompt system — `agents/database/prompts.ts` (1,905 lines)
- Reference prompt system — `agents/template/prompts.ts` (~95 lines)
- Reference prompt system — `agents/payments/prompts.ts` (~3,216 lines)
- Reference prompt system — `agents/clone/prompts.ts` (~591 lines)

## Overview

The system delegates specialized tasks to sub-agents, each with deep domain prompts. The coding agent calls these via tool use (e.g., `use_database_agent`, `use_payments_agent`). Each sub-agent has its own system prompt and tool set.

---

## Database Agent

Source: Reference prompt system — `agents/database/prompts.ts` (1,905 lines)

### Key Exports

**GENERATE_NEW_API_ROUTE_PROMPT** (~300 lines)

Generates complete, production-ready Next.js API routes using Drizzle ORM with SQLite/Turso.

Tech stack: Next.js 15 App Router, TypeScript, Drizzle ORM, `@/db` for connection, `@/db/schema` for tables.

**Authentication detection:** Checks if auth tables (user, session, account, verification) exist in schema:
- If present: include session validation, user-scoped operations, reject user IDs from request bodies
- If absent: standard API with no auth

**Security rules (verbatim):**
```
CRITICAL USER ID SECURITY:
- NEVER accept userId, user_id, authorId from request bodies
- NEVER allow clients to specify which user owns a record
- NEVER modify the getCurrentUser function - ALWAYS import from @/lib/auth
- ALWAYS get user ID from session via getCurrentUser()
- ALWAYS scope all operations to the authenticated user
```

**Required patterns per HTTP method:**
- GET: single record by ID, list with pagination (max 100), search, filtering, sorting
- POST: validate required fields, auto-generate timestamps, sanitize inputs, `.returning()`, 201 status
- PUT: require ID param, check record exists AND belongs to user, preserve unmodified fields
- DELETE: require ID param, verify ownership, `.returning()` to confirm

**DATABASE_AGENT_SYSTEM_PROMPT** (~600 lines)

Orchestrates all database operations using 7 specialized tools:
1. `manage_table_schema` -- schema operations via instant apply diff format
2. `manage_api_routes` -- API route operations via diff-based editing
3. `generate_new_api_route` -- new API generation from instructions
4. `generate_seeder_file` -- data seeding with actual sample data (never faker)
5. `npm_install` -- package installation
6. `test_api_route` -- endpoint testing via curl
7. `execute_sql_query` -- raw SQL execution

**Tool selection logic:** Maps natural language to tool calls:
- "create table X" -> generate diff, manage_table_schema
- "edit table X" -> manage_table_schema, fallback to execute_sql_query (ALTER TABLE)
- "create API for X" -> generate_new_api_route or manage_api_routes
- "seed X table" -> generate_seeder_file
- "test API" -> test_api_route

**Multi-step operations:** Strict dependency ordering:
- Schema FIRST -> API/Seeder -> Testing
- Example: "create users table with API and seed data" = 7-12 sequential steps

**Schema intelligence:**
- Auto-detects types: email -> unique text, price -> real, isActive -> boolean
- Relationship detection: userId -> foreign key, parentId -> self-reference
- Naming: camelCase for fields, snake_case for DB columns
- Always integer IDs (never UUID)

**Sample data policy:** Never use faker functions. Always use actual sample data arrays with `db.insert(table).values([...])`. Generate 5-10 records unless specified otherwise.

---

## Template Agent

Source: Reference prompt system — `agents/template/prompts.ts` (~95 lines)

### INITIAL_TEMPLATE_SYSTEM_PROMPT

**Role:** Expert Next.js 15 + TypeScript + Tailwind CSS developer and award-winning UI/UX designer.

**Task:** Modify existing template files to satisfy user requests while preserving layout, structure, and functionality.

**Key rules:**
- Preserve all layout, structure, functionality of original template
- Keep existing routes (/, /pricing, /company, etc.) unchanged -- only change copy
- Preserve color scheme unless specified otherwise
- Do not import new packages; create own implementations if needed
- Keep existing images; use lucide-react for new icons
- Preserve all exported variable names (including expected properties)
- Text changes MUST be the same length as original to prevent layout shift
- Never include TSX code inside a .ts file

**Output format:** Edit snippet with truncation comments:
```
// ... keep existing code ...
// modified section
// ... rest of code ...
```

**Next.js practices:**
- Server Components for static content (pages)
- Client Components for interactivity (`"use client"`)
- styled-jsx is BANNED -- use Tailwind CSS exclusively
- Escape TSX-sensitive characters: `&#123;`, `&#125;`, `&lt;`, `&gt;`
- Escape apostrophes in single-quoted strings

---

## Payments Agent

Source: Reference prompt system — `agents/payments/prompts.ts` (~3,216 lines)

The payments agent is the largest sub-agent, handling all Stripe/Autumn.js integration.

### Key Exports

**CUSTOM_AUTUMN_PROVIDER** (~33 lines)
Pre-built React component: `CustomAutumnProvider` wrapping `AutumnProvider` from `autumn-js/react`. Captures `?token=` from URL after checkout redirect, persists to localStorage, refreshes auth session.

**AUTUMN_PROVIDER_LAYOUT_DIFF** (~18 lines)
Edit snippet showing how to wrap `{children}` with `<CustomAutumnProvider>` in `layout.tsx`.

**AUTUMN_API_ROUTE** (~16 lines)
Pre-built API route at `/api/autumn/[...path]` using `autumnHandler` from `autumn-js/next`. Identifies users via `auth.api.getSession()`.

**BILLING_PORTAL_API_ROUTE** (~40 lines)
POST endpoint that generates a Stripe billing portal URL via `autumn.customers.billingPortal()`.

**GENERATE_PRODUCTS_PROMPT** (~435 lines)
Core prompt for generating `autumn.config.ts` files from user pricing descriptions.

Defines the Autumn.js API:
- `feature({ id, name, type, credit_schema? })` -- types: boolean, single_use, continuous_use, credit_system
- `product({ id, name, is_default?, is_add_on?, items })` -- pricing plans
- `featureItem({ feature_id, included_usage?, interval?, entity_feature_id? })` -- included features
- `priceItem({ price, interval? })` -- fixed pricing
- `pricedFeatureItem({ feature_id, price, billing_units?, usage_model?, included_usage?, interval? })` -- usage-based pricing

**Critical rules:**
- Never use price: 0 (breaks dashboard sync)
- Free plans: no priceItem at all, only featureItem with limits
- Import from "atmn", export each feature/product as named `export const`
- Output ONLY raw TypeScript, no markdown fences

**PRICING_TABLE_COMPONENT** (~200 lines)
Complete pre-built pricing table React component using `usePricingTable` from `autumn-js/react`. Handles:
- Monthly/annual toggle
- Auth checks before checkout
- Billing portal for active plans
- iframe-aware external URL handling
- Loading and error states

Additional UI components are included (checkout dialog, pricing table content utilities) as pre-built code that the agent injects directly into projects.

---

## Clone Agent

Source: Reference prompt system — `agents/clone/prompts.ts` (~591 lines)

### CLONE_SECTION_SYSTEM_PROMPT (~154 lines)

**Role:** Expert Next.js 15 + TypeScript + Tailwind CSS + Shadcn/UI developer specializing in pixel-perfect website cloning.

**Inputs:** File path, design instructions, high level design, screenshots, theme, section-specific assets, all scraped assets, globals.css, content, HTML structure, computed styles.

**Priority hierarchy for accuracy:**
1. HTML Structure + Computed Styles = ground truth
2. Screenshots for visual reference
3. Content for text
4. Assets for images

**Guidelines:**
- Prioritize data over visuals: HTML and computed styles are most accurate
- Use computed styles for exact Tailwind classes (don't guess from screenshots)
- Asset handling: section-specific assets first, all scraped assets as fallback, graceful degradation
- Never write custom SVG as replacement for assets/text
- Only use fonts from inputs or Google Fonts
- Never wrap `<a>` in `<Link>` components
- Export exactly one main component per section file using default export
- styled-jsx is COMPLETELY FORBIDDEN

**Theme enforcement:**
```
You MUST adhere to the theme specified in the <theme> tag. If 'light', ONLY generate
light theme code. If 'dark', ONLY generate dark theme code. DO NOT mix themes or
generate styles for the opposite theme.
```

**Styling precision requirements:**
- Color matching: exact hex/rgb from computed_styles
- Typography: exact font-family, font-size, font-weight, line-height
- Border radius: exact values from computed_styles
- Shadows: precise box-shadow and text-shadow
- Transforms: maintain all CSS transforms, transitions, animations
- Layout: preserve responsive breakpoints, container constraints, grid/flex properties

### FINAL_HOMEPAGE_FILE_SYSTEM_PROMPT (~55 lines)

Generates the `src/app/page.tsx` that imports and composes all cloned sections.

**Key rules:**
- Landing pages: MUST be Server Component (no useClient, useEffect, styled-jsx)
- Apps: MUST be Client Component with React state to manage section composition
- Import consistency: match named vs default exports exactly
- Homepage owns all page-level layout: grids, sidebars, spacing, breakpoints
- Components are layout-agnostic building blocks

### GLOBALS_CSS_CLONE_SYSTEM_PROMPT

Generates `globals.css` with Tailwind v4 design tokens cloned from the source website.

**Critical file structure:**
1. Font imports (`@import url(...)`) -- MUST be at very top
2. `@import "tailwindcss"`
3. `@import "tw-animate-css"`
4. `@custom-variant dark (&:is(.dark *));`
5. `@theme { ... }` with shadcn-compatible tokens

**Token naming:** Uses Tailwind v4 namespaces (`--color-*`, `--font-*`, `--text-*`, `--radius-*`, etc.)

**Theme enforcement:** Single theme only. If light detected, no `.dark` block. If dark detected, all colors in `:root` are dark theme values.

### Builder Functions

- `buildCloneSectionUserPrompt(params)` -- assembles file_path, theme, design_instructions, globals_css, high_level_design, assets, content, computed_styles, html_structure
- `buildFinalHomepageUserPrompt(params)` -- assembles website_design + sections
- `buildGlobalsCssUserPrompt(params)` -- assembles screenshots, high_level_design, computed_styles
