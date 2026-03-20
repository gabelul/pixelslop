# Adapt Fix Guide

How to fix responsiveness findings from the scanner. Covers breakpoint behavior, touch targets, overflow, and mobile layout adaptation — the things that make a site actually work on phones instead of just shrinking.

---

## What This Guide Fixes

Scanner findings that map here:

- **Responsiveness pillar score 1-2** — broken mobile, horizontal overflow, tiny touch targets, desktop-just-shrunk
- **AI Slop pattern: Generic Hero Sections** — heroes that don't adapt, just squish
- Findings mentioning: overflow, touch targets, breakpoints, mobile layout, tablet layout, viewport, responsive

---

## How to Locate the Source

The scanner reports overflow at specific viewports, touch target sizes, and whether layout genuinely adapts or just shrinks. Trace back to the structural CSS.

### Framework Detection

```bash
# Tailwind responsive — look for breakpoint prefixes
grep -rn "sm:\|md:\|lg:\|xl:" "$ROOT/src" --include="*.tsx" --include="*.jsx" --include="*.html" | head -10

# CSS media queries
grep -rn "@media" "$ROOT/src" --include="*.css" --include="*.scss" | head -10

# Fixed widths that might cause overflow
grep -rn "width:\s*\d\+px\|min-width:\s*\d\+px" "$ROOT/src" --include="*.css" --include="*.scss" | head -10
```

### Finding the Overflow Source

```bash
# Elements with fixed widths larger than mobile viewport (375px)
grep -rn "width:\s*[4-9][0-9][0-9]px\|width:\s*[1-9][0-9][0-9][0-9]px" "$ROOT/src" --include="*.css" --include="*.tsx" | head -5

# Flex items without wrapping
grep -rn "display.*flex" "$ROOT/src" --include="*.css" --include="*.tsx" | head -10

# Tables (common overflow offenders)
grep -rn "<table\|display.*table" "$ROOT/src" --include="*.css" --include="*.tsx" --include="*.html" | head -5
```

---

## Fix Recipes

### Recipe 1: Fix Horizontal Overflow

**When:** Scanner reports elements extending beyond viewport at 375px or 768px.

**Common causes and fixes:**

```css
/* Cause: Fixed-width container */
.container { width: 1200px; }
/* Fix: Make it responsive */
.container { width: 100%; max-width: 1200px; margin: 0 auto; }

/* Cause: Flex row that doesn't wrap */
.row { display: flex; }
/* Fix: Allow wrapping */
.row { display: flex; flex-wrap: wrap; }

/* Cause: Image without max-width */
img { /* no constraints */ }
/* Fix: Responsive images */
img { max-width: 100%; height: auto; }

/* Cause: Table wider than viewport */
table { min-width: 800px; }
/* Fix: Horizontal scroll wrapper */
.table-wrapper { overflow-x: auto; -webkit-overflow-scrolling: touch; }
table { min-width: 800px; } /* keep the table readable */
```

**Rule:** The nuclear option is `overflow-x: hidden` on `body`. Do NOT do this — it masks the problem instead of fixing it. Find the offending element and constrain it properly.

### Recipe 2: Fix Touch Targets

**When:** Scanner reports interactive elements (buttons, links, inputs) smaller than 44x44px on mobile.

**What to do:** Increase the tappable area without necessarily making the visual element larger.

```css
/* Option A: Increase padding on the element itself */
.small-link {
  padding: 12px 16px; /* Makes the link 44px+ tall with typical line-height */
}

/* Option B: Invisible hit area via pseudo-element */
.icon-button {
  position: relative;
}
.icon-button::after {
  content: '';
  position: absolute;
  inset: -10px;  /* Extends tap target 10px in every direction */
}

/* Option C: Minimum size constraint */
button, a, input, select {
  min-height: 44px;
  min-width: 44px;
}
```

**For navigation links specifically:**
```css
/* Mobile nav links need generous padding */
@media (max-width: 768px) {
  .nav-link {
    display: block;
    padding: 12px 16px;
  }
}
```

**Rule:** 44x44px is the WCAG 2.5.5 minimum. 48px is better. Never go below 44px for touch devices.

### Recipe 3: Adapt Layout (Not Just Shrink)

**When:** Scanner reports the same layout structure at all viewports — just narrower. No column collapse, no navigation change.

**What to do:** The layout needs to genuinely change at mobile widths.

**Self-adjusting grid (no media queries needed):**
```css
.card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: var(--space-lg);
}
```
This automatically goes from 3 columns on desktop to 1 column on mobile. No breakpoint needed.

**Explicit breakpoint for complex layouts:**
```css
.two-column {
  display: grid;
  grid-template-columns: 1fr;
  gap: var(--space-lg);
}

@media (min-width: 768px) {
  .two-column {
    grid-template-columns: 2fr 1fr;
  }
}
```

**Navigation adaptation:**
```css
/* Mobile: hamburger or bottom nav */
@media (max-width: 768px) {
  .desktop-nav { display: none; }
  .mobile-nav { display: flex; }
}

/* Desktop: full horizontal nav */
@media (min-width: 769px) {
  .mobile-nav { display: none; }
  .desktop-nav { display: flex; }
}
```

### Recipe 4: Fix Mobile Typography

**When:** Scanner reports body text below 14px on mobile, or desktop-sized headings squeezed into mobile viewport.

**What to do:** Use `clamp()` for fluid sizing, or set explicit mobile sizes.

```css
/* Fluid approach — scales smoothly between viewports */
h1 { font-size: clamp(1.75rem, 4vw + 1rem, 3.5rem); }
h2 { font-size: clamp(1.375rem, 2vw + 0.875rem, 2.25rem); }

/* Explicit breakpoint approach */
h1 { font-size: 2rem; }
@media (min-width: 768px) {
  h1 { font-size: 3.5rem; }
}

/* Body text — never below 16px on mobile */
body { font-size: max(1rem, 16px); }
```

### Recipe 5: Fix Content Stacking Order

**When:** Content on mobile is in a confusing order — the CTA appears before the context, or visual elements dominate above the fold while the actual content is buried.

**What to do:** Use CSS Grid with explicit `order` or grid areas to reorder content for mobile.

```css
.hero {
  display: grid;
  grid-template-areas: 'content' 'image';
}

@media (min-width: 768px) {
  .hero {
    grid-template-columns: 1fr 1fr;
    grid-template-areas: 'content image';
  }
}

.hero-content { grid-area: content; }
.hero-image { grid-area: image; }
```

### Recipe 6: Handle Pointer and Hover Differences

**When:** The site has hover-only interactions (hover to reveal menus, hover to show tooltips) that don't work on touch.

```css
/* Only apply hover effects when the device supports hover */
@media (hover: hover) {
  .card:hover {
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(0,0,0,.1);
  }
}

/* Touch devices: make the content always visible */
@media (hover: none) {
  .hover-reveal { opacity: 1; } /* Don't hide behind hover */
}
```

---

## Anti-Patterns to Avoid

When fixing responsiveness, do NOT:

- **Hide content on mobile with `display: none`** — if it matters, make it work. If it doesn't matter, remove it everywhere.
- **Use `overflow-x: hidden` on body** — this masks overflow, it doesn't fix it. Find the source.
- **Desktop-first CSS** — write mobile-first (base styles for mobile, `min-width` queries to add complexity). Loads less CSS on mobile.
- **Test only in DevTools** — browser emulation lies about touch targets, font rendering, and performance. Real device testing catches what DevTools doesn't.
- **Add breakpoints based on device names** — use content-driven breakpoints. Your layout tells you when it breaks.
- **Create separate mobile/desktop versions** — one responsive codebase. Two codebases means two sets of bugs.

---

## Verification Criteria

> **Checker scope:** The checker verifies the specific metric it was given (contrast ratio, element size, pattern detection). Broader criteria listed here are guidance for the scanner's re-evaluation, not individual checker measurements.

After applying a responsiveness fix, the checker should re-measure:

- **Overflow** — no horizontal scroll at 375px, 768px, or 1440px viewport?
- **Touch targets** — all interactive elements 44x44px+ at 375px viewport?
- **Layout change** — does column count or layout structure actually change between desktop and mobile?
- **Mobile font size** — body text 16px+ on mobile?
- **Navigation** — does navigation change form on mobile (hamburger, bottom nav, etc.)?
- **Images** — do images scale with `max-width: 100%`? No fixed-width images causing overflow?
