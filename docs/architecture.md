# Architecture

## The split: parent owns interaction, subagents own compute

Pixelslop's biggest architectural constraint is that **subagents can't ask users questions**. Claude Code's `AskUserQuestion` tool doesn't work inside agents spawned via the Agent tool. This isn't a bug we can work around — it's a documented runtime limitation (GitHub issues [#12890](https://github.com/anthropics/claude-code/issues/12890), [#18721](https://github.com/anthropics/claude-code/issues/18721)).

So the architecture splits cleanly:

```
User  <-->  SKILL.md (parent session)  <-->  Orchestrator  <-->  Scanner/Fixer/Checker
              |                                   |
        AskUserQuestion                    runs to completion
        (interactive)                      (no user interaction)
```

**SKILL.md** handles all decisions that need user input:
- Which URL to scan (discovery flow)
- Whether to start a temp server
- Setup questions (audience, brand, off-limits)
- Fix strategy (fix everything / critical only / cherry-pick / report only)

**The orchestrator** receives a resolved URL and runs to completion:
- Scan mode: run scanner, group findings, return results
- Fix mode: read plan file, run fix/check loop, return summary

## Two-phase execution

SKILL.md spawns the orchestrator twice per full session:

### Phase 1: Scan

```
SKILL.md                    Orchestrator
   |                             |
   | -- spawn(scan) -----------> |
   |                             | --> Scanner subagent (Playwright)
   |                             | <-- scores, findings, slop classification
   | <-- scan results ---------- |
   |
   | -- AskUserQuestion -------> User: "Fix everything"
   | <-- user answer
   |
   | -- plan begin (file) -----> .pixelslop-plan.md
```

### Phase 2: Fix

```
SKILL.md                    Orchestrator
   |                             |
   | -- spawn(fix) ------------> |
   |                             | -- read plan -->  .pixelslop-plan.md
   |                             |
   |                             | for each issue:
   |                             |   checkpoint create
   |                             |   --> Fixer subagent
   |                             |   gate run
   |                             |   --> Checker subagent
   |                             |   plan update (fixed/failed/partial)
   |                             |
   | <-- fix summary ----------- |
   |
   | -- serve stop -------------> cleanup
```

The plan file is the handoff contract between phases. SKILL.md creates it (with `plan begin --force`), the orchestrator reads it. No giant JSON blobs in prompt strings.

## The agents

| Agent | Tools | What it does |
|-------|-------|-------------|
| **pixelslop** (orchestrator) | Read, Bash, Glob, Grep | Coordinates everything. No Write/Edit — all state goes through pixelslop-tools CLI |
| **pixelslop-scanner** | Read, Bash, Glob, Grep + Playwright MCP | Opens pages, captures screenshots, extracts computed styles, scores pillars, detects slop |
| **pixelslop-fixer** | Read, Write, Edit, Bash, Glob, Grep | Applies one fix per invocation. Always checkpoints first. |
| **pixelslop-checker** | Read, Bash, Glob, Grep + Playwright MCP | Re-measures the targeted metric after a fix. Returns PASS/FAIL/PARTIAL. No Write/Edit — can't change code |
| **pixelslop-setup** | Read, Bash, Glob, Grep | Explores codebase for design context (framework, CSS approach, fonts, tokens) |

The tool boundaries are security boundaries. The fixer can edit files; the checker can't. The orchestrator can't edit anything — it manages state through `pixelslop-tools`. Tests enforce these constraints.

## pixelslop-tools

Every state operation goes through a single deterministic CLI: `pixelslop-tools`. No agent writes plan files by hand, creates checkpoints with inline bash, or parses frontmatter with sed. The CLI guarantees consistent state.

See [pixelslop-tools reference](pixelslop-tools.md) for the full command list.

## Session logging

Off by default. When `--debug` is passed, two things happen:

1. **SKILL.md writes explicit log entries** at high-level flow points (discovery, server start, spawn orchestrator, fix complete)
2. **pixelslop-tools auto-logs** when commands are called with `--debug` — plan updates, checkpoint operations, gate results all append to the session log without the orchestrator needing to make separate log calls

This "piggyback" approach exists because subagents don't reliably follow logging instructions. Instead of hoping the model calls `log write`, we baked logging into the commands it already runs. If `plan update contrast-footer fixed --debug` executes, the log entry happens. Guaranteed.

## Static site detection

When no URL is provided and no dev server is found, pixelslop checks for HTML files in the project root (`discover static-site`). If found, it offers to start a zero-dependency Node HTTP server via `serve start`. The server:

- Picks a free port automatically (no conflicts)
- Uses Node's built-in `http` module (no Python, no npx serve)
- Runs as a detached process with PID tracking
- Gets cleaned up by `serve stop` after the session

State is scoped per-project under `.pixelslop/temp-server.json`, so multiple projects can run concurrent sessions without stepping on each other.

## File layout

```
.pixelslop-plan.md          # Fix plan (created by SKILL.md, read by orchestrator)
.pixelslop.md               # Design context (audience, brand, off-limits)
.pixelslop-session.log      # Debug log (only with --debug)
.pixelslop/
  checkpoints/              # File backups before each fix
  temp-server.json          # Temp server PID/port state
  screenshots/              # Scanner captures (if saved)
```

All pixelslop state lives in `.pixelslop*` files/dirs — easy to gitignore, easy to clean up.
