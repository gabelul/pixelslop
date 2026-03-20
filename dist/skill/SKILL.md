---
name: pixelslop
description: >
  Browser-first design quality review and fix. Scans pages with Playwright,
  scores 5 design pillars, detects AI slop patterns, fixes issues with
  checkpoint-based rollback.
user-invokable: true
args:
  - name: url
    description: URL to evaluate (required)
    required: true
  - name: root
    description: Path to project source (enables fix mode with checkpoints)
    required: false
  - name: build-cmd
    description: Build gate command (overrides auto-detection)
    required: false
  - name: code-check
    description: Run in code-check mode (source analysis only, no browser)
    required: false
  - name: personas
    description: Persona IDs to evaluate (comma-separated, "all", or "none"). Default all
    required: false
  - name: thorough
    description: Show lower-confidence findings (threshold 50% instead of 65%)
    required: false
---

Spawn the `pixelslop` orchestrator agent to run the full design review workflow.

The orchestrator handles everything: scanning the page, grouping findings, asking the user how to proceed, running the fix/check loop, and producing a final report.

## Arguments

Pass arguments from the skill invocation to the orchestrator:

- **url** — the target page URL (required)
- **root** — path to the project source code (default: current directory)
- **build-cmd** — explicit build gate command (default: auto-detect from package.json)
- **code-check** — if set, run source-only analysis without browser
- **personas** — comma-separated persona IDs, "all" (default), or "none" to skip persona evaluation
- **thorough** — show lower-confidence findings with `[low confidence]` tag

## Agents

The orchestrator spawns these subagents as needed:

| Agent | Role |
|-------|------|
| `pixelslop-scanner` | Evaluates pages across viewports, scores pillars, detects slop |
| `pixelslop-fixer` | Applies one targeted fix per finding with checkpoint |
| `pixelslop-checker` | Verifies fixes by re-measuring the targeted metric |
| `pixelslop-setup` | Explores codebase to build project design context |

## Resources

Knowledge files loaded by agents at runtime:

- `resources/scoring.md` — 5-pillar grading rubric (1-4 per pillar, /20 total)
- `resources/visual-eval.md` — Playwright operational manual (viewports, JS snippets)
- `resources/ai-slop-patterns.md` — AI slop pattern catalog with detection methods
- `resources/checkpoint-protocol.md` — fix/verify/rollback mechanism
- `resources/plan-format.md` — plan file contract between agents
- `resources/typeset.md` — fix guide: typography
- `resources/arrange.md` — fix guide: hierarchy & spacing
- `resources/colorize.md` — fix guide: color & contrast
- `resources/adapt.md` — fix guide: responsiveness
- `resources/distill.md` — fix guide: AI slop removal
- `resources/harden.md` — fix guide: accessibility
- `resources/clarify.md` — fix guide: copy & labels
- `resources/personas/schema.md` — persona format documentation
- `resources/personas/*.json` — 8 built-in persona evaluation profiles

## Tools

The orchestrator and agents use `pixelslop-tools` (bin/pixelslop-tools.cjs) for deterministic state management:

```bash
# Initialize a session
node bin/pixelslop-tools.cjs init scan --url $URL --root $ROOT --raw

# Create and manage the fix plan
node bin/pixelslop-tools.cjs plan begin --url $URL --root $ROOT --issues '...' --raw
node bin/pixelslop-tools.cjs plan update $ISSUE_ID fixed
node bin/pixelslop-tools.cjs plan snapshot --raw

# Checkpoint operations
node bin/pixelslop-tools.cjs checkpoint create $ISSUE_ID --files file1,file2
node bin/pixelslop-tools.cjs checkpoint revert $ISSUE_ID

# Build gate
node bin/pixelslop-tools.cjs gate run --raw
```
