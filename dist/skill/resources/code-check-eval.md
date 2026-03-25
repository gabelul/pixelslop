# Code Check Evaluation Protocol

You're running without a browser. No Playwright, no screenshots, no computed styles. What you have is source code, a set of grep patterns, and the ability to read files. That's enough to catch a surprising amount of design quality issues -- but be honest about what you can't verify.

Code check is report-only. No pillar scores (those need rendered evidence), no fixes, no plan file, no checkpoints.

---

## File Discovery

Find target files using Glob:

```
**/*.{html,jsx,tsx,vue,svelte,astro,css,scss,less,pcss,ts,js}
```

Exclude `node_modules/`, `dist/`, `build/`, `.next/`, `.nuxt/`, `vendor/`, and anything in `.gitignore`.

If the project has more than 500 target files, sample strategically: prioritize `src/`, `app/`, `pages/`, `components/`, and `styles/` directories. Note in the report that sampling was used and how many files were scanned out of the total.

Report file count and breakdown by type (e.g., "142 files: 48 TSX, 32 CSS, 28 HTML, 34 other").

---

## Slop Pattern Detection

Check for all patterns from `ai-slop-patterns.md`. Visual patterns (1-10) have browser JS snippets, but most also have source-level grep equivalents. Source patterns (S11-S16) are grep-native.

### Source Equivalents of Visual Patterns

| # | Pattern | Grep Pattern | What You're Looking For |
|---|---------|-------------|------------------------|
| 1 | Gradient text | `background-clip:\s*text\|bg-clip-text\|-webkit-background-clip:\s*text` | CSS gradient applied to text via clipping |
| 2 | Glassmorphism | `backdrop-filter:\s*blur` | Blur effects on elements (occasional = fine, 3+ = pattern) |
| 3 | Dark + glow | Background: `#0[0-9a-f]{5}\|#1[0-9a-f]{5}\|bg-\[#0\|bg-gray-9\|bg-slate-9\|bg-zinc-9` combined with `box-shadow:.*#[0-9a-f]` where the shadow color is saturated | Very dark backgrounds with colored shadows |
| 4 | Hero metrics | `stat-card\|metric-card\|StatCard\|MetricCard\|dashboard-stat\|stats-grid\|metric-grid` | Named metric/stat display components |
| 5 | Identical cards | Check `ai-slop-patterns.md` S11 -- repeated identical section structures | 3+ sections with same heading->paragraph->button layout |
| 6 | Everything centered | `text-align:\s*center\|text-center\|mx-auto.*mx-auto\|items-center.*justify-center` | Count occurrences -- >70% of text blocks centered = pattern |
| 7 | Generic fonts | `font-family:.*(?:inter\|roboto\|arial\|open.sans\|lato\|montserrat\|system-ui)` (case-insensitive) or Tailwind `font-sans` without custom font config | Overused AI-default font stacks |
| 8 | Floating cards | `translateY.*hover\|hover:.*-translate-y\|hover.*shadow-lg\|hover.*shadow-xl` | Cards that float up on hover with shadow increase |
| 9 | Bounce animations | `cubic-bezier\([^)]*[2-9]\|cubic-bezier\([^)]*1\.[5-9]\|animation.*bounce\|transition.*bounce` | Easing with overshoot values > 1.0 |
| 10 | One-sided borders | `border-(left\|top):\s*\d+px\s+solid\|border-l-\d\|border-t-\d` | Thick colored single-side borders used as decoration |

### Additional Source-Level Patterns

These aren't in the visual catalog but are strong source-level signals:

- **Hard-coded colors outside variables:** Grep for hex colors (`#[0-9a-fA-F]{3,8}`) in CSS/JSX that aren't inside `:root`, `--`, `@theme`, or variable declarations. A few is normal; 20+ unique hex values scattered across files = no design system.
- **Pure black/white:** `#000000\|#000\b\|#ffffff\|#fff\b\|rgb(0,\s*0,\s*0)\|rgb(255,\s*255,\s*255)` -- AI defaults to pure extremes instead of tinted neutrals.
- **Layout property animation:** `@keyframes[^}]*(?:width\|height\|padding\|margin\|top\|left\|right\|bottom)` -- Animating layout properties instead of transform/opacity.
- **Focus removal without replacement:** `outline:\s*(?:none\|0)` without a nearby `:focus-visible` rule -- kills keyboard accessibility.
- **Transition-all:** `transition:\s*all\|transition-property:\s*all` -- Lazy shorthand that animates properties you didn't intend.

### Source Patterns S11-S16

These are defined in `ai-slop-patterns.md` with their grep patterns. Read them from there -- don't duplicate the definitions. Just run the greps.

### Classification

Use the same bands as the visual scanner. Count unique patterns detected (not total matches -- a pattern that appears in 10 files still counts as 1 pattern):

| Rating | Pattern Count | Meaning |
|--------|--------------|---------|
| **CLEAN** | 0-1 | Source shows intentional design decisions |
| **MILD** | 2-3 | Some AI tendencies in the code |
| **SLOPPY** | 4-6 | Multiple AI fingerprints in source |
| **TERMINAL** | 7+ | Source is a showcase of AI defaults |

**Important caveat:** Source detection has lower confidence than browser detection. A pattern in CSS might be in an unused file, an overridden style, or a third-party dependency. Note this in the report when relevant.

---

## Accessibility Structure Checks

These are structural checks -- does the HTML have the right bones? You can't verify contrast ratios or focus visibility without a browser, but you can catch missing landmarks, labels, and semantic structure.

### Checks

| Check | Grep Pattern | Flag When |
|-------|-------------|-----------|
| Missing alt text | `<img[^>]*(?!.*alt=)` or `<img[^>]*alt=""` with non-decorative context | Any `<img>` without `alt` attribute (empty `alt=""` is fine for decorative images) |
| Placeholder-only labels | `<input[^>]*placeholder=` without nearby `<label` or `aria-label` | Inputs using placeholder instead of proper labels |
| Missing landmarks | Absence of `<main\|<nav\|<header\|<footer\|role="main"\|role="navigation"` | No landmarks in the primary layout files |
| Heading hierarchy | Extract `<h[1-6]` tags, check for level skips (h1 -> h3 with no h2) | Skipped heading levels in any component |
| Missing skip link | Absence of `#main-content\|#content\|skip-to\|skip-nav\|skip-link` | No skip navigation link in the layout/header |
| Missing lang | `<html` without `lang=` attribute | Primary HTML file has no language declaration |
| Focus removal | `outline:\s*(?:none\|0)\|outline-none` without corresponding `:focus-visible` rule | Focus indicators stripped with no replacement |
| Icon-only buttons | `<button[^>]*>[^<]*<(?:svg\|img\|i\b)` without `aria-label` | Buttons containing only an icon with no accessible name |

### Reporting

For each finding, include:
- File path and line number
- The specific element or pattern matched
- Why it matters (one sentence)

Don't flag issues in test files, storybook stories, or documentation. Focus on production source.

---

## Generic Copy Detection

AI-generated interfaces love generic text. These patterns are dead giveaways.

### Checks

| Check | Grep Pattern | Flag When |
|-------|-------------|-----------|
| Repeated button labels | `>Learn More<\|>Get Started<\|>Read More<\|>Try Now<\|>Sign Up<\|>Explore<\|>Discover<` | Same generic label appears 3+ times across different sections |
| Placeholder content | `Lorem ipsum\|Coming soon\|\\[Your .* here\\]\|\\[Insert\|placeholder text\|sample text` | Any leftover placeholder text in production files |
| Stock photo alt text | `alt="[^"]*(?:diverse team\|professional\|working on laptop\|business meeting\|happy customer\|smiling person\|team collaboration)` | Alt text that describes generic stock imagery |
| Generic headings | `>Our Features<\|>Why Choose Us<\|>Get Started<\|>Our Services<\|>About Us<\|>How It Works<\|>What Our Customers Say<\|>Ready to` | Headings that could belong to literally any website |
| Repeated section names | Count distinct section/component headings -- flag if 3+ are generic enough to be interchangeable | Sections that lack specific, differentiated content |

---

## Missing State Detection

Good interfaces handle more than the happy path. Check whether the codebase accounts for edge states.

### Checks

| State | Grep For Presence | Flag When |
|-------|------------------|-----------|
| Error | `error\|aria-invalid\|role="alert"\|\.error\|alert-danger\|error-message\|validation` | No error handling patterns found in form-heavy or data-fetching code |
| Loading | `loading\|aria-busy\|role="progressbar"\|skeleton\|spinner\|isLoading\|isPending` | No loading states in code that fetches data or submits forms |
| Empty | `no results\|no data\|empty.state\|emptyState\|no items\|nothing here\|not found` | No empty state handling in list/table/feed components |
| Disabled | `disabled\|aria-disabled\|isDisabled\|:disabled\|cursor-not-allowed` | No disabled state handling for interactive elements |

**Context matters.** A simple landing page doesn't need loading states. A dashboard with API calls does. Use file context to judge relevance -- don't flag a marketing page for missing `aria-busy`.

---

## Theming Issues

Source-level signals that the design system (or lack thereof) needs attention.

### Checks

| Check | How to Detect | Flag When |
|-------|--------------|-----------|
| Hard-coded colors | Count unique hex/rgb values outside `:root`, CSS variable declarations, or Tailwind config | >15 unique hard-coded color values scattered across files |
| No dark mode | Search for `prefers-color-scheme\|dark-mode\|theme-dark\|data-theme\|\.dark\s` | Zero dark mode support in a project with custom theming |
| Spacing inconsistency | Extract unique margin/padding pixel values from CSS | >12 distinct pixel-based spacing values (suggests no spacing scale) |
| No CSS variables | Check if the project uses `var(--` or CSS custom properties | CSS-heavy project with zero custom properties = no token system |

---

## Report Format

Every code check produces this exact structure. Tooling downstream will parse it.

```
## Pixelslop Code Check: [project name or directory name]

Root: [absolute path]
Date: [ISO timestamp]
Files scanned: [count] ([breakdown by type])
Confidence: [percentage]%

### Source Slop Patterns

[count] patterns detected -- **[CLEAN/MILD/SLOPPY/TERMINAL]**

| # | Pattern | Count | Files | Evidence |
|---|---------|-------|-------|----------|
| 1 | [pattern name] | [match count] | [file list] | [representative match] |

### Accessibility Structure

[findings with file:line references, grouped by check type]

### Generic Copy

[findings with file:line references]

### Missing States

[findings with file:line references, noting which states are absent]

### Theming Issues

[findings with specific counts and file references]

### Not Verified (requires browser)

These checks need rendered output -- a code check can't measure them:

- Contrast ratios (need computed colors on rendered backgrounds)
- Touch target sizes (need rendered element dimensions)
- Responsive behavior (need viewport testing across breakpoints)
- Visual hierarchy (need rendered layout to assess focal points)
- Real typography metrics (need computed font rendering)
- Color palette cohesion (need rendered palette extraction)
- Animation timing (need runtime measurement)

To get these, run a full visual scan: `/pixelslop [url]`
```

---

## Confidence Model

Code check starts at a lower baseline than visual scanning -- source analysis misses things that only show up when rendered.

| Factor | Bonus |
|--------|-------|
| Base confidence | 40% |
| All target files scanned (no sampling) | +15% |
| Slop pattern detection completed | +10% |
| Accessibility structure checked | +10% |
| Generic copy checked | +10% |
| Missing states checked | +10% |
| Theming issues checked | +5% |
| **Maximum** | **100%** |

In `--thorough` mode, the finding threshold drops from 65% to 50% (same as the visual scanner). Tag low-confidence findings with `[low confidence]`.

Findings that rely on a single grep match without surrounding context should be flagged lower-confidence than findings corroborated by multiple signals.
