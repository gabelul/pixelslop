# Contributing to Pixelslop

## What This Project Is

Pixelslop is a browser-first design quality reviewer. The scanner agent opens a live page in Playwright, captures screenshots and computed styles, scores design quality on 5 measurable pillars, and detects AI slop patterns. Browser evidence is the source of truth.

Phase 5 is complete — updates and distribution. The orchestrator coordinates scanner, fixer, checker, and setup agents in a full workflow with persona-based evaluation from 8 user perspectives. The project has CI, automated releases, and an upgrade path via `npx pixelslop@latest update`.

## Project Structure

```
pixelslop/
├── bin/                               # CLI tools
│   ├── pixelslop.mjs                    # Installer CLI (install/update/uninstall/doctor)
│   └── pixelslop-tools.cjs              # Agent state management CLI
├── dist/                              # Package content (tracked in git)
│   ├── agents/
│   │   ├── pixelslop.md                 # Orchestrator — coordinates workflow
│   │   ├── pixelslop-scanner.md         # Scanner — evaluates pages
│   │   ├── pixelslop-fixer.md           # Fixer — applies one fix per finding
│   │   ├── pixelslop-checker.md         # Checker — verifies fixes
│   │   └── pixelslop-setup.md           # Setup — builds project context
│   └── skill/
│       ├── SKILL.md                  # Skill entry point (/pixelslop command)
│       └── resources/                # Knowledge files agents read at runtime
│           ├── ai-slop-patterns.md   # 25 visual patterns + detection JS
│           ├── scoring.md            # 5-pillar rubric + report format
│           ├── visual-eval.md        # Playwright protocol + JS snippets
│           ├── checkpoint-protocol.md # Fix/verify/rollback mechanism
│           ├── plan-format.md        # Plan file contract
│           ├── typeset.md            # Fix guide: typography
│           ├── arrange.md            # Fix guide: hierarchy & spacing
│           ├── colorize.md           # Fix guide: color & contrast
│           ├── adapt.md              # Fix guide: responsiveness
│           ├── distill.md            # Fix guide: AI slop removal
│           ├── harden.md             # Fix guide: accessibility
│           ├── clarify.md            # Fix guide: copy & labels
│           └── personas/             # Persona evaluation profiles
│               ├── schema.md         # Persona JSON format docs
│               └── *.json            # 8 built-in personas
├── tests/                            # Test suite (node --test)
│   ├── report-format.test.js         # Report parser + format validation
│   ├── slop-detection.test.js        # Detection thresholds + classification
│   ├── resource-validation.test.js   # Structural integrity of all dist/ files
│   ├── checkpoint.test.js            # Checkpoint metadata schema + naming
│   ├── tools.test.js                 # pixelslop-tools CLI unit tests
│   ├── plan-format.test.js           # Plan format contract validation
│   ├── orchestrator.test.js          # Orchestrator + setup spec validation
│   ├── installer.test.js             # Installer path rewriting + MCP config
│   ├── persona.test.js               # Persona schema validation
│   └── fixtures/
│       └── sloppy-app/               # Integration test fixture
│           └── index.html            # Deliberately sloppy page
├── dev_docs/                         # Internal planning (gitignored)
├── CLAUDE.md                         # Project conventions for AI agents
└── package.json
```

### What lives where

| Directory | Tracked | Purpose |
|-----------|---------|---------|
| `dist/` | Yes | Package content — what ships to users |
| `tests/` | Yes | Test suite — validates detection logic and report format |
| `dev_docs/` | No | Internal planning, research notes, test results |
| `.pixelslop/` | No | Scanner runtime output (screenshots, reports) |

## How the Scanner Works

1. Agent reads 3 resource files from `dist/skill/resources/`
2. Navigates to a URL with Playwright
3. Evaluates at 3 viewports: Desktop (1440x900), Tablet (768x1024), Mobile (375x812)
4. Runs extraction snippets inside the direct browser collector to capture computed styles
5. Scores 5 pillars (Hierarchy, Typography, Color, Responsiveness, Accessibility) each 1-4
6. Counts slop patterns against the catalog in `ai-slop-patterns.md`
7. Produces a structured markdown report per the format in `scoring.md`

## Making Changes

### Adding a new slop pattern

1. Add the pattern to `dist/skill/resources/ai-slop-patterns.md`
2. Include: name, description, detection JS snippet (must work in the collector page context), severity (1-3)
3. If the pattern needs a new threshold, add test cases to `tests/slop-detection.test.js`
4. Run `npm test` to verify nothing breaks
5. Test against at least 2 pages: one where the pattern should fire, one where it shouldn't

**Pattern template:**
```markdown
### N. Pattern Name
**What it looks like:** One-line description of the visual symptom.
**How to detect:**
\`\`\`js
// collector snippet
(() => {
  // Detection logic — must return { pattern: 'name', detected: boolean, ...evidence }
})()
\`\`\`
**Screenshot cues:** What to look for visually.
**Severity:** 1 (mild) / 2 (notable) / 3 (strong fingerprint)
```

### Modifying the scoring rubric

1. Edit `dist/skill/resources/scoring.md`
2. Keep pillar scores 1-4 with explicit criteria per level
3. Every score level must specify what browser evidence supports it
4. If you change severity bands (CLEAN/MILD/SLOPPY/TERMINAL thresholds), update:
   - `scoring.md` (the table)
   - `ai-slop-patterns.md` (the Severity Bands section)
   - `tests/slop-detection.test.js` (the `classifySlop` tests)

### Modifying JS extraction snippets

1. Edit `dist/skill/resources/visual-eval.md`
2. All snippets must be self-contained IIFEs — no external dependencies
3. Snippets run in the browser page context via the direct collector runtime
4. Cap output size (use `.slice()`) — Playwright has response size limits
5. Test the snippet manually against a live page before committing

### Changing the report format

The report format in `scoring.md` is a contract — the fixer and checker agents parse it. If you change the format:

1. Update the template in `scoring.md`
2. Update the `parseReport()` function in `tests/report-format.test.js`
3. Update the tests to match the new structure
4. Run `npm test`

### Adding or modifying a fix guide

The 7 fix guide files in `dist/skill/resources/` teach the fixer agent how to fix specific finding types. Each guide must have these sections:

1. **What This Guide Fixes** — which scanner findings map to this guide
2. **How to Locate the Source** — framework detection and grep patterns
3. **Fix Recipes** — specific CSS/HTML changes with before/after examples
4. **Anti-Patterns to Avoid** — what NOT to do while fixing
5. **Verification Criteria** — what the checker should re-measure after the fix

The `npm run validate` suite checks for these sections automatically.

| Fix Guide | Covers |
|-----------|--------|
| `typeset.md` | Font scale, weight hierarchy, line-height, readability |
| `arrange.md` | Spacing rhythm, grid monotony, section differentiation |
| `colorize.md` | Palette, contrast fixes, accent discipline, tinted neutrals |
| `adapt.md` | Breakpoints, touch targets, overflow, mobile layout |
| `distill.md` | Slop removal: gradient text, glassmorphism, glow shadows |
| `harden.md` | ARIA, focus indicators, missing states, text overflow |
| `clarify.md` | Alt text, button labels, generic copy, heading text |

### Creating a custom persona

Personas are JSON files that define evaluation perspectives. Built-in personas live in `dist/skill/resources/personas/`. Custom personas go in `.pixelslop/personas/`.

1. Create a JSON file matching the schema in `dist/skill/resources/personas/schema.md`
2. Set the `id` field to match the filename (without `.json`)
3. Choose a `category`: `accessibility`, `context`, `international`, or `professional`
4. Define `designPriorities` (1-4 for each of the 5 pillars)
5. List `evaluationChecks` — IDs from the check catalog in `visual-eval.md` Section 8
6. Add `frustrationTriggers` (3+ patterns that cause problems)
7. Add `positiveSignals` (3+ patterns that work well)
8. Set `cognitiveLoadFactors` (array, can be empty if not relevant)
9. Add `narrationStyle` with a `voice` and 3+ `sampleReactions`
10. Configure `browserChecks` with relevant viewports and extra evaluations

**Testing a custom persona:**
```bash
# Validate schema
npm run test:persona

# Verify it loads without errors
node -e "console.log(JSON.parse(require('fs').readFileSync('.pixelslop/personas/my-persona.json', 'utf8')).id)"
```

The scanner auto-discovers persona files at load time and validates them against the schema. Invalid files are skipped with a warning.

### Modifying the checkpoint protocol

The checkpoint protocol in `checkpoint-protocol.md` is shared between the fixer and checker agents. Changes to the protocol affect both agents. The test suite validates the metadata schema, status enum, and file naming conventions.

### Working with the test fixture

`tests/fixtures/sloppy-app/index.html` is a controlled page with known design problems. Serve it locally for integration testing:

```bash
npx http-server tests/fixtures/sloppy-app/ -p 8888
```

Then you can run the scanner against `http://localhost:8888` and test the full fix/check/revert loop.

### Adding a pixelslop-tools command

1. Add the handler function in `bin/pixelslop-tools.cjs`
2. Register the command in the `main()` router switch
3. Support `--raw` mode (JSON) and human-readable mode
4. Support `--cwd` (already global — your handler uses `CWD` automatically)
5. Add unit tests in `tests/tools.test.js`
6. Run `npm run test:tools` then `npm test`

### Modifying the plan format

The plan format is a contract between agents. If you change `.pixelslop-plan.md` structure:

1. Update `dist/skill/resources/plan-format.md` (the spec)
2. Update `bin/pixelslop-tools.cjs` (the implementation)
3. Update `tests/plan-format.test.js` (the contract tests)
4. Update `tests/tools.test.js` (the CLI tests)
5. Check orchestrator, fixer, and checker agent specs for any references

### Working with the installer

`bin/pixelslop.mjs` is the CLI that installs pixelslop into Claude Code and Codex CLI. It copies files, rewrites paths in agent specs, configures MCP, and manages symlinks.

**Testing locally:**
```bash
# Run installer tests (no side effects — uses temp dirs)
npm run test:installer

# Test actual install (writes to ~/.pixelslop, ~/.claude, etc.)
node bin/pixelslop.mjs install

# Verify
node bin/pixelslop.mjs doctor

# Clean up
node bin/pixelslop.mjs uninstall
```

**Adding a new runtime:**
1. Add a client entry to the `CLIENTS` array in `bin/pixelslop.mjs`
2. Implement `detect()`, `installSkill()`, `removeSkill()`, `checkSkill()`
3. Set the MCP config path and format (`json` or `toml`)
4. Add tests for the new client's MCP format if it differs from existing ones
5. Run `npm run test:installer` then `npm test`

**Path rewriting:** Agent specs reference `bin/pixelslop-tools.cjs` and `dist/skill/resources/` — paths that only work inside the repo. The `rewriteAgentPaths()` function replaces these with absolute paths to the install root. If you rename any of these paths, update the function and the drift detection tests.

## Running Tests

```bash
# Run everything (the full suite — do this before committing)
npm test

# Validate resource files only (structure, frontmatter, JS syntax, cross-file consistency)
npm run validate

# Run specific test suites
npm run test:detection     # Detection thresholds and classification logic
npm run test:format        # Report format parser and contract validation
npm run test:checkpoint    # Checkpoint metadata schema and naming
npm run test:tools         # pixelslop-tools CLI unit tests
npm run test:plan          # Plan format contract validation
npm run test:orchestrator  # Orchestrator + setup agent spec validation
npm run test:installer     # Installer path rewriting, MCP config, manifest
```

Uses Node.js native test runner (`node --test`). Zero external dependencies.

### Test Suites

| File | What it validates | Run after... |
|------|-------------------|--------------|
| `resource-validation.test.js` | File existence (all 20 dist/ files), frontmatter fields, JS snippet syntax, cross-file consistency, agent tool lists, fix guide structure, test fixture | Editing any file in `dist/` |
| `slop-detection.test.js` | isDark threshold, genericFont detection, glow shadow calibration, severity bands, rating bands | Changing detection thresholds |
| `report-format.test.js` | Report parser, format contract, cross-field consistency | Changing the report format in scoring.md |
| `checkpoint.test.js` | Checkpoint metadata schema (required fields, enum values, timestamp format), file naming conventions | Changing the checkpoint protocol |
| `tools.test.js` | All pixelslop-tools commands (plan, checkpoint, gate, config, init, verify) in both raw/human modes | Changing `bin/pixelslop-tools.cjs` |
| `plan-format.test.js` | Plan format spec (fields, statuses, priorities, categories, cross-file consistency) | Changing `plan-format.md` |
| `orchestrator.test.js` | Orchestrator + setup agent specs (frontmatter, tools, protocol steps, cross-references) | Changing agent specs |
| `installer.test.js` | Path rewriting, MCP config writing, manifest schema, agent/resource completeness, package config | Changing `bin/pixelslop.mjs` or adding agents/resources |
| `persona.test.js` | Persona JSON schema validation, required fields, value ranges, category coverage, cross-file consistency | Changing persona files or persona-related agent/scoring changes |

### What the validation catches

The `npm run validate` suite checks things a contributor is likely to break:

- **Missing files** — all 19 dist/ files must exist (5 agents, 1 SKILL.md, 12 resources, 1 fixture)
- **Broken frontmatter** — agents missing required fields (name, model, tools)?
- **Wrong tool names** — scanner referencing `browser_screenshot` instead of `browser_take_screenshot`?
- **Tool capability mismatch** — fixer missing Write/Edit? Checker/orchestrator accidentally has Write/Edit?
- **JS syntax errors** — did your new detection snippet have a typo?
- **Severity band mismatch** — scoring.md says TERMINAL at 6+, ai-slop-patterns.md says 7+?
- **Missing pattern fields** — new pattern without a severity rating or detection JS?
- **Viewport drift** — visual-eval.md says 768x1024 but scanner says 768x1080?
- **Fix guide structure** — every guide must have the 5 required sections
- **Checkpoint references** — fixer and checker must both reference checkpoint-protocol.md
- **Finding mapping coverage** — fixer must map all 5 pillars + slop to fix guides
- **Agent cross-references** — all agents referenced by orchestrator and SKILL.md must exist

## Key Rules

- **Browser evidence required.** If it can't be measured in Playwright, don't score it.
- **No visual claims without proof.** Every finding needs a screenshot, computed value, or a11y snapshot.
- **Test your thresholds.** If you change a detection threshold, add test cases for the boundary.
- **Severity bands must match.** `scoring.md` and `ai-slop-patterns.md` define the same bands — keep them in sync.
- **Agents use pixelslop-tools for state.** Plan files, checkpoints, and config are mutated via `bin/pixelslop-tools.cjs`, not inline bash.
- **Orchestrator has NO Write/Edit.** All state goes through `pixelslop-tools`. Test-enforced.
- **Fixer has Write/Edit, Checker does NOT.** The tool separation is intentional and test-enforced.
- **One fix per fixer invocation.** One finding, one checkpoint, one fix, one check. No batching.
- **Checkpoint protocol is the contract.** Both fixer and checker follow the same protocol file.

## Commits

Conventional commits. Always.

```
feat: add new slop pattern for X
fix: adjust isDark threshold to catch Y
test: add boundary tests for glow detection
docs: update CONTRIBUTING with pattern template
```

## Releases

Releases are automated via release-please + GitHub Actions:

1. **Write conventional commits** — `feat:`, `fix:`, `chore:`, etc.
2. **Push to main** — release-please creates/updates a release PR with changelog entries
3. **Merge the release PR** — triggers npm publish with OIDC provenance
4. **That's it** — the version bump, changelog update, git tag, GitHub release, and npm publish all happen automatically

### Version bumping rules

| Commit prefix | Version bump | Example |
|---------------|-------------|---------|
| `feat:` | Minor (0.X.0) | `feat: add new slop pattern` |
| `fix:` | Patch (0.0.X) | `fix: adjust isDark threshold` |
| `BREAKING CHANGE:` | Major (X.0.0) | Breaking API change |
| `chore:`, `docs:`, `test:`, etc. | Patch (0.0.X) | `docs: update README` |

### Testing a release locally

```bash
npm pack --dry-run     # See what would be published
npm publish --dry-run  # Simulate a publish
```

## Voice

All user-facing content — resource files, reports, README — is written in a direct, practical voice. Resource files are instructional: "experienced design reviewer briefing a junior." No corporate fluff, no academic hedging.
