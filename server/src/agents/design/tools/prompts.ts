/**
 * Tool descriptions for the Design System Agent
 * Tool descriptions for design generation and website cloning.
 */

export const GENERATE_DESIGN_SYSTEM_DESCRIPTION = `
Design an app/website based on the user query.

This tool generates a comprehensive design system including:
- Website design documentation with high-level design, theme, and sections
- Design tokens and styling guidelines

When the user request involves:
- Cloning a website: The user_query should be about cloning the website
- A design kit: Only summarize the style of the design kit in a few words concisely

The tool will analyze any provided images, design kits, or reference materials to create a cohesive design system that matches the user's vision.

Args:
  user_query: The original user request before the design system was generated
  website_url: (Optional) The URL of the website to clone

Returns:
  Complete design system with globals_css and website_design documentation
`;

export const CLONE_WEBSITE_DESCRIPTION = `
Clone a website by URL and return screenshots/assets for design system generation.

This tool performs comprehensive website cloning:
1. Captures full-page screenshots of the website
2. Extracts all assets (images, fonts, SVGs, icons, videos)
3. Analyzes the website structure and content
4. Returns organized data for design system generation

Args:
  website_url: The URL of the website to clone

Returns:
  JSON containing screenshots, assets, content structure, and design context
`;

export const WEBSITE_DESIGN_CLONING_PROMPT = `
<role>
You are a website cloning specialist that can clone a website to pixel perfect accuracy to fulfill the user's request.
</role>

<task>
Analyze the provided screenshots, content, CSS, asset maps to produce a pixel perfect clone of the website that satisfies the user's request.
</task>

<inputs>
- User request: The user request you must satisfy.
- Screenshots: The screenshots of the website to clone.
- Content: The content of the website to clone.
- Asset maps: The assets scraped from the website (images, videos, icons, fonts, etc.)
- HTML Structure: The raw HTML structure of the page.
</inputs>

<output_format>
Return a strict XML document containing:

<high_level_design>
1. Brand & Art Direction Overview
2. Color Palette (Clone Exactly for the Detected Theme)
3. Typography Scale (Clone Exactly)
4. Spacing & Layout Grid (Clone Exactly)
5. Visual Effects & Treatments (Clone Exactly)
6. Component Styles (Clone Exactly)
7. Site sections (Clone Exactly)
</high_level_design>

<theme>
Either "light" or "dark", based on the detected theme.
</theme>

<sections>
List of sections with design details and assets needed for each section.
</sections>
</output_format>
`;

export const TODO_LIST_PROMPT = `
Given a user_request, create a todo list that an AI coding agent can go through and complete said given user query. Keep in mind the coding agent can generate images and videos, test API endpoints, as well as ask the user for API keys.

The todo list shouldn't contain anything regarding testing.

You should seek to minimize the number of items in the todo list and have at most 5 items.

Each item in the todo list should be a task that a user would reasonably take 5 minutes to complete.

Here are some example todo lists:

Example 1:
<user_request>Make me a tetris game</user_request>
<todo_list>
1. Create tetris page with playable Tetris game logic
2. Add this as the main component on the homepage
3. Polish basic styles and layout for Tetris UI
</todo_list>

Example 2:
<user_request>make me a website for my laundromat business</user_request>
<todo_list>
1. Create homepage with hero section, services overview, and location/hours info
2. Build services page detailing wash/dry/fold pricing and machine types
3. Add contact page with location map, phone, email, and contact form
4. Create about page with business story and facility photos
5. Implement responsive navigation header with business logo and menu plus footer
</todo_list>
`;
