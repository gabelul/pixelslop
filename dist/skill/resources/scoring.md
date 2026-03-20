# Pixelslop Scoring Rubric

How you turn browser observations into numbers that mean something.

Five pillars. Each scored 1 to 4. Total out of 20. Every single score must cite specific browser evidence -- not vibes, not hunches, not "it feels off." If you cannot point to a concrete observation that justifies the score, you do not have enough information to assign one.

A score of 1 is not an insult. It is a measurement. A score of 4 is not a compliment. It is also a measurement. The goal here is accuracy, not kindness.

---

## The Five Pillars

### Pillar 1: Hierarchy (1-4)

**What it measures:** Whether the page has clear visual weight distribution -- focal points, heading structure, layout prominence, and whether a user can figure out what matters within seconds of landing.

**Score 1 -- No Direction**
The page is a flat wall of equally weighted content. Nothing stands out. Multiple elements compete for attention at the same size, color, and position. There is no clear primary action. A user landing here has to work to figure out what to do. Headings are the same size as body text, or close enough that the difference does not register. Layout is a single column of sameness or a grid where every card screams at the same volume.

Evidence: heading sizes within 4px of each other, no element with significantly larger font-size or bolder weight, primary CTA same visual weight as secondary elements, no whitespace separation between content sections.

**Score 2 -- Attempted but Muddled**
There is some size or weight variation, but it does not quite land. The heading is bigger, sure, but three other elements also demand attention. The CTA exists but sits in a visual tie with a decorative element or secondary link. The hierarchy is technically present but does not guide the eye -- you notice structure, but you still have to think about what matters most.

Evidence: heading exists at a larger size but competing elements (images, badges, secondary CTAs) draw equal or near-equal visual weight. More than one element could plausibly be "the main thing."

**Score 3 -- Clear and Functional**
The eye flows to the most important element first. There is a visible primary action that a user can identify within 2-3 seconds. Size, color, and position communicate importance in a way that works. Minor issues -- maybe a secondary element is slightly too prominent, or the visual flow hiccups between sections -- but the fundamentals are solid.

Evidence: measurable size difference between heading levels (h1 significantly larger than h2, h2 than h3), primary CTA visually distinct from other interactive elements, whitespace used to separate content groups.

**Score 4 -- Intentional and Immediate**
The focal point is obvious within 1-2 seconds. The primary action is unmistakable. Size, color, position, and whitespace all work together to create a hierarchy that feels effortless. You do not have to think about what matters -- the design tells you. Secondary content supports the primary without competing. Every level of the hierarchy has a reason to exist.

Evidence: clear progressive reduction in visual weight from h1 through body text, primary CTA isolated with whitespace or color contrast, layout sections visually distinct with intentional spacing, no competing focal points.

**Key evidence to collect:**
- Computed font sizes for all heading levels (h1-h6) and body text
- Font weights across heading levels
- CTA button sizes, colors, and padding compared to other interactive elements
- Whitespace/margin/padding between major content sections
- Number of elements with font-size > 24px (if everything is big, nothing is)
- Screenshot with viewport at 1440px width -- does one thing dominate?

---

### Pillar 2: Typography (1-4)

**What it measures:** Font selection, scale discipline, weight consistency, and whether the text is actually comfortable to read. This is about the type system as a whole -- not individual font sizes (that is Hierarchy's job) but whether the fonts, spacing, and rhythm form a coherent system.

**Score 1 -- System Default or Chaos**
The page uses system fonts (Arial, Times New Roman, the browser default serif/sans-serif) with no apparent intentionality behind the choice. Or worse, multiple fonts thrown together with no logic. Line heights are browser defaults. Line lengths run edge-to-edge or are uncomfortably short. Font sizes jump around without a consistent scale. Body text is either too small to read comfortably or too large for the column width.

Evidence: `font-family` resolving to system defaults, no custom fonts loaded, line-height at browser default (typically 1.2 or `normal`), body text line-length exceeding 80 characters or under 30 characters, no consistent ratio between font sizes.

**Score 2 -- Custom but Undisciplined**
A custom font is loaded (probably Google Fonts), but the type system lacks discipline. Too many sizes that do not follow a scale. Weights used inconsistently -- bold where regular would work, or everything at the same weight. Line heights exist but vary without reason. The font choice is fine but generic (Open Sans, Roboto used as-is with no personality). It works, but it does not say anything.

Evidence: custom font loaded but fewer than 3 distinct sizes in use, or more than 6 with no modular ratio between them. Inconsistent font-weight values across similar elements. Line heights vary between 1.2 and 2.0 with no pattern.

**Score 3 -- Solid System**
Fonts are chosen with purpose and paired well if multiple families are used. A clear size scale is in place (even if not mathematically perfect). Weights are used consistently -- bold means something, regular means something else. Line heights are comfortable (1.4-1.6 for body text). Line lengths are reasonable (45-75 characters). The typography supports readability and has some personality.

Evidence: consistent modular scale (roughly 1.2x-1.5x between levels), deliberate font pairing (serif + sans-serif, or display + body), line-height in the 1.4-1.6 range for body, line-lengths between 45-75 characters, no more than 3 font families.

**Score 4 -- Distinctive and Disciplined**
The type system has genuine personality that reinforces the brand. Font pairing is distinctive -- not the same Google Fonts every other site uses. The modular scale is tight and consistent. Weight hierarchy is clear and intentional. Letter-spacing and line-height are tuned, not defaulted. Body text is a pleasure to read. The typography alone gives the page an identity.

Evidence: distinctive font pairing (not just Inter/Roboto/Open Sans defaults), consistent modular scale with ratios between 1.2-1.618, deliberate letter-spacing adjustments, line-height tuned per text size, no more than 2-3 font families used with clear roles (display, body, mono), comfortable reading rhythm across paragraphs.

**Key evidence to collect:**
- All `font-family` values and whether custom fonts are loaded
- Computed font sizes for every text element, mapped against a modular scale
- Font weight values and where each is used
- Line height values for body text and headings
- Character count per line at each major viewport width
- Letter-spacing values if present
- Number of distinct font families in use

---

### Pillar 3: Color (1-4)

**What it measures:** Palette cohesion, accent discipline, and whether the color choices feel intentional and distinctive. This is strictly about the palette itself -- contrast ratios and accessibility are scored under Pillar 5. Here we care about whether the colors work together and say something about the brand.

**Score 1 -- The AI Palette**
You have seen this site before, on every other AI startup landing page from 2024. Cyan on dark. Purple-to-blue gradient. Neon accent on a near-black background. The "futuristic" default that communicates nothing except "an AI generated this." Or: a random collection of colors with no relationship to each other -- clashing hues, no neutral strategy, accents everywhere with no restraint.

Evidence: background-color in the #0a-#1a range (near-black), accent colors in the cyan/electric-blue/purple family, gradient backgrounds using blue-to-purple or cyan-to-magenta, more than 3 saturated accent colors with no clear primary, use of neon/glow effects (box-shadow with saturated colors, text-shadow with bright values).

**Score 2 -- Safe but Generic**
The palette is not offensive but it is not saying anything either. Standard blue primary, gray neutrals, maybe a green for success and red for error. Nothing wrong with it, but also nothing that gives the page an identity. You could swap this palette onto any other site in the same category and nobody would notice.

Evidence: primary color is a standard blue (#007bff-ish or similar framework default), neutrals are pure grays (#333, #666, #999, #ccc, #f5f5f5), no tinted neutrals, accent colors limited to standard semantic colors (red/green/yellow), no intentional palette beyond framework defaults.

**Score 3 -- Cohesive and Intentional**
The palette feels chosen, not defaulted. Colors work together. Neutrals might be tinted to warm or cool the overall feel. There is a clear primary accent and it is used with discipline -- not splashed on everything. The palette has enough personality that you would recognize it if you saw it on a different page of the same site.

Evidence: primary color is not a framework default, neutrals show intentional tinting (warm grays, cool grays, or tinted toward the primary), accent color used on 3 or fewer element types, background colors have subtle warmth or coolness, palette limited to 4-6 total colors including neutrals.

**Score 4 -- Distinctive and Memorable**
The color palette is a design decision, not an afterthought. It has genuine personality. Tinted neutrals create atmosphere. Accents are used sparingly and always draw attention to the right things. The palette would be hard to confuse with competitors. Color usage has clear rules -- you can see the logic in which elements get which colors.

Evidence: tinted neutrals (not pure gray), unique primary that is not the standard tech-blue/startup-teal, accent color used with clear restraint (fewer than 5 instances on a given page), consistent color logic (e.g., all interactive elements use the same accent, all backgrounds use the same neutral family), no neon/glow effects unless they serve a specific brand purpose.

**Key evidence to collect:**
- All unique `background-color`, `color`, `border-color` values
- Gradient definitions if present
- Count of distinct saturated colors (hue, not neutrals)
- Whether neutrals are pure gray or tinted
- Box-shadow and text-shadow colors (glow detection)
- Whether accent colors are used consistently on specific element types

---

### Pillar 4: Responsiveness (1-4)

**What it measures:** How the layout behaves across three viewport widths -- desktop (1440px), tablet (768px), and mobile (375px). This is not just "does it shrink" but "does it actually adapt." Also covers overflow, touch targets, and whether the mobile experience is a real experience or a shrunken desktop.

**Score 1 -- Broken**
The site breaks on mobile. Horizontal scroll appears. Text overflows containers. Touch targets are tiny (under 30px). Images or elements extend beyond the viewport. Navigation is inaccessible or unusable at narrow widths. The mobile experience is functionally broken -- a user on a phone would struggle to complete basic tasks.

Evidence: `overflow-x` scroll appearing at 375px viewport, elements wider than viewport, touch targets (buttons, links) smaller than 30px in either dimension, text truncated or overlapping at narrow widths, navigation hamburger that does not function.

**Score 2 -- Shrinks but Does Not Adapt**
The site technically fits on mobile but it is just a compressed desktop layout. Everything gets smaller proportionally. Font sizes might be uncomfortably small. Touch targets are borderline (30-43px). Spacing gets cramped. It is responsive in the CSS sense (things reflow) but not in the design sense (nobody thought about the mobile experience specifically).

Evidence: same layout structure at all viewports (just narrower), font sizes below 14px on mobile, touch targets between 30-43px, minimal or no difference in padding/margin between desktop and mobile, images scale down but are not cropped or art-directed.

**Score 3 -- Properly Responsive**
The layout genuinely adapts. Navigation changes form (hamburger, bottom nav, or other mobile pattern). Content reflows into appropriate mobile layouts. Font sizes remain readable. Touch targets meet the 44px minimum. Spacing adjusts for the viewport. The experience feels considered at each breakpoint, even if it is not perfect.

Evidence: different layout at each viewport (grid columns collapse, navigation changes form), touch targets at 44px+, font sizes 16px+ for body text on mobile, padding/margin values differ between desktop and mobile stylesheets, no horizontal overflow.

**Score 4 -- Genuine Layout Adaptation**
The mobile, tablet, and desktop experiences each feel designed for their context. It is not just reflow -- content priority might shift, navigation patterns change meaningfully, touch targets are generous (48px+), spacing feels right at every width. Images are handled well (art direction, proper sizing, no massive downloads on mobile). The mobile experience is not a compromise -- it is a real product.

Evidence: content reordering between viewports (not just reflow), navigation pattern genuinely different on mobile vs desktop, touch targets 48px+, images use `srcset` or art direction, spacing system adapts proportionally, no elements that feel awkward or out of place at any viewport width.

**Key evidence to collect:**
- Screenshots at 1440px, 768px, and 375px
- Presence of horizontal overflow at each viewport
- Touch target sizes for all interactive elements at 375px
- Font sizes for body text at each viewport
- Navigation pattern at each viewport
- Whether layout structure actually changes (column count, element order)
- Image handling (srcset, sizes, or art direction)

---

### Pillar 5: Accessibility (1-4)

**What it measures:** Whether the site can be used by people with disabilities. Measured through contrast ratios, semantic HTML structure, ARIA usage, keyboard navigability, and alt text. This is the only pillar that tests contrast -- Color (Pillar 3) is about palette aesthetics, this is about whether people can actually read the text.

**Primary evidence:** Contrast ratios (via computed styles), heading hierarchy (via a11y snapshot), landmark regions (via a11y snapshot), alt text presence (via a11y snapshot), semantic HTML (via a11y snapshot). Focus indicators and keyboard navigation are assessed visually from screenshots but not programmatically tested — scores 3 and 4 should note when these claims are observation-based rather than measured.

**Score 1 -- Significant Barriers**
Key text fails WCAG AA contrast requirements (below 4.5:1 for normal text, below 3:1 for large text). No semantic HTML structure -- divs and spans all the way down, no heading hierarchy. Images missing alt text. No skip-to-content link. Interactive elements unreachable or invisible via keyboard. The site is functionally inaccessible to users who rely on assistive technology.

Evidence: contrast ratios below 4.5:1 on body text or navigation, contrast below 3:1 on headings, no `<main>`, `<nav>`, `<header>`, `<footer>` landmarks, images without `alt` attributes, no visible focus indicators on interactive elements, heading levels skipped (h1 to h4 with no h2/h3).

**Score 2 -- Partial Effort**
Some accessibility work has been done but it is incomplete. Main text might pass contrast but secondary text (captions, labels, placeholder text) fails. Some semantic HTML is present but inconsistent. A few images have alt text, others do not. Focus states exist on some elements but not all. It is the "we added some ARIA and called it a day" level.

Evidence: primary text passes 4.5:1 but secondary text (subtitles, meta, placeholders) falls below, mix of semantic and non-semantic elements, some images with alt and some without, inconsistent focus indicators, heading hierarchy partially correct.

**Score 3 -- Solid Fundamentals**
All key text passes WCAG AA contrast (4.5:1 for normal text, 3:1 for large text). Semantic HTML is used consistently. Heading hierarchy is logical (h1 > h2 > h3, no skips). Images have meaningful alt text (not just "image" or the filename). Focus indicators are visible. Basic keyboard navigation works. Skip-to-content link present. ARIA used where native HTML semantics are insufficient.

Evidence: all text-on-background combinations pass AA ratios, `<main>`, `<nav>`, `<header>` landmarks present, heading levels sequential, alt text descriptive, focus-visible styles on all interactive elements, tab order logical.

**Score 4 -- Thorough and Thoughtful**
Everything in Score 3 plus: contrast passes AAA where practical (7:1 for normal text). ARIA labels on complex interactive components (modals, tabs, accordions). Alt text is genuinely descriptive, not just present. Focus management handles dynamic content (modals trap focus, returns focus on close). Color is never the sole indicator of state. Reduced-motion preferences respected. The accessibility work goes beyond compliance into genuine usability.

Evidence: contrast ratios approaching or exceeding 7:1 on key text, `aria-label`, `aria-describedby`, or `aria-labelledby` on complex widgets, prefers-reduced-motion media query present, focus trap on modals, no information conveyed by color alone, `role` attributes on custom components.

**Key evidence to collect:**
- Contrast ratios for all text-on-background combinations (calculate from computed styles using relative luminance)
- Semantic element usage (`<main>`, `<nav>`, `<header>`, `<footer>`, `<section>`, `<article>`)
- Heading hierarchy (list all headings in DOM order with their levels)
- Image alt attribute presence and content
- Focus indicator visibility (`:focus-visible` styles)
- ARIA attribute usage across the page
- Tab order (does it follow visual order?)
- Skip-to-content link presence
- `prefers-reduced-motion` media query in stylesheets

---

## Rating Bands

| Range | Rating | What It Means |
|-------|--------|---------------|
| 17-20 | Excellent | Intentional design with clear identity. This site was designed, not generated. |
| 13-16 | Good | Solid fundamentals, some personality. Works well but has room to distinguish itself. |
| 9-12 | Needs Work | Template-territory. Recognizable patterns, fixable problems, no real identity yet. |
| 5-8 | Poor | Generic AI output with significant issues. Needs structural attention, not polish. |
| 1-4 | Critical | Broken or effectively unusable. Start over or fix fundamentals before anything else. |

These bands are guidelines, not rigid cutoffs. A site scoring 12 with one pillar at 1 has a different story than a site scoring 12 with everything at 2-3. The individual pillar scores tell you where the problems are. The total tells you the overall health.

---

## AI Slop Classification

Based on patterns detected during scanning, classify the overall AI-slop level:

| Level | Label | Criteria |
|-------|-------|----------|
| 0-1 | CLEAN | Zero or one pattern. Might just be a design choice, not a tell. |
| 2-3 | MILD | A couple of common patterns (dark mode + gradient, generic font). Minor tells. |
| 4-6 | SLOPPY | Multiple AI-output fingerprints. The site looks like it was prompted into existence. |
| 7+ | TERMINAL | The full AI starter pack. Cyan-on-dark, gradient text, glassmorphism, floating cards, neon accents, "Powered by AI" energy everywhere. |

Common AI-slop patterns to check for:
- Near-black background (#0a-#1a range) with bright accent colors
- Cyan/electric-blue/purple gradient combinations
- Gradient text (background-clip: text)
- Glassmorphism (backdrop-filter: blur + semi-transparent backgrounds)
- Glowing box-shadows with saturated colors
- Identical card grids with no variation
- "Hero metrics" layout (3-4 big numbers in a row)
- Generic dark mode with no personality
- Floating/hovering cards with excessive shadow

---

## Confidence Model

Not every scan has the same quality of evidence. The confidence score tells the reader how much to trust the numbers.

Base confidence starts at **50%**. Evidence types add to it:

| Evidence Type | Confidence Bonus |
|---------------|-----------------|
| Screenshot captured and analyzed | +15% |
| Computed styles extracted via JavaScript | +10% |
| Contrast ratios calculated (relative luminance formula) | +10% |
| Accessibility snapshot analyzed | +5% |
| Source code grepped (when `--root` is available) | +5% |
| Multiple viewports compared (2+ widths) | +5% |

**Maximum: 100%.** These stack, so a full scan with all evidence types hits 100%.

If total confidence lands below **65%**, the scanner must flag it in the report. A low-confidence score is still useful -- it just means the reader should treat it as directional rather than definitive. "We think the typography is weak but we could not extract computed styles to confirm the scale" is honest and helpful.

---

## Output Format

Every scan produces a report in this structure. No exceptions, no freestyle. The scanner agent reads this format and fills it in.

```
## Pixelslop Report: [page title]
URL: [url]
Date: [timestamp]
Confidence: [percentage]%

### Scores
| Pillar | Score | Evidence |
|--------|-------|----------|
| Hierarchy | ?/4 | [key finding] |
| Typography | ?/4 | [key finding] |
| Color | ?/4 | [key finding] |
| Responsiveness | ?/4 | [key finding] |
| Accessibility | ?/4 | [key finding] |
| **Total** | **?/20** | **[rating band]** |

### AI Slop: [CLEAN/MILD/SLOPPY/TERMINAL]
Patterns detected: [count]
[list each detected pattern with evidence]

### Findings
[Priority-ordered list of specific findings with evidence]

### Persona Insights
[Per-persona summaries — only present if personas were evaluated. Omit section entirely if --personas none]

### Screenshots
- Desktop (1440x900): [reference]
- Tablet (768x1024): [reference]
- Mobile (375x812): [reference]
```

The Evidence column in the scores table is not optional. A score without evidence is a guess. Put the single most important observation for each pillar there. Details go in Findings.

Findings should be ordered by impact -- the thing that hurts the site the most goes first. Each finding should reference which pillar it affects and include the specific browser observation that surfaced it.

Screenshots are references to captured images, not inline data. If a screenshot was not captured for a given viewport, note it as `[not captured]` and that gap should be reflected in the confidence score.

---

## Persona Report Format

When personas are evaluated, append a `### Persona Insights` section after `### Findings`. Each persona gets a subheading with its name and category, an issue summary, specific findings, and positive signals.

```
### Persona Insights

#### [persona-name] ([category])
Issues: [count] | Weighted priority: [High/Medium/Low]
- [Issue description with specific evidence]
- [Issue description with specific evidence]

Positive: [Comma-separated list of positive signals found]

#### [next-persona-name] ([category])
...
```

**Rules for persona findings:**

1. **Evidence required.** Persona findings must reference the same browser evidence as pillar findings. "Screen reader user would struggle with heading hierarchy" must cite the specific heading skip found in the a11y snapshot.

2. **Weighted priority.** Calculated from the persona's `designPriorities` and the severity of the issues found. High = multiple issues in priority-4 pillars. Medium = issues in priority-2-3 pillars. Low = minor issues in priority-1 pillars only.

3. **Map to fix categories.** Persona findings map to the same fix categories as pillar findings (accessibility, typography, layout, responsiveness, color, slop, copy). The orchestrator uses this mapping to group persona issues with existing findings — no parallel fix track.

4. **Narration optional.** The scanner may use `narrationStyle.sampleReactions` from the persona JSON to contextualize findings. This adds color but is not required.

5. **Positive signals are brief.** One line, comma-separated. Don't pad the report with paragraphs about what's working.

6. **Skip empty personas.** If a persona has zero issues and no notable positive signals, omit it from the report entirely. Don't include "No issues found" sections.
