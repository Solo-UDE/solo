This `DESIGN.md` is a complete unification of the five interfaces you provided (The Dashboard, The Code Editor, The Command Palette, and The Communications Client). It codifies the "NeuralForge" aesthetic: a high-density, keyboard-centric, dark-mode ecosystem.

You can place this file in your root directory (e.g., `docs/DESIGN.md`) to serve as the single source of truth for developers and designers.

---

# NeuralForge Design System (NF-DS)

**Version:** 2.0.0 (Unified IDE Specification)
**Visual Dialect:** "Deep Focus" / Cyber-Industrial
**Core Philosophy:** "The interface should feel like a cockpit—dense, data-rich, and retreating into the background."

---

## 1. The "Deep Field" Color System

We strictly avoid pure black (`#000000`). We use a tiered system of warm charcoals to create depth.

### A. Surface Hierarchy (Z-Index based)

* **`--bg-void`**: `#0A0A0A` (The deepest layer; app background behind floating modals)
* **`--bg-base`**: `#0D0D0D` (Main window background, Editor canvas)
* **`--bg-surface-1`**: `#161616` (Sidebars, Rail navigation)
* **`--bg-surface-2`**: `#1F1F1F` (Cards, Chat bubbles, Input fields)
* **`--bg-surface-3`**: `#2A2A2A` (Hover states, "Active" list items)
* **`--bg-glass`**: `rgba(20, 20, 20, 0.75)` (Command Palette, Floating Context Menus)

### B. Borders & Dividers

* **`--border-subtle`**: `#262626` (Panel dividers, grid lines)
* **`--border-medium`**: `#333333` (Card borders, Input borders)
* **`--border-highlight`**: `#4D4D4D` (Hover state borders)
* **`--border-focus`**: `#5E5E5E` (Keyboard focus ring, active tab top-border)

### C. Syntax & Data Colors (The "Code" Palette)

Derived from the editor view.

* **`--syntax-keyword`**: `#FF5E1E` (Orange - `POLICY`, `SET`)
* **`--syntax-string`**: `#E6DB74` (Yellow - `"risk_review"`)
* **`--syntax-comment`**: `#75715E` (Olive Grey - ` # Scope: card...`)
* **`--syntax-function`**: `#66D9EF` (Cyan - `signal_weight`)
* **`--syntax-value`**: `#AE81FF` (Purple - numbers, booleans)

---

## 2. Typography & Readability

**Strategy:** A strict separation between "Interface" (Sans) and "Logic" (Mono).

### Font Stack

1. **UI/Chrome:** `Inter`, `San Francisco`, or `system-ui`. (Used for navigation, headings, chat)
2. **Data/Code:** `JetBrains Mono`, `Fira Code`, or `Roboto Mono`. (Used for IDs, Tags, Editor, Configs)

### Type Hierarchy

| Semantic Token | Size | Weight | Usage |
| --- | --- | --- | --- |
| **`text-display`** | 24px | 600 | Modal Headers, Welcome Screens |
| **`text-h1`** | 20px | 500 | Main Context Titles (e.g., Ticket Titles) |
| **`text-h2`** | 16px | 500 | Section Headers (e.g., "Work items", "General") |
| **`text-body`** | 14px | 400 | Chat messages, Descriptions |
| **`text-mono`** | 13px | 400 | Code blocks, Ticket IDs (#OPS-129) |
| **`text-tiny`** | 11px | 500 | Tags, Status Pills, Metadata timestamps |

---

## 3. Component Architecture

### A. The "Glass" Command Palette

The central navigation hub (triggered by `Cmd+K`).

* **Container:** Centered, Fixed width (600px).
* **Appearance:** Heavy blur (`backdrop-filter: blur(16px)`), Dark overlay (`--bg-glass`).
* **Interaction:**
* **Input:** No border, large text (18px), subtle placeholder.
* **Results:** List items with 48px height.
* **Active Item:** Highlighted with `--bg-surface-3` and a white text color shift.



### B. "Work Item" Cards

Used for tasks, tickets, and gallery items.

* **Layout:** Grid-based (2 or 3 columns).
* **Padding:** `16px` internal padding.
* **Visuals:**
* **Icon:** Top left, colored by domain (Orange for bug, Blue for feature).
* **Metadata Row:** Mono-spaced font for IDs (`#OPS-129`).
* **Tags:** Pill-shaped, `20px` height, `1px` border, transparent background.



### C. Chat & Activity Stream

* **Human Message:** Aligned right (optional) or distinct avatar. Plain text.
* **System/AI Message:**
* **Identity:** Marked by "Sparkle" icon or System Avatar.
* **Styling:** Can include "Thinking..." states (pill shape, pulsing opacity).
* **Actions:** Embedded buttons/links for generated artifacts (e.g., "Generated 2 work items").


* **Input Area:** Fixed at bottom. "Type message" placeholder. Paperclip icon for attachments.

### D. The Editor Canvas

* **Line Numbers:** Color `#4d4d4d`, Right-aligned, Padding-right `16px`.
* **Indent Guides:** `1px` solid `#262626`.
* **Breadcrumbs:** Top bar (e.g., `Domain > Financial Conduct > Consumer`). Clickable path.

---

## 4. Iconography & Assets

* **Style:** Stroke-based, 1.5px stroke width. Consistent with `Lucide` or `Phosphor` icons.
* **Sizes:**
* `16px`: Inline text icons, breadcrumbs.
* `20px`: Navigation rail icons.
* `24px`: Primary actions.



---

## 5. Interaction States (The "Feel")

### Hover Effects

* **Lists/Tables:** Do not use heavy background fills. Use a subtle brightness lift or a 1px border reveal.
* **Buttons:** `transform: translateY(-1px)` and brightness 110%.

### Focus (Accessibility)

* Because this is a keyboard-first IDE, focus states are critical.
* **Implementation:** `ring-1` of `--border-focus` (or a specific "brand blue" ring) on all focusable inputs.
* **Shortcuts:** Visual hints (e.g., `⌘ K`, `Enter`) should be displayed in `--text-tertiary` inside the component.

---

## 6. Layout Grids (The "scaffold")

### The "Tri-Pane" Layout

1. **Navigation Rail (Left):**
* Width: `64px` (collapsed) or `240px` (expanded).
* Content: Project tree, Queues, System status.


2. **Context/Editor (Center):**
* Width: `flex-grow` (Takes remaining space).
* Content: Tabs at top, Code/Details in body.


3. **Auxiliary Rail (Right):**
* Width: `320px` to `400px` (Resizable).
* Content: Chat, AI Assistant, Documentation, Properties.
* Behavior: Collapsible via `Cmd + B` or similar.



---

### Implementation Note for Tailwind CSS

To achieve the specific "noise" texture seen in the backgrounds of the cards (subtle grain), use a utility class:

```css
.bg-noise {
  background-image: url("data:image/svg+xml,..."); /* SVG Noise pattern */
  opacity: 0.03;
  pointer-events: none;
}

```