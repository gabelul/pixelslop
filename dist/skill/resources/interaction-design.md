# Interaction Design — Fix Guide

Interactions are where design meets behavior. A button that looks clickable but has no hover state. A dropdown that clips behind its parent. A form that swallows errors silently. These aren't just design issues — they're trust killers. Users learn fast whether an interface responds to them or ignores them.

This guide covers the interactive layer: states, positioning, forms, modals, loading, and navigation patterns.

---

## What This Guide Fixes

Scanner findings that map here:
- Missing or incomplete interactive states (hover, focus, active, disabled)
- Dropdowns/overlays clipped by parent containers
- Forms without proper labels, validation, or error feedback
- Missing loading indicators
- Modals without focus management or escape routes
- Keyboard navigation gaps
- Touch gesture discoverability issues

---

## How to Locate the Source

```bash
# Find interactive elements with inline styles or class-based states
grep -rn "hover\|focus\|active\|disabled\|:focus-visible" --include="*.css" --include="*.scss" --include="*.tsx" --include="*.jsx" src/
grep -rn "onHover\|onFocus\|onBlur\|isDisabled\|isLoading" --include="*.tsx" --include="*.jsx" src/

# Find dropdown/popover components
grep -rn "dropdown\|popover\|tooltip\|overlay\|modal\|dialog" --include="*.tsx" --include="*.jsx" --include="*.css" src/

# Find form components
grep -rn "<form\|<input\|<select\|<textarea\|handleSubmit\|onSubmit" --include="*.tsx" --include="*.jsx" src/

# Tailwind state variants
grep -rn "hover:\|focus:\|active:\|disabled:\|focus-visible:" --include="*.tsx" --include="*.jsx" src/
```

---

## Fix Recipes

### Recipe 1: The 8 Interactive States

Every interactive element has up to 8 states. Most sites nail 2-3 and forget the rest. Here's the full set:

| State | CSS/Attribute | What It Communicates |
|-------|--------------|---------------------|
| **Default** | Base styles | "I'm here, I'm clickable" |
| **Hover** | `:hover` | "You're on the right track" |
| **Focus** | `:focus-visible` | "Keyboard users, this is where you are" |
| **Active** | `:active` | "You pressed me, I felt it" |
| **Disabled** | `[disabled]`, `[aria-disabled="true"]` | "Not right now" |
| **Loading** | `[aria-busy="true"]`, `.loading` | "Working on it, hang tight" |
| **Error** | `[aria-invalid="true"]`, `.error` | "Something went wrong here" |
| **Success** | `.success`, `[data-state="success"]` | "Done, you're good" |

**The minimum viable set:** Default + Hover + Focus + Disabled. If an element can be in a loading or error state, those are mandatory too.

**CSS pattern for buttons:**
```css
.btn {
  /* Default */
  background: var(--color-primary);
  color: var(--color-on-primary);
  transition: background-color 150ms ease, box-shadow 150ms ease;
}

.btn:hover {
  background: var(--color-primary-hover);
}

.btn:focus-visible {
  outline: 2px solid var(--color-focus-ring);
  outline-offset: 2px;
}

.btn:active {
  transform: scale(0.98);
}

.btn:disabled,
.btn[aria-disabled="true"] {
  opacity: 0.5;
  cursor: not-allowed;
  pointer-events: none;
}

.btn[aria-busy="true"] {
  position: relative;
  color: transparent;
  pointer-events: none;
}

.btn[aria-busy="true"]::after {
  content: "";
  position: absolute;
  inset: 0;
  margin: auto;
  width: 1em;
  height: 1em;
  border: 2px solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  animation: spin 600ms linear infinite;
}
```

**Tailwind equivalent:**
```
hover:bg-primary-600 focus-visible:ring-2 focus-visible:ring-offset-2 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed
```

**Key rule:** Use `:focus-visible`, not `:focus`. Plain `:focus` fires on mouse clicks too, which annoys mouse users with unexpected outlines. `:focus-visible` only fires for keyboard navigation.

### Recipe 2: Dropdown and Overlay Positioning

This is where most AI-generated code falls apart. Dropdowns clip, tooltips overflow, and z-index becomes a war zone.

#### The Problem

`position: absolute` inside a parent with `overflow: hidden` = clipped dropdown. This is the #1 overlay bug.

```css
/* THE BUG */
.parent {
  overflow: hidden; /* or overflow: auto, overflow: scroll */
  position: relative;
}
.dropdown {
  position: absolute; /* trapped inside .parent's overflow boundary */
  top: 100%;
}
```

#### Solution 1: CSS Anchor Positioning (Modern)

The modern way. Supported in Chrome 125+, behind flags in Firefox. Use with fallback.

```css
.trigger {
  anchor-name: --dropdown-trigger;
}

.dropdown {
  position: fixed;
  position-anchor: --dropdown-trigger;
  position-area: block-end span-inline-end;
  margin-top: 4px;

  /* Auto-flip if no room below */
  position-try-fallbacks: flip-block;
}
```

**Feature detection:**
```css
@supports (anchor-name: --test) {
  /* Modern anchor positioning */
}

@supports not (anchor-name: --test) {
  /* Fallback: fixed positioning with JS coordinates */
}
```

#### Solution 2: Portal Pattern (React/Vue/Svelte)

Render the overlay at the document root so it escapes any overflow context.

**React:**
```jsx
import { createPortal } from 'react-dom';

function Dropdown({ trigger, children }) {
  const [pos, setPos] = useState(null);
  const triggerRef = useRef(null);

  const open = () => {
    const rect = triggerRef.current.getBoundingClientRect();
    setPos({ top: rect.bottom + 4, left: rect.left });
  };

  return (
    <>
      <button ref={triggerRef} onClick={open}>{trigger}</button>
      {pos && createPortal(
        <div style={{ position: 'fixed', ...pos }}>{children}</div>,
        document.body
      )}
    </>
  );
}
```

**Vue:**
```vue
<Teleport to="body">
  <div v-if="isOpen" class="dropdown" :style="position">
    <slot />
  </div>
</Teleport>
```

**Svelte:**

Svelte has no built-in portal. Use a mount action that appends to `document.body`:

```svelte
<script>
  function portal(node) {
    document.body.appendChild(node);
    return { destroy() { node.remove(); } };
  }
</script>

{#if isOpen}
  <div use:portal class="dropdown" style:top="{pos.top}px" style:left="{pos.left}px">
    <slot />
  </div>
{/if}
```

#### Solution 3: Fixed Positioning Fallback

When you can't use portals and anchor positioning isn't supported:

```js
function positionDropdown(trigger, dropdown) {
  const rect = trigger.getBoundingClientRect();
  const viewportHeight = window.innerHeight;
  const dropdownHeight = dropdown.offsetHeight;

  // Position below trigger, flip above if no room
  const spaceBelow = viewportHeight - rect.bottom;
  const top = spaceBelow >= dropdownHeight + 8
    ? rect.bottom + 4
    : rect.top - dropdownHeight - 4;

  dropdown.style.position = 'fixed';
  dropdown.style.top = `${top}px`;
  dropdown.style.left = `${rect.left}px`;
  dropdown.style.minWidth = `${rect.width}px`;
}
```

#### Z-Index Scale

Don't assign random z-index values. Use a semantic scale:

```css
:root {
  --z-dropdown: 100;
  --z-sticky: 200;
  --z-modal-backdrop: 300;
  --z-modal: 400;
  --z-toast: 500;
  --z-tooltip: 600;
}
```

### Recipe 3: Loading State Patterns

Users need to know something's happening. A frozen interface feels broken.

**Skeleton screens** > spinners for content loading. They preserve layout and feel faster.

```css
.skeleton {
  background: linear-gradient(90deg,
    var(--color-skeleton) 25%,
    var(--color-skeleton-shine) 50%,
    var(--color-skeleton) 75%
  );
  background-size: 200% 100%;
  animation: shimmer 1.5s ease infinite;
  border-radius: 4px;
}

@keyframes shimmer {
  from { background-position: 200% 0; }
  to { background-position: -200% 0; }
}
```

**Announce loading to screen readers:**
```html
<div aria-busy="true" aria-live="polite">
  <!-- Loading content -->
</div>
```

When loading completes, remove `aria-busy` — the live region announces the new content automatically.

**Button loading state:** Replace text with spinner, keep button width stable so the layout doesn't jump.

### Recipe 4: Form Design

Forms are where users give you their data and their trust. Don't squander either.

**Labels first, always:**
```html
<!-- Good: visible label -->
<label for="email">Email address</label>
<input id="email" type="email" required autocomplete="email">

<!-- Bad: placeholder as label -->
<input type="email" placeholder="Email address">
```

Placeholders disappear when you type. That's recall, not recognition.

**Error messages below the field:**
```html
<label for="password">Password</label>
<input id="password" type="password" aria-describedby="password-error" aria-invalid="true">
<p id="password-error" role="alert">Must be at least 8 characters</p>
```

**Validate on blur, not on every keystroke.** Let users finish typing before telling them they're wrong.

**Group related fields:**
```html
<fieldset>
  <legend>Shipping address</legend>
  <!-- address fields -->
</fieldset>
```

### Recipe 5: Modal and Popover Best Practices

Modals are a last resort, not a first instinct. If you must use one:

**Focus management checklist:**
1. When modal opens: move focus to the first focusable element inside (or the modal itself)
2. While modal is open: trap Tab within the modal (wrap from last to first focusable element)
3. When modal closes: return focus to the element that opened it
4. Always: Escape key closes the modal

**Native `<dialog>` is your friend:**
```html
<dialog id="confirm-dialog">
  <h2>Delete this item?</h2>
  <p>This can't be undone.</p>
  <button onclick="this.closest('dialog').close('cancel')">Cancel</button>
  <button onclick="this.closest('dialog').close('confirm')">Delete</button>
</dialog>
```

```js
// Open as modal (with backdrop, focus trap, escape handling — all free)
document.getElementById('confirm-dialog').showModal();
```

**The Popover API** for non-modal overlays (tooltips, menus):
```html
<button popovertarget="menu">Options</button>
<div id="menu" popover>
  <!-- Menu items -->
</div>
```

Popovers get: top-layer rendering (no z-index wars), light-dismiss (click outside to close), keyboard support built in.

**Backdrop click:** Modals should close on backdrop click unless they contain unsaved data. Use `dialog::backdrop` for styling.

### Recipe 6: Keyboard Navigation

If it works with a mouse but breaks with a keyboard, it's broken. Period.

**Tab order should match visual order.** If your tab sequence jumps around the page, your source order or `tabindex` values are wrong. Fix the DOM order before reaching for `tabindex`.

**Roving tabindex for composite widgets** (tab lists, toolbars, listboxes):
```js
// Only one item in the group is tabbable at a time
// Arrow keys move focus between items
// Tab moves to the next widget entirely
items.forEach((item, i) => {
  item.tabIndex = i === activeIndex ? 0 : -1;
});

container.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
    e.preventDefault();
    activeIndex = (activeIndex + 1) % items.length;
    items[activeIndex].focus();
    items[activeIndex].tabIndex = 0;
    items.forEach((item, i) => { if (i !== activeIndex) item.tabIndex = -1; });
  }
});
```

**Skip link** (if not already present):
```html
<a href="#main-content" class="skip-link">Skip to main content</a>
```

```css
.skip-link {
  position: absolute;
  top: -100%;
  left: 0;
  z-index: 1000;
}
.skip-link:focus {
  top: 0;
  background: var(--color-primary);
  color: white;
  padding: 0.5rem 1rem;
}
```

### Recipe 7: Gesture Discoverability

Touch gestures are invisible by default. If users don't know they can swipe, they won't.

**Show affordances:**
- Swipe: visible arrow indicators or partial next-item peek
- Pull-to-refresh: subtle instruction on first visit or empty state
- Long-press: never make it the only way to access functionality. Always provide a visible alternative (menu button, context menu)

**Always provide a non-gesture alternative.** Every swipe action should also be available as a button tap. Every long-press menu should also be reachable via a visible icon.

---

## Anti-Patterns to Avoid

- **`position: absolute` in `overflow: hidden`** — the #1 dropdown bug. Use portals, fixed positioning, or anchor positioning instead.
- **`:focus` instead of `:focus-visible`** — unnecessary focus rings on mouse clicks confuse users.
- **`outline: none` without replacement** — removes the focus indicator entirely. Keyboard users are now blind.
- **Arbitrary z-index values** — `z-index: 9999` is a symptom, not a solution. Use a semantic scale.
- **Placeholder-only labels** — placeholders are hints, not labels. They disappear on input.
- **Swallow errors silently** — failed form submissions with no visible error = users wondering if the button is broken.
- **`tabindex` > 0** — creates unexpected tab order. Use 0 (natural order) or -1 (programmatic focus only).
- **Hover-only actions** — touch devices don't hover. Always provide tap/click alternatives.
- **Modal for everything** — modals interrupt flow. Use inline expansion, popovers, or navigation instead when possible.
- **Bounce/elastic easing on interaction feedback** — feels dated. Use smooth ease-out curves for UI responses.

---

## Verification Criteria

> **Checker scope:** The checker verifies the specific metric it was given (contrast ratio, element size, pattern detection). Broader criteria listed here are guidance for the scanner's re-evaluation, not individual checker measurements.

After fixing an interaction issue, the checker should verify:

- **States:** Hover, focus, active, and disabled states all produce visible style changes (compare computed styles across states via Playwright)
- **Dropdowns:** Overlay is fully visible in the viewport (no clipping). Check `getBoundingClientRect()` of the open dropdown against viewport dimensions
- **Forms:** Every `<input>` has an associated `<label>` (via `for` attribute, wrapping, or `aria-label`). Error states produce visible `[role="alert"]` or `[aria-invalid]` feedback
- **Loading:** Interactive elements show loading state during async operations (`[aria-busy]`, `.loading` class, or spinner visible)
- **Modals:** Focus moves into modal on open. Escape key closes it. Focus returns to trigger on close
- **Keyboard:** All interactive elements reachable via Tab. Composite widgets support arrow-key navigation. Skip link present and functional
- **Touch:** All touch targets at least 44x44px. Swipe actions have visible button alternatives
