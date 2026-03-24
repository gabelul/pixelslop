# Changelog

## [0.2.0](https://github.com/gabelul/pixelslop/releases/tag/v0.2.0) (2026-03-24)

### Features

* **Static site support** — `discover static-site` detects HTML folders, `serve start/stop` runs a zero-dependency Node HTTP server on a free port. Plain HTML projects work without a dev server or Python.
* **Interactive discovery** — SKILL.md uses `AskUserQuestion` to confirm server selection, temp server startup, and fix strategy before the orchestrator touches anything.
* **Two-phase architecture** — scan and fix run as separate orchestrator spawns. Plan file (`.pixelslop-plan.md`) is the handoff contract between phases. No more giant JSON blobs in prompt strings.
* **`--debug` flag** — opt-in session logging to `.pixelslop-session.log`. Auto-logging piggybacks on `plan update`, `checkpoint create/revert`, `gate run`, and `init scan` so subagent activity gets traced without model cooperation.
* **`--force` on plan begin** — replaces stale plans from previous sessions instead of erroring out.
* **Per-project state scoping** — temp server PID, session log, and plan files resolve via `--root`, not global CWD. Multiple projects can run concurrent sessions.
* **docs/** — five focused docs (getting-started, troubleshooting, architecture, pixelslop-tools reference, personas). README slimmed from 183 to 76 lines.

### Bug Fixes

* Plan file created in repo root instead of project dir when `--root` pointed elsewhere
* Session log wrote to CWD instead of project root
* macOS resource fork files (`._index.html`) polluted static site detection
* Unix-only `sleep 0.1` in temp server startup replaced with cross-platform sync wait
* Stale plan from previous session blocked `plan begin` with no workaround
* Multiline log messages broke the line-based session log format

### Architecture

* Subagents confirmed unable to use `AskUserQuestion` (Claude Code issues #12890, #18721). Parent session owns all user interaction, orchestrator runs to completion.
* `SendMessage` relay pattern tested and rejected — too fragile. File-based handoff via `.pixelslop-plan.md` is reliable.
* Orchestrator split into scan-only and fix-from-plan modes based on plan file presence at startup.

### Tests

* 470 tests (was 443). New coverage: static site detection, temp server lifecycle, session logger, `--force` flag, `--debug` auto-logging, per-project state scoping.

## [0.1.0](https://github.com/gabelul/pixelslop/releases/tag/v0.1.0) (2026-03-19)

### Features

* Scanner with 5-pillar scoring and 25 AI slop patterns
* Fixer/checker fix-verify-rollback loop with checkpoints
* Orchestrator coordinating full scan→fix→verify workflow
* pixelslop-tools CLI for deterministic state management
* Installer for Claude Code and Codex CLI (`npx pixelslop install`)
* 8 built-in persona evaluation profiles
* `--thorough` mode and `--personas` flag
* Monorepo workspace detection
* 6 additional code check patterns (S11-S16)
* `update` command with backup and file diff output
