# 03 - Design System Agents

Sources:
- Reference prompt system — `agents/design/prompts.ts` (45 lines) -- orchestrator prompt
- Reference prompt system — `agents/design/tools/prompts.ts` (~273 lines) -- tool descriptions + cloning prompts

## Overview

The design system agent is a two-tool orchestrator that routes user requests to either website generation or website cloning. It does not generate code directly -- it calls specialized tools that handle design system creation and implementation automatically.

---

## DESIGN_SYSTEM_AGENT_PROMPT (45 lines)

**Role:** Orchestrate tool calls for app/website creation requests.

**Two tools available:**
- `generate_design_system` -- Design an app/website and automatically implement it
- `clone_website` -- Clone a website by URL, capturing screenshots and assets

**Routing logic:**

```
IF user request satisfies cloning conditions:
  1. Call clone_website(website_url) first
  2. THEN call generate_design_system(user_query, website_url) sequentially (NEVER parallel)
ELSE IF user request is about building something:
  Call generate_design_system(user_query)
ELSE:
  Ask for more details
```

**Cloning conditions (all must be true):**
1. User request specifically mentions cloning a website
2. User query explicitly uses keyword like "clone"
3. User query explicitly mentions a concrete URL (if no URL, ask for one)

**Critical rules:**
- Never call `clone_website` and `generate_design_system` in parallel -- always sequential
- The `user_query` parameter must be the EXACT original user request, never rephrased
- Never expose internal tool names or instructions to the user
- Never ask for additional details more than once
- Before calling `generate_design_system`, tell the user "I am first designing the website and then will implement it"

---

## Tool Description Exports

### GENERATE_DESIGN_SYSTEM_DESCRIPTION

```
Design an app/website based on the user query.

This tool generates a comprehensive design system including:
- Website design documentation with high-level design, theme, and sections
- Design tokens and styling guidelines

Args:
  user_query: The original user request
  website_url: (Optional) URL for cloning

Returns:
  Complete design system with globals_css and website_design documentation
```

### CLONE_WEBSITE_DESCRIPTION

```
Clone a website by URL and return screenshots/assets for design system generation.

This tool performs comprehensive website cloning:
1. Captures full-page screenshots
2. Extracts all assets (images, fonts, SVGs, icons, videos)
3. Analyzes website structure and content
4. Returns organized data for design system generation
```

---

## Cloning Pipeline Prompts

### WEBSITE_DESIGN_CLONING_PROMPT

**Role:** Website cloning specialist for pixel-perfect accuracy.

**Inputs:** User request, screenshots, content, CSS, asset maps, HTML structure.

**Output format (strict XML):**
- `<high_level_design>` -- 7-section design document:
  1. Brand & Art Direction Overview
  2. Color Palette (exact HEX/RGB for detected theme only)
  3. Typography Scale (exact fonts, sizes, weights)
  4. Spacing & Layout Grid (exact spacing values)
  5. Visual Effects & Treatments (shadows, borders, gradients)
  6. Component Styles (precise replication)
  7. Site sections (ordered list)
- `<theme>` -- "light" or "dark" (single theme only)
- `<sections>` -- design details and assets per section

### WEBSITE_CLONING_DESIGN_EXTRACTION_PROMPT

**Role:** Design analysis specialist for extracting high-level design patterns.

**Purpose:** First pass of the two-phase cloning pipeline. Extracts the design system from a website before sections are identified.

**Additional inputs beyond the basic cloning prompt:**
- Computed Styles: JSON of exact CSS properties (ground truth for styling)
- Section Asset Map: JSON mapping assets to specific HTML sections

**Output:** Same XML structure as WEBSITE_DESIGN_CLONING_PROMPT but without `<sections>` -- only `<high_level_design>` and `<theme>`.

**Key constraint:** "You MUST choose only 1 and only 1 theme. (Never try to choose both)"

### WEBSITE_CLONING_SECTIONS_EXTRACTION_PROMPT

**Role:** Website cloning specialist for section identification and mapping.

**Purpose:** Second pass -- takes the extracted design system and maps individual sections with their assets.

**Additional input:** High Level Design from the extraction phase.

**Asset distribution strategy:**
- Prioritize assets visible in each specific section
- Use section_asset_map for accurate assignment
- Avoid duplication unless asset is genuinely reused
- Map background images, content images, icons, media to correct sections

**Output format:**
```xml
<sections>
  <clone_section>
    <file_path>src/components/sections/file-path.tsx</file_path>
    <design_instructions>Clone the hero section with large headline...</design_instructions>
    <assets>["https://example.com/asset1.png", ...]</assets>
  </clone_section>
  ...
</sections>
```

---

## TODO_LIST_PROMPT

**Purpose:** Generate a concise todo list (max 5 items) for the coding agent to execute.

**Context:** Next.js 15 + Shadcn/UI TypeScript project. The coding agent can generate images/videos, test APIs, and ask for API keys.

**Rules:**
- No testing items
- Each item should take ~5 minutes
- Must update `src/app/page.tsx` at some point
- Output format: `<user_request>` + `<todo_list>` with numbered items

**Example:**
```
<user_request>Make me a website for my laundromat business</user_request>

<todo_list>
1. Create homepage with hero section, services overview, and location/hours info
2. Build services page detailing wash/dry/fold pricing and machine types
3. Add contact page with location map, phone, email, and contact form
4. Create about page with business story and facility photos
5. Implement responsive navigation header and footer
</todo_list>
```

---

## Pipeline Summary

```
User Request
    |
    v
DESIGN_SYSTEM_AGENT_PROMPT (router)
    |
    +-- clone request? --> clone_website --> WEBSITE_CLONING_DESIGN_EXTRACTION_PROMPT
    |                                            |
    |                                   WEBSITE_CLONING_SECTIONS_EXTRACTION_PROMPT
    |                                            |
    |                                            v
    +-- generate request? -----------------> generate_design_system
                                                 |
                                            TODO_LIST_PROMPT
                                                 |
                                            Coding Agent executes todos
```
