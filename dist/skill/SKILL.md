---
name: pixelslop
description: >
  Browser-first design quality review and fix. Scans pages with Playwright,
  scores 5 design pillars, detects AI slop patterns, fixes issues with
  checkpoint-based rollback.
user-invokable: true
args:
  - name: url
    description: URL to evaluate (optional; if omitted, pixelslop guides discovery)
    required: false
  - name: root
    description: Path to project source (optional; defaults to current directory)
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
  - name: debug
    description: Enable session logging to .pixelslop-session.log for troubleshooting
    required: false
---

## How This Works

You (the main session) handle all user-facing decisions **before** spawning the orchestrator. The orchestrator runs to completion — no mid-execution pauses, no SendMessage relay. This keeps things reliable.

**Your job:** resolve the URL, ask setup questions, then hand everything to the orchestrator.
**Orchestrator's job:** scan, group findings, run fix loop, return results.

## Debug Logging

Session logging is **off by default**. When the user passes `--debug` (e.g., `/pixelslop --debug` or `/pixelslop http://localhost:3000 --debug`), enable it by adding `--debug` to every `pixelslop-tools` command you run during this session. This activates auto-logging inside the orchestrator commands (plan update, checkpoint, gate) without any extra effort.

When debug is active, clear the log first, then log key skill-level events:

```bash
# Clear previous session log
node bin/pixelslop-tools.cjs log clear --root "$ROOT"

# Log at each phase (only when --debug is active)
node bin/pixelslop-tools.cjs log write --root "$ROOT" --agent skill --level info --message "Session started, debug=true"
node bin/pixelslop-tools.cjs log write --root "$ROOT" --agent skill --level info --message "Discovery: static site detected"
node bin/pixelslop-tools.cjs log write --root "$ROOT" --agent skill --level info --message "Spawning orchestrator for scan"
node bin/pixelslop-tools.cjs log write --root "$ROOT" --agent skill --level info --message "Scan complete: $TOTAL/20, $N issues"
node bin/pixelslop-tools.cjs log write --root "$ROOT" --agent skill --level info --message "Spawning orchestrator for fix loop"
node bin/pixelslop-tools.cjs log write --root "$ROOT" --agent skill --level info --message "Fix loop complete"
```

The orchestrator's `plan update`, `checkpoint create/revert`, `gate run`, and `init scan` commands auto-log when `--debug` is passed. No separate log calls needed for those.

After the session, the user reads the log with:

```bash
node bin/pixelslop-tools.cjs log read --root "$ROOT"
# or just the last 20 entries:
node bin/pixelslop-tools.cjs log read --root "$ROOT" --tail 20
```

If the user didn't pass `--debug`, skip all logging commands — don't create any log file.

## Phase 1: Resolve the URL (only when no URL argument provided)

If the user passed a URL, skip to Phase 2.

Otherwise, run discovery to figure out what to scan:

```bash
# Check for running local servers
node bin/pixelslop-tools.cjs discover server --root "$ROOT" --raw

# Check for dev server start targets (package.json scripts)
node bin/pixelslop-tools.cjs discover start-target --root "$ROOT" --raw

# Check for static HTML files (no package.json)
node bin/pixelslop-tools.cjs discover static-site --root "$ROOT" --raw
```

Based on the results, use `AskUserQuestion` to confirm what to scan:

- **Running repo-matched server found:** Ask "Found a running server at <url> from this repo. Scan that?" → Options: "Yes, scan it" / "Use a different URL"
- **Start target found (no servers running):** Ask "No server running. Start <command>?" → Options: "Yes, start it" / "I'll provide a URL"
- **Static site detected (`is_static: true`):** Ask "This looks like a static site with <entry_points>. Start a temp server to scan it?" → Options: "Serve and scan (Recommended)" / "I'll provide a URL"
- **Nothing found:** Ask "No servers, start targets, or HTML files found. What URL should I scan?" → user types a URL via "Other"

If the user confirms serving a static site, start the temp server:

```bash
node bin/pixelslop-tools.cjs serve start --root "$ROOT" --raw
```

Parse the returned JSON for the `url` field. **Remember to stop this server after the orchestrator finishes** (Phase 4).

If the user confirms starting a dev server, run the detected start command and wait for it to be ready.

## Phase 2: Pre-flight Check

Run init to validate the environment:

```bash
node bin/pixelslop-tools.cjs init scan --url "$URL" --root "$ROOT" --raw
```

Check for cached technical context from a previous run:

```bash
node bin/pixelslop-tools.cjs config load-context --root "$ROOT" --raw
```

If `exists: true` and `stale: false`, pass the cached context to the orchestrator — this skips the setup agent and saves 30-60 seconds. If `stale: true` (older than 7 days), let the orchestrator re-run setup to refresh. If `exists: false`, the cache is missing, malformed, or has a version mismatch — the orchestrator will run setup normally.

The cached context covers technical detection only (framework, CSS approach, fonts, tokens) — it doesn't replace `.pixelslop.md` design intent.

If the init result shows `pixelslop_config` is null (no `.pixelslop.md`), optionally ask the user quick setup questions via `AskUserQuestion`:

- Target audience
- Brand personality
- Off-limits elements (things not to change)

These are optional — if the user wants to skip, proceed without them.

## Phase 3: Scan

Spawn the orchestrator to scan the page. Keep the prompt short — just the essential parameters:

```
Agent(
  name: "pixelslop-scan",
  prompt: "Run pixelslop scan. URL: <url>. Root: <root>. Personas: <personas>. Thorough: <thorough>."
)
```

Add design context only if it was collected: `Design context: audience=<...>, brand=<...>, off-limits=<...>`

The orchestrator scans the page, groups findings, and returns results. This takes 2-4 minutes.

When the orchestrator returns, present the scan results to the user. If the mode is `visual-editable`, use `AskUserQuestion` to ask the fix strategy:

- "Fix everything" — all issues by category
- "Critical only" — P0 + P1 issues only
- "Cherry-pick" — user picks specific issues
- "Report only" — save the report, don't fix

## Phase 3b: Fix (only if the user chose to fix)

Before spawning the fix phase, create the plan file using the scan results. Run this yourself (not the orchestrator):

```bash
node bin/pixelslop-tools.cjs plan begin \
  --url "$URL" \
  --root "$ROOT" \
  --mode "$MODE" \
  --issues '$ISSUES_JSON' \
  --force \
  --raw
```

The `--force` flag replaces any stale plan from a previous session.

Build `ISSUES_JSON` from the scan results — an array of `{id, priority, category, description}` objects. Filter based on the user's strategy choice:
- "Fix everything" — include all issues
- "Critical only" — include only P0 and P1
- "Cherry-pick" — include only the issues the user selected

Then spawn the orchestrator for fixes. The prompt stays short because the plan file has all the details:

```
Agent(
  name: "pixelslop-fix",
  prompt: "Run pixelslop fix loop. A plan file exists at .pixelslop-plan.md with the issues to fix. URL: <url>. Root: <root>."
)
```

The orchestrator reads the plan file, processes each issue (checkpoint → fix → verify), and returns a summary.

## Phase 4: Cleanup

After the orchestrator finishes (whether scan-only or after fixes):

```bash
# Stop temp server if one was started in Phase 1
node bin/pixelslop-tools.cjs serve stop --root "$ROOT" --raw
```

This is a safe no-op if no server was started.

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
- `resources/interaction-design.md` — fix guide: interactive states, dropdowns, forms, modals
- `resources/cognitive-load.md` — cognitive load checklist (supplements hierarchy evaluation)
- `resources/heuristics.md` — Nielsen's 10 heuristics adapted for browser measurement
- `resources/personas/schema.md` — persona format documentation
- `resources/personas/*.json` — 8 built-in persona evaluation profiles

## Tools

The orchestrator and agents use `pixelslop-tools` for deterministic state management:

```bash
# Discovery (run by SKILL.md before spawning orchestrator)
node bin/pixelslop-tools.cjs discover server --root $ROOT --raw
node bin/pixelslop-tools.cjs discover start-target --root $ROOT --raw
node bin/pixelslop-tools.cjs discover static-site --root $ROOT --raw

# Temp server (run by SKILL.md)
node bin/pixelslop-tools.cjs serve start --root $ROOT --raw
node bin/pixelslop-tools.cjs serve stop --root $ROOT --raw

# Session init
node bin/pixelslop-tools.cjs init scan --url $URL --root $ROOT --raw

# Context caching (skip setup on repeat runs)
node bin/pixelslop-tools.cjs config save-context --root $ROOT --framework "..." --raw
node bin/pixelslop-tools.cjs config load-context --root $ROOT --raw

# Fix plan management (orchestrator)
node bin/pixelslop-tools.cjs plan begin --url $URL --root $ROOT --issues '...' --force --raw
node bin/pixelslop-tools.cjs plan update $ISSUE_ID fixed
node bin/pixelslop-tools.cjs plan snapshot --raw

# Checkpoint operations (fixer/checker)
node bin/pixelslop-tools.cjs checkpoint create $ISSUE_ID --files file1,file2
node bin/pixelslop-tools.cjs checkpoint revert $ISSUE_ID

# Build gate
node bin/pixelslop-tools.cjs gate run --raw
```
