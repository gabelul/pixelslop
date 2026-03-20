# Arrange Fix Guide

How to fix spacing and layout findings from the scanner. Covers spacing rhythm, grid monotony, section differentiation, and visual hierarchy through space — the things that make a layout feel designed instead of dumped.

---

## What This Guide Fixes

Scanner findings that map here:

- **Hierarchy pillar score 1-2** — flat layout, no visual weight distribution, competing focal points
- **AI Slop pattern: Same Spacing Everywhere** — uniform padding/margin with no rhythm
- **AI Slop pattern: Identical Card Grids** — cookie-cutter feature sections
- **AI Slop pattern: Everything Centered** — center-aligned everything with no asymmetry
- **AI Slop pattern: Nested Cards** — cards inside cards (matryoshka layout)
- **AI Slop pattern: Cards Wrapping Everything** — every piece of content in its own container
- Findings mentioning: spacing monotony, grid monotony, visual hierarchy, section differentiation, layout density

---

## How to Locate the Source

The scanner reports computed `padding`, `margin`, `gap`, and `max-width` values from containers. Trace these back to source.

### Framework Detection

```bash
# Tailwind — spacing utilities
grep -rn "p-\d\|px-\|py-\|m-\d\|mx-\|my-\|gap-\|space-" "$ROOT/src" --include="*.tsx" --include="*.jsx" --include="*.html" | head -10

# CSS — padding/margin/gap declarations
grep -rn "padding\|margin\|gap" "$ROOT/src" --include="*.css" --include="*.scss" | head -10

# Grid/flex containers
grep -rn "grid-template\|display:\s*grid\|display:\s*flex" "$ROOT/src" --include="*.css" --include="*.tsx" | head -10
```

### Finding the Problematic Sections

```bash
# If scanner reports identical cards, find the grid container
grep -rn "grid\|flex.*wrap" "$ROOT/src" --include="*.tsx" --include="*.jsx" | head -10

# If scanner reports everything centered, find text-align: center
grep -rn "text-align.*center\|text-center\|items-center.*justify-center" "$ROOT/src" --include="*.css" --include="*.tsx" | head -10
```

---

## Fix Recipes

### Recipe 1: Establish a Spacing Scale

**When:** Scanner reports padding/margin values that are arbitrary (17px, 23px, 38px) with no system.

**What to do:** Adopt a 4pt-based spacing scale and apply it consistently.

**Recommended scale (4pt base):**

| Token | Value | Use for |
|-------|-------|---------|
| `--space-xs` | 4px | Tight gaps: icon-to-label, badge padding |
| `--space-sm` | 8px | Related elements: input groups, list items |
| `--space-md` | 16px | Standard padding: card content, form fields |
| `--space-lg` | 24px | Section content padding, card spacing |
| `--space-xl` | 32px | Between content groups |
| `--space-2xl` | 48px | Between major sections |
| `--space-3xl` | 64px | Page-level section separation |
| `--space-4xl` | 96px | Hero-level breathing room |

```css
:root {
  --space-xs: 0.25rem;
  --space-sm: 0.5rem;
  --space-md: 1rem;
  --space-lg: 1.5rem;
  --space-xl: 2rem;
  --space-2xl: 3rem;
  --space-3xl: 4rem;
  --space-4xl: 6rem;
}
```

**Rule:** Every spacing value in the project should come from this scale. If you need 12px, use `--space-sm` + `--space-xs` or add a `--space-1.5` (12px) token.

### Recipe 2: Break Spacing Monotony

**When:** Scanner reports same padding everywhere — every section uses 32px padding-top and padding-bottom with no variation.

**What to do:** Create rhythm through intentional variation. Tight grouping for related content, generous spacing for section breaks.

```css
/* BEFORE: everything the same */
section { padding: 32px 0; }

/* AFTER: rhythm through variation */
.hero { padding: var(--space-4xl) 0; }              /* 96px — breathe */
.features { padding: var(--space-2xl) 0; }           /* 48px — standard */
.testimonials { padding: var(--space-3xl) 0; }       /* 64px — emphasis */
.cta { padding: var(--space-2xl) 0 var(--space-4xl); } /* asymmetric */
```

**The principle:** Related elements get tight spacing (8-16px). Distinct sections get generous spacing (48-96px). This contrast is what creates visual rhythm.

### Recipe 3: Break Card Grid Monotony

**When:** Scanner detects 3+ identical cards in a row with same dimensions and internal structure.

**What to do:** Introduce variation without destroying the grid.

**Option A: Vary the grid (if the content supports it)**
```css
/* Instead of equal thirds, use a featured-first layout */
.feature-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-lg);
}
.feature-grid > :first-child {
  grid-column: span 2;  /* Feature card spans full width */
}
```

**Option B: Vary the card interiors**
- Alternate icon placement (left vs top)
- Use different visual treatments for primary vs secondary cards
- Vary content length — don't force all descriptions to the same length

**Option C: Replace cards with a different pattern**
- Use a simple list with icons instead of cards
- Use a two-column text layout instead of a card grid
- Use a timeline or numbered steps

### Recipe 4: Break Centering Monotony

**When:** Scanner reports >70% of content is center-aligned.

**What to do:** Introduce left-alignment and asymmetry where it makes sense.

```css
/* Hero can stay centered — it's a legitimate pattern there */
.hero { text-align: center; }

/* But features, testimonials, content sections → left-align */
.features { text-align: left; }
.testimonial { text-align: left; }

/* Asymmetric layouts add visual interest */
.content-section {
  display: grid;
  grid-template-columns: 2fr 1fr; /* Content weighted left */
  gap: var(--space-xl);
  text-align: left;
}
```

**Rule:** Center alignment works for heroes and CTAs. For everything else, left-aligned text with asymmetric layouts feels more designed.

### Recipe 5: Eliminate Nested Cards

**When:** Scanner detects cards inside cards — containers with border-radius and shadow nested inside other containers with border-radius and shadow.

**What to do:** Flatten the structure. Use spacing and subtle dividers instead of nested containers.

```css
/* BEFORE: card > card > content */
.outer-card { border-radius: 12px; box-shadow: 0 2px 4px rgba(0,0,0,.1); padding: 24px; }
.inner-card { border-radius: 8px; box-shadow: 0 1px 2px rgba(0,0,0,.1); padding: 16px; }

/* AFTER: single container with internal spacing */
.card { border-radius: 12px; box-shadow: 0 2px 4px rgba(0,0,0,.1); padding: 24px; }
.card-section { padding-top: var(--space-lg); border-top: 1px solid var(--color-border); }
```

### Recipe 6: Use `gap` Instead of Margin Hacks

**When:** Source uses margins on children to space flex/grid items, causing margin collapse or uneven edges.

**What to do:** Replace child margins with `gap` on the parent container.

```css
/* BEFORE */
.card-grid > * { margin-bottom: 24px; }
.card-grid > *:last-child { margin-bottom: 0; }

/* AFTER */
.card-grid { display: grid; gap: var(--space-lg); }
```

---

## Anti-Patterns to Avoid

When fixing layout and spacing, do NOT:

- **Add more containers** — the goal is less nesting, not more. Flatten, don't wrap.
- **Make all spacing equal** — that's the problem you're fixing. Create rhythm through variation.
- **Center everything** — center alignment should be intentional, not the default.
- **Fix grid monotony by adding decoration** — the fix is structural (varied sizing, asymmetry), not cosmetic (shadows, borders, gradients).
- **Use arbitrary z-index values** — if depth is needed, use a semantic scale (1-5), not 999.

---

## Verification Criteria

> **Checker scope:** The checker verifies the specific metric it was given (contrast ratio, element size, pattern detection). Broader criteria listed here are guidance for the scanner's re-evaluation, not individual checker measurements.

After applying a layout/spacing fix, the checker should re-measure:

- **Spacing variation** — are there at least 3 distinct spacing values in use (not all the same)?
- **Card grid identity** — if cards exist, do they have some structural variation (size, span, or internal layout)?
- **Center ratio** — is center-aligned text below 70% of total text elements?
- **Nesting depth** — no containers with border-radius+shadow nested inside other containers with border-radius+shadow?
- **Visual hierarchy** — does the squint test pass (can you identify primary/secondary groupings with blurred vision)?
