# Pixelslop

[![CI](https://github.com/gabelul/pixelslop/actions/workflows/ci.yml/badge.svg)](https://github.com/gabelul/pixelslop/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/pixelslop.svg)](https://www.npmjs.com/package/pixelslop)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![Node](https://img.shields.io/node/v/pixelslop.svg)](https://nodejs.org)

AI coding agents are incredible at generating interfaces. They're also incredible at generating the *same* interface — gradient text on a dark background, glass cards with glow shadows, Inter font everywhere, identical three-column feature grids, and CTAs that technically exist but nobody can actually read because the contrast is 2.3:1.

That's AI slop. It's not broken. It's not ugly. It's just... the same. Every time. And the more AI tools get better at generating UIs (I built [stitch-kit](https://github.com/gabelul/stitch-kit) to teach agents how to use Google Stitch for exactly this), the more important it becomes to have something that looks at the *output* and says "this is generic" before your users do.

Pixelslop opens your actual pages in a real browser. Not your source code — your *rendered pages*. It screenshots them at three viewports, extracts computed styles, measures contrast ratios, counts how many of the 25 known AI slop patterns are present, scores design quality on 5 pillars, and evaluates the experience from 8 different user personas. Then it fixes what it finds.

The key difference: it doesn't read your CSS and guess what the page looks like. It renders the page and measures what's actually there. Gradient text that only exists in a conditional branch? Pixelslop won't flag it. Gradient text that's actually rendering on your hero? Caught, measured, scored.

## Install

```bash
npx pixelslop install
```

One command. Auto-detects Claude Code and Codex CLI, copies agent specs, installs skill files, configures Playwright MCP. Done.

> **Prerequisite:** You need [Claude Code](https://docs.anthropic.com/en/docs/claude-code) or [Codex CLI](https://github.com/openai/codex) installed first. Pixelslop installs *into* your existing runtime — it doesn't bundle one.

```bash
npx pixelslop@latest update    # upgrade with backup + diff
npx pixelslop doctor           # verify installation health
npx pixelslop uninstall        # remove everything
```

### Install options

```bash
npx pixelslop install                # global, symlinks where possible
npx pixelslop install --project      # this project only (.claude/, .mcp.json)
npx pixelslop install --copy         # force copy mode (portable for teams/CI)
```

## What it actually does

Type `/pixelslop http://localhost:3000` and the orchestrator handles everything. It assumes your source code is in the current directory — pass `--root ./some/path` only if it's elsewhere.

1. Opens the page in Playwright at 3 viewports (1440, 768, 375)
2. Captures screenshots, extracts computed styles via JS
3. Scores 5 pillars: **Hierarchy**, **Typography**, **Color**, **Responsiveness**, **Accessibility** (each 1-4)
4. Counts slop patterns against a catalog of 25 known AI fingerprints
5. Evaluates the design from 8 user personas (screen reader user, rushed mobile user, design critic, etc.)
6. Groups findings by category, assigns priorities
7. Asks you what to fix — everything, specific categories, critical only, or just the report
8. Runs the fix/check loop: fixer applies one change → build gate → checker re-measures → pass/fail/partial
9. Checkpoints every edit so bad fixes get rolled back automatically
10. Final report with before/after score delta

### The 25 slop patterns

Things like gradient text on headings, glassmorphism everywhere, dark-glow-cyan aesthetic, cards that look identical, generic font stacks (Inter/Poppins with no hierarchy), same-weight text throughout, uniform spacing with no rhythm, decorative elements that serve no purpose. Each pattern has a browser-executable detection snippet and a severity rating.

### The 5 pillars

| Pillar | What it measures |
|--------|-----------------|
| **Hierarchy** | Does the page guide your eye? Section differentiation, heading scale, visual weight distribution |
| **Typography** | Font variety, size scale, weight hierarchy, line-height, readability |
| **Color** | Palette cohesion, accent discipline, AI-palette detection (not contrast — that's accessibility) |
| **Responsiveness** | Does layout genuinely adapt? Overflow, touch targets, viewport-specific behavior |
| **Accessibility** | Contrast ratios (WCAG AA/AAA), heading hierarchy, landmarks, ARIA, alt text, semantic HTML |

Every score must cite browser evidence. A score without a computed value, screenshot, or a11y snapshot behind it is a guess — and pixelslop does not guess.

## Persona evaluation

The scanner doesn't just score numbers — it evaluates your design through the eyes of 8 different users:

| Persona | What they care about |
|---------|---------------------|
| `screen-reader-user` | Heading hierarchy, landmarks, ARIA, alt text, focus order |
| `low-vision-user` | Zoom reflow, contrast ratios, text sizing, target sizes |
| `keyboard-user` | Focus indicators, tab order, skip navigation, keyboard traps |
| `rushed-mobile-user` | Touch targets, CTA visibility, page weight, above-fold content |
| `slow-connection-user` | Image optimization, loading states, font loading, critical CSS |
| `non-native-english` | Plain language, idiom usage, icon+text pairing, reading level |
| `design-critic` | Visual hierarchy, spacing consistency, typography discipline |
| `first-time-visitor` | Onboarding clarity, value proposition, trust signals, CTA clarity |

Runs automatically. Skip with `--personas none`. Pick specific ones with `--personas screen-reader-user,design-critic`. Pass `--thorough` to lower the confidence threshold and see everything.

## The agents

| Agent | Role | Model |
|-------|------|-------|
| `pixelslop` | Orchestrator — coordinates the full workflow | Opus |
| `pixelslop-scanner` | Evaluates pages, scores pillars, detects slop patterns | Sonnet |
| `pixelslop-fixer` | Applies one targeted fix per finding | Sonnet |
| `pixelslop-checker` | Verifies fixes by re-measuring the targeted metric | Sonnet |
| `pixelslop-setup` | Explores codebase for design context (framework, CSS, fonts) | Sonnet |

The orchestrator has no Write/Edit tools — all state goes through `pixelslop-tools`. The fixer has Write/Edit, the checker does not. This is a deliberate capability boundary enforced by the test suite.

### pixelslop-tools

Deterministic CLI for all agent state management. Plan files, checkpoints, build gates, config. No inline bash file edits — agents call this instead.

```bash
pixelslop-tools plan begin --url ... --root ... --issues '...'
pixelslop-tools checkpoint create issue-id --files src/style.css
pixelslop-tools gate run --raw
pixelslop-tools init scan --url http://localhost:3000 --root . --raw
```

## How it fits with AI design tools

I built [stitch-kit](https://github.com/gabelul/stitch-kit) to teach AI agents how to generate beautiful UIs using Google Stitch. It's 35 skills that turn your coding agent from design-blind to design-competent — ideation, visual research, prompt engineering, multi-screen generation, design systems, and conversion to production code.

Pixelslop is the other side of that coin. Stitch-kit helps agents *create* good design. Pixelslop catches when they *didn't* — whether the UI came from Stitch, Cursor, v0, Claude Artifacts, or any other AI tool. Together, they close the loop: generate with taste, verify with evidence, fix what slipped through.

## Running tests

```bash
npm test                 # 443 tests, zero dependencies
npm run test:tools       # pixelslop-tools CLI tests
npm run test:installer   # Installer unit tests
npm run test:orchestrator # Agent spec validation
npm run test:persona     # Persona schema validation
npm run validate         # Resource file structure checks
```

## Integration testing

```bash
# Serve the deliberately sloppy test fixture
npx http-server tests/fixtures/sloppy-app/ -p 8888

# Then run: /pixelslop http://localhost:8888 --root ./tests/fixtures/sloppy-app
```

## Custom personas

The persona format is designed so custom personas can drop in without code changes. Put a JSON file matching the [persona schema](dist/skill/resources/personas/schema.md) into `.pixelslop/personas/` and the scanner picks it up automatically.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to add patterns, modify fix guides, work with the checkpoint protocol, or extend the persona system.

## Releases

Automated via [release-please](https://github.com/googleapis/release-please). Conventional commits → changelog → npm publish. `feat:` bumps minor, `fix:` bumps patch.

## License

Apache 2.0 — see [LICENSE](LICENSE) and [NOTICE](NOTICE) for attribution.

---

Built by [Gabi](https://booplex.com) @ [Booplex](https://booplex.com) — because AI agents are getting scary good at generating UIs, and someone needs to make sure "generated" doesn't become synonymous with "generic." The best AI-built interfaces should be indistinguishable from human-designed ones. Pixelslop is how you get there. Apache 2.0.
