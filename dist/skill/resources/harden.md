# Harden Fix Guide

How to fix accessibility and interaction findings from the scanner. Covers ARIA attributes, focus indicators, touch targets, text overflow, and missing interactive states — the things that make a site usable by everyone, not just people with mice and perfect vision.

---

## What This Guide Fixes

Scanner findings that map here:

- **Accessibility pillar score 1-2** — missing ARIA, no focus indicators, broken heading hierarchy, missing landmarks
- **Accessibility pillar (non-contrast findings)** — missing alt text, skip links, semantic HTML
- Findings mentioning: ARIA, focus, keyboard, screen reader, landmarks, alt text, heading hierarchy, touch targets, semantic HTML, tab order

Note: **Contrast failures** go to `colorize.md`. This guide handles everything else under accessibility.

---

## How to Locate the Source

The scanner reports from the accessibility snapshot (heading hierarchy, landmarks, ARIA) and from computed styles (focus indicators, touch targets). Trace issues to the HTML/JSX source.

### Finding the Problem Elements

```bash
# Missing alt text on images
grep -rn "<img" "$ROOT/src" --include="*.tsx" --include="*.jsx" --include="*.html" | grep -v "alt=" | head -5

# Elements with onClick but no role or keyboard handler
grep -rn "onClick" "$ROOT/src" --include="*.tsx" --include="*.jsx" | grep -v "button\|Button\|<a " | head -5

# Focus indicator overrides (outline: none without replacement)
grep -rn "outline.*none\|outline.*0\b" "$ROOT/src" --include="*.css" --include="*.scss" | head -5

# Missing landmarks
grep -rn "<main\|<nav\|<header\|<footer\|role=\"main\"\|role=\"navigation\"" "$ROOT/src" --include="*.tsx" --include="*.jsx" --include="*.html" | head -10

# Heading usage
grep -rn "<h[1-6]" "$ROOT/src" --include="*.tsx" --include="*.jsx" --include="*.html" | head -20
```

---

## Fix Recipes

### Recipe 1: Fix Missing Alt Text

**When:** Scanner reports images without `alt` attributes in the accessibility snapshot.

**What to do:** Add descriptive alt text for content images. Use empty alt for decorative images.

```html
<!-- Content image — describe what it communicates -->
<!-- BEFORE -->
<img src="chart.png" />

<!-- AFTER -->
<img src="chart.png" alt="Revenue grew 40% in Q4, from $2M to $2.8M" />

<!-- Decorative image — explicitly mark as decorative -->
<!-- BEFORE -->
<img src="decorative-blob.svg" />

<!-- AFTER -->
<img src="decorative-blob.svg" alt="" role="presentation" />
```

**Rule:** Alt text describes the **information** the image conveys, not the image itself. "Bar chart" is useless. "Revenue grew 40% in Q4" is useful. If the image is purely decorative, `alt=""` tells screen readers to skip it.

### Recipe 2: Fix Heading Hierarchy

**When:** Scanner reports skipped heading levels (h1 → h3 with no h2), multiple h1s, or no h1 at all.

**What to do:** Ensure headings follow a logical progression: one h1, then h2s, then h3s under their h2s.

```html
<!-- BEFORE: broken hierarchy -->
<h1>Welcome</h1>
<h3>Features</h3>    <!-- Skipped h2 -->
<h1>Contact Us</h1>  <!-- Duplicate h1 -->

<!-- AFTER: logical hierarchy -->
<h1>Welcome</h1>
<h2>Features</h2>    <!-- Correct level -->
<h2>Contact Us</h2>  <!-- h2, not duplicate h1 -->
```

**If the visual design requires an h3-sized h2:** Use CSS to style it smaller. The HTML level is for document structure, CSS is for appearance.

```css
/* h2 that looks like h3 visually but maintains hierarchy */
.section-subheading {
  font-size: var(--text-lg); /* Smaller than typical h2 */
}
```

### Recipe 3: Add Landmark Regions

**When:** Scanner reports missing `<main>`, `<nav>`, `<header>`, or `<footer>` elements.

**What to do:** Replace generic `<div>` wrappers with semantic elements.

```html
<!-- BEFORE -->
<div class="header">...</div>
<div class="nav">...</div>
<div class="content">...</div>
<div class="footer">...</div>

<!-- AFTER -->
<header>...</header>
<nav aria-label="Main navigation">...</nav>
<main>...</main>
<footer>...</footer>
```

**Rule:** Every page needs at minimum: `<header>`, `<nav>`, `<main>`, and `<footer>`. These let screen reader users jump between sections. A page without landmarks is like a book without a table of contents.

### Recipe 4: Fix Focus Indicators

**When:** Scanner reports `outline: none` or `outline: 0` on interactive elements without a replacement focus style.

**What to do:** Add visible `:focus-visible` styles. This shows focus rings for keyboard users but not for mouse clicks.

```css
/* BEFORE: focus removed entirely */
button:focus { outline: none; }
a:focus { outline: 0; }

/* AFTER: visible focus for keyboard, hidden for mouse */
button:focus { outline: none; }
button:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

a:focus { outline: none; }
a:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}
```

**Rule:** Never remove focus indicators without providing an alternative. `:focus-visible` is the modern approach — it only shows the focus ring when the user is navigating with a keyboard, not when clicking with a mouse.

### Recipe 5: Add ARIA to Custom Interactive Elements

**When:** Scanner reports `<div>` or `<span>` elements with click handlers but no `role` or keyboard handling.

**What to do:** Either replace with a native interactive element, or add proper ARIA.

```html
<!-- BEST: Replace with native element -->
<!-- BEFORE -->
<div class="btn" onclick="doThing()">Click me</div>

<!-- AFTER -->
<button class="btn" onclick="doThing()">Click me</button>

<!-- If you can't change the element, add ARIA + keyboard handling -->
<div
  class="btn"
  role="button"
  tabindex="0"
  onclick="doThing()"
  onkeydown="if(event.key==='Enter'||event.key===' ')doThing()"
  aria-label="Click me"
>Click me</div>
```

**Rule:** Native elements (`<button>`, `<a>`, `<input>`) come with built-in keyboard handling and ARIA roles. Use them. Custom elements with `role="button"` are a last resort when you can't change the HTML structure.

### Recipe 6: Add Skip-to-Content Link

**When:** Scanner reports no skip link. Keyboard users have to tab through the entire header/nav to reach content.

```html
<!-- Add as the FIRST element inside <body> -->
<a href="#main-content" class="skip-link">Skip to content</a>

<!-- ... header, nav, etc. ... -->

<main id="main-content">
  <!-- page content -->
</main>
```

```css
.skip-link {
  position: absolute;
  top: -40px;
  left: 0;
  padding: 8px 16px;
  background: var(--color-primary);
  color: white;
  z-index: 100;
  transition: top 0.2s;
}

.skip-link:focus {
  top: 0;
}
```

### Recipe 7: Fix Text Overflow

**When:** Scanner reports text truncated or overlapping at narrow viewports.

```css
/* Single-line truncation with ellipsis */
.truncate {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Multi-line clamp */
.line-clamp {
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* Long words/URLs that break containers */
.wrap-break {
  word-wrap: break-word;
  overflow-wrap: break-word;
  hyphens: auto;
}

/* Flex/grid items that refuse to shrink */
.flex-item { min-width: 0; overflow: hidden; }
.grid-item { min-width: 0; min-height: 0; }
```

### Recipe 8: Respect Reduced Motion

**When:** Page has animations but no `prefers-reduced-motion` media query.

```css
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

---

## Anti-Patterns to Avoid

When fixing accessibility, do NOT:

- **Add ARIA to everything** — ARIA is a last resort. Use native HTML elements first. A `<button>` beats a `<div role="button">` every time.
- **Remove focus outlines without replacement** — if you hide the default outline, you MUST provide an alternative visible focus style.
- **Use placeholder text as labels** — placeholders disappear when you start typing. Labels are permanent.
- **Add `alt="image"` or `alt="photo"`** — these are worse than no alt text. Describe the information, not the medium.
- **Fix heading hierarchy by changing visual styles** — don't make an h3 *look* like an h2. Change the HTML level and style with CSS.
- **Assume keyboard testing is sufficient** — test with an actual screen reader (VoiceOver on Mac, NVDA on Windows) for at least the critical user flows.

---

## Verification Criteria

After applying an accessibility fix, the checker should re-measure:

- **Heading hierarchy** — exactly one h1, no skipped levels?
- **Landmarks** — `<main>`, `<nav>`, `<header>`, `<footer>` all present?
- **Alt text** — all content images have descriptive alt? Decorative images have `alt=""`?
- **Focus indicators** — visible focus ring on all interactive elements when tabbing?
- **ARIA** — custom interactive elements have `role`, `tabindex`, and keyboard handlers?
- **Skip link** — does a skip-to-content link exist and function?
- **Touch targets** — all interactive elements 44x44px+ at mobile viewport?
- **Reduced motion** — `prefers-reduced-motion` media query present?
