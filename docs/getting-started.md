# Getting Started

## Install

```bash
npx pixelslop install
```

That's it. Install is interactive by default: it detects Claude Code and Codex CLI, lets you pick which runtimes to wire up, then copies agent specs, installs skill files, and verifies the direct browser runtime.

**You need [Claude Code](https://docs.anthropic.com/en/docs/claude-code) or [Codex CLI](https://github.com/openai/codex) already installed.** Pixelslop plugs into your existing runtime — it doesn't bundle one.

### Options

```bash
npx pixelslop install                      # interactive: pick scope + runtimes
npx pixelslop install --global             # global install for current user
npx pixelslop install --project            # project install (.claude/, .codex/)
npx pixelslop install --claude-only        # install Claude Code only
npx pixelslop install --codex-only         # install Codex CLI only
npx pixelslop install --all                # install every detected runtime
npx pixelslop install --project --all      # project-scoped Claude + Codex
npx pixelslop install --copy               # force copy mode (portable for teams/CI)
```

Project installs now use runtime-native paths:

- Claude Code: `.claude/`
- Codex CLI: `.codex/`

### Lifecycle

```bash
npx pixelslop@latest update    # upgrade with backup + diff
npx pixelslop doctor           # verify installation health
npx pixelslop uninstall        # remove pixelslop from every installed runtime
npx pixelslop status           # show scope, install root, and all installed runtimes
```

`update`, `status`, and `uninstall` work across the full installed set. If you installed both Claude and Codex, those commands report and clean up both.

## Your first scan

Start your dev server, then:

```
/pixelslop http://localhost:3000
```

Or skip the URL and let pixelslop figure it out:

```
/pixelslop
```

It'll look for running local servers, check if any belong to this repo, and ask before touching anything. Got a plain HTML folder with no dev server? It detects that too and offers to spin up a temp server on a free port.

## What happens next

1. Opens your page in Playwright at 3 viewports (1440, 768, 375px)
2. Screenshots, computed styles, contrast ratios, a11y tree — all measured from the real render
3. Scores 5 pillars: Hierarchy, Typography, Color, Responsiveness, Accessibility (each 1-4, total /20)
4. Checks 25 known AI slop patterns
5. Evaluates from named user personas (Sam, Alex, Casey, Quinn, etc.)
6. Generates a self-contained HTML report with tabbed sections
7. Groups findings, assigns priorities (P0/P1/P2)
8. Asks you what to fix — everything, critical only, cherry-pick, or just the report
9. Runs the fix loop: checkpoint → fix → build gate → verify → pass/fail/rollback
10. Final report with before/after score comparison

## Git and fixing

**Scanning works without git.** You can scan any page and get a full report with scores, personas, and findings — no git setup needed.

**Fixing works best with git.** The fix loop creates checkpoints before editing your files so it can roll back if something breaks. By default, this uses git to validate that files are tracked and clean before touching them.

**No git? No problem.** If your project isn't in a git repo, pixelslop will ask whether you want to:
- **Use no-git mode** — fixes still work, using file-based backups instead of git tracking. You get the same checkpoint/rollback safety, just without git history integration.
- **Report only** — scan and report without fixing anything.
- **Set up git first** — go initialize a repo, then come back.

The no-git mode is solid for prototypes, static sites, or projects that haven't been committed yet. For production codebases, git mode gives you the extra safety of tracked-file validation and `git checkout` as a fallback rollback.

The whole thing takes 2-5 minutes for a scan, plus 1-2 minutes per fix.

## Flags

| Flag | What it does |
|------|-------------|
| `--root ./path` | Project source lives somewhere else (default: current dir) |
| `--personas none` | Skip persona evaluation |
| `--personas screen-reader-user,design-critic` | Pick specific personas |
| `--thorough` | Lower confidence threshold, show borderline findings |
| `--quick` | Skip the per-run config step, use saved settings/defaults |
| `--code-check` | Source analysis only, no browser |
| `--debug` | Write session log for troubleshooting (see [troubleshooting](troubleshooting.md)) |

## Static HTML sites

No package.json? No dev server? No problem. If pixelslop finds `.html` files in your project root, it offers to start a zero-dependency Node HTTP server on a free port. It uses Node's built-in `http` module — no Python, no `npx serve`, no extra installs. The server stops automatically when the session ends.

## Next steps

- [Troubleshooting](troubleshooting.md) — `--debug` flag, session logs, common issues
- [Architecture](architecture.md) — how the agents work together
- [pixelslop-tools reference](pixelslop-tools.md) — full CLI for state management
- [Personas](personas.md) — built-in personas and custom persona creation
