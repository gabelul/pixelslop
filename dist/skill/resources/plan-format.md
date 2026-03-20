# Plan Format

The `.pixelslop-plan.md` file is the contract between the orchestrator, fixer, and checker agents. It tracks the state of a pixelslop session — which issues were found, which are fixed, which failed, and the before/after scores.

**Agents never edit this file directly.** All mutations go through `pixelslop-tools plan *` commands.

---

## Structure

```markdown
---
url: http://localhost:3000
root: .
mode: visual-editable
baseline_score: 11
baseline_slop: TERMINAL
gate_command: pnpm typecheck
gate_baseline: pass
session: 2026-03-18T14:00:00Z
current_category: accessibility
---

## Issues

- [pending] contrast-cta P0 [accessibility] CTA contrast 2.28:1 — target 4.5:1
- [fixed] gradient-text P1 [slop] Gradient text on h1
- [partial] touch-targets P1 [responsiveness] Footer links 19px — target 44px

## Scores

| Pillar | Before | After |
|--------|--------|-------|
| Hierarchy | 3 | — |
| Typography | 2 | — |
| Color | 2 | — |
| Responsiveness | 3 | — |
| Accessibility | 2 | — |
```

---

## Frontmatter Fields

| Field | Type | Description |
|-------|------|-------------|
| `url` | string | Target page URL |
| `root` | string | Path to project source |
| `mode` | enum | `visual-editable`, `visual-report-only`, or `code-check` |
| `baseline_score` | number | Total score from initial scan (0-20) |
| `baseline_slop` | enum | `CLEAN`, `MILD`, `SLOPPY`, or `TERMINAL` |
| `gate_command` | string | Build gate command, or `none` |
| `gate_baseline` | enum | `pass`, `fail`, or `unknown` |
| `session` | ISO 8601 | When the session started |
| `current_category` | string | Category currently being processed |

---

## Issue Line Format

```
- [status] issue-id priority [category] description
```

| Part | Values | Notes |
|------|--------|-------|
| `status` | `pending`, `in-progress`, `fixed`, `failed`, `partial`, `skipped` | Managed by `plan update` |
| `issue-id` | slug | Unique identifier, e.g. `contrast-cta` |
| `priority` | `P0`, `P1`, `P2` | P0 = must fix, P1 = should fix, P2 = nice to fix |
| `category` | bracket-wrapped | Maps to fix guide pillar |
| `description` | free text | What's wrong, with measured values |

---

## Priority Assignment

| Level | Criteria |
|-------|----------|
| **P0** | AA-fail contrast (< 4.5:1 normal, < 3:1 large), score-1 pillars, TERMINAL slop patterns |
| **P1** | Borderline contrast (4.5-5:1), score-2 pillars, SLOPPY patterns |
| **P2** | Everything else — score-3 pillars, MILD patterns, cosmetic issues |

"Critical only" mode = P0 + P1.

---

## Category Map

Scanner findings are tagged with pillar names. The orchestrator maps them to fix categories:

| Finding pillar | Plan category |
|----------------|--------------|
| Accessibility | `accessibility` |
| Typography | `typography` |
| Hierarchy | `layout` |
| Responsiveness | `responsiveness` |
| Color | `color` |
| AI Slop | `slop` |
| Copy | `copy` |
