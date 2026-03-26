# Visual Evaluation Protocol

Operational manual for the Pixelslop scanner agent. Tells you exactly how to use Playwright MCP tools to capture visual evidence from a live web page and produce structured data for scoring.

Every JS snippet here is complete and runnable via `browser_evaluate`. Copy them verbatim.

---

## 1. Viewport Protocol

Three viewports, always in this order -- desktop first establishes the baseline.

| Viewport | Size | Role |
|----------|------|------|
| Desktop | 1440x900 | Primary evaluation. Typography, colors, spacing, decorations, contrast, a11y snapshot. |
| Tablet | 768x1024 | Breakpoint stress test. Layout comparison, overflow check. |
| Mobile | 375x812 | Usability gauntlet. Touch targets, overflow, text readability. |

---

## 2. Evaluation Sequence

Follow this sequence for every URL. Do not skip steps, do not reorder.

### Step 1: Navigate

```
browser_navigate({ url: "<target_url>" })
browser_console_messages()
browser_network_requests()
```

Load the URL, then immediately grab console and network data. Flag console errors (not warnings) and failed network requests (4xx/5xx). These are secondary signals -- record them but do not let them dominate.

### Step 2: Desktop Evaluation (1440x900)

The main event. Most evidence comes from here.

```
browser_resize({ width: 1440, height: 900 })
browser_take_screenshot()
```

Save screenshot as `.pixelslop/screenshots/[domain]-desktop-[timestamp].png`.

Run all five extraction snippets from Section 3: typography, color, spacing, decoration, contrast.

Then get the accessibility snapshot and check console:

```
browser_snapshot()
browser_console_messages()
```

See Section 4 for what to check in the snapshot output.

### Step 3: Tablet Evaluation (768x1024)

```
browser_resize({ width: 768, height: 1024 })
browser_take_screenshot()
```

Save as `.pixelslop/screenshots/[domain]-tablet-[timestamp].png`. Run the horizontal overflow check from Section 3.

Compare against desktop -- you are not re-running all extractions, just checking what changed. Common tablet failures: grids without a breakpoint, fixed-width heroes, navigation that neither stays inline nor collapses.

### Step 4: Mobile Evaluation (375x812)

```
browser_resize({ width: 375, height: 812 })
browser_take_screenshot()
```

Save as `.pixelslop/screenshots/[domain]-mobile-[timestamp].png`. Run touch target audit and horizontal overflow check from Section 3. Also check text readability -- body text below 14px on mobile is a problem.

### Step 5: Cross-Viewport Comparison

After all three viewports are evaluated, compare:

- **Layout shifts:** Did the page respond to narrower viewports or just shrink?
- **Content reflow:** Are elements stacking logically on smaller screens?
- **Overflow:** Horizontal scroll at tablet or mobile is a red flag.
- **Touch targets:** Fine with a cursor, too small for a finger?
- **Typography scaling:** Did font sizes adapt or is desktop type shoved into mobile?

---

## 3. JS Extraction Snippets

All snippets run via `browser_evaluate`, return structured data, and should not be modified. Each snippet is an arrow function `() => {...}` — pass it directly to `browser_evaluate`'s `function` parameter. Do NOT wrap in `(...)()` — the tool invokes the function internally.

### Typography Extraction

```js
() => {
  const selectors = ['h1','h2','h3','h4','h5','h6','p','button','a','li','label','input','th','td'];
  const results = {};
  selectors.forEach(sel => {
    const el = document.querySelector(sel);
    if (!el) return;
    const s = getComputedStyle(el);
    results[sel] = {
      fontFamily: s.fontFamily,
      fontSize: s.fontSize,
      fontWeight: s.fontWeight,
      lineHeight: s.lineHeight,
      letterSpacing: s.letterSpacing,
      color: s.color
    };
  });
  return results;
}
```

### Color Extraction

Samples bg, text, and border colors from structural and interactive elements. Capped at 50 entries.

```js
() => {
  const samples = [];
  const key = document.querySelectorAll('body, main, header, footer, nav, section, article, aside, [class*="card"], [class*="hero"], [class*="banner"], button, a');
  key.forEach(el => {
    const s = getComputedStyle(el);
    samples.push({
      tag: el.tagName.toLowerCase(),
      classes: el.className?.toString().slice(0, 80) || '',
      bg: s.backgroundColor,
      color: s.color,
      borderColor: s.borderColor,
      backgroundImage: s.backgroundImage !== 'none' ? s.backgroundImage.slice(0, 200) : null
    });
  });
  return samples.slice(0, 50);
}
```

### Spacing Extraction

Padding, margin, gap, and max-width from containers. Reveals whether the site uses a consistent spacing system.

```js
() => {
  const containers = document.querySelectorAll('main, section, article, [class*="container"], [class*="wrapper"], [class*="content"]');
  return Array.from(containers).slice(0, 20).map(el => {
    const s = getComputedStyle(el);
    return {
      tag: el.tagName.toLowerCase(),
      classes: el.className?.toString().slice(0, 60) || '',
      padding: s.padding,
      margin: s.margin,
      gap: s.gap,
      maxWidth: s.maxWidth
    };
  });
}
```

### Decoration Detection

Counts box shadows, backdrop filters, large border radii, and gradient text effects. Returns aggregate counts plus element samples.

```js
() => {
  const all = document.querySelectorAll('*');
  const decorations = { shadows: 0, blurs: 0, roundedElements: 0, gradientTexts: 0 };
  const details = [];
  all.forEach(el => {
    const s = getComputedStyle(el);
    if (s.boxShadow && s.boxShadow !== 'none') decorations.shadows++;
    if (s.backdropFilter && s.backdropFilter !== 'none') {
      decorations.blurs++;
      details.push({ type: 'blur', tag: el.tagName, classes: el.className?.toString().slice(0, 40) });
    }
    const br = parseFloat(s.borderRadius);
    if (br > 12) decorations.roundedElements++;
    if (s.backgroundClip === 'text' || s.webkitBackgroundClip === 'text') {
      decorations.gradientTexts++;
      details.push({ type: 'gradientText', tag: el.tagName, text: el.textContent?.slice(0, 40) });
    }
  });
  return { counts: decorations, details: details.slice(0, 20) };
}
```

### Contrast Ratio Calculation

The heaviest snippet. Calculates WCAG 2.1 contrast ratios for text against effective background, walking up the DOM for transparent backgrounds. Returns up to 30 entries with AA pass/fail.

```js
() => {
  function luminance(r, g, b) {
    const [rs, gs, bs] = [r, g, b].map(c => {
      c = c / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
  }

  function parseColor(color) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null; // CSP may block canvas — fail gracefully
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return { r, g, b };
  }

  function contrastRatio(c1, c2) {
    const l1 = luminance(c1.r, c1.g, c1.b);
    const l2 = luminance(c2.r, c2.g, c2.b);
    const lighter = Math.max(l1, l2);
    const darker = Math.min(l1, l2);
    return (lighter + 0.05) / (darker + 0.05);
  }

  function getEffectiveBg(el) {
    let current = el;
    while (current) {
      const bg = getComputedStyle(current).backgroundColor;
      if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') return bg;
      current = current.parentElement;
    }
    return 'rgb(255, 255, 255)';
  }

  const results = [];
  const textElements = document.querySelectorAll('h1,h2,h3,h4,h5,h6,p,a,button,label,li,span,td,th');
  const checked = new Set();

  textElements.forEach(el => {
    if (checked.size >= 30) return;
    const text = el.textContent?.trim();
    if (!text || text.length < 2) return;

    const key = el.tagName + ':' + text.slice(0, 20);
    if (checked.has(key)) return;
    checked.add(key);

    const s = getComputedStyle(el);
    const fg = s.color;
    const bg = getEffectiveBg(el);
    const fgParsed = parseColor(fg);
    const bgParsed = parseColor(bg);
    if (!fgParsed || !bgParsed) return; // canvas blocked by CSP — skip this element
    const ratio = contrastRatio(fgParsed, bgParsed);
    const fontSize = parseFloat(s.fontSize);
    const fontWeight = parseInt(s.fontWeight);
    const isLarge = fontSize >= 24 || (fontSize >= 18.66 && fontWeight >= 700);
    const wcagAA = isLarge ? ratio >= 3 : ratio >= 4.5;

    results.push({
      tag: el.tagName.toLowerCase(),
      text: text.slice(0, 30),
      fg, bg,
      ratio: Math.round(ratio * 100) / 100,
      fontSize,
      isLarge,
      passesAA: wcagAA
    });
  });

  return results;
}
```

### Touch Target Check (Mobile Only)

Run at 375x812. Finds interactive elements smaller than the 44x44px minimum (WCAG 2.5.5).

```js
() => {
  const interactive = document.querySelectorAll('a, button, input, select, textarea, [role="button"], [onclick]');
  const issues = [];
  interactive.forEach(el => {
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      if (rect.width < 44 || rect.height < 44) {
        issues.push({
          tag: el.tagName.toLowerCase(),
          text: el.textContent?.trim().slice(0, 30) || el.getAttribute('aria-label') || '',
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        });
      }
    }
  });
  return { totalInteractive: interactive.length, undersized: issues.length, issues: issues.slice(0, 20) };
}
```

### Horizontal Overflow Check

Run at tablet and mobile. Detects elements extending beyond viewport width.

```js
() => {
  const docWidth = document.documentElement.clientWidth;
  const overflow = [];
  document.querySelectorAll('*').forEach(el => {
    const rect = el.getBoundingClientRect();
    if (rect.right > docWidth + 5 || rect.left < -5) {
      overflow.push({
        tag: el.tagName.toLowerCase(),
        classes: el.className?.toString().slice(0, 40) || '',
        right: Math.round(rect.right),
        docWidth
      });
    }
  });
  return { hasOverflow: overflow.length > 0, count: overflow.length, elements: overflow.slice(0, 10) };
}
```

---

## 4. Accessibility Snapshot Protocol

`browser_snapshot()` returns the accessibility tree. Not a full audit, but catches the most impactful issues.

### What to Check

**Heading hierarchy:** Exactly one `h1`. No skipped levels (h1 then h3 with no h2). Descriptive text, not generic ("Read More" as h3 is suspect).

**Images without alt text:** Look for `img` nodes with empty or missing `name`. Decorative images can have empty alt, content images need descriptions.

**Form inputs without labels:** Inputs should have associated labels in the tree. A placeholder is not a label.

**Landmark regions:** Page needs at minimum: `navigation`, `main`, and `contentinfo` (footer). Missing landmarks mean screen readers cannot navigate.

**ARIA roles and labels:** Interactive elements need accessible names. Custom widgets need appropriate roles. `role="button"` on non-button elements needs keyboard handlers.

### How to Use the Data

The snapshot feeds two scoring areas: direct accessibility findings (missing alt text, broken hierarchy, unlabeled inputs) and supporting evidence for other findings (low-contrast text compounded by missing ARIA labels).

Do not over-index on tree completeness. Some frameworks produce verbose trees, others are sparse. Focus on presence or absence of the checks listed above.

---

## 5. Console and Network Checks

These are supporting evidence, not primary scoring inputs. A page can have console warnings and still score well visually. A page with a broken API call that causes missing content, though -- that matters.

### Console Messages

```
browser_console_messages()
```

**Flag these:**
- JavaScript errors (TypeError, ReferenceError, etc.) -- these indicate broken functionality
- Failed resource loads -- missing fonts, broken images, unavailable scripts
- CSP violations -- can indicate broken third-party integrations

**Ignore these:**
- Deprecation warnings (unless they are causing visible issues)
- Third-party tracking script warnings
- React development mode warnings
- General info/debug messages

### Network Requests

```
browser_network_requests()
```

**Flag these:**
- 4xx responses on first-party resources (broken links, missing assets)
- 5xx responses (server errors)
- Failed font loads (these directly impact typography evaluation)
- Failed image loads (these directly impact visual evaluation)

**Ignore these:**
- 4xx on third-party analytics/tracking endpoints
- Preflight (OPTIONS) requests
- Requests to ad networks

### When These Become Primary

These escalate when they have visible consequences. A failed font load that causes a Times New Roman fallback is a typography finding. A failed API call that leaves a section empty is a layout finding. The network error is the evidence, the visual result is the finding.

---

## 6. Measurement to Finding Pipeline

How raw data becomes a scored finding. No gut-feel judgments without evidence.

1. **Raw data collection.** JS snippets and tool outputs produce computed styles, ratios, dimensions, a11y nodes. Measurement, not interpretation.
2. **Pattern matching.** Compare raw data against rubric criteria. Six font families = inconsistent typography. Four contrast failures = accessibility issue. These are pattern matches.
3. **Evidence tagging.** Every finding gets tagged with: screenshot reference, computed values, a11y data, and/or console/network output.
4. **Finding generation.** A complete finding has: pillar, observation (factual), evidence (from step 3), score impact, and severity.

### Stage 5: Confidence Calculation

Confidence depends on the evidence backing:

- **High:** Multiple evidence types agree (screenshot + computed values + a11y tree).
- **Medium:** One strong evidence type, not visually obvious in screenshot.
- **Low:** Ambiguous data that could be intentional design. Note this in the finding.

Do not inflate certainty to make findings sound more authoritative.

---

## 7. Screenshot Naming Convention

Screenshots go in the `.pixelslop/screenshots/` directory relative to where the scan was initiated. Naming follows this pattern:

```
.pixelslop/screenshots/[domain]-desktop-[timestamp].png
.pixelslop/screenshots/[domain]-tablet-[timestamp].png
.pixelslop/screenshots/[domain]-mobile-[timestamp].png
```

**Domain formatting:**
- Strip the protocol and `www.` prefix
- Replace dots with hyphens
- Example: `https://www.example.com` becomes `example-com`

**Timestamp formatting:**
- Use ISO-ish format without colons: `YYYYMMDD-HHmmss`
- Example: `20260317-143022`

**Full example:**

```
.pixelslop/screenshots/example-com-desktop-20260317-143022.png
.pixelslop/screenshots/example-com-tablet-20260317-143025.png
.pixelslop/screenshots/example-com-mobile-20260317-143028.png
```

---

## 8. Persona Evaluation Snippets

Additional JS snippets for persona-specific checks. These supplement the core extraction snippets from Section 3. Only run the ones needed for the active personas.

### Heading Hierarchy Sequential Check

Validates h1→h2→h3 ordering with no skips. Used by: screen-reader-user, keyboard-user, design-critic, first-time-visitor.

```js
() => {
  const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6'));
  const levels = headings.map(h => parseInt(h.tagName[1]));
  const issues = [];
  let prevLevel = 0;
  for (let i = 0; i < levels.length; i++) {
    if (levels[i] > prevLevel + 1 && prevLevel > 0) {
      issues.push({
        expected: `h${prevLevel + 1}`,
        found: `h${levels[i]}`,
        text: headings[i].textContent.trim().slice(0, 40),
        index: i
      });
    }
    prevLevel = levels[i];
  }
  const h1Count = levels.filter(l => l === 1).length;
  return {
    check: 'heading-hierarchy-sequential',
    totalHeadings: headings.length,
    h1Count,
    skips: issues,
    passed: issues.length === 0 && h1Count === 1
  };
}
```

### Landmark Regions Present

Checks for main, nav, header, footer landmarks. Used by: screen-reader-user, keyboard-user.

```js
() => {
  const landmarks = {
    main: !!document.querySelector('main, [role="main"]'),
    nav: !!document.querySelector('nav, [role="navigation"]'),
    header: !!document.querySelector('header, [role="banner"]'),
    footer: !!document.querySelector('footer, [role="contentinfo"]')
  };
  const present = Object.values(landmarks).filter(Boolean).length;
  return {
    check: 'landmark-regions-present',
    landmarks,
    present,
    total: 4,
    passed: present >= 3
  };
}
```

### Skip Navigation Link

Checks if a skip-nav link exists as one of the first focusable elements. Used by: screen-reader-user, keyboard-user.

```js
() => {
  const focusable = document.querySelectorAll('a, button, input, [tabindex]');
  const first5 = Array.from(focusable).slice(0, 5);
  const skipLink = first5.find(el => {
    const text = (el.textContent || el.getAttribute('aria-label') || '').toLowerCase();
    const href = el.getAttribute('href') || '';
    return (text.includes('skip') && (text.includes('nav') || text.includes('content') || text.includes('main')))
      || href.startsWith('#main') || href.startsWith('#content');
  });
  return {
    check: 'skip-navigation-link',
    found: !!skipLink,
    text: skipLink ? skipLink.textContent.trim().slice(0, 40) : null,
    passed: !!skipLink
  };
}
```

### Above-Fold CTA Check

Checks if the primary CTA is visible without scrolling on the current viewport. Used by: rushed-mobile-user, first-time-visitor.

```js
() => {
  const viewportHeight = window.innerHeight;
  const ctas = document.querySelectorAll('a[class*="btn"], a[class*="button"], a[class*="cta"], button[class*="btn"], button[class*="cta"], [role="button"]');
  const aboveFold = [];
  const belowFold = [];
  ctas.forEach(el => {
    const rect = el.getBoundingClientRect();
    if (rect.height === 0 || rect.width === 0) return;
    const entry = { tag: el.tagName.toLowerCase(), text: el.textContent.trim().slice(0, 30), top: Math.round(rect.top) };
    if (rect.top < viewportHeight) {
      aboveFold.push(entry);
    } else {
      belowFold.push(entry);
    }
  });
  return {
    check: 'above-fold-cta',
    aboveFold: aboveFold.length,
    belowFold: belowFold.length,
    viewportHeight,
    passed: aboveFold.length > 0,
    details: { aboveFold: aboveFold.slice(0, 5), belowFold: belowFold.slice(0, 3) }
  };
}
```

### Reading Level Estimate

Estimates Flesch-Kincaid grade level from visible text. Used by: non-native-english, first-time-visitor.

```js
() => {
  const textElements = document.querySelectorAll('h1, h2, h3, h4, p, li, label, figcaption');
  let totalWords = 0, totalSentences = 0, totalSyllables = 0;
  const sampleText = [];
  textElements.forEach(el => {
    const text = el.textContent.trim();
    if (text.length < 10) return;
    sampleText.push(text.slice(0, 100));
    const words = text.split(/\s+/).filter(w => w.length > 0);
    totalWords += words.length;
    totalSentences += (text.match(/[.!?]+/g) || []).length || 1;
    words.forEach(word => {
      const clean = word.replace(/[^a-zA-Z]/g, '').toLowerCase();
      if (clean.length <= 3) { totalSyllables += 1; return; }
      const vowelGroups = clean.match(/[aeiouy]+/gi) || [];
      let count = vowelGroups.length;
      if (clean.endsWith('e') && count > 1) count--;
      totalSyllables += Math.max(1, count);
    });
  });
  if (totalWords < 10 || totalSentences < 1) {
    return { check: 'reading-level-estimate', gradeLevel: null, insufficient: true, totalWords };
  }
  const gradeLevel = 0.39 * (totalWords / totalSentences) + 11.8 * (totalSyllables / totalWords) - 15.59;
  return {
    check: 'reading-level-estimate',
    gradeLevel: Math.round(gradeLevel * 10) / 10,
    totalWords,
    totalSentences,
    avgWordsPerSentence: Math.round(totalWords / totalSentences * 10) / 10,
    passed: gradeLevel <= 10,
    sample: sampleText.slice(0, 3)
  };
}
```

### Image Optimization Check

Checks image sizes relative to viewport and total image weight. Used by: slow-connection-user, rushed-mobile-user.

```js
() => {
  const images = document.querySelectorAll('img');
  const issues = [];
  let totalEstimatedKB = 0;
  images.forEach(img => {
    const natural = { w: img.naturalWidth, h: img.naturalHeight };
    const displayed = { w: img.clientWidth, h: img.clientHeight };
    const hasSrcset = !!img.srcset;
    const ratio = (natural.w > 0 && displayed.w > 0) ? natural.w / displayed.w : 1;
    if (ratio > 2.5 && natural.w > 200) {
      issues.push({
        src: (img.src || '').slice(-60),
        natural: `${natural.w}x${natural.h}`,
        displayed: `${displayed.w}x${displayed.h}`,
        ratio: Math.round(ratio * 10) / 10,
        hasSrcset
      });
    }
  });
  return {
    check: 'image-optimization-check',
    totalImages: images.length,
    oversized: issues.length,
    issues: issues.slice(0, 5),
    passed: issues.length === 0
  };
}
```

### Cognitive Density Scan

Counts competing CTAs, text blocks, and navigation items in the visible viewport. Used by: first-time-visitor, rushed-mobile-user, non-native-english.

```js
() => {
  const viewportHeight = window.innerHeight;
  const ctaCount = document.querySelectorAll('a[class*="btn"], a[class*="button"], button:not([type="reset"]):not([type="button"])').length;
  const navItems = document.querySelectorAll('nav a, nav button, [role="navigation"] a').length;
  const textBlocks = Array.from(document.querySelectorAll('p, [class*="description"]')).filter(el => {
    const rect = el.getBoundingClientRect();
    return rect.top < viewportHeight && el.textContent.trim().split(/\s+/).length > 20;
  }).length;
  const sections = document.querySelectorAll('main section, main > div > div').length;
  return {
    check: 'cognitive-density-scan',
    ctaCount,
    navItems,
    denseTextBlocks: textBlocks,
    visibleSections: sections,
    passed: ctaCount <= 3 && navItems <= 8 && textBlocks <= 2
  };
}
```

---

## Section 9: Evidence Bundle Output

After running all extraction snippets across all viewports, the evidence collector assembles a JSON evidence bundle and writes it to `/tmp/pixelslop-evidence-{timestamp}.json`. See `evidence-schema.md` for the full schema.

The mapping from snippets to bundle fields:

| Snippet | Bundle Field |
|---------|-------------|
| Typography extraction | `viewports.desktop.typography` |
| Color extraction | `viewports.desktop.colors` |
| Spacing extraction | `viewports.desktop.spacing` |
| Decoration detection | `viewports.desktop.decorations` |
| Contrast calculation | `viewports.desktop.contrast` |
| Touch target audit | `viewports.mobile.touchTargets` |
| Overflow check | `viewports.{viewport}.overflow` |
| `browser_snapshot()` | `viewports.desktop.a11ySnapshot` |
| `browser_console_messages()` | `console` |
| `browser_network_requests()` | `network` |
| Persona evaluation snippets | `personaChecks.*` |
| Source pattern greps | `sourcePatterns` |

Each `confidence` flag tracks whether the corresponding evidence was successfully collected. If a snippet fails or returns empty, set the flag to `false` — don't skip the field, set it to `null`.

---

## Reference: Tool Call Summary

| Tool | Purpose | When Used |
|------|---------|-----------|
| `browser_navigate` | Load the target URL | Step 1 |
| `browser_resize` | Set viewport dimensions | Steps 2, 3, 4 |
| `browser_take_screenshot` | Capture the viewport | Steps 2, 3, 4 |
| `browser_evaluate` | Run JS snippets | Steps 2, 4 |
| `browser_snapshot` | Get accessibility tree | Step 2 |
| `browser_console_messages` | Check for JS errors | Steps 1, 2 |
| `browser_network_requests` | Check for failed requests | Step 1 |
