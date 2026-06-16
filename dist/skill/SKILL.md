---
name: pixelslop
description: >
  Browser-first design quality review and fix. Scans real pages with Playwright,
  scores 5 measured pillars, detects AI slop patterns, and runs a design-director
  pass for subjective judgment findings. Evaluates against 8 built-in personas
  plus project-specific ones generated from your audience, tracks score trends
  across runs, and fixes issues toward your design tokens with checkpoint-based
  rollback. Exhaustive by default (--fast for a quick pass).
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
    description: Show lower-confidence findings, tagged with confidence. Default true (exhaustive)
    required: false
  - name: deep
    description: Extended collection with doubled budgets and more elements tested. Default true (exhaustive)
    required: false
  - name: fast
    description: Quick pass — turns deep and thorough off for a faster, high-confidence-only scan
    required: false
  - name: debug
    description: Enable session logging to .pixelslop-session.log for troubleshooting
    required: false
  - name: settings
    description: Open interactive settings configurator (ignores other args)
    required: false
  - name: quick
    description: Skip run-time config, use saved settings/defaults directly
    required: false
---

## Asking the user (works in any harness)

Pixelslop runs under different harnesses (Claude Code, Codex CLI, and others), and they ask the user questions differently. Wherever this skill says to ask the user — including every `AskUserQuestion(...)` block below — present the **same question and the same options** using whatever your harness supports:

- **Claude Code:** use the `AskUserQuestion` tool with the listed options (structured, selectable).
- **Codex CLI, or any harness with no choice-prompt tool:** print the question and its options as a short numbered list, then **stop and wait** for the user to reply with a number or text. Codex has no `AskUserQuestion`-style popup (it's an open request upstream), so a plain numbered menu is the equivalent. Don't silently pick a default and continue — the point is to let the user choose.
- **Non-interactive runs** (`codex exec`, CI, or `--quick`): don't ask at all. Use the saved setting or the documented default and proceed.

The `AskUserQuestion(...)` snippets in this file are the question **content** — the exact wording and options to surface. *How* you render them is your harness's call; *what* you ask is not. If you're not on Claude Code, read each block as "ask this question, offer these options" and present it your way.

## Spawning agents (works in any harness)

Pixelslop's work is split across named agents — an orchestrator, a setup agent, an evidence collector, six measured evaluators, a design-director, a fixer, a checker. How you run a named agent depends on your harness:

- **Claude Code:** spawn it as a subagent by name (the Task/Agent tool), parallel where the runtime supports it.
- **Codex CLI:** Codex supports named subagents, but only when the agent is installed in its TOML format. If a Pixelslop agent isn't spawnable, use the inline fallback below.
- **Any harness where the named agent isn't spawnable (or that has no subagents at all):** run the agent **inline** — read its spec file (e.g. `dist/agents/internal/pixelslop-eval-hierarchy.md`, or the installed path) and follow its instructions yourself, in sequence.

So **"Spawn agent: X" everywhere in this skill means: spawn X as a subagent if you can, otherwise read X's spec and execute it inline.** The output contract is identical either way — you only lose parallelism. Never skip an agent because you can't spawn it; run it inline instead. A scan with the evaluators run inline is still a complete scan, just sequential.

## Settings Mode

When `--settings` is passed (e.g., `/pixelslop settings`), run the interactive settings configurator and stop — don't scan anything.

### Step 1: Load Current Settings

```bash
node bin/pixelslop-tools.cjs config get --root "$ROOT" --raw
```

This returns the current settings with defaults filled in. Show the user what's currently set.

### Step 2: Walk Through Preferences

Use `AskUserQuestion` to present each setting group. Pre-select the current value so the user can skip things they don't want to change.

**Browser mode:**
```
AskUserQuestion([{
  question: "Browser mode during scans?",
  options: [
    { label: "Headless", description: "Faster, no visible browser. Good for most scans." },
    { label: "Headed", description: "Watch the browser work. Useful for debugging or demos." }
  ]
}])
```
Map: "Headless" → `headed: false`, "Headed" → `headed: true`

**Collection depth:**
```
AskUserQuestion([{
  question: "How deep should the collector go?",
  options: [
    { label: "Standard", description: "Quick scan — hover 15 elements, tab 30, 8s scroll budget." },
    { label: "Deep", description: "Thorough scan — doubled budgets, more elements tested. Takes longer." }
  ]
}])
```
Map: "Standard" → `deep: false`, "Deep" → `deep: true`

**Confidence threshold:**
```
AskUserQuestion([{
  question: "Finding confidence level?",
  options: [
    { label: "Normal", description: "Show findings above 65% confidence. Fewer false positives." },
    { label: "Thorough", description: "Show findings above 50% confidence. More findings, some may be noise." }
  ]
}])
```
Map: "Normal" → `thorough: false`, "Thorough" → `thorough: true`

**Persona evaluation:**
```
AskUserQuestion([{
  question: "Which personas should evaluate the page?",
  options: [
    { label: "All 8 personas", description: "Screen reader, low vision, keyboard, mobile, slow connection, non-native English, design critic, first-time visitor." },
    { label: "None", description: "Skip persona evaluation. Faster, but misses perspective-specific issues." },
    { label: "Let me pick", description: "Choose specific personas to include." }
  ]
}])
```
Map: "All 8 personas" → `personas: all`, "None" → `personas: none`.
If "Let me pick", show a follow-up with the 8 individual persona names and let the user select. Join selected IDs with commas.

### Step 3: Save Settings

Write all settings at once:

```bash
node bin/pixelslop-tools.cjs config set-all \
  --headed "$HEADED" \
  --deep "$DEEP" \
  --thorough "$THOROUGH" \
  --personas "$PERSONAS" \
  --root "$ROOT" \
  --raw
```

### Step 4: Confirm

Show the user a summary of what was saved:

| Setting | Value |
|---------|-------|
| Browser mode | Headless / Headed |
| Collection depth | Standard / Deep |
| Confidence | Normal / Thorough |
| Personas | all / none / specific list |

Tell them: "These settings apply to all future `/pixelslop` runs in this project. Override any setting with a CLI flag (e.g., `/pixelslop --thorough`)."

**After settings mode completes, stop. Don't continue to the scan workflow.**

---

## Capabilities & Options (the full menu)

Everything Pixelslop can do, in one place. Read this so you can tell the user what's available — most people (and most agents) don't know half of it. When a scan finishes, mention the one or two options that fit their situation.

**What a scan produces:**
- **5 measured pillars** (hierarchy, typography, color, responsiveness, accessibility), scored /20 from real browser evidence.
- **AI slop detection** — 25 visual patterns + source patterns.
- **Design-director judgment** — a subjective pass that looks at the screenshots and flags what measurement can't (generic composition, AI-generated feel, missed opportunities). Shown in a separate "Design judgment" layer; never affects the /20.
- **Persona evaluation** — 8 built-in personas, plus 1-2 project-specific personas generated from your audience/brand.
- **Score trends** — each run's score is recorded; repeat scans show movement (`scan trend`).
- **Self-contained HTML report** with screenshots and the measured/judgment split.

**Run options (flags):**
- `--fast` — quick pass; turns off deep + thorough (Pixelslop is exhaustive by default).
- `--thorough` / `--deep` — both default **on**; `--fast` is the opt-out.
- `--personas all|none|<ids>` — which personas to evaluate (default all).
- `--code-check` — source-only analysis, no browser.
- `--quick` — skip the per-run config prompt, use saved settings/defaults.
- `--headed` — visible browser window.
- `--settings` — open the interactive settings configurator.
- `--debug` — session logging for troubleshooting.

**Beyond scanning:**
- **Fix loop** — locates the source, fixes *toward your design tokens*, checkpoints before editing, rolls back if the build breaks.
- **Design tokens** — `config read-tokens` / `write-tokens` hold your real palette/type/spacing so fixes match the project.
- **Custom personas** — `personas write` adds your own; the orchestrator also generates project-specific ones automatically.
- **Settings** — `/pixelslop settings` saves preferences per project so you don't pass flags every run.

If a scan was slow, mention `--fast`. If the user has a clear audience, project personas are already working for them. If they've scanned before, point at the trend. Surface what's relevant; don't dump the whole list every time.

## Advise, don't interrogate (read this before asking the user anything)

You are an advisor, not a config form. Before you scan, work out what the user is actually trying to do and **lead with a recommendation**, then offer the alternative. Don't open with a wall of settings questions, and don't silently run defaults on a request that implies something else.

Infer intent from how they asked, then match it:

| What they said / the situation | Recommend | Why |
|--------------------------------|-----------|-----|
| "quick look", "does this look ok", a glance | **`--fast`** | high-confidence findings only, ~10s — respects "quick" |
| "review", "before launch", "audit", or unspecified | **the default** (exhaustive: 5 pillars + design-director + personas) | catches the soft stuff, not just what's measurable |
| First scan of this project (no `.pixelslop.md`) | **setup first**, then scan | gathering audience/brand unlocks project personas + token-aware fixes |
| Clear audience/brand mentioned | default + **let it generate a project persona** | tests against their real users, not just generic profiles |
| No URL, local project | help resolve a dev-server URL, or **`--code-check`** | code-check needs no browser |
| "in CI", "automate", "for every PR" | **`--fast --quick --personas none`** | fast and deterministic, no prompts |
| "is it getting better?", iterating | scan, then **`scan trend`** | shows the /20 climbing across runs |
| Wants fixes, not just a report | scan → **fix loop** → re-scan | fixes move toward their tokens; the trend confirms it |

How to actually advise:
1. **State your recommendation and the one tradeoff**, in a sentence. "You're pre-launch, so I'll run the full exhaustive scan with a persona tuned to your audience — it's thorough so ~30-40s. Want a fast gut-check instead?"
2. **Only ask when there's a real fork.** If the intent is clear, recommend and proceed. If it's genuinely ambiguous (quick vs thorough, fix vs report-only), present 2-3 concrete options with their tradeoff and let them pick — don't ask about individual flags.
3. **Never** present the raw settings questions (personas? deep? thorough?) as the opening move. Those are for `/pixelslop settings`, not for advising a scan. Translate intent into the flags yourself.

The point: the user shouldn't need to know the flags exist. You know them. Recommend the right run, explain it in one line, and let them redirect.

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

## Code-Check Mode

When the user passes `--code-check`, the workflow is shorter — no URL, no browser, no server.

### Code-Check Phase 1: Pre-flight

Run init with the code-check flag (no URL needed):

```bash
node bin/pixelslop-tools.cjs init scan --code-check --root "$ROOT" --raw
```

Validate that root is a valid directory. If not, tell the user and stop.

### Code-Check Phase 2: Scan

Spawn the orchestrator in code-check mode:

```
Agent(
  name: "pixelslop-scan",
  prompt: "Run pixelslop code check. Root: <root>. Code-check: true. Thorough: <thorough>."
)
```

The orchestrator spawns the code-check scanner (not the visual scanner). No Playwright needed.

### Code-Check Phase 3: Results

Present the code check report to the user. Code check is report-only — no fix strategy question, no fix loop. Tell the user they can run a full visual scan (`/pixelslop [url]`) for pillar scores and browser-verified findings.

No cleanup needed (no server was started).

**If `--code-check` was passed, use the code-check flow above and skip everything below.**

---

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

### Install self-check (do this first)

Before anything else, confirm the pixelslop install is healthy and current:

```bash
node bin/pixelslop-tools.cjs doctor --raw
```

- **If this command fails to run** (command not found, file missing, non-zero exit) the install is broken or incomplete — almost always a stale or partial install. Stop and tell the user: *"Your pixelslop install looks broken or incomplete. Run `npx pixelslop@latest update`, then try again."* Don't attempt the scan.
- **If it returns `"stale": true`** a newer version is published. Tell the user once: *"A newer pixelslop is available — run `npx pixelslop@latest update` for the latest fixes. Continuing with the installed version."* Then proceed (don't block).
- **If it returns `"status": "ok"`** proceed silently.

This is what makes a stale or broken install self-diagnose instead of failing opaquely mid-scan. `doctor` only checks the network once per day (cached), so it's cheap to run every time.

### Validate the environment

Run init to validate the environment:

```bash
node bin/pixelslop-tools.cjs init scan --url "$URL" --root "$ROOT" --raw
```

Parse the JSON result immediately. Do **not** start the expensive scan until you handle any required preflight decision.

### Git Readiness Gate

If the init result says all of the following:

- `mode: "visual-report-only"`
- `url_type: "local"`
- `root_valid: true`
- `preflight_action_required: true`

stop and ask the user **before any scan or browser analyze-page call**.

If `report_only_reason` is `missing-git`, ask:

```text
AskUserQuestion([{
  question: "This project is not ready for editable mode yet, so running now would only generate a report. How do you want to proceed?",
  options: [
    { label: "Use no-git mode (Recommended)", description: "Keep rollback via file backups and continue without git setup." },
    { label: "Report only", description: "Skip fix mode and just generate the scan report." },
    { label: "Stop and set up git first", description: "Exit now so I can initialize git and make a baseline commit." }
  ]
}])
```

Handle the answer like this:

- **Use no-git mode**: re-run init with `--allow-no-git`, then continue.
- **Report only**: continue in report-only mode.
- **Stop and set up git first**: stop. Tell the user git-backed editable mode needs `git init` followed by a baseline commit before rerunning `/pixelslop`.

If `report_only_reason` is `missing-git-baseline`, ask:

```text
AskUserQuestion([{
  question: "This repo exists, but it has no baseline commit yet. Pixelslop checkpoints need tracked files. How do you want to proceed?",
  options: [
    { label: "Use no-git mode (Recommended)", description: "Keep rollback via file backups and continue without creating a git commit." },
    { label: "Report only", description: "Skip fix mode and just generate the scan report." },
    { label: "Stop and make a baseline commit first", description: "Exit now so I can commit the current project state before rerunning." }
  ]
}])
```

Handle that answer like this:

- **Use no-git mode**: re-run init with `--allow-no-git`, then continue.
- **Report only**: continue in report-only mode.
- **Stop and make a baseline commit first**: stop. Tell the user to run `git add -A && git commit -m "chore: baseline"` before rerunning `/pixelslop`.

This gate exists to avoid wasting tokens on a long scan when the user really wanted editable mode. Do not imply that `git init` alone unlocks checkpoints.

### Load Project Settings

Before doing anything else, load the project settings and merge with CLI args:

```bash
node bin/pixelslop-tools.cjs config get --root "$ROOT" --raw
```

This returns `{ settings: { headed, deep, thorough, personas }, defined: [...] }`. Merge with CLI args — **CLI args always win** over saved settings, saved settings win over defaults:

- If user passed `--thorough`, use that regardless of saved settings
- If user didn't pass `--thorough` but settings has `thorough: true`, use that
- If neither, use the default (`false`)

Store the merged values as the effective settings for this session. Use them when spawning the orchestrator and collector.

### Check Cached Context

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

## Phase 2b: Configure This Run

A lightweight pre-scan step that lets the user tweak settings for this specific run. Not a full settings rewrite — just quick adjustments.

### Settings precedence (highest to lowest)

| Priority | Source | Scope |
|----------|--------|-------|
| 1 | CLI flags | This run only — e.g., `--personas none --thorough` |
| 2 | Per-run answers | This run only — user picks in Phase 2b |
| 3 | Saved settings | All runs — from `.pixelslop.md` |
| 4 | Defaults | Fallback — exhaustive by default: `personas: all`, `thorough: true`, `deep: true` |

**Exhaustive by default.** Pixelslop is usually driven by an AI agent that won't remember to pass `--thorough` or `--deep`, so those default to **on**. `thorough: true` shows lower-confidence findings tagged with their confidence rather than hiding them; `deep: true` doubles collection budgets for more evidence (at the cost of a slower scan). The opt-out is **`--fast`**: when the user passes `--fast`, set `thorough: false` and `deep: false` for that run (a quick, high-confidence-only pass). `--fast` is a CLI flag, so it wins over saved settings for this run, same as any other flag.

### Skip conditions

Skip Phase 2b entirely (go straight to Phase 3) if ANY of these are true:
- `--quick` flag was passed
- All 4 configurable settings (`--personas`, `--thorough`, `--deep`, `--headed`) were provided via CLI flags — nothing left to ask
- The missing-git gate above is still unresolved — do not run `browser analyze-page` until the user chooses no-git, git init, or report-only

### Flow

**Step 1: Determine locked vs unlocked settings.**

A setting is "locked" if the user provided it via CLI flag. Locked settings are not re-asked.

Example: `/pixelslop --thorough --personas none` → thorough and personas are locked; deep and headed are unlocked.

**Step 2: Smart persona analysis (if personas unlocked).**

If the `--personas` flag was NOT provided via CLI, run a quick page-type analysis to suggest relevant personas:

```bash
node bin/pixelslop-tools.cjs browser analyze-page --url "$URL" --raw
```

This returns `{ type, signals, suggestedPersonas: { ids, names } }`. Fast (< 2s, no screenshots). If it fails, fall back to `type: "general"`.

**Step 3: Show effective settings and ask.**

```
AskUserQuestion([{
  question: "Ready to scan [URL] (detected: [page type]). Current settings: [list effective settings, mark locked ones]. Configure this run?",
  options: [
    { label: "Go", description: "Run with these settings" },
    { label: "Adjust", description: "Change the [N] unlocked settings for this run" }
  ]
}])
```

If "Go" → proceed to Phase 3 with current merged settings.

**Step 4: Ask only unlocked settings.**

If "Adjust" → present `AskUserQuestion` for each unlocked setting. For the persona question, include the smart pick option based on page-type analysis:

```
AskUserQuestion([{
  question: "This looks like a [page type]. Which personas?",
  options: [
    { label: "Smart pick ([N])", description: "[humanNames] — best for [page type] pages" },
    { label: "All 8 personas", description: "Full evaluation from every perspective" },
    { label: "None", description: "Skip persona evaluation" },
    { label: "Let me pick", description: "Choose specific personas" }
  ]
}])
```

Reuse the same question format from Settings Mode for other settings (browser mode, collection depth, confidence threshold). Skip any setting that's already locked by CLI.

**Step 5: Offer to save.**

```
AskUserQuestion([{
  question: "Save these as your project defaults?",
  options: [
    { label: "No, just this run", description: "Settings apply only to this scan" },
    { label: "Yes, save to .pixelslop.md", description: "Use these for all future scans too" }
  ]
}])
```

If "Yes" → call `config set-all` with the adjusted values. If "No" → use the settings ephemerally for this scan only (don't write to `.pixelslop.md`).

### Relationship to --settings mode

`--settings` is a standalone persistent configurator — it writes to `.pixelslop.md` and exits, no scan. Phase 2b is an ephemeral per-run config that defaults to not saving. They don't interfere with each other.

---

## Phase 3: Scan

Spawn the orchestrator to scan the page. Use the effective settings from Phase 2/2b:

```
Agent(
  name: "pixelslop-scan",
  prompt: "Run pixelslop scan. URL: <url>. Root: <root>. Personas: <personas>. Thorough: <thorough>. Deep: <deep>. Headed: <headed>."
)
```

Add design context only if it was collected: `Design context: audience=<...>, brand=<...>, off-limits=<...>`

The orchestrator scans the page, groups findings, and returns results. This takes 2-4 minutes.

The orchestrator also attempts a best-effort HTML export after scan results are assembled. Treat the `report generate --raw` result as JSON, not prose. On success, it returns a report path under `.pixelslop/reports/`. Surface the exact returned path to the user with `Report saved: <actual path>`. Do not just say the report was saved. If export fails, the scan still succeeds, but say `Report not generated: <error>` so the user knows there is no artifact to open.

When the orchestrator returns, present the scan results to the user. Include the HTML report path when present. If the mode is `visual-editable`, use `AskUserQuestion` to ask the fix strategy:

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
When you relay that summary to the user, include exactly one explicit report outcome line:

- `Report saved: <actual path returned by report generate>`
- `Report not generated: <error>`

Never say the report exists without the concrete path, and do not invent a placeholder filename.

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
| `pixelslop-scanner` | Compatibility wrapper around `pixelslop-tools browser collect` |
| `pixelslop-fixer` | Applies one targeted fix per finding with checkpoint |
| `pixelslop-checker` | Verifies fixes by re-measuring the targeted metric |
| `pixelslop-setup` | Explores codebase to build project design context |
| `pixelslop-code-scanner` | Source-only analysis — greps for slop, a11y, copy, missing states (code-check mode) |

## Resources

Knowledge files loaded by agents at runtime:

- `resources/scoring.md` — 5-pillar grading rubric (1-4 per pillar, /20 total)
- `resources/visual-eval.md` — direct browser collector manual (viewports, JS snippets)
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
- `resources/code-check-eval.md` — code-check evaluation protocol (source-only analysis)
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

# Project settings (interactive configurator writes these)
node bin/pixelslop-tools.cjs config get --root $ROOT --raw
node bin/pixelslop-tools.cjs config set headed true --root $ROOT --raw
node bin/pixelslop-tools.cjs config set-all --headed true --deep false --thorough false --personas all --root $ROOT --raw

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
