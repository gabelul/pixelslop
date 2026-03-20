# Clarify Fix Guide

How to fix copy and labeling findings from the scanner. Covers alt text quality, button labels, generic copy, heading text, and empty states — the things that make an interface understandable instead of cryptic.

---

## What This Guide Fixes

Scanner findings that map here:

- **AI Slop pattern: Redundant Information** — heading + subtitle saying the same thing twice
- **AI Slop pattern: Every Button is Primary** — when the copy issue is that buttons say "Click Here" or "Submit" instead of specific actions
- **Accessibility pillar** — when the issue is alt text quality (present but not descriptive), or labels that don't help
- Findings mentioning: generic copy, vague labels, redundant text, placeholder copy, "Lorem ipsum," alt text quality, button labels, empty states, error messages

---

## How to Locate the Source

Scanner evidence comes from the accessibility snapshot (heading text, alt text, button labels) and from visual evaluation (redundant heading/subtitle pairs, generic hero text). Trace to the JSX/HTML source.

### Finding the Problem Copy

```bash
# Generic button labels
grep -rn ">Click here<\|>Submit<\|>Click<\|>OK<\|>Yes<\|>No<" "$ROOT/src" --include="*.tsx" --include="*.jsx" --include="*.html" | head -5

# Placeholder/Lorem ipsum text
grep -rn "Lorem ipsum\|placeholder\|TODO.*replace\|FIXME.*text" "$ROOT/src" --include="*.tsx" --include="*.jsx" --include="*.html" | head -5

# Generic alt text
grep -rn 'alt="image"\|alt="photo"\|alt="icon"\|alt="logo"\|alt="picture"' "$ROOT/src" --include="*.tsx" --include="*.jsx" --include="*.html" | head -5

# Generic heading text
grep -rn ">Our Features<\|>Our Services<\|>Our Products<\|>Our Team<\|>About Us<\|>Get Started<" "$ROOT/src" --include="*.tsx" --include="*.jsx" --include="*.html" | head -5

# Link text that doesn't stand alone
grep -rn ">here<\|>click here<\|>read more<\|>learn more<" "$ROOT/src" --include="*.tsx" --include="*.jsx" --include="*.html" | head -5
```

---

## Fix Recipes

### Recipe 1: Fix Generic Button Labels

**When:** Buttons say "Submit," "Click Here," "OK," or "Yes/No" instead of describing the action.

**What to do:** Label buttons with verb + object. Name the action specifically.

```html
<!-- BEFORE -->
<button>Submit</button>
<button>OK</button>
<button>Click Here</button>

<!-- AFTER -->
<button>Create account</button>
<button>Save changes</button>
<button>Download report</button>
```

**For destructive actions, name the destruction:**
```html
<!-- BEFORE -->
<button>OK</button>  <!-- In a delete confirmation -->
<button>Remove</button>

<!-- AFTER -->
<button>Delete project</button>
<button>Cancel subscription</button>
```

**For confirmation dialogs:**
```html
<!-- BEFORE -->
<button>Yes</button> / <button>No</button>

<!-- AFTER -->
<button>Delete 5 files</button> / <button>Keep files</button>
```

**Rule:** A user should understand what a button does without reading any surrounding context. "Save changes" is clear. "Submit" requires the user to remember what form they're filling out.

### Recipe 2: Fix Redundant Heading + Subtitle

**When:** Scanner detects headings followed by subtitles that restate the same information.

**What to do:** Keep whichever is more specific. If both are vague, rewrite the heading to be specific and remove the subtitle.

```html
<!-- BEFORE: double-says the same thing -->
<h2>Our Features</h2>
<p>Explore the amazing features we offer to our customers.</p>

<!-- AFTER: specific heading, no redundant subtitle -->
<h2>Ship 3x faster with automated deployments</h2>

<!-- Or if a subtitle adds real value: -->
<h2>Automated Deployments</h2>
<p>Push to main and your site is live in under 90 seconds.</p>
```

**The test:** Cover the subtitle — does the heading communicate enough on its own? Now cover the heading — does the subtitle say something new? If either answer is "no," one of them can go.

### Recipe 3: Fix Alt Text Quality

**When:** Images have alt text but it's generic ("image," "photo," "icon," "logo") or describes the medium instead of the message.

**What to do:** Alt text should describe what the image **communicates**, not what it **is**.

```html
<!-- BEFORE: describes the medium -->
<img src="chart.png" alt="chart" />
<img src="team.jpg" alt="photo" />
<img src="dashboard.png" alt="screenshot" />

<!-- AFTER: describes the information -->
<img src="chart.png" alt="Revenue grew 40% in Q4, reaching $2.8M" />
<img src="team.jpg" alt="The founding team: Alice (CEO), Bob (CTO), Carol (Design Lead)" />
<img src="dashboard.png" alt="Analytics dashboard showing 50K daily active users" />
```

**For icons inside buttons/links:**
```html
<!-- Icon-only buttons need aria-label, not visual alt text -->
<button aria-label="Close dialog">
  <svg><!-- X icon --></svg>
</button>

<a href="/settings" aria-label="Account settings">
  <svg><!-- gear icon --></svg>
</a>
```

**For decorative images:**
```html
<!-- Background blobs, decorative dividers, ornaments -->
<img src="blob.svg" alt="" role="presentation" />
```

### Recipe 4: Fix Generic Heading Text

**When:** Headings use template-language: "Our Features," "Our Services," "What We Offer," "Why Choose Us."

**What to do:** Replace with specific, benefit-driven text that tells the user what they'll actually get.

```html
<!-- BEFORE: template headings -->
<h2>Our Features</h2>
<h2>Our Services</h2>
<h2>Why Choose Us</h2>

<!-- AFTER: specific, benefit-driven -->
<h2>Build and deploy in minutes, not days</h2>
<h2>Security auditing for teams of any size</h2>
<h2>Trusted by 2,000+ engineering teams</h2>
```

**Rule:** If you can swap the heading onto a competitor's website and it still makes sense, it's too generic. Headings should be specific to what this product does and why it matters.

### Recipe 5: Fix Link Text

**When:** Links say "click here," "here," "read more," or "learn more" without describing the destination.

**What to do:** Link text should make sense out of context — screen readers often list all links on a page.

```html
<!-- BEFORE: meaningless link text -->
<p>To see our pricing, <a href="/pricing">click here</a>.</p>
<p>We wrote about this. <a href="/blog/post">Read more</a>.</p>

<!-- AFTER: descriptive link text -->
<p><a href="/pricing">View pricing plans</a></p>
<p><a href="/blog/post">Read our migration guide</a></p>
```

### Recipe 6: Fix Empty States

**When:** Empty states show "No items" or "Nothing here" with no context or next action.

**What to do:** Empty states should acknowledge, explain, and guide.

```html
<!-- BEFORE: dead end -->
<p>No projects found.</p>

<!-- AFTER: acknowledge + guide -->
<div class="empty-state">
  <h3>No projects yet</h3>
  <p>Create your first project to start tracking deployments.</p>
  <button>Create project</button>
</div>
```

### Recipe 7: Fix Error Messages

**When:** Error messages are generic ("Error occurred," "Invalid input") or technical ("Error 403: Forbidden").

**What to do:** Error messages should explain what happened, why, and how to fix it.

```html
<!-- BEFORE: technical or vague -->
<span class="error">Invalid input</span>
<span class="error">Error 403</span>
<span class="error">Something went wrong</span>

<!-- AFTER: specific and helpful -->
<span class="error">Email needs an @ symbol. Try: name@example.com</span>
<span class="error">You don't have permission to edit this project. Contact your admin to request access.</span>
<span class="error">We couldn't save your changes. Check your internet connection and try again.</span>
```

**Formula:** (1) What happened? (2) Why? (3) How to fix it?

---

## Anti-Patterns to Avoid

When fixing copy and labels, do NOT:

- **Use jargon** — "Authenticate your credentials" → "Sign in." Users aren't reading a spec.
- **Blame the user** — "You entered an invalid date" → "Please enter a date in MM/DD/YYYY format."
- **Use humor in errors** — users are already frustrated. Be helpful, not cute.
- **Vary terminology** — pick one word and stick with it. If "Delete" is used in one place, don't use "Remove" in another and "Trash" in a third.
- **Replace specific copy with generic copy** — the fix for bad copy is better copy, not less copy.
- **Add text without checking character limits** — buttons and labels have space constraints. Check that your improved copy fits.

---

## Verification Criteria

> **Checker scope:** The checker verifies the specific metric it was given (contrast ratio, element size, pattern detection). Broader criteria listed here are guidance for the scanner's re-evaluation, not individual checker measurements.

After applying a copy/label fix, the checker should re-measure:

- **Button specificity** — do all buttons use verb + object format?
- **Alt text quality** — do content images describe their information, not their medium?
- **Heading specificity** — are headings specific to the product, not template-generic?
- **Link independence** — do link texts make sense without surrounding context?
- **Redundancy** — are heading/subtitle pairs saying different things?
- **Error helpfulness** — do error messages explain what, why, and how-to-fix?
- **Terminology consistency** — is the same action called the same thing everywhere?
