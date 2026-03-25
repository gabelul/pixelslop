# Cognitive Load Assessment

Your hierarchy score should account for how hard the page makes the user's brain work. A gorgeous layout still fails if it overwhelms people with choices, buries the path forward, or demands they remember things from three screens ago.

This checklist gives you concrete, browser-measurable signals for cognitive overload. Not vibes -- numbers.

---

## The Three Types (Quick Primer)

- **Intrinsic** -- complexity baked into the task itself. A tax form is harder than a login page. You can't fix this, but you can avoid making it worse.
- **Extraneous** -- complexity the design adds on top. Bad grouping, visual noise, mystery navigation. This is what you're hunting.
- **Germane** -- effort spent actually learning. Good design invests cognitive budget here, not on deciphering the interface.

Your job: find extraneous load. That's the stuff bad design creates and good design eliminates.

---

## The Checklist

Run these checks during your evaluation. Each one has a browser-measurable signal and a threshold for flagging.

### 1. Element Density Per Section

Too many interactive elements crammed into one area = decision paralysis.

**What to check:** Count visible interactive elements (buttons, links, inputs, selects) within each `<section>` or major landmark.

```js
(() => {
  const sections = document.querySelectorAll('section, [role="region"], main > div');
  const results = [];
  sections.forEach((s, i) => {
    const interactive = s.querySelectorAll('a, button, input, select, textarea, [role="button"], [tabindex="0"]');
    const visible = [...interactive].filter(el => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    if (visible.length > 0) {
      results.push({ section: i, tag: s.tagName.toLowerCase(), interactive_count: visible.length });
    }
  });
  return results;
})()
```

**Flag when:** Any section has >15 interactive elements without sub-grouping (no nested `<fieldset>`, `<nav>`, or `<ul>` wrapping related items).

### 2. Choice Overload (CTA Density)

When everything screams for attention, nothing gets it. Miller's Law (updated for modern research): people handle about 4 +/- 1 chunks in working memory, not 7.

**What to check:** Count primary-looking CTAs visible in a single viewport.

```js
(() => {
  const buttons = document.querySelectorAll('button, [role="button"], a.btn, a.button, input[type="submit"]');
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  const visible = [...buttons].filter(el => {
    const r = el.getBoundingClientRect();
    return r.top < viewport.height && r.bottom > 0 && r.width > 0;
  });
  const primary = visible.filter(el => {
    const bg = getComputedStyle(el).backgroundColor;
    const isColored = bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent';
    return isColored;
  });
  return { total_visible: visible.length, primary_looking: primary.length, viewport };
})()
```

**Flag when:** >7 CTAs visible in one viewport, or >3 that look "primary" (solid background color, prominent sizing).

### 3. Information Chunking

Related content should cluster together with clear breathing room between groups. A wall of undifferentiated content is a wall of pain.

**What to check:** Measure spacing (gap, margin) between logical groups. Look for uniform vs. varied spacing patterns.

```js
(() => {
  const containers = document.querySelectorAll('section, article, [role="region"], main > div, main > section');
  const gaps = [];
  containers.forEach(c => {
    const children = [...c.children].filter(el => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    for (let i = 1; i < children.length; i++) {
      const prev = children[i - 1].getBoundingClientRect();
      const curr = children[i].getBoundingClientRect();
      const gap = curr.top - prev.bottom;
      gaps.push({ gap: Math.round(gap), between: `${children[i-1].tagName}->${children[i].tagName}` });
    }
  });
  const values = gaps.map(g => g.gap).filter(g => g > 0);
  const unique = [...new Set(values)];
  return { total_gaps: gaps.length, unique_values: unique.length, samples: gaps.slice(0, 20) };
})()
```

**Flag when:** >80% of gaps are the same value (monotonous spacing -- no hierarchy between content groups).

### 4. Progressive Disclosure

If a page dumps everything on the user at once, it's failing at progressive disclosure. Long forms, exhaustive lists, and dense dashboards should reveal complexity gradually.

**What to check:** Look for expandable/collapsible patterns and check if long content is managed.

```js
(() => {
  const details = document.querySelectorAll('details, [aria-expanded], [data-accordion], .accordion, .collapsible, [role="tablist"]');
  const forms = document.querySelectorAll('form');
  const formFields = [...forms].map(f => ({
    action: f.action || 'none',
    visible_fields: f.querySelectorAll('input:not([type="hidden"]), select, textarea').length
  }));
  const longLists = [...document.querySelectorAll('ul, ol')].filter(l => l.children.length > 10);
  return {
    disclosure_elements: details.length,
    forms: formFields,
    long_lists: longLists.length,
    long_list_items: longLists.map(l => l.children.length)
  };
})()
```

**Flag when:** A form has >8 visible fields with zero progressive disclosure (no fieldsets, no steps, no accordion). Or a list has >15 items with no pagination, search, or filtering UI.

### 5. Visual Grouping Consistency

Related elements should share a visual container with consistent internal spacing. When every element floats in the same undifferentiated void, users can't parse relationships.

**What to check:** Evaluate whether related controls share containers and consistent spacing.

```js
(() => {
  const groups = document.querySelectorAll('fieldset, [role="group"], [role="radiogroup"], nav ul, .card, .panel, .group');
  const ungrouped = document.querySelectorAll('main input:not(fieldset input), main select:not(fieldset select)');
  return {
    grouped_containers: groups.length,
    ungrouped_inputs: ungrouped.length,
    ratio: groups.length > 0 ? (ungrouped.length / (groups.length + ungrouped.length)).toFixed(2) : ungrouped.length > 0 ? '1.00' : '0.00'
  };
})()
```

**Flag when:** >50% of form inputs sit outside any grouping container, or the page has zero `<fieldset>`, `[role="group"]`, or equivalent grouping elements despite having 5+ inputs.

### 6. Single Focus Per Section

Each section should have one clear purpose -- one heading, one primary action. Sections with competing focal points split attention.

**What to check:** Count headings and primary CTAs per section.

```js
(() => {
  const sections = document.querySelectorAll('section, [role="region"]');
  const results = [];
  sections.forEach((s, i) => {
    const headings = s.querySelectorAll('h1, h2, h3');
    const primaryBtns = s.querySelectorAll('button:not(.secondary):not(.ghost):not(.text), [role="button"], a.btn-primary, a.cta');
    const directHeadings = [...headings].filter(h => h.closest('section, [role="region"]') === s);
    results.push({
      section: i,
      heading_count: directHeadings.length,
      primary_cta_count: primaryBtns.length
    });
  });
  return results;
})()
```

**Flag when:** A section has >2 direct headings or >2 primary CTAs. That section is trying to do too many things.

### 7. Navigation Complexity

Top-level navigation with too many items forces users to scan everything before choosing. Modern research puts the sweet spot at 5-7 items, not the classic "7 +/- 2."

**What to check:** Count top-level navigation items.

```js
(() => {
  const navs = document.querySelectorAll('nav, [role="navigation"]');
  const results = [];
  navs.forEach((nav, i) => {
    const topLevel = nav.querySelectorAll(':scope > ul > li, :scope > ol > li, :scope > a, :scope > button');
    results.push({ nav_index: i, top_level_items: topLevel.length, aria_label: nav.getAttribute('aria-label') || 'unlabelled' });
  });
  return results;
})()
```

**Flag when:** Primary navigation has >7 top-level items without clear grouping (dropdown menus or sections).

---

## Scoring Guidance

Cognitive load isn't its own pillar -- it feeds into **hierarchy**. Here's how:

- **0-1 flags from the checklist** -- no impact. The page handles complexity fine.
- **2-3 flags** -- pull hierarchy score down by 1 point. The structure exists but doesn't manage attention well.
- **4+ flags** -- pull hierarchy score down by 2 points. The page is actively fighting the user's ability to focus.

When writing your hierarchy findings, call out specific cognitive load issues alongside your structural observations. "The hero section has 9 CTAs competing for attention" is more actionable than "the hierarchy is unclear."

---

## Common Violations

### Wall of Options
A settings page or dashboard that presents 20+ controls in a flat list. No grouping, no progressive disclosure, no priority signaling. Users freeze.

**Look for:** Sections with >15 interactive elements and no `<fieldset>` or `[role="group"]` wrappers.

### Memory Bridge
User needs information from Page A to complete a task on Page B, but there's no reference, breadcrumb, or summary visible. Forces recall instead of recognition.

**Look for:** Multi-step flows without breadcrumbs, step indicators, or summary panels.

### Hidden Navigation
Important nav items buried in hamburger menus on desktop, or navigation that only appears on scroll. If users can't see it, they can't find it.

**Look for:** Primary navigation hidden behind a toggle button at desktop viewports (>1024px).

### Jargon Barrier
Interface labels use internal or technical language that the target audience won't recognize. This is hard to detect in Playwright alone, but you can flag suspiciously long labels or uncommon vocabulary patterns.

**Look for:** Button/link text >30 characters, labels with technical terms (API, config, params) on consumer-facing pages.

### Visual Noise Floor
Excessive decorative elements (shadows, gradients, borders, icons) competing with functional content. When everything is decorated, nothing stands out.

**Look for:** >5 distinct box-shadow values, >3 gradient backgrounds, or >8 decorative icons visible in one viewport. Cross-reference with the AI slop pattern detection.

### Context Switching
Interface forces frequent mode changes -- editing inline, then in a modal, then in a sidebar, then back inline. Each switch costs cognitive resources.

**Look for:** Presence of multiple interaction patterns for the same type of action (e.g., both inline editing and modal editing on the same page).
