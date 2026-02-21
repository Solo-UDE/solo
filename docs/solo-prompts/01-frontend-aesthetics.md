# 01 - Frontend Aesthetics: The Anti-AI-Slop Prompt

**Source:** Reference prompt system — `agents/coding/prompts.ts` (lines 641-659, repeated across multiple prompt variants)

**Impact:** Critical -- this is the single most important prompt block in the entire system.

---

## The Complete `<frontend_aesthetics>` Block

This is the exact, verbatim text injected into the coding agent system prompts:

```xml
<frontend_aesthetics>
You tend to converge toward generic, "on distribution" outputs. In frontend design, this creates what users call the "AI slop" aesthetic. Avoid this: make creative, distinctive frontends that surprise and delight. Focus on:

Typography: Choose fonts that are beautiful, unique, and interesting. Avoid generic fonts like Arial and Inter; opt instead for distinctive choices that elevate the frontend's aesthetics.

Color & Theme: Commit to a cohesive aesthetic. Use CSS variables for consistency. Dominant colors with sharp accents outperform timid, evenly-distributed palettes. Draw from IDE themes and cultural aesthetics for inspiration.

Motion: Use animations for effects and micro-interactions. Prioritize CSS-only solutions for HTML. Use Motion library for React when available. Focus on high-impact moments: one well-orchestrated page load with staggered reveals (animation-delay) creates more delight than scattered micro-interactions.

Backgrounds: Create atmosphere and depth rather than defaulting to solid colors. Layer CSS gradients, use geometric patterns, or add contextual effects that match the overall aesthetic.

Avoid generic AI-generated aesthetics:
- Overused font families (Inter, Roboto, Arial, system fonts)
- Clichéd color schemes (particularly purple gradients on white backgrounds)
- Predictable layouts and component patterns
- Cookie-cutter design that lacks context-specific character

Interpret creatively and make unexpected choices that feel genuinely designed for the context. Vary between light and dark themes, different fonts, different aesthetics. You still tend to converge on common choices (Space Grotesk, for example) across generations. Avoid this: it is critical that you think outside the box!
</frontend_aesthetics>
```

---

## Why This Block Is So Effective

The `<frontend_aesthetics>` block is arguably the highest-value 20 lines of prompt engineering in the entire codebase. Its effectiveness comes from several deliberate techniques:

### 1. It Names the Failure Mode Directly

The opening line -- "You tend to converge toward generic, 'on distribution' outputs" -- does something most prompts fail to do: it tells the model *what it is doing wrong* using the model's own conceptual vocabulary. The phrase "on distribution" is a term from machine learning that language models understand at a deep level. By framing the problem in terms the model can reason about (statistical convergence toward common outputs), the prompt creates genuine behavioral change rather than surface-level compliance.

The phrase "AI slop" further anchors this by connecting the technical failure mode to its human-perceived consequence. The model now understands both *why* it defaults to generic output and *how users experience* that default.

### 2. It Provides Concrete Escape Hatches, Not Just Prohibitions

Many prompt engineering attempts fail because they only say "don't do X" without providing alternatives. This block balances every prohibition with a constructive direction:

- Don't use generic fonts --> "Choose fonts that are beautiful, unique, and interesting"
- Don't use timid palettes --> "Dominant colors with sharp accents"
- Don't scatter micro-interactions --> "One well-orchestrated page load with staggered reveals"
- Don't default to solid backgrounds --> "Layer CSS gradients, use geometric patterns"

Each direction is specific enough to act on but open enough to allow creativity.

### 3. It Uses a Categorical Anti-Pattern List

The explicit list of things to avoid serves as a checklist the model can evaluate against:

- Overused font families (Inter, Roboto, Arial, system fonts)
- Cliched color schemes (particularly purple gradients on white backgrounds)
- Predictable layouts and component patterns
- Cookie-cutter design that lacks context-specific character

The parenthetical "particularly purple gradients on white backgrounds" is a masterful detail. It calls out the single most common AI-generated color scheme by name, making it impossible for the model to unconsciously reproduce it.

### 4. It Addresses Convergence Across Generations

The final paragraph tackles a subtle problem: even when models try to be "creative," they converge on the same "creative" choices across separate generations. The call-out of Space Grotesk specifically is an example of this -- it became the go-to "creative" font choice for AI systems trying to avoid Inter. By naming this secondary convergence pattern, the prompt pushes the model past the first layer of "trying to be different" into genuinely varied output.

### 5. It Uses XML Tags for Structural Clarity

Wrapping the block in `<frontend_aesthetics>` tags serves two purposes:
- It creates a clearly delineated section that the model can reference and reason about as a unit
- It enables clean composition -- the block can be injected into any prompt variant without disrupting surrounding content

---

## Where It Appears

The `<frontend_aesthetics>` block is not used once -- it is injected into every coding agent prompt variant that may produce frontend code. In `agents/coding/prompts.ts` (2,811 lines), it appears in:

| Prompt Variant | Purpose | Lines (approx) |
|---------------|---------|----------------|
| `generateSystemPrompt` | New project generation from scratch | 641-659 |
| `editSystemPrompt` | Editing existing frontend code | Repeated |
| `componentSystemPrompt` | Creating individual components | Repeated |
| `refactorSystemPrompt` | Refactoring existing frontend code | Repeated |

The block is defined once and interpolated into each variant via template literals, ensuring consistency. A single edit to the block propagates across all frontend-touching operations.

---

## Breakdown by Domain

### Typography

```
Choose fonts that are beautiful, unique, and interesting. Avoid generic fonts
like Arial and Inter; opt instead for distinctive choices that elevate the
frontend's aesthetics.
```

**What this achieves:** Pushes the model away from its top-of-distribution font choices. Arial and Inter are the two most commonly generated font selections. By explicitly banning them and asking for "distinctive choices," the model reaches deeper into its knowledge of typography -- producing selections like Clash Display, General Sans, Satoshi, Cabinet Grotesk, and other modern typefaces that give generated UIs a genuinely designed feel.

### Color & Theme

```
Commit to a cohesive aesthetic. Use CSS variables for consistency. Dominant
colors with sharp accents outperform timid, evenly-distributed palettes. Draw
from IDE themes and cultural aesthetics for inspiration.
```

**What this achieves:** Three distinct instructions layered together:
1. **Cohesion** -- prevents the common AI failure of mixing unrelated colors
2. **Dominance hierarchy** -- "dominant colors with sharp accents" produces palettes with clear visual hierarchy instead of the typical AI approach of distributing 4-5 colors evenly
3. **Inspiration sources** -- "IDE themes and cultural aesthetics" pushes the model toward specific, opinionated color worlds (Dracula, Nord, Solarized, Japanese minimalism, Bauhaus, etc.) rather than generic corporate blue

### Motion

```
Use animations for effects and micro-interactions. Prioritize CSS-only solutions
for HTML. Use Motion library for React when available. Focus on high-impact
moments: one well-orchestrated page load with staggered reveals
(animation-delay) creates more delight than scattered micro-interactions.
```

**What this achieves:** The key insight here is the prioritization hierarchy. Without guidance, AI tends to either skip animation entirely or add trivial hover effects everywhere. This prompt redirects toward:
1. A single high-impact animation moment (page load with staggered reveals)
2. CSS-first implementation (no unnecessary JS overhead)
3. Framework-appropriate tooling (Motion library for React)

The specific technique callout -- `animation-delay` for staggered reveals -- gives the model a concrete pattern to implement rather than leaving animation as an abstract concept.

### Backgrounds

```
Create atmosphere and depth rather than defaulting to solid colors. Layer CSS
gradients, use geometric patterns, or add contextual effects that match the
overall aesthetic.
```

**What this achieves:** Addresses one of the most visible tells of AI-generated UI: flat, solid-color backgrounds. By asking for "atmosphere and depth," the prompt triggers the model to use techniques like:
- Multi-stop gradients with subtle color shifts
- Radial gradients for focal points
- Noise textures or grain overlays
- Geometric SVG patterns
- Contextual effects (particles, waves, mesh gradients)

---

## Applying This to Solo

The principles in `<frontend_aesthetics>` directly informed Solo's own design system (documented in `.claude/skills/solo-ui-skill/`). While Solo has a fixed design language (it is an IDE, not a generated website), the underlying philosophy carries over:

- **Typography:** Solo uses carefully chosen typefaces rather than system defaults
- **Color:** Solo's palette uses dominant dark tones with the Solo Green (`oklch(0.68 0.17 140)`) as a sharp accent -- exactly the "dominant color with sharp accent" pattern
- **Motion:** Solo's animation system prioritizes GPU-accelerated transforms with three distinct easing curves for different interaction types
- **Backgrounds:** Solo uses backdrop blur, layered opacity, and glassmorphism rather than flat solid panels

The `<frontend_aesthetics>` block is not just a prompt -- it is a design philosophy compressed into 20 lines. Its real lesson is that the most effective AI prompts do not just instruct; they diagnose the model's failure modes, name them explicitly, and provide concrete alternatives.
