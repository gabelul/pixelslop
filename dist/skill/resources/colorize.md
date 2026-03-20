# Colorize Fix Guide

How to fix color findings from the scanner. Covers palette cohesion, accent discipline, tinted neutrals, and contrast — the things that make a color system feel intentional instead of auto-generated.

---

## What This Guide Fixes

Scanner findings that map here:

- **Color pillar score 1-2** — generic palette, pure grays, no accent discipline, AI-default colors
- **Accessibility pillar (contrast sub-findings)** — text failing WCAG AA ratios
- **AI Slop pattern: Cyan-on-Dark Palette** — the hacker-terminal-meets-SaaS aesthetic
- **AI Slop pattern: Purple-to-Blue Gradients** — the default "AI product" palette
- **AI Slop pattern: Dark Mode with Glowing Accents** — neon halos on near-black
- **AI Slop pattern: Neon Accents on Dark** — nightclub UI energy
- **AI Slop pattern: Pure Black/White Backgrounds** — literal #000 or #fff
- **AI Slop pattern: Gray Text on Colored Backgrounds** — washed-out secondary text
- Findings mentioning: palette, contrast, accent, neutrals, tint, color temperature

---

## How to Locate the Source

The scanner reports computed `background-color`, `color`, `border-color`, and `box-shadow` values. Trace back to where they're defined.

### Framework Detection

```bash
# Tailwind — color configuration
grep -rn "colors:" "$ROOT/tailwind.config.*" 2>/dev/null | head -5

# CSS custom properties — color tokens
grep -rn "\-\-color\|\-\-bg\|\-\-text\|\-\-accent\|\-\-primary" "$ROOT/src" --include="*.css" --include="*.scss" | head -10

# Hardcoded colors
grep -rn "#[0-9a-fA-F]\{6\}\|#[0-9a-fA-F]\{3\}\b\|rgb(" "$ROOT/src" --include="*.css" --include="*.tsx" | head -10
```

### Finding the Problem Colors

```bash
# Pure black/white backgrounds
grep -rn "#000000\|#ffffff\|#000\"\|#fff\"\|bg-black\|bg-white" "$ROOT/src" --include="*.css" --include="*.tsx" | head -5

# Cyan/neon accents
grep -rn "#00[a-f][0-9a-f]ff\|#0ff\|cyan\|text-cyan\|bg-cyan" "$ROOT/src" --include="*.css" --include="*.tsx" | head -5

# Gradient definitions
grep -rn "gradient\|bg-gradient" "$ROOT/src" --include="*.css" --include="*.tsx" | head -10
```

---

## Fix Recipes

### Recipe 1: Fix Contrast Failures

**When:** Scanner reports text failing WCAG AA (below 4.5:1 for normal text, below 3:1 for large text).

**This is the most common fix and the highest-priority one.** Bad contrast is an accessibility barrier, not just an aesthetic issue.

**Approach:** Darken the text or lighten the background. Prefer adjusting the color with less visual impact.

```css
/* BEFORE: white text on green button, 2.5:1 ratio */
.cta { background: #22c55e; color: white; }

/* AFTER: darker green to pass AA, 4.6:1 ratio */
.cta { background: #15803d; color: white; }

/* Or: dark text on light green instead */
.cta { background: #bbf7d0; color: #14532d; }
```

**How to calculate:** WCAG contrast uses relative luminance. The checker will re-measure using the same formula from visual-eval.md. Target 4.5:1 minimum for body text, 3:1 for text 24px+ or 18.66px+ bold.

**Rule:** Don't sacrifice the brand color entirely — shift its lightness/darkness while keeping the hue. If the brand green is too light for white text, darken the green rather than changing it to blue.

### Recipe 2: Replace Pure Black/White

**When:** Scanner detects literal `#000000` or `#ffffff` as background color.

**What to do:** Replace with off-black and off-white that have subtle tint.

```css
/* BEFORE */
body { background-color: #ffffff; color: #000000; }

/* AFTER: warm tint */
body { background-color: #faf9f7; color: #1a1815; }

/* AFTER: cool tint */
body { background-color: #f8fafc; color: #0f172a; }
```

**Dark mode:**
```css
/* BEFORE */
body { background-color: #000000; }

/* AFTER: warm dark */
body { background-color: #1c1917; }

/* AFTER: cool dark */
body { background-color: #0f172a; }
```

**Rule:** The tint should be subtle enough that you can't immediately name the color — if someone says "that's blue," you've gone too far. It should feel warm or cool, not colored.

### Recipe 3: Replace AI-Default Palette

**When:** Scanner detects the cyan-on-dark, purple-to-blue gradient, or neon accent patterns.

**What to do:** Replace the AI defaults with a color palette that has actual personality. The problem isn't dark mode or gradients — it's that the specific colors are the defaults every AI reaches for.

**Step 1:** Pick a primary color that isn't cyan, electric-blue, or purple. Seriously, anything else.

**Step 2:** Derive the palette from that primary:
```css
:root {
  /* Example: warm, earthy palette instead of AI-tech-blue */
  --color-primary: oklch(55% 0.15 30);        /* terracotta */
  --color-primary-light: oklch(85% 0.06 30);  /* light terracotta */
  --color-primary-dark: oklch(35% 0.12 30);   /* deep terracotta */

  --color-neutral-50: oklch(97% 0.01 60);     /* warm off-white */
  --color-neutral-100: oklch(93% 0.01 60);    /* warm light gray */
  --color-neutral-700: oklch(35% 0.01 60);    /* warm dark gray */
  --color-neutral-900: oklch(20% 0.01 60);    /* warm near-black */
}
```

**Step 3:** Apply the 60-30-10 rule:
- 60% — neutrals (backgrounds, large surfaces)
- 30% — secondary color (supporting areas, cards, sections)
- 10% — accent/primary (CTAs, highlights, key moments)

### Recipe 4: Fix Gray Text on Colored Backgrounds

**When:** Scanner detects gray text (#666, #999) sitting on colored or dark backgrounds where it looks washed out.

**What to do:** Replace the gray with a tinted version that matches the background temperature.

```css
/* BEFORE: gray text on dark blue background */
.card { background: #1e3a5f; }
.card-meta { color: #999; }  /* washed out, hard to read */

/* AFTER: blue-tinted light text */
.card-meta { color: #94a3b8; }  /* slate-400, same family as the blue */
```

**Rule:** Secondary text on colored backgrounds should be a lighter shade of the background color, not a standalone gray. On dark backgrounds, use opacity or desaturated versions of the background hue.

### Recipe 5: Remove Gratuitous Gradients

**When:** Scanner detects purple-to-blue or cyan-to-magenta gradients used as decoration rather than design.

**What to do:** Replace with solid colors or, if a gradient serves a real purpose, use one that matches the brand palette.

```css
/* BEFORE: AI-default gradient */
.hero { background: linear-gradient(135deg, #7c3aed, #3b82f6); }

/* AFTER: solid brand color with subtle texture */
.hero { background-color: var(--color-primary); }

/* Or if gradient serves hierarchy: subtle, single-hue gradient */
.hero { background: linear-gradient(180deg, var(--color-primary), var(--color-primary-dark)); }
```

### Recipe 6: Tint the Neutrals

**When:** Scanner reports pure gray neutrals (#333, #666, #999, #ccc, #f5f5f5) with no temperature.

**What to do:** Add a subtle tint that matches the primary color's temperature.

```css
/* Warm palette → warm grays */
--neutral-50: #faf8f5;
--neutral-100: #f0ece6;
--neutral-400: #a39e94;
--neutral-700: #44403c;

/* Cool palette → cool grays */
--neutral-50: #f8fafc;
--neutral-100: #f1f5f9;
--neutral-400: #94a3b8;
--neutral-700: #334155;
```

---

## Anti-Patterns to Avoid

When fixing color, do NOT:

- **Add more colors** — the goal is a cohesive palette, not a rainbow. 2-4 colors plus neutrals.
- **Remove all color** — the fix for "too many colors" isn't "no colors." It's disciplined color.
- **Change the brand color entirely** — adjust lightness/saturation, keep the hue unless it's literally cyan-on-dark AI-default.
- **Rely on color alone** — always pair color with shape, text, or icon to communicate state. Colorblind users exist.
- **Use high chroma at extreme lightness** — very bright + very saturated = garish. Reduce chroma as lightness approaches white or black.
- **Introduce gradients to fix a flat palette** — gradients are decoration, not a color system. Fix the palette first.

---

## Verification Criteria

> **Checker scope:** The checker verifies the specific metric it was given (contrast ratio, element size, pattern detection). Broader criteria listed here are guidance for the scanner's re-evaluation, not individual checker measurements.

After applying a color fix, the checker should re-measure:

- **Contrast ratios** — all text-on-background combinations pass WCAG AA (4.5:1 body, 3:1 large)?
- **Neutral tint** — backgrounds are not pure #000/#fff?
- **Accent discipline** — primary accent used on 5 or fewer element types per page?
- **Palette size** — no more than 4 distinct saturated hues (plus neutrals)?
- **AI-pattern removal** — specifically flagged patterns (cyan-on-dark, purple-blue gradient, neon glow) no longer detected?
- **Color consistency** — same semantic meaning uses same color throughout (all errors red, all success green)?
