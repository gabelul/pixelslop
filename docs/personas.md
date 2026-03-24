# Personas

## What they are

Personas are lenses. The scanner doesn't just score numbers — it evaluates your page through the eyes of different users and catches things that pure metric checks miss. A screen reader user cares about heading hierarchy and landmarks. A rushed mobile user cares about whether the CTA is above the fold and tappable. A design critic cares about spacing consistency and type discipline.

The findings still map to the same fix categories (accessibility, typography, color, etc.). Personas don't create a separate fix track — they surface issues that the pure-metric scan might underweight.

## Built-in personas

| ID | Who they are | What they check |
|----|-------------|----------------|
| `screen-reader-user` | Relies on assistive technology | Heading hierarchy, landmarks, ARIA, alt text, focus order, skip navigation |
| `low-vision-user` | Uses zoom, needs high contrast | Zoom reflow, contrast ratios, text sizing, target sizes, color-only indicators |
| `keyboard-user` | Navigates without a mouse | Focus indicators, tab order, skip navigation, keyboard traps, interactive element access |
| `rushed-mobile-user` | Scanning on a phone, limited patience | Touch targets, CTA visibility, page weight, above-fold content, scroll depth |
| `slow-connection-user` | Poor network, older device | Image optimization, loading states, font loading, critical CSS, total page weight |
| `non-native-english` | Reading in a second language | Plain language, idiom avoidance, icon+text pairing, reading level, acronym expansion |
| `design-critic` | Trained eye for visual quality | Visual hierarchy, spacing consistency, typography discipline, color restraint, alignment |
| `first-time-visitor` | Never seen this site before | Onboarding clarity, value proposition, trust signals, CTA clarity, navigation findability |

## Using personas

```
/pixelslop http://localhost:3000                                   # all 8 personas (default)
/pixelslop http://localhost:3000 --personas none                   # skip persona evaluation
/pixelslop http://localhost:3000 --personas screen-reader-user     # just one
/pixelslop http://localhost:3000 --personas keyboard-user,low-vision-user  # pick a few
```

## Custom personas

Drop a JSON file into `.pixelslop/personas/` in your project. The scanner picks it up automatically — no code changes, no config updates.

### Schema

```json
{
  "id": "color-blind-user",
  "name": "Color Blind User",
  "description": "Deuteranopia (red-green color blindness), the most common form",
  "perspective": "Cannot distinguish between red and green hues. Relies on shape, position, and labels to differentiate UI states.",
  "checks": [
    {
      "id": "color-only-status",
      "description": "Status indicators that use only color (red=error, green=success) without shape or label",
      "pillar": "accessibility",
      "severity": "P0",
      "detection": "Look for status badges, form validation indicators, and progress states that rely solely on color"
    },
    {
      "id": "red-green-buttons",
      "description": "Adjacent buttons differentiated only by red vs green coloring",
      "pillar": "accessibility",
      "severity": "P1",
      "detection": "Check button groups where color is the only differentiator between actions"
    }
  ],
  "summary_template": "As a color blind user: {count} issue(s) — {issues}"
}
```

### Required fields

| Field | Type | What it's for |
|-------|------|--------------|
| `id` | string | Unique slug, used in `--personas` flag |
| `name` | string | Display name in reports |
| `description` | string | One line — who this persona is |
| `perspective` | string | How this user experiences the web differently |
| `checks` | array | What to look for (each needs `id`, `description`, `pillar`, `severity`, `detection`) |
| `summary_template` | string | Report format, `{count}` and `{issues}` get replaced |

### Checks

Each check maps to an existing pillar (accessibility, typography, color, responsiveness) so the findings integrate into the standard fix categories. The `detection` field tells the scanner what to look for in the browser — it's guidance for the model, not executable code.

Severity follows the same P0/P1/P2 system as pillar findings.

### Where to put them

```
your-project/
  .pixelslop/
    personas/
      color-blind-user.json
      elderly-user.json
```

The schema docs live at `dist/skill/resources/personas/schema.md` in the pixelslop package. The built-in personas are at `dist/skill/resources/personas/*.json` if you want examples to copy from.
