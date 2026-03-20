# Distill Fix Guide

How to fix AI slop findings from the scanner. This is the most Pixelslop-specific resource — it covers removing the visual fingerprints of AI-generated interfaces: glassmorphism, gradient text, glow shadows, decorative overload, and the general "prompted into existence" aesthetic.

---

## What This Guide Fixes

Scanner findings that map here:

- **AI Slop patterns (any)** — this is the primary guide for slop removal
- **AI Slop pattern: Gradient Text** — headings with background-clip: text
- **AI Slop pattern: Glassmorphism Everywhere** — backdrop-filter blur on everything
- **AI Slop pattern: Dark Mode with Glowing Accents** — neon box-shadows on dark backgrounds
- **AI Slop pattern: Decorative Sparklines** — tiny SVGs pretending to be data
- **AI Slop pattern: Bounce/Elastic Animations** — overshoot animations from Dribbble circa 2016
- **AI Slop pattern: Rounded Rectangles with Generic Shadows** — every container with border-radius 8-16px + soft shadow
- **AI Slop pattern: One-Sided Accent Borders** — thick colored left/top borders as lazy accents
- **AI Slop pattern: Icon-Above-Heading Pattern** — the universal "feature list" template
- **AI Slop pattern: Redundant Information** — heading says "Our Features," subtitle says "Explore our features"
- **AI Slop pattern: Every Button is Primary** — all buttons share the same visual weight
- **AI Slop pattern: Modal Overuse** — everything gets a modal
- Findings mentioning: slop, AI-generated, decoration, visual noise, pattern count

---

## How to Locate the Source

AI slop patterns are usually applied broadly through CSS classes, Tailwind utilities, or component-level styles. The scanner gives you specific counts and element references — use those to find the source.

### Finding Slop in Source

```bash
# Gradient text (background-clip: text)
grep -rn "background-clip.*text\|bg-clip-text\|-webkit-background-clip.*text" "$ROOT/src" --include="*.css" --include="*.tsx" | head -5

# Backdrop-filter / glassmorphism
grep -rn "backdrop-filter\|backdrop-blur" "$ROOT/src" --include="*.css" --include="*.tsx" | head -5

# Glowing box-shadows (saturated colors in shadows)
grep -rn "box-shadow.*rgba\|shadow-\[.*rgba\|shadow-cyan\|shadow-purple\|shadow-blue" "$ROOT/src" --include="*.css" --include="*.tsx" | head -5

# Bounce/elastic animations
grep -rn "cubic-bezier.*1\.[3-9]\|bounce\|elastic\|spring" "$ROOT/src" --include="*.css" --include="*.tsx" | head -5

# Gradient backgrounds (purple-blue range)
grep -rn "bg-gradient\|linear-gradient.*purple\|linear-gradient.*blue.*purple\|from-purple\|to-blue\|from-blue\|via-purple" "$ROOT/src" --include="*.css" --include="*.tsx" | head -10

# Decorative SVGs (sparklines, illustrations)
grep -rn "<svg" "$ROOT/src" --include="*.tsx" --include="*.jsx" --include="*.html" | wc -l
```

---

## Fix Recipes

### Recipe 1: Remove Gradient Text

**When:** Scanner detects elements with `background-clip: text` — headings that use gradient fills instead of solid color.

**What to do:** Replace with a solid color from the palette. The gradient wasn't adding information, it was adding decoration.

```css
/* BEFORE */
.hero-title {
  background: linear-gradient(135deg, #7c3aed, #3b82f6);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

/* AFTER */
.hero-title {
  color: var(--color-primary);
}
```

**Tailwind version:**
```html
<!-- BEFORE -->
<h1 class="bg-gradient-to-r from-purple-500 to-blue-500 bg-clip-text text-transparent">

<!-- AFTER -->
<h1 class="text-slate-900">
```

**Rule:** If gradient text is the only way a heading stands out, the hierarchy is weak. Fix the hierarchy (size, weight, space) instead of using decoration to compensate.

### Recipe 2: Remove Gratuitous Glassmorphism

**When:** Scanner detects 3+ elements with `backdrop-filter: blur`. One or two can be legitimate (a floating nav, a modal overlay). Five or more is a pattern.

**What to do:** Remove backdrop-filter from cards and containers. Keep it only where blur serves a functional purpose (overlay on image, floating header on scroll).

```css
/* BEFORE */
.card {
  background: rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.2);
}

/* AFTER */
.card {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
}
```

**Rule:** Glassmorphism is decoration pretending to be depth. Real depth comes from spacing, size, and intentional shadow — not from blurring whatever's behind the element.

### Recipe 3: Remove Glow Shadows

**When:** Scanner detects box-shadows with saturated colors (cyan, purple, blue halos around cards or buttons on dark backgrounds).

**What to do:** Replace colored glow shadows with subtle, neutral shadows. Or remove them entirely — dark mode interfaces don't need shadows for depth the way light mode does.

```css
/* BEFORE */
.card {
  box-shadow: 0 0 20px rgba(0, 200, 255, 0.3), 0 0 40px rgba(128, 0, 255, 0.15);
}

/* AFTER: subtle neutral shadow */
.card {
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
}

/* Or AFTER: no shadow on dark mode (use border instead) */
.card {
  border: 1px solid rgba(255, 255, 255, 0.08);
}
```

**Dark mode tip:** In dark mode, use subtle borders instead of shadows for card definition. Shadows on dark backgrounds are nearly invisible anyway — the glow was compensating for that by using saturated colors.

### Recipe 4: Simplify Decoration Overload

**When:** Scanner reports high counts of rounded-rectangle-with-shadow elements, or excessive decoration in general.

**What to do:** Strip decoration to a minimum. Not every container needs border-radius, shadow, AND background color. Pick one treatment and apply it consistently.

```css
/* BEFORE: every container decorated */
.card { border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,.1); background: white; }
.sidebar { border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,.1); background: white; }
.widget { border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,.1); background: white; }

/* AFTER: selective decoration with hierarchy */
.card { border-radius: 8px; border: 1px solid var(--color-border); }
.sidebar { /* no extra decoration — spacing handles grouping */ }
.widget.featured { border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,.06); }
```

**Rule:** Decoration should create hierarchy, not uniformity. If every element has the same shadow and radius, none of them stands out. Give decoration to the things that matter, strip it from everything else.

### Recipe 5: Fix Redundant Copy

**When:** Scanner detects heading + subtitle pairs that say the same thing twice. "Our Features" → "Explore the features we offer."

**What to do:** Remove the redundant element. Keep whichever one is more specific.

```html
<!-- BEFORE -->
<h2>Our Features</h2>
<p>Explore the amazing features we offer to help you succeed.</p>

<!-- AFTER: just the heading, made more specific -->
<h2>Ship faster with built-in CI/CD</h2>
```

If both are vague, rewrite the heading to be specific and remove the subtitle entirely.

### Recipe 6: Differentiate Button Hierarchy

**When:** Scanner reports all buttons with the same visual treatment — no distinction between primary, secondary, and tertiary actions.

**What to do:** Establish 2-3 button tiers with clear visual weight.

```css
/* Primary — filled, high contrast, for the main action */
.btn-primary {
  background: var(--color-primary);
  color: white;
  border: none;
}

/* Secondary — outlined, medium weight, for supporting actions */
.btn-secondary {
  background: transparent;
  color: var(--color-primary);
  border: 1px solid var(--color-primary);
}

/* Tertiary — text-only, low weight, for optional actions */
.btn-tertiary {
  background: transparent;
  color: var(--color-primary);
  border: none;
  text-decoration: underline;
}
```

### Recipe 7: Remove Bounce/Elastic Animations

**When:** Scanner detects `cubic-bezier` curves with overshoot (4th parameter > 1.3) or named bounce/elastic effects.

**What to do:** Replace with standard easing. Elements should arrive at their destination without bouncing past it.

```css
/* BEFORE */
.card { transition: transform 0.3s cubic-bezier(0.68, -0.55, 0.27, 1.55); }

/* AFTER: standard ease-out */
.card { transition: transform 0.2s ease-out; }
```

---

## Anti-Patterns to Avoid

When removing slop, do NOT:

- **Remove ALL decoration** — the goal is intentional decoration, not no decoration. A plain unstyled page isn't better than a sloppy one.
- **Replace one AI pattern with another** — switching from purple-blue gradient to cyan-teal gradient is not a fix.
- **Add more CSS to compensate** — removing glassmorphism doesn't require adding something else in its place. Sometimes less is the fix.
- **Remove animations entirely** — remove the *bouncy/decorative* animations. Subtle transitions on interactive elements (hover, focus) are good UX.
- **Strip dark mode** — dark mode is fine. AI-default dark mode with glowing accents is not. Fix the palette and shadows, keep the dark background if it's intentional.

---

## Verification Criteria

After applying a slop fix, the checker should re-measure:

- **Pattern count** — has the total detected slop pattern count decreased?
- **Specific pattern** — is the targeted pattern (gradient text, glassmorphism, etc.) no longer detected?
- **Visual regression** — did removing decoration break the layout? (Screenshot comparison at relevant viewport.)
- **Contrast maintained** — does the page still pass WCAG AA after color changes?
- **Hierarchy preserved** — does visual hierarchy still work without the removed decoration? (If gradient text was the only thing making the heading stand out, removing it might break hierarchy — the heading needs another way to be prominent.)
