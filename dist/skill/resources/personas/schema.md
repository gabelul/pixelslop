# Persona Schema

Personas are evaluation lenses — not interaction simulators. They let the collector evaluate design quality from different user perspectives. "How does this page serve a screen reader user? A rushed mobile shopper? A non-native English speaker?"

## Format

Every persona is a single JSON file. Built-in personas live in `dist/skill/resources/personas/`. Custom personas load from `.pixelslop/personas/` or the path set via `--personas-dir`. Same schema, same behavior — the collector doesn't care where the file came from.

## Fields

```json
{
  "id": "string — kebab-case unique identifier, matches filename",
  "name": "string — human-readable name",
  "category": "string — one of: accessibility, context, international, professional",
  "description": "string — what this persona evaluates and why",

  "designPriorities": {
    "accessibility": "number 1-4 — how much this pillar matters to this user",
    "hierarchy": "number 1-4",
    "typography": "number 1-4",
    "color": "number 1-4",
    "responsiveness": "number 1-4"
  },

  "evaluationChecks": [
    "string — check IDs from visual-eval.md or persona-specific checks"
  ],

  "frustrationTriggers": [
    "string — design patterns that cause problems for this user type"
  ],

  "positiveSignals": [
    "string — design patterns that work well for this user type"
  ],

  "cognitiveLoadFactors": [
    "string — information density issues (empty array if not relevant)"
  ],

  "narrationStyle": {
    "voice": "string — how this persona communicates findings (methodical, impatient, critical, etc.)",
    "sampleReactions": [
      "string — example quotes showing how this persona would react to issues"
    ]
  },

  "browserChecks": {
    "viewports": ["string — which viewports to evaluate: desktop, tablet, mobile"],
    "extraEvaluations": ["string — additional browser checks to run for this persona"]
  }
}
```

## Field Details

### `id`

Kebab-case, matches the JSON filename (without `.json`). Used in `--personas screen-reader-user,keyboard-user` flag values and in the report output. Must be unique across all personas (built-in and custom).

### `category`

Groups personas for display. Valid categories:

| Category | What it covers |
|----------|---------------|
| `accessibility` | Users with disabilities or assistive technology |
| `context` | Users in specific situations (rushed, slow connection, first visit) |
| `international` | Users from different language/cultural backgrounds |
| `professional` | Design-focused evaluation perspectives |

### `designPriorities`

Weights 1-4 for each of the 5 scoring pillars. These don't change the pillar scores — they rerank findings so the most relevant ones surface first for this persona.

- **4** = critical for this user type (e.g., accessibility for screen-reader-user)
- **3** = very important
- **2** = moderately important
- **1** = less relevant but still checked

### `evaluationChecks`

Array of check IDs that guide what the collector evaluates for this persona. These are evaluation topics, not 1:1 mappings to specific collector snippets. The collector uses judgment to select the appropriate measurement approach — some checks use a11y snapshots, some use computed styles, some use visual inspection of screenshots. IDs serve as a checklist, not an API contract. Built-in check IDs:

- `heading-hierarchy-sequential` — h1→h2→h3 without skips
- `landmark-regions-present` — main, nav, header, footer landmarks exist
- `aria-labels-on-interactive` — buttons and links have accessible names
- `alt-text-meaningful` — images have descriptive alt text (not "image" or filename)
- `skip-navigation-link` — skip-nav link as first focusable element
- `focus-order-logical` — tab order follows visual layout
- `form-labels-associated` — inputs have programmatic labels
- `live-regions-for-updates` — dynamic content uses aria-live
- `zoom-reflow-200` — content reflows at 200% zoom without horizontal scroll
- `focus-indicators-visible` — interactive elements show focus state
- `keyboard-trap-detection` — no elements trap keyboard focus
- `above-fold-cta` — primary CTA visible without scrolling
- `page-weight-check` — total transfer size and request count
- `font-loading-strategy` — custom fonts use swap/optional display
- `critical-css-present` — above-fold styles inlined or preloaded
- `reading-level-estimate` — Flesch-Kincaid grade level of visible text
- `icon-text-pairing` — icons have adjacent text labels
- `image-optimization-check` — image sizes reasonable for viewport
- `cognitive-density-scan` — counts competing CTAs, text blocks, nav items
- `spacing-consistency-audit` — checks spacing rhythm and visual breathing room
- `color-cohesion-check` — palette discipline and accent restraint
- `typography-discipline-check` — font count, scale consistency, weight hierarchy
- `a11y-snapshot-deep` — extended accessibility tree analysis

### `frustrationTriggers`

Human-readable descriptions of design patterns that cause problems for this user type. The collector matches these against collected findings to generate persona-specific issues. These are qualitative — they guide the collector's interpretation, not its measurement.

### `positiveSignals`

Design patterns that work well for this user type. The collector notes these in the persona summary as "what's working." Helps balance the report — it's not all problems.

### `cognitiveLoadFactors`

Information density checks for cognitive-load-sensitive personas. Empty array for personas where cognitive load isn't a primary concern. When populated, the collector evaluates:

- Number of competing CTAs per viewport
- Text density (words per visible section)
- Navigation item count
- Distinct visual zones competing for attention

### `narrationStyle`

Adds personality to persona findings. The `voice` field sets the tone, `sampleReactions` show example quotes. The collector can use these to contextualize findings:

> "I can't tell what this section is — no heading or landmark." — screen-reader-user

This makes findings more concrete than abstract accessibility rules.

### `browserChecks`

Configures the collector's evaluation scope for this persona.

- `viewports` — which viewport sizes to evaluate (most personas check desktop; rushed-mobile-user checks mobile)
- `extraEvaluations` — additional browser checks beyond standard extraction (e.g., `a11y-snapshot-deep` for accessibility personas, `zoom-reflow-200` for low-vision)

## Creating Custom Personas

1. Create a `.json` file matching the schema above
2. Drop it in `.pixelslop/personas/` (or your configured personas directory)
3. Run the collector — custom personas are auto-discovered and evaluated alongside built-ins

The filename (without `.json`) must match the `id` field. The collector validates persona files at load time and skips any that don't match the schema, with a warning in the report.

## Persona Report Format

Persona findings appear after the standard 5-pillar scores and slop classification:

```
### Persona Insights

#### screen-reader-user (Accessibility)
Issues: 3 | Weighted priority: High
- Missing landmark regions — no <main>, <nav>, or <footer> detected
- Heading hierarchy skips h2 (h1 → h3 in features section)
- Buttons labeled "Click here" — not descriptive for screen readers

Positive: Clean heading text, form inputs have labels

#### rushed-mobile-user (Context)
Issues: 1 | Weighted priority: Medium
- Primary CTA below fold on mobile — requires scrolling to find action

Positive: Touch targets meet 44px minimum, page loads in < 3s
```

Each persona section includes: issue count, weighted priority (based on `designPriorities`), specific issues with evidence, and positive signals found.
