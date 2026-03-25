# Nielsen's Heuristics — Browser-Measurable Edition

Jakob Nielsen's 10 usability heuristics have been around since 1994 and they're still the sharpest UX diagnostic tool in the box. Problem is, most of them were written for human evaluators clicking through an interface. You're a scanner running Playwright.

So here's the deal: each heuristic below is reframed as something you can actually check from browser evidence — computed styles, DOM structure, ARIA attributes, element presence. Some heuristics map cleanly to measurable signals. Others are harder to pin down without actually being a human user. Where that's the case, we'll say so and give you the best proxy we've got.

These are supplementary checks. They don't replace the 5 pillars — they give you a UX lens to layer on top of your visual quality evaluation.

---

## The 10 Heuristics

### 1. Visibility of System Status

*The system should keep users informed about what's going on through timely feedback.*

**What to check in Playwright:**
- Loading indicators: look for spinners, progress bars, skeleton screens (`[aria-busy="true"]`, `.loading`, `.skeleton`, `[role="progressbar"]`, `.spinner`)
- Live regions: `[aria-live]` elements that announce status changes to screen readers
- Form submission feedback: does the submit button change state? (`[disabled]` after click, loading text)
- Page load: does the page show content progressively or flash from blank to complete?

**Evidence:** Count of `[aria-live]` regions, presence of `[role="progressbar"]`, loading state CSS classes, `[aria-busy]` usage.

**Feeds into:** Accessibility pillar (live regions, status communication), Hierarchy pillar (visual feedback presence).

### 2. Match Between System and Real World

*The system should speak the users' language, not system-oriented jargon.*

**What to check in Playwright:**
- Navigation labels: are they recognizable words or internal jargon? Hard to fully automate, but check for red flags
- Icon + label pairing: icons without text labels force users to guess meaning. Check for `<svg>` or `<img>` inside buttons/links without adjacent text
- Date/number formatting: localized formats vs. raw timestamps or database-style formats

```js
(() => {
  const iconOnlyBtns = [...document.querySelectorAll('button, [role="button"], a')].filter(el => {
    const hasIcon = el.querySelector('svg, img, i[class*="icon"], span[class*="icon"]');
    const textContent = el.textContent.trim();
    const hasAriaLabel = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby');
    return hasIcon && textContent.length < 2 && !hasAriaLabel;
  });
  return { icon_only_without_label: iconOnlyBtns.length };
})()
```

**Flag when:** >3 icon-only interactive elements without `aria-label`. Users have to guess what they do.

**Feeds into:** Accessibility pillar (labels), Hierarchy pillar (clarity of navigation).

### 3. User Control and Freedom

*Users need a clearly marked "emergency exit" to leave unwanted states.*

**What to check in Playwright:**
- Close buttons on modals/overlays: `[aria-label="Close"]`, `.close`, `[role="dialog"]` children with dismiss affordance
- Cancel buttons on forms: presence of cancel/back alongside submit
- Undo affordances: toast notifications with undo actions, or history controls
- Back navigation: breadcrumbs, back links, browser history support

```js
(() => {
  const dialogs = document.querySelectorAll('[role="dialog"], dialog, .modal');
  const dialogsWithClose = [...dialogs].filter(d =>
    d.querySelector('[aria-label*="close" i], [aria-label*="dismiss" i], .close, button.close, [data-dismiss]')
  );
  const forms = document.querySelectorAll('form');
  const formsWithCancel = [...forms].filter(f =>
    f.querySelector('button[type="reset"], a[href], button:not([type="submit"])')
  );
  return {
    dialogs: dialogs.length,
    dialogs_with_close: dialogsWithClose.length,
    forms: forms.length,
    forms_with_cancel: formsWithCancel.length
  };
})()
```

**Flag when:** Modals exist without close buttons, or forms have submit but no cancel/back option.

**Feeds into:** Accessibility pillar (keyboard escape), Hierarchy pillar (navigation clarity).

### 4. Consistency and Standards

*Users shouldn't have to wonder whether different words, situations, or actions mean the same thing.*

**What to check in Playwright:**
- Button consistency: do all buttons with the same role share similar styles? Compare computed styles across `<button>` elements
- Link consistency: do links look like links? Check for `text-decoration` and distinct color on `<a>` elements
- Heading hierarchy: consistent sizing progression from h1 → h6
- Interactive element patterns: similar elements should behave similarly

```js
(() => {
  const buttons = [...document.querySelectorAll('button, [role="button"]')].slice(0, 20);
  const styles = buttons.map(b => {
    const s = getComputedStyle(b);
    return {
      text: b.textContent.trim().substring(0, 30),
      bg: s.backgroundColor,
      color: s.color,
      fontSize: s.fontSize,
      borderRadius: s.borderRadius,
      fontFamily: s.fontFamily.split(',')[0].trim()
    };
  });
  const uniqueBgs = [...new Set(styles.map(s => s.bg))];
  const uniqueFonts = [...new Set(styles.map(s => s.fontFamily))];
  return {
    button_count: styles.length,
    unique_backgrounds: uniqueBgs.length,
    unique_fonts: uniqueFonts.length,
    samples: styles.slice(0, 8)
  };
})()
```

**Flag when:** Buttons use >4 distinct background colors (suggests no consistent button hierarchy), or >2 different font families across buttons.

**Feeds into:** Typography pillar (font consistency), Color pillar (palette discipline), Hierarchy pillar (element consistency).

### 5. Error Prevention

*Good design prevents problems from occurring in the first place.*

**What to check in Playwright:**
- Form validation attributes: `required`, `pattern`, `type` (email, url, tel, number), `minlength`, `maxlength`
- Confirmation UI for destructive actions: delete buttons with confirmation dialogs or undo patterns
- Input constraints: `<select>` for known-value fields instead of free text, date pickers instead of text inputs

```js
(() => {
  const inputs = document.querySelectorAll('input:not([type="hidden"]), select, textarea');
  const withValidation = [...inputs].filter(i =>
    i.hasAttribute('required') || i.hasAttribute('pattern') || i.hasAttribute('minlength') || i.hasAttribute('maxlength') ||
    ['email', 'url', 'tel', 'number', 'date'].includes(i.type)
  );
  const deleteButtons = [...document.querySelectorAll('button, [role="button"]')].filter(b =>
    /delete|remove|destroy/i.test(b.textContent)
  );
  return {
    total_inputs: inputs.length,
    with_validation: withValidation.length,
    validation_ratio: inputs.length > 0 ? (withValidation.length / inputs.length).toFixed(2) : 'n/a',
    delete_buttons: deleteButtons.length
  };
})()
```

**Flag when:** Forms have >3 inputs but <30% use any validation attribute. That's inviting user errors.

**Feeds into:** Accessibility pillar (form quality).

### 6. Recognition Rather Than Recall

*Minimize memory load. Make objects, actions, and options visible.*

**What to check in Playwright:**
- Input labels: every input should have a visible `<label>`, not just a `placeholder`. Placeholder-only inputs force recall once the user starts typing
- Breadcrumbs: multi-page flows should show where the user is
- Persistent navigation: key nav elements visible without scrolling
- Search: complex sites should have search functionality

```js
(() => {
  const inputs = document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]), textarea, select');
  const withLabel = [...inputs].filter(i => {
    const id = i.id;
    const hasFor = id && document.querySelector('label[for="' + id + '"]');
    const wrappedInLabel = i.closest('label');
    const hasAriaLabel = i.getAttribute('aria-label') || i.getAttribute('aria-labelledby');
    return hasFor || wrappedInLabel || hasAriaLabel;
  });
  const placeholderOnly = [...inputs].filter(i => {
    const id = i.id;
    const hasLabel = (id && document.querySelector('label[for="' + id + '"]')) || i.closest('label') || i.getAttribute('aria-label') || i.getAttribute('aria-labelledby');
    return i.placeholder && !hasLabel;
  });
  const breadcrumbs = document.querySelectorAll('[aria-label*="breadcrumb" i], .breadcrumb, nav.breadcrumbs, ol.breadcrumb');
  const search = document.querySelectorAll('input[type="search"], [role="search"], [aria-label*="search" i]');
  return {
    total_inputs: inputs.length,
    with_label: withLabel.length,
    placeholder_only: placeholderOnly.length,
    has_breadcrumbs: breadcrumbs.length > 0,
    has_search: search.length > 0
  };
})()
```

**Flag when:** Any input relies on placeholder alone (no visible label, no aria-label). Or a site with >5 pages has no breadcrumbs and no search.

**Feeds into:** Accessibility pillar (labels, landmarks), Hierarchy pillar (navigation).

### 7. Flexibility and Efficiency of Use

*Shortcuts and accelerators for expert users, invisible to novices.*

**What to check in Playwright:**
- Keyboard shortcuts: `accesskey` attributes, visible shortcut hints
- Search with keyboard focus: does search accept focus on `/` or `Ctrl+K`?
- Autocomplete: `autocomplete` attributes on form fields
- Skip links: hidden links that jump to main content

```js
(() => {
  const accesskeys = document.querySelectorAll('[accesskey]');
  const autocomplete = document.querySelectorAll('[autocomplete]:not([autocomplete="off"])');
  const skipLinks = document.querySelectorAll('a[href="#main"], a[href="#content"], a.skip-link, a.skip-to-content');
  return {
    accesskeys: accesskeys.length,
    autocomplete_fields: autocomplete.length,
    skip_links: skipLinks.length
  };
})()
```

**Feeds into:** Accessibility pillar (skip links, keyboard support). Note: most sites won't have accesskeys, so don't flag their absence — just note their presence as a positive signal.

### 8. Aesthetic and Minimalist Design

*Interfaces should not contain information that is irrelevant or rarely needed.*

**What to check:** This one maps directly to your 5-pillar evaluation. The hierarchy, typography, and color pillars already measure this. Cross-reference your scores.

**Specific signals to look for:**
- Decorative elements outnumbering functional ones (see AI slop detection)
- Redundant content: headings that restate the same info as their subheadings
- Visual noise: excessive borders, shadows, gradients (see `ai-slop-patterns.md`)

**Feeds into:** All 5 pillars — this heuristic is essentially what the entire pixelslop scan measures.

### 9. Help Users Recognize, Diagnose, and Recover from Errors

*Error messages should express the problem in plain language, suggest a solution, and never blame the user.*

**What to check in Playwright:**
- Error message elements: `.error`, `[role="alert"]`, `[aria-invalid="true"]`, `.validation-error`
- Error message quality: are they near the relevant input? (Check DOM proximity)
- Error page patterns: 404/500 pages with navigation options vs. dead ends

```js
(() => {
  const errorElements = document.querySelectorAll('[role="alert"], .error, .error-message, [aria-invalid="true"], .validation-error, .form-error');
  const invalidInputs = document.querySelectorAll('[aria-invalid="true"]');
  const errorWithDescription = [...invalidInputs].filter(i =>
    i.getAttribute('aria-describedby') || i.getAttribute('aria-errormessage')
  );
  return {
    error_elements: errorElements.length,
    invalid_inputs: invalidInputs.length,
    with_description: errorWithDescription.length
  };
})()
```

**Feeds into:** Accessibility pillar (error handling, ARIA usage).

### 10. Help and Documentation

*It's better if the system is usable without docs, but help should be easy to find when needed.*

**What to check in Playwright:**
- Help links: links containing "help", "FAQ", "documentation", "support"
- Tooltips: `title` attributes, `[aria-describedby]`, `[data-tooltip]`
- Contextual help: info icons near complex fields

```js
(() => {
  const helpLinks = [...document.querySelectorAll('a')].filter(a =>
    /help|faq|documentation|support|guide/i.test(a.textContent + ' ' + (a.getAttribute('href') || ''))
  );
  const tooltips = document.querySelectorAll('[title], [data-tooltip], [data-tip]');
  const describedBy = document.querySelectorAll('[aria-describedby]');
  return {
    help_links: helpLinks.length,
    tooltip_elements: tooltips.length,
    described_by_elements: describedBy.length
  };
})()
```

**Feeds into:** Accessibility pillar (contextual help), Hierarchy pillar (information architecture).

---

## How This Feeds the Scanner

These heuristics are a supplementary lens, not a replacement for the 5 pillars. Here's how to use them:

1. **During evaluation**, run these checks alongside your pillar-specific measurements. They'll catch UX issues that pure visual analysis misses.

2. **In your findings**, reference the heuristic by number when relevant. "Heuristic #6 violation: 4 inputs use placeholder-only labels" is more precise than "labels are missing."

3. **In your scores**, let heuristic findings influence the relevant pillar score. A page with great typography but terrible error handling should see its accessibility score dip.

4. **In thorough mode**, run all 10 checks. In normal mode, focus on heuristics 1 (system status), 4 (consistency), 5 (error prevention), and 6 (recognition > recall) — these have the strongest browser-measurable signals.

Don't create a separate "heuristics score." The 5 pillars are the score. These heuristics are the extra questions you ask to make those pillar scores more accurate.
