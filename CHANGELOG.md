# Changelog

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
