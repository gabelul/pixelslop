# pixelslop-tools CLI Reference

Deterministic CLI for all agent state management. Plan files, checkpoints, build gates, discovery, config, temp servers, session logging. Agents call this instead of writing inline bash.

## Global flags

| Flag | What it does |
|------|-------------|
| `--raw` | JSON output (for agent consumption) |
| `--cwd <path>` | Override working directory (where pixelslop-tools itself runs) |
| `--root <path>` | Project root (where plan files, logs, and state go) |
| `--debug` | Enable auto-logging to `.pixelslop-session.log` |

`--root` and `--cwd` are different. `--cwd` changes where the CLI process runs. `--root` identifies the project being analyzed — plan files, logs, and config go there. Most of the time you only need `--root`.

## discover

Find what to scan when no URL was provided.

```bash
# Running local servers on common dev ports
pixelslop-tools discover server --root . --raw

# Package.json dev scripts in the repo
pixelslop-tools discover start-target --root . --raw

# Static HTML sites (no package.json, just .html files)
pixelslop-tools discover static-site --root . --raw
```

`discover server` probes ports 3000-3010, 4200, 5173, 5174, 8000, 8080, 8888 by default. Override with `--ports 3000,4000,9090`.

`discover static-site` skips folders with a `package.json` that has `dev`, `start`, or `serve` scripts — those should use `start-target` instead. It also ignores dotfiles and macOS resource forks (`._*` files).

## serve

Zero-dependency temp server for static HTML sites.

```bash
# Start on a free port (OS picks it)
pixelslop-tools serve start --root ./my-site --raw

# Start on a specific port
pixelslop-tools serve start --root ./my-site --port 8080 --raw

# Stop
pixelslop-tools serve stop --root ./my-site --raw
```

Uses Node's built-in `http` module. No Python, no `npx serve`, no npm installs. The server runs as a detached process — the CLI returns immediately with the URL and PID. State is tracked per-project in `.pixelslop/temp-server.json`.

`serve stop` is a safe no-op if no server is running.

## init

Load session context in one call (saves 5-6 round trips).

```bash
pixelslop-tools init scan --url http://localhost:3000 --root . --raw
```

Returns: mode (`visual-editable`/`visual-report-only`/`code-check`), root validation, gate command, existing plan, monorepo detection, config state, and detected apps.

## plan

Manage the fix plan file (`.pixelslop-plan.md`).

```bash
# Create a new plan (--force replaces existing)
pixelslop-tools plan begin --url http://localhost:3000 --root . --issues '[...]' --force --raw

# Update one issue's status
pixelslop-tools plan update contrast-cta fixed
pixelslop-tools plan update touch-targets in-progress

# Batch update multiple issues
pixelslop-tools plan patch --contrast-cta fixed --touch-targets partial

# Read a plan field
pixelslop-tools plan get mode
pixelslop-tools plan get issues

# Advance to next pending issue
pixelslop-tools plan advance

# Full plan state as JSON
pixelslop-tools plan snapshot --raw
pixelslop-tools plan json --raw
```

Valid statuses: `pending`, `in-progress`, `fixed`, `failed`, `partial`, `skipped`.

Issues JSON format for `--issues`:

```json
[
  {"id": "contrast-cta", "priority": "P0", "category": "accessibility", "description": "CTA contrast 2.28:1"},
  {"id": "touch-targets", "priority": "P1", "category": "responsiveness", "description": "19 elements below 44px"}
]
```

## checkpoint

File-backup checkpoints for safe rollback.

```bash
# Create checkpoint before editing
pixelslop-tools checkpoint create contrast-cta --files index.html,src/style.css

# Revert to pre-edit state
pixelslop-tools checkpoint revert contrast-cta

# Verify checkpoint integrity
pixelslop-tools checkpoint verify contrast-cta

# List all checkpoints
pixelslop-tools checkpoint list
```

Checkpoints save a copy of each file before the fixer touches it. If the checker says FAIL, it restores the originals. Git-tracked files only — pixelslop won't checkpoint untracked files.

## gate

Build gate — runs the project's build command and reports pass/fail.

```bash
# Auto-detect and run build command
pixelslop-tools gate run --raw

# Explicit build command
pixelslop-tools gate run --build-cmd "npm run build" --raw

# Set baseline in plan
pixelslop-tools gate baseline --raw
```

Auto-detection checks `package.json` for `build` script and picks the right package manager (npm/yarn/pnpm/bun). If no build script exists, the gate is skipped (always passes).

## config

Project design context (`.pixelslop.md`).

```bash
# Write config
pixelslop-tools config write --audience "upscale diners" --brand "warm Italian" --off-limits "don't touch the fonts"

# Read config
pixelslop-tools config read --raw

# Check if config exists
pixelslop-tools config exists --raw
```

## log

Session logging (only active with `--debug`).

```bash
# Write an entry (explicit — used by SKILL.md)
pixelslop-tools log write --agent skill --level info --message "Session started"

# Read the log
pixelslop-tools log read --root .
pixelslop-tools log read --root . --tail 20

# Clear the log
pixelslop-tools log clear --root .
```

Levels: `info` (●), `warn` (▲), `error` (✖), `debug` (○).

Auto-logging (fires when `--debug` is on the command): `plan begin`, `plan update`, `checkpoint create`, `checkpoint revert`, `gate run`, and `init scan` all auto-append entries. No separate `log write` call needed.

## verify

Post-session integrity checks.

```bash
pixelslop-tools verify plan          # plan file structure
pixelslop-tools verify session       # all issues resolved?
pixelslop-tools verify screenshots   # screenshot dir exists
pixelslop-tools verify checkpoints   # checkpoint integrity
```
