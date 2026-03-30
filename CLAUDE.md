# Pixelslop — Project Conventions

## What This Is

Pixelslop is a browser-first design quality reviewer. It opens real pages in Playwright, captures screenshots and computed styles, scores design quality on 5 measurable pillars, and detects AI slop patterns. Browser evidence is the source of truth — no guessing from code.

## Current Phase

Phase 5 is complete — updates and distribution. See `dev_docs/MASTER-PLAN.md` for the full roadmap.

**What works now:**
- **Installer** — `npx pixelslop install` is interactive by default. It detects Claude Code and Codex CLI, lets the user pick runtimes and scope, supports project-local Codex installs in `.codex/`, rewrites paths, configures MCP, and installs skills via symlink or copy. `npx pixelslop@latest update` upgrades the installed runtime set with backup + diff.
- **CI/CD** — GitHub Actions for CI (Node 18/20/22) and automated releases via release-please + npm publish with OIDC provenance.
- **Orchestrator** — coordinates the full scan→fix→verify workflow. Spawns subagents, manages user interaction, groups findings by category, handles PARTIAL results. Supports `--personas` and `--thorough` flags.
- **Scanner** — evaluates pages across 3 viewports, scores 5 pillars, detects 25 slop patterns, runs persona evaluation from 8 user perspectives. Tested on 7 pages, scores stable within ±1.
- **Persona evaluation** — 8 built-in personas (screen-reader-user, low-vision-user, keyboard-user, rushed-mobile-user, slow-connection-user, non-native-english, design-critic, first-time-visitor). Extensible JSON format supports custom personas.
- **Fixer** — takes a scanner finding, locates the source code, creates a checkpoint via `pixelslop-tools`, applies the smallest viable fix.
- **Checker** — re-measures the targeted metric after a fix, compares before/after, returns PASS/FAIL/PARTIAL. Updates plan via `pixelslop-tools`.
- **Setup** — explores codebase for design context (framework, CSS approach, fonts, tokens), returns structured findings + questions.
- **pixelslop-tools** — deterministic CLI for all state management (plan, checkpoints, gates, config, init, verify). Agents call this instead of inline bash. Supports monorepo workspace detection.
- **Checkpoint protocol** — file-backup-based fix/verify/rollback mechanism. Both fixer and checker use `pixelslop-tools checkpoint *`.

## File Layout

```
bin/                               # CLI tools
├── pixelslop.mjs                     # Installer CLI (install/update/uninstall/doctor/status)
├── pixelslop-tools.cjs               # Agent state management CLI (plan/checkpoint/gate/config/init/verify)
dist/                              # Package content (tracked in git)
├── agents/
│   ├── pixelslop.md                  # Orchestrator — coordinates full workflow
│   ├── pixelslop-scanner.md          # Scanner agent — evaluates pages
│   ├── pixelslop-fixer.md            # Fixer agent — applies one fix per finding
│   ├── pixelslop-checker.md          # Checker agent — verifies fixes
│   └── pixelslop-setup.md            # Setup agent — builds project design context
└── skill/
    ├── SKILL.md                   # Skill entry point (/pixelslop command)
    └── resources/                 # Knowledge files agents read at runtime
        ├── ai-slop-patterns.md    # 25 visual patterns + detection JS
        ├── scoring.md             # 5-pillar rubric + report format contract
        ├── visual-eval.md         # Playwright protocol + JS snippets
        ├── checkpoint-protocol.md # Fix/verify/rollback mechanism
        ├── plan-format.md         # Plan file contract (.pixelslop-plan.md format)
        ├── typeset.md             # Fix guide: typography
        ├── arrange.md             # Fix guide: hierarchy & spacing
        ├── colorize.md            # Fix guide: color & contrast
        ├── adapt.md               # Fix guide: responsiveness
        ├── distill.md             # Fix guide: AI slop removal
        ├── harden.md              # Fix guide: accessibility
        ├── clarify.md             # Fix guide: copy & labels
        └── personas/              # Persona evaluation profiles
            ├── schema.md          # Persona JSON format documentation
            ├── screen-reader-user.json
            ├── low-vision-user.json
            ├── keyboard-user.json
            ├── rushed-mobile-user.json
            ├── slow-connection-user.json
            ├── non-native-english.json
            ├── design-critic.json
            └── first-time-visitor.json
tests/                             # Test suite (node --test, zero dependencies)
├── report-format.test.js          # Report parser + format contract
├── slop-detection.test.js         # Detection thresholds + classification
├── resource-validation.test.js    # Structural integrity of all dist/ files
├── checkpoint.test.js             # Checkpoint metadata schema + naming
├── tools.test.js                  # pixelslop-tools CLI unit tests
├── plan-format.test.js            # Plan file format contract validation
├── orchestrator.test.js           # Orchestrator + setup spec validation
├── installer.test.js              # Installer path rewriting, MCP config, manifest
├── persona.test.js                # Persona schema validation
└── fixtures/
    └── sloppy-app/                # Integration test fixture
        └── index.html             # Deliberately sloppy page for fix/check testing
dev_docs/                          # Internal planning (gitignored)
```

## Testing

```bash
npm test                 # Full suite (780+ tests)
npm run validate         # Resource file structure + cross-file consistency only
npm run test:detection   # Detection logic only
npm run test:format      # Report format only
npm run test:checkpoint  # Checkpoint metadata schema only
npm run test:tools       # pixelslop-tools CLI commands only
npm run test:plan        # Plan format contract only
npm run test:orchestrator # Orchestrator + setup spec only
npm run test:installer   # Installer path rewriting, MCP config, manifest
npm run test:persona     # Persona schema validation
```

Run `npm test` before committing changes to `dist/` or `bin/`. The validation suite catches broken JS snippets, frontmatter issues, severity band mismatches, missing pattern fields, agent tool misconfigurations, plan format contract violations, pixelslop-tools command failures, and installer drift. See `CONTRIBUTING.md` for the full contributor workflow.

## pixelslop-tools Conventions

Agents use `pixelslop-tools` (bin/pixelslop-tools.cjs) for all state operations. Key rules:

- **Never edit `.pixelslop-plan.md` directly.** Use `plan begin`, `plan update`, `plan patch`.
- **Never create checkpoints with inline bash.** Use `checkpoint create`, `checkpoint revert`.
- **Always use `--raw` for agent consumption.** Human mode is for debugging.
- **`--cwd` overrides working directory.** Subagents may run from different directories.
- **Large output → tmpfile.** If JSON exceeds 50KB, tool writes to `/tmp/pixelslop-*.json` with `@file:` prefix.

## Voice & Persona

All user-facing content — README, comments, commit messages, resource files, reports — is written in Gabi's voice. Reference the persona guide at `~/Desktop/my_persona_v3.md` for tone. Short version: direct, warm, slightly sarcastic, no corporate fluff, strategy-first.

Resource files are instructional — written to teach an agent how to evaluate design. Clear, opinionated, practical. Think "experienced design reviewer briefing a junior."

## Commits

Conventional commits. Always. See the global CLAUDE.md for the full format reference.

## Releases & Changelogs

Releases are automated via release-please + npm publish with OIDC provenance. The changelog quality depends on how you merge.

### Merging feature branches

- **Multi-commit branches → `git merge` (not squash).** Each `feat:` and `fix:` commit becomes its own changelog entry, grouped into sections. This is how you get rich changelogs.
- **Single-change branches → squash is fine.** One commit = one changelog entry.
- **PR titles must be conventional commits.** `pr-lint.yml` enforces this. GitHub uses the PR title as the squash commit message.

### Release PR workflow

1. Pushing to main triggers release-please, which opens a **draft PR** with version bump + auto-generated CHANGELOG.md
2. The changelog groups commits: Features, Bug Fixes, Refactoring (test/chore/ci/docs/style hidden)
3. **Small releases:** mark the draft ready and merge. Auto-generated list is fine.
4. **Big releases:** checkout the PR branch, add a summary paragraph above the auto-generated entries in CHANGELOG.md, push, then mark ready and merge. This is the only way to get prose summaries — editing the PR body does NOT change the changelog.
5. Merging creates the GitHub release + tag, then publishes to npm

### Writing good changelog entries

The changelog is only as good as the commit messages. When committing on a feature branch:

- **`feat:` commits** — describe the capability, not the implementation. "add scroll pass with fold-by-fold analysis" not "add collectScrollPass function"
- **`fix:` commits** — describe what was broken from the user's perspective. "exclude skipped probes from evaluator score caps" not "fix condition in checkAccessibilityCaps"
- **Bold the key noun** in manual changelog entries: `* **Scroll pass** — fold-by-fold page analysis...`
- **One commit per logical change.** Don't bundle "add feature + fix test + update docs" in one commit. Split them so the changelog reads naturally.
- For squash merges that need multiple changelog entries, use `BEGIN_COMMIT_OVERRIDE` / `END_COMMIT_OVERRIDE` in the merged PR body

### What NOT to do

- Don't squash a branch with 10+ meaningful commits — the changelog loses all detail
- Don't use `docs:` commits for changelog edits — they trigger releases (before 0.2.7 fix, now hidden)
- Don't edit the release PR body expecting it to change CHANGELOG.md — it won't
- Don't skip the draft PR review for big releases — that's your window to write the summary

## Key Rules

- **Browser evidence required.** If it can't be measured in Playwright, don't score it.
- **No visual claims without proof.** Every finding needs a screenshot, computed value, or a11y snapshot behind it.
- **dist/ is tracked.** It's package content, not build output. The .gitignore knows this.
- **dev_docs/ is not shipped.** Planning docs, research, archived specs — all internal.
- **Report format is a contract.** Fixer and checker agents parse it. The test suite enforces the schema. Don't freestyle.
- **Severity bands must match.** `scoring.md` and `ai-slop-patterns.md` define the same bands — tests catch drift.
- **Orchestrator has NO Write/Edit.** All state goes through `pixelslop-tools`. Tests enforce it.
- **Fixer has Write/Edit, Checker does NOT.** This is a capability-based security boundary. Tests enforce it.
- **One fix per fixer invocation.** No batching. One finding → one checkpoint → one fix → one check.
- **Checkpoint before edit.** The fixer always creates a checkpoint via `pixelslop-tools` before modifying files. No exceptions.
- **Build gate is non-negotiable.** If the build breaks after a fix, automatic rollback. No "but the design fix was correct."
- **Max one retry on PARTIAL.** Keep the improvement and move on. Don't loop forever.
- **Run tests before committing.** `npm test` — 780+ tests, zero dependencies, takes ~10s.
- **Path rewriting is fragile.** If you rename `bin/pixelslop-tools.cjs` or move `dist/skill/resources/`, update `rewriteAgentPaths()` in `bin/pixelslop.mjs`. The installer tests catch drift.

## Direct Browser Runtime

Pixelslop now runs deterministic browser work through `pixelslop-tools browser *` commands backed by direct Playwright execution. The collector, fixer, and checker no longer depend on Playwright MCP tool declarations.
