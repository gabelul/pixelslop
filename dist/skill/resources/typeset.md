# Typeset Fix Guide

How to fix typography findings from the scanner. Covers font scale, weight hierarchy, line-height, and readability — the things that make text feel intentional instead of defaulted.

---

## Use the project's type tokens first

If the fixer loaded design tokens (`config read-tokens`), they carry the project's real type system — `font-body`, `font-display`, `type-scale`. Use those as your target: apply the project's fonts and its scale ratio rather than picking new ones. The recipes below are the fallback for when the project declares no type tokens.

---

## What This Guide Fixes

Scanner findings that map here:

- **Typography pillar score 1-2** — generic fonts, no scale discipline, inconsistent weights
- **AI Slop pattern: Generic Font Stack** — Inter/Roboto/Arial as primary with no personality
- **AI Slop pattern: Monospace for Tech Vibes** — monospace outside code blocks for decoration
- Findings mentioning: font scale, weight inconsistency, line-height, readability, font pairing
- **Measured readability findings** — `measure` (line too long/short), `body-size` (under the 14px floor), `leading` (line-height too tight/loose), `tracking` (letter-spacing too tight/wide on body), `flat-hierarchy` (type scale barely differs), `justified-body`, `all-caps-body`

---

## How to Locate the Source

The scanner reports computed `font-family`, `font-size`, `font-weight`, and `line-height` values. Your job is to find where those values are set in source code.

### Framework Detection

Check the project structure to determine how styles are applied:

```bash
# Tailwind — look for tailwind config and utility classes
grep -rl "tailwind" "$ROOT/package.json" "$ROOT/tailwind.config.*" 2>/dev/null

# CSS Modules — look for .module.css files
find "$ROOT/src" -name "*.module.css" -o -name "*.module.scss" 2>/dev/null | head -5

# CSS-in-JS — look for styled-components, emotion, etc.
grep -rl "styled\." "$ROOT/src" --include="*.tsx" --include="*.jsx" 2>/dev/null | head -5

# Plain CSS — global stylesheets
find "$ROOT/src" "$ROOT/public" "$ROOT/styles" -name "*.css" -not -name "*.module.css" 2>/dev/null | head -5
```

### Finding the Right Selectors

Use the scanner's evidence to trace back:

```bash
# If scanner reports font-family on h1, find where h1 is styled
grep -rn "font-family\|fontFamily" "$ROOT/src" --include="*.css" --include="*.scss" --include="*.tsx" --include="*.jsx" | grep -i "h1\|heading\|title"

# For Tailwind, find where font classes are applied
grep -rn "font-\[" "$ROOT/src" --include="*.tsx" --include="*.jsx" --include="*.html" | head -10

# Find font imports (Google Fonts, local fonts)
grep -rn "fonts.googleapis\|@font-face\|font-display" "$ROOT/src" "$ROOT/public" --include="*.css" --include="*.html" --include="*.tsx" | head -10
```

---

## Fix Recipes

### Recipe 1: Replace Generic Font with a Distinctive Choice

**When:** Scanner flags Inter/Roboto/Arial as primary font with no personality.

**What to do:** Replace the generic font import with something that has actual character. Don't just swap one generic for another — pick something that says something about the brand.

**Better alternatives to common defaults:**
- Instead of Inter → Instrument Sans, Plus Jakarta Sans, Outfit
- Instead of Roboto → Onest, Figtree, Urbanist
- Instead of Open Sans → Source Sans 3, Nunito Sans, DM Sans
- For editorial/premium feel → Fraunces, Newsreader, Lora (serifs)

**Tailwind approach:**
```css
/* In tailwind.config.js or @theme block */
fontFamily: {
  sans: ['Plus Jakarta Sans', 'system-ui', 'sans-serif'],
  heading: ['Instrument Sans', 'system-ui', 'sans-serif'],
}
```

**CSS approach:**
```css
/* Replace the @import or @font-face */
@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;700&display=swap');

body { font-family: 'Plus Jakarta Sans', system-ui, sans-serif; }
```

**Rule:** Keep it to 2-3 font families maximum. One body, one heading (if different), one mono (if needed). More than 3 is almost always a mistake.

### Recipe 2: Establish a Modular Type Scale

**When:** Scanner reports font sizes with no consistent ratio — arbitrary jumps like 14px, 15px, 18px, 22px, 31px.

**What to do:** Pick a scale ratio and apply it consistently. Five sizes cover most interfaces.

**Common ratios:**
- 1.25 (Major Third) — compact, good for apps and dashboards
- 1.333 (Perfect Fourth) — balanced, good general-purpose ratio
- 1.5 (Perfect Fifth) — dramatic, good for marketing sites

**Example scale at 1.25 ratio, 16px base:**
- xs: 0.75rem (12px) — captions, labels
- sm: 0.875rem (14px) — secondary text, metadata
- base: 1rem (16px) — body text
- lg: 1.25rem (20px) — subheadings, card titles
- xl: 1.563rem (25px) — section headings
- 2xl: 1.953rem (31px) — page headings
- 3xl: 2.441rem (39px) — hero headings

**CSS custom properties approach:**
```css
:root {
  --text-xs: 0.75rem;
  --text-sm: 0.875rem;
  --text-base: 1rem;
  --text-lg: 1.25rem;
  --text-xl: 1.563rem;
  --text-2xl: 1.953rem;
  --text-3xl: 2.441rem;
}
```

**Rule:** Use `rem` not `px` for font sizes. Respects user browser settings and doesn't break accessibility.

### Recipe 3: Fix Weight Hierarchy

**When:** Scanner reports all text at the same weight, or weights used inconsistently (bold headings but also bold body text, or everything at 400).

**What to do:** Establish a clear weight mapping where each weight means something.

**Standard mapping:**
- 400 (Regular) — body text, descriptions
- 500 (Medium) — labels, navigation items, subtle emphasis
- 600 (Semibold) — subheadings, card titles, interactive elements
- 700 (Bold) — primary headings, strong emphasis

**Don't use more than 3-4 weights.** Each additional weight should justify its existence. If you can't explain why this text is 600 instead of 500, it probably shouldn't be.

### Recipe 4: Fix Line-Height

**When:** Scanner reports browser-default line-height (typically `normal` / ~1.2) on body text, or wildly inconsistent line-heights.

**What to do:**

```css
/* Headings — tighter, they're big enough to read at lower line-height */
h1, h2, h3 { line-height: 1.1; }
h4, h5, h6 { line-height: 1.2; }

/* Body text — looser, needs breathing room for readability */
p, li, td { line-height: 1.5; }

/* Small text — even looser */
small, caption, .meta { line-height: 1.6; }
```

**Dark backgrounds:** Add +0.05 to +0.1 to line-height values. Light text on dark needs more spacing to maintain readability.

### Recipe 5: Fix Line Length

**When:** Scanner reports text running edge-to-edge or in uncomfortably narrow columns. Optimal reading measure is 45-75 characters per line.

**What to do:**

```css
/* Character-based max-width — adapts to font size automatically */
.prose, article, .content { max-width: 65ch; }

/* If text is too narrow (under 30ch), widen the container */
.sidebar-text { max-width: 45ch; min-width: 30ch; }
```

### Recipe 6: Fluid Typography

**When:** Scanner reports fixed font sizes that don't scale between viewports. Desktop heading size shoved onto mobile.

**What to do:** Use `clamp()` for smooth scaling between breakpoints.

```css
h1 { font-size: clamp(1.75rem, 4vw + 1rem, 3rem); }
h2 { font-size: clamp(1.375rem, 2.5vw + 0.75rem, 2rem); }
p { font-size: clamp(0.938rem, 0.5vw + 0.85rem, 1.125rem); }
```

**Rule:** Body text minimum is 16px (1rem). Going below on mobile is an accessibility problem.

### Recipe 7: Fix Letter-Spacing (Tracking)

**When:** Scanner reports a `tracking` finding — negative letter-spacing on body text, or wide tracking on a body run. Negative tracking jams letters together; wide tracking on long copy slows reading to a crawl.

**What to do:** Body copy wants tracking at or near zero. Reserve tracking adjustments for the two places they actually help:

```css
/* Body — leave it alone. Default (0) is correct. */
p, li, td { letter-spacing: normal; }

/* Large display headings — a touch tighter reads as crafted */
h1, .display { letter-spacing: -0.02em; }

/* Short uppercase labels — a little wider so the caps don't bunch */
.eyebrow, .label, [class*="badge"] { letter-spacing: 0.05em; text-transform: uppercase; }
```

**Rule:** Wide tracking is for short uppercase labels, never for sentences. If a paragraph has positive tracking, remove it.

### Recipe 8: Fix a Flat Type Scale

**When:** Scanner reports `flat-hierarchy` — the largest heading is less than 1.5× the body size, so headings and body read as the same thing. The page has no typographic anchor.

**What to do:** Open up the scale so the top of the hierarchy is unmistakable. Apply a real ratio (see Recipe 2) and make sure the h1 lands well above body:

```css
/* Body 16px; h1 should clear ~2.4x at minimum on a content page */
h1 { font-size: clamp(2rem, 4vw + 1rem, 2.75rem); } /* ~40-44px */
h2 { font-size: clamp(1.5rem, 2.5vw + 0.75rem, 2rem); }
p  { font-size: 1rem; }
```

**Rule:** A heading that only differs from body by weight isn't a heading. Differentiate by size first, then weight.

### Recipe 9: Fix Body Alignment and Casing

**When:** Scanner reports `justified-body` or `all-caps-body`.

**What to do:**

```css
/* Justified web text without hyphenation opens rivers of whitespace. Left-align. */
p, li { text-align: left; }
/* If justification is a hard design requirement, enable hyphenation to close the gaps */
.justified { text-align: justify; hyphens: auto; }

/* All-caps belongs on short labels, not paragraphs. Drop it back to sentence case. */
p { text-transform: none; }
```

**Rule:** Uppercase is a label treatment. A full paragraph in caps is slower to read and reads as shouting.

---

## Anti-Patterns to Avoid

When fixing typography, do NOT:

- **Add more font families** — simplify, don't complicate. If there are already 3+ families, reduce them.
- **Use decorative/display fonts for body text** — display fonts are for headings. Body text needs a reading face.
- **Set font sizes in px** — use `rem` so user browser settings are respected.
- **Pair similar fonts** — two geometric sans-serifs create tension without hierarchy. Contrast on multiple axes: serif + sans, geometric + humanist, condensed + wide.
- **Ignore font loading** — add `font-display: swap` to prevent invisible text during load.
- **Skip fallback fonts** — always include system fonts in the stack for graceful degradation.

---

## Verification Criteria

After applying a typography fix, the checker should re-measure:

- **Font family** — is the primary font distinctive (not in the generic list)?
- **Size scale** — do sizes follow a consistent ratio (within ±2px of a modular scale)?
- **Weight distribution** — are at least 2 distinct weights in use with clear roles?
- **Line-height** — body text between 1.4-1.7? Headings between 1.0-1.3?
- **Line length** — body text between 45-75 characters per line?
- **Minimum size** — no body text below 16px on mobile?
- **Font loading** — `font-display` declared (no invisible text flash)?
