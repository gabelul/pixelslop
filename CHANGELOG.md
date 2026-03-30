# Changelog

## [0.3.0](https://github.com/gabelul/pixelslop/compare/pixelslop-v0.2.7...pixelslop-v0.3.0) (2026-03-30)

Pixelslop 0.3.0 is a ground-up rework of how design quality gets measured. The scanner that used to be one monolithic agent is now a collector feeding 6 specialist evaluators. The browser runtime that depended on Playwright MCP is now direct Playwright execution. And the collector doesn't just look at static screenshots anymore — it scrolls, hovers, tabs through elements, and clicks interactive widgets to verify they actually work.

The /20 scoring model hasn't changed. The 5 pillars are the same. But the evidence behind each score is substantially deeper, and the evaluators are sharper about what they penalize.

### Scanner Architecture

The old scanner was a single agent that captured screenshots, extracted styles, and scored everything in one pass. That's gone.

* **Evidence collector** — `pixelslop-browser.cjs` captures screenshots, computed styles, contrast ratios, typography, spacing, a11y snapshots, and persona checks across 3 viewports (1440px, 768px, 375px). Outputs a structured evidence bundle.
* **6 specialist evaluators** — hierarchy, typography, color, responsiveness, accessibility, and slop. Each reads the evidence bundle, applies its rubric from `scoring.md`, and returns a scored JSON finding. They run in parallel, they're read-only, and they can't see each other's work.
* **Evidence schema** — `evidence-schema.md` is the formal contract between collector and evaluators. Defines every field, its type, which evaluator owns it, and confidence flags.

### Direct Browser Runtime

Replaced Playwright MCP tool declarations with direct Playwright execution via `pixelslop-tools browser *` commands. The collector, fixer, and checker call Playwright directly — no MCP middleware, no tool-call overhead, no dependency on the host runtime having Playwright MCP configured.

### Interaction Evidence Layer

The collector now runs 4 interaction passes after the static evidence capture:

* **Scroll pass** — scrolls the page fold by fold. Screenshots each fold, tracks sticky/fixed elements, detects lazy-loaded images, samples below-fold typography. Pages with scroll ratio > 8 get flagged for content priority issues.
* **Hover pass** — hovers up to 15 interactive elements at desktop, captures before/after computed style diffs. Detects buttons and links with zero hover feedback.
* **Focus pass** — tabs through up to 30 focusable elements, checks each for a visible focus indicator (outline, box-shadow, or border change). Identifies non-semantic clickables: divs and spans with `cursor:pointer` or `onclick` that should be `<button>` or `<a>`.
* **Promise verification** — clicks mobile menu triggers, anchor links, and tabs/accordions, then checks whether the expected outcome happened. Binary pass/fail: did the nav open? Did the page scroll to the anchor? Did `aria-expanded` change? Skipped probes (ambiguous or unclickable triggers) are classified as unverifiable, not broken.

Each pass has its own time budget (scroll 8s, hover 5s, focus 3s, promises 12s) and graceful bailout. A timeout stores partial results, flags confidence, and continues — one noisy pass never contaminates the rest.

`--deep` mode doubles all budgets and raises caps for complex pages.

### Evaluator Wiring

Interaction evidence feeds into the existing pillar evaluators:

* **Accessibility** — `focusPass.missingIndicators` (>30% missing = score cap at 2), `focusPass.nonSemanticClickables` (>3 = score cap at 2), broken tabs/accordion ARIA state from promise verification
* **Responsiveness** — broken mobile menu from promise verification (score cap at 2), anchor-link failures scoped to mobile context with no sticky nav (warn only)
* **Hierarchy** — scroll fold count and ratio for content priority (CTAs buried past fold 5)

Prompt contract tests lock the scoring rules — if someone weakens the evaluator thresholds, the test suite catches it.

### Interactive Installer

`npx pixelslop install` is now an interactive wizard. Detects Claude Code and Codex CLI, lets you pick runtimes and scope, supports project-local Codex installs in `.codex/`, rewrites agent paths, configures MCP, and installs skills via symlink or copy. `npx pixelslop@latest update` upgrades with backup + diff.

### Code Check Mode

`--code-check` runs source-only analysis without opening a browser. 6 additional source patterns (S11-S16), cognitive load scoring, usability heuristics, and interaction design checks.

### Release Infrastructure

* PR titles validated as conventional commits via `amannn/action-semantic-pull-request`
* Release PRs open as drafts for changelog review before publishing
* Changelog sections group features/fixes/refactoring, hide test/chore/ci/docs noise
* CI matrix: Node 18, 20, 22. npm publish with OIDC provenance.

### Tests

781 tests (was 470 at 0.2.0). Coverage includes:
* 7 interaction test fixtures (ref-map, sticky-header, lazy-images, focus-visible, broken-mobile-menu, tabs-accordion, anchor-links)
* Prompt contract tests for accessibility and responsiveness evaluators
* Evidence schema validation
* Installer path rewriting, MCP config, manifest structure
* Browser runtime integration tests
* Persona schema validation

### Breaking Changes

None. The /20 scoring model, report format, plan format, and CLI interface are all unchanged. Scores may shift slightly because evaluators now have more evidence to work with — that's the point.

---

## [0.2.7](https://github.com/gabelul/pixelslop/compare/pixelslop-v0.2.6...pixelslop-v0.2.7) (2026-03-30)

Release infrastructure: PR title linting, changelog section grouping, draft release PRs for review before publish. No functional changes.

## [0.2.6](https://github.com/gabelul/pixelslop/compare/pixelslop-v0.2.5...pixelslop-v0.2.6) (2026-03-30)

Interaction evidence inside the existing evaluators. The browser collector now scrolls, hovers, tabs, and clicks interactive elements — then feeds what it finds into the accessibility, responsiveness, and hierarchy evaluators. No new pillar, no scoring model change. The existing /20 score gets sharper because evaluators can see things they couldn't before: missing focus indicators, divs masquerading as buttons, broken hamburger menus.

### Features

* **Scroll pass** — fold-by-fold page analysis with screenshots, sticky element tracking, lazy image detection, and below-fold typography sampling. Pages that scroll for 8+ viewport heights get flagged for content priority issues.
* **Hover pass** — before/after computed style diffs on up to 15 interactive elements at desktop. Detects elements with no hover feedback.
* **Focus pass** — keyboard Tab-through that tests up to 30 elements for visible focus indicators. Identifies non-semantic clickables (divs/spans with `cursor:pointer` or `onclick` that should be buttons).
* **Promise verification** — click→verify loop for mobile menus, anchor links, and tabs/accordions. Binary pass/fail outcomes — if the nav doesn't open or the anchor doesn't scroll, that's a measurable failure.
* **`--deep` flag** — doubles all time budgets and raises element caps for extended collection on complex pages.
* **Evaluator wiring** — accessibility evaluator now caps score at 2 when >30% of focused elements lack visible indicators, or when >3 non-semantic clickables are found. Responsiveness evaluator caps at 2 for broken mobile menus. Hierarchy evaluator uses scroll data for content priority.
* **Skipped probe handling** — ambiguous or unclickable triggers classified as "skipped" (unverifiable), not "failed" (broken). Evaluators only penalize real click-action failures.

### Architecture

* Element ref system assigns stable selectors to interactive elements — buttons, links, tabs, divs-acting-as-buttons — with semantic classification.
* Probe isolation: `resetProbeState()` between every interaction, `resetBetweenPasses()` between every pass and before viewport switches. A noisy probe never contaminates subsequent collection.
* Per-pass time budgets (scroll 8s, hover 5s, focus 3s, promises 12s) with graceful bailout — partial results stored, confidence flagged, scan continues.
* Evidence schema updated with formal field specifications and evaluator routing rules.

### Tests

* 781 tests (was 616). 7 new test fixtures, 3 new test files, prompt contract tests for accessibility and responsiveness evaluators locking the skipped-probe exclusion rules.

## [0.2.5](https://github.com/gabelul/pixelslop/compare/pixelslop-v0.2.4...pixelslop-v0.2.5) (2026-03-26)


### Features

* replace Playwright MCP with direct browser runtime ([0a9d42e](https://github.com/gabelul/pixelslop/commit/0a9d42e7bf879ab4950ec8bbc47c9cad7c683d51))


### Bug Fixes

* CI installs playwright-core and Chromium before running tests ([7a7461c](https://github.com/gabelul/pixelslop/commit/7a7461cfc553a5cd729f2838e8e0a59eba253bc4))

## [0.2.4](https://github.com/gabelul/pixelslop/compare/pixelslop-v0.2.3...pixelslop-v0.2.4) (2026-03-26)


### Features

* evidence schema, 6 specialist evaluator agents, evaluator tests ([35c6e93](https://github.com/gabelul/pixelslop/commit/35c6e9394b873d16d72b869ef0ce7dcb6de7008c))
* scanner decomposition into evidence collector + specialist fan-out ([4e89083](https://github.com/gabelul/pixelslop/commit/4e890832593a8068b4601aa462d772a49a7e6586))
* specialist agent architecture — scanner decomposition ([67faf02](https://github.com/gabelul/pixelslop/commit/67faf023479fd60053a1bd369b375de1d5e81212))


### Bug Fixes

* add pixelslop-code-scanner to installer AGENT_FILES ([ecd2116](https://github.com/gabelul/pixelslop/commit/ecd211627b8be172a9bcbc13cf35db2d713332f2))
* address Codex review — paths, schema fields, slop coverage, responsiveness evidence ([91c7b49](https://github.com/gabelul/pixelslop/commit/91c7b492bdd3bf3ad30a0934d199472efc71cd10))
* Codex round 2 — schema/snippet alignment, test lockdown, evaluator field refs ([19fdb7d](https://github.com/gabelul/pixelslop/commit/19fdb7d32083ad79ea6912ccfd27f22e6177e3c5))
* remaining Codex review items — schema drift, title, uninstall safety ([2034284](https://github.com/gabelul/pixelslop/commit/203428406dfa51505ce7e2f097640f642769b2e1))

## [0.2.3](https://github.com/gabelul/pixelslop/compare/pixelslop-v0.2.2...pixelslop-v0.2.3) (2026-03-25)


### Features

* add interactive multi-runtime installer ([58afd63](https://github.com/gabelul/pixelslop/commit/58afd635253abaec37716cafe51ba3594a8139ab))

## [0.2.2](https://github.com/gabelul/pixelslop/compare/pixelslop-v0.2.1...pixelslop-v0.2.2) (2026-03-25)


### Features

* code-check mode for source-only design analysis ([f348e16](https://github.com/gabelul/pixelslop/commit/f348e164a7dde647922af9dc0deeb728a2a3a8f6))
* cognitive load, heuristics, interaction design, context caching ([1c2ef21](https://github.com/gabelul/pixelslop/commit/1c2ef219f2525c97a6057980f6563e06b4dc8ba8))


### Bug Fixes

* serve tests wait for TCP socket before fetching ([3e6cd06](https://github.com/gabelul/pixelslop/commit/3e6cd06366edb01ce7129559e4bdf1c94a5fc767))

## [0.2.1](https://github.com/gabelul/pixelslop/compare/pixelslop-v0.2.0...pixelslop-v0.2.1) (2026-03-24)


### Features

* pixelslop v0.1.0 — browser-first design quality scanner ([c80a7c3](https://github.com/gabelul/pixelslop/commit/c80a7c342b290792ed5b2aea0efecb0dadc93df2))
* static site support, interactive discovery, two-phase architecture, debug logging ([635b314](https://github.com/gabelul/pixelslop/commit/635b314daa5a118f86282be08c2d0b203998406f))


### Bug Fixes

* add focus-visible outlines for nav links, buttons, CTAs, tabs, and footer links ([4b7d653](https://github.com/gabelul/pixelslop/commit/4b7d653444318c8bc2d732ca19893878da9bb29a))
* add prefers-reduced-motion query to disable animations for motion-sensitive users ([08af8df](https://github.com/gabelul/pixelslop/commit/08af8df060f818a6fb05f80d21fb13d48f6fe223))
* add screen-reader description for gallery images hidden by aria-hidden track ([b87c690](https://github.com/gabelul/pixelslop/commit/b87c6906a883734b224a03f0307e54b7e76a55cf))
* add skip navigation link and main landmark for keyboard/screen reader users ([6ce17b1](https://github.com/gabelul/pixelslop/commit/6ce17b173053983690620c33519016cd02d3616a))
* add srcset and sizes to hero image for responsive image loading ([d3e6129](https://github.com/gabelul/pixelslop/commit/d3e6129d7303b6da2ad201bc1f3e394b15d46ace))
* bump minimum font sizes for menu tags and labels ([b8a40a8](https://github.com/gabelul/pixelslop/commit/b8a40a8006000cc391fd13cfae39659588814d19))
* clone gallery images via JS instead of duplicating in HTML ([66ec376](https://github.com/gabelul/pixelslop/commit/66ec3766ea52ae925f70e1e5b286d30ad582ebba))
* darken muted text from [#7](https://github.com/gabelul/pixelslop/issues/7)C6D5F to [#716356](https://github.com/gabelul/pixelslop/issues/716356) for AA contrast on cream backgrounds ([eb1fee7](https://github.com/gabelul/pixelslop/commit/eb1fee70c946d8bd87c92eb9f1263fd55862daf3))
* darken muted text from [#8](https://github.com/gabelul/pixelslop/issues/8)A7B6E to [#7](https://github.com/gabelul/pixelslop/issues/7)C6D5F for AA contrast compliance ([5f6bb2a](https://github.com/gabelul/pixelslop/commit/5f6bb2a81a7a714124544fc03945814fa0ea6c1c))
* darken terracotta accent from #C4613A to #B25531 for AA contrast compliance ([a61be70](https://github.com/gabelul/pixelslop/commit/a61be701add9c9a97e00ebcb5e9856a7be0fecd2))
* enforce 44px minimum touch targets on mobile interactive elements ([4549354](https://github.com/gabelul/pixelslop/commit/4549354f0697bd0b70805f58f0473fe779550e62))
* improve form label and placeholder contrast on dark charcoal background ([216ea25](https://github.com/gabelul/pixelslop/commit/216ea25676ca6ed02b9dd6470434a76ea9c7a35b))
* lighten footer text for AA contrast compliance on dark background ([eda8403](https://github.com/gabelul/pixelslop/commit/eda8403a2355187aa3da2e922eaf72ea829722bb))
* replace static 2024 copyright with dynamic current year ([0772a68](https://github.com/gabelul/pixelslop/commit/0772a68d1307fbc41dd9c780fb7202003da8591a))
* replace transition: all with scoped properties on .btn, .menu__tab, .footer__social a ([fe61000](https://github.com/gabelul/pixelslop/commit/fe61000df69329da0a4ebb099d26064828122568))

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

## [0.1.1](https://github.com/gabelul/pixelslop/compare/pixelslop-v0.1.0...pixelslop-v0.1.1) (2026-03-20)

### Features

* pixelslop v0.1.0 — browser-first design quality scanner ([c80a7c3](https://github.com/gabelul/pixelslop/commit/c80a7c342b290792ed5b2aea0efecb0dadc93df2))

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
