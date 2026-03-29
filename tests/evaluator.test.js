/**
 * Internal Evaluator Agent Validation Tests
 *
 * Validates the 6 specialist evaluator agents that live in
 * dist/agents/internal/. These are spawned by the orchestrator
 * to score individual pillars from the evidence bundle.
 *
 * Key boundaries enforced:
 * - Read-only tools (no Playwright, no Write/Edit, no Bash)
 * - NOT in the installer's AGENT_FILES list
 * - All 5 pillars covered + slop classifier
 * - Each references scoring.md or ai-slop-patterns.md
 *
 * Run: node --test tests/evaluator.test.js
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = join(__dirname, '..', 'dist');
const INTERNAL = join(DIST, 'agents', 'internal');

/**
 * Read a file from dist/.
 * @param {string} relativePath - Path relative to dist/
 * @returns {string} File contents
 */
function readDist(relativePath) {
  const fullPath = join(DIST, relativePath);
  assert.ok(existsSync(fullPath), `Missing file: dist/${relativePath}`);
  return readFileSync(fullPath, 'utf-8');
}

/**
 * Parse YAML frontmatter from markdown.
 * @param {string} content - Markdown with frontmatter
 * @returns {{ frontmatter: object, body: string }}
 */
function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: content };

  const fm = {};
  const lines = match[1].split('\n');
  let currentKey = null;
  let currentArray = null;

  for (const line of lines) {
    const kvMatch = line.match(/^(\w[\w-]*):\s*(.+)?$/);
    if (kvMatch && !line.startsWith('  ')) {
      currentKey = kvMatch[1];
      const value = kvMatch[2]?.trim();
      if (value === '>') {
        fm[currentKey] = '';
        currentArray = null;
      } else if (value === undefined || value === '') {
        fm[currentKey] = [];
        currentArray = currentKey;
      } else {
        fm[currentKey] = value;
        currentArray = null;
      }
      continue;
    }
    if (line.match(/^\s+-\s/) && currentArray) {
      const item = line.replace(/^\s+-\s*/, '').trim();
      if (!Array.isArray(fm[currentArray])) fm[currentArray] = [];
      fm[currentArray].push(item);
      continue;
    }
    if (line.match(/^\s+\S/) && currentKey && typeof fm[currentKey] === 'string' && fm[currentKey] === '') {
      fm[currentKey] = line.trim();
    }
  }

  return { frontmatter: fm, body: match[2] };
}


// ─────────────────────────────────────────────
// Tests: Internal agents directory exists
// ─────────────────────────────────────────────

describe('Internal evaluator agents directory', () => {
  it('dist/agents/internal/ directory exists', () => {
    assert.ok(existsSync(INTERNAL), 'Missing: dist/agents/internal/');
  });

  it('contains exactly 6 evaluator specs', () => {
    const files = readdirSync(INTERNAL).filter(f => f.endsWith('.md') && !f.startsWith('._'));
    assert.equal(files.length, 6,
      `Expected 6 internal evaluator specs, found ${files.length}: ${files.join(', ')}`);
  });
});


// ─────────────────────────────────────────────
// Tests: Internal agents are NOT in AGENT_FILES
// ─────────────────────────────────────────────

describe('Internal agents are excluded from installer', () => {
  it('no internal agent appears in AGENT_FILES', () => {
    const installerSrc = readFileSync(join(__dirname, '..', 'bin', 'pixelslop.mjs'), 'utf-8');
    const internalFiles = readdirSync(INTERNAL).filter(f => f.endsWith('.md') && !f.startsWith('._'));

    for (const file of internalFiles) {
      assert.ok(
        !installerSrc.includes(`'${file}'`) || installerSrc.includes('internal'),
        `Internal agent ${file} should NOT be in AGENT_FILES`
      );
    }
  });
});


// ─────────────────────────────────────────────
// Tests: Evidence schema resource
// ─────────────────────────────────────────────

describe('Evidence schema resource', () => {
  let content;

  it('dist/skill/resources/evidence-schema.md exists', () => {
    content = readDist('skill/resources/evidence-schema.md');
    assert.ok(content.length > 500, 'evidence-schema.md seems too short');
  });

  it('documents the JSON structure', () => {
    assert.ok(content.includes('viewports') && content.includes('desktop'),
      'should document viewport evidence structure');
  });

  it('maps snippets to bundle fields', () => {
    assert.ok(
      content.includes('typography') && content.includes('colors') && content.includes('contrast'),
      'should map extraction snippets to bundle fields'
    );
  });

  it('documents confidence flags', () => {
    assert.ok(content.includes('confidence'),
      'should document the confidence flags structure');
  });

  it('documents persona checks', () => {
    assert.ok(content.includes('personaChecks') || content.includes('persona'),
      'should document persona check data');
  });

  it('documents source patterns', () => {
    assert.ok(content.includes('sourcePatterns') || content.includes('source'),
      'should document source pattern field');
  });
});


// ─────────────────────────────────────────────
// Tests: Pillar coverage (no gaps, no duplicates)
// ─────────────────────────────────────────────

describe('Pillar coverage', () => {
  const expectedPillars = ['hierarchy', 'typography', 'color', 'responsiveness', 'accessibility'];

  it('all 5 pillars have a specialist', () => {
    const files = readdirSync(INTERNAL).filter(f => f.endsWith('.md') && !f.startsWith('._'));
    const fileNames = files.map(f => f.toLowerCase());

    for (const pillar of expectedPillars) {
      assert.ok(
        fileNames.some(f => f.includes(pillar)),
        `Missing specialist for pillar: ${pillar}`
      );
    }
  });

  it('slop classifier exists', () => {
    const files = readdirSync(INTERNAL).filter(f => f.endsWith('.md') && !f.startsWith('._'));
    assert.ok(
      files.some(f => f.includes('eval-slop')),
      'Missing slop classifier agent'
    );
  });

  it('no duplicate pillar coverage', () => {
    assert.ok(existsSync(INTERNAL), `INTERNAL dir missing: ${INTERNAL}`);
    const raw = readdirSync(INTERNAL);
    const mdFiles = raw.filter(f => f.endsWith('.md') && !f.startsWith('._'));
    const pillarFiles = mdFiles.filter(f => !f.includes('eval-slop'));
    assert.equal(pillarFiles.length, 5,
      `Expected 5 pillar evaluators (excluding slop), found ${pillarFiles.length}. Raw dir: ${raw.join(', ')}. MD files: ${mdFiles.join(', ')}. Pillar files: ${pillarFiles.join(', ')}`);
  });
});


// ─────────────────────────────────────────────
// Tests: Accessibility evaluator prompt contracts
// ─────────────────────────────────────────────

describe('Accessibility evaluator — interaction evidence contracts', () => {
  let content;

  it('loads accessibility evaluator', () => {
    content = readFileSync(join(INTERNAL, 'pixelslop-eval-accessibility.md'), 'utf-8');
    assert.ok(content.length > 200);
  });

  it('only counts tabs/accordion failures when action is click', () => {
    // The prompt must require action='click' for widget-semantics failures.
    // Skipped probes (ambiguous/unclickable triggers) are not broken widgets.
    assert.ok(
      content.includes("'click'") || content.includes('"click"') || content.includes('`click`'),
      'accessibility evaluator must gate widget failures on action being click'
    );
    assert.ok(
      content.includes("'tabs'") || content.includes("'accordion'"),
      'accessibility evaluator must scope widget failures to tabs/accordion patterns'
    );
    // Verify the three conditions appear together in the interactivePromises extraction
    const promiseSection = content.split('interactivePromises')[1] || '';
    assert.ok(
      promiseSection.includes('click') && promiseSection.includes('passed'),
      'interactivePromises section must require both action=click and passed=false'
    );
  });

  it('explicitly excludes skipped probes from widget-semantics findings', () => {
    // The prompt must tell the evaluator that skipped != broken
    assert.ok(
      content.includes('skipped') && content.includes('unverifiable'),
      'accessibility evaluator must explain that skipped probes are unverifiable, not broken'
    );
    assert.ok(
      content.includes("not 'skipped'") || content.includes('not skipped') ||
      content.includes("(not 'skipped')"),
      'accessibility evaluator must explicitly exclude skipped actions'
    );
  });

  it('ignores anchor-link and mobile-menu patterns', () => {
    // These belong to responsiveness, not accessibility
    assert.ok(
      content.includes('anchor-link') && content.includes('mobile-menu') &&
      content.toLowerCase().includes('ignore'),
      'accessibility evaluator must tell agent to ignore anchor-link and mobile-menu'
    );
  });

  it('references focusPass evidence fields', () => {
    assert.ok(content.includes('focusPass'), 'must reference focusPass');
    assert.ok(content.includes('missingIndicators'), 'must reference missingIndicators');
    assert.ok(content.includes('nonSemanticClickables'), 'must reference nonSemanticClickables');
  });

  it('defines score cap thresholds for interaction evidence', () => {
    // 30% missing focus indicators = cap at 2
    assert.ok(
      content.includes('30%') && content.includes('cap'),
      'must define the 30% missing-indicators score cap'
    );
    // >3 non-semantic clickables = cap at 2
    assert.ok(
      content.includes('3 non-semantic') || content.includes('3 non-semantic clickables'),
      'must define the >3 non-semantic clickables threshold'
    );
  });
});


// ─────────────────────────────────────────────
// Tests: Responsiveness evaluator prompt contracts
// ─────────────────────────────────────────────

describe('Responsiveness evaluator — interaction evidence contracts', () => {
  let content;

  it('loads responsiveness evaluator', () => {
    content = readFileSync(join(INTERNAL, 'pixelslop-eval-responsiveness.md'), 'utf-8');
    assert.ok(content.length > 200);
  });

  it('only counts mobile-menu failures when action is click', () => {
    // Nav-adaptation criterion must gate on action='click'
    const navSection = content.split('Navigation adaptation')[1]?.split('**Anchor')[0] || '';
    assert.ok(
      navSection.includes('click') && navSection.includes('passed'),
      'navigation adaptation must require both action=click and passed=false'
    );
    assert.ok(
      navSection.includes("not 'skipped'") || navSection.includes('not skipped') ||
      navSection.includes("(not 'skipped')"),
      'navigation adaptation must explicitly exclude skipped actions'
    );
  });

  it('explicitly excludes skipped probes as unverifiable', () => {
    assert.ok(
      content.includes('skipped') && content.includes('unverifiable'),
      'responsiveness evaluator must explain that skipped probes are unverifiable, not broken'
    );
    assert.ok(
      content.toLowerCase().includes("don't penalize skipped") ||
      content.toLowerCase().includes('do not penalize skipped'),
      'must explicitly say not to penalize skipped probes'
    );
  });

  it('scopes anchor-link penalties to mobile context with no sticky nav', () => {
    const anchorSection = content.split('Anchor navigation')[1]?.split('**Font')[0] || '';
    // Must require mobile viewport OR (long page AND no sticky nav)
    assert.ok(
      anchorSection.includes('mobile') && anchorSection.includes('scroll.ratio'),
      'anchor-link criterion must reference mobile viewport and scroll.ratio'
    );
    assert.ok(
      anchorSection.includes('sticky') || anchorSection.includes('stickyElements'),
      'anchor-link criterion must check for sticky/fixed navigation'
    );
    // Must not penalize when sticky nav exists
    assert.ok(
      anchorSection.toLowerCase().includes('do not penalize') ||
      anchorSection.toLowerCase().includes("don't penalize") ||
      anchorSection.toLowerCase().includes('not a responsiveness failure'),
      'must explicitly exclude pages with sticky nav from anchor-link penalties'
    );
  });

  it('anchor-link issues are warn-level, not score caps', () => {
    const anchorSection = content.split('Anchor navigation')[1]?.split('**Font')[0] || '';
    assert.ok(
      anchorSection.includes('warn'),
      'anchor-link findings should specify warn level'
    );
    // The text should say anchors don't justify a score cap on their own
    assert.ok(
      anchorSection.includes("don't justify a score cap") ||
      anchorSection.includes('not a score cap') ||
      anchorSection.includes('warn, not a fail'),
      'anchor-link criterion must clarify these are warns, not score-cap triggers'
    );
  });

  it('mobile-menu click failures cap score at 2', () => {
    const navSection = content.split('Navigation adaptation')[1]?.split('Anchor')[0] || '';
    assert.ok(
      navSection.includes('cap at 2') || navSection.includes('score cap'),
      'broken mobile menu (click failure) must trigger score cap at 2'
    );
  });
});


// ─────────────────────────────────────────────
// Tests: Each specialist has correct boundaries
// ─────────────────────────────────────────────

describe('Specialist agent boundaries', () => {
  const files = existsSync(INTERNAL)
    ? readdirSync(INTERNAL).filter(f => f.endsWith('.md') && !f.startsWith('._'))
    : [];

  for (const file of files) {
    describe(file, () => {
      let content, fm;

      it('loads without error', () => {
        content = readFileSync(join(INTERNAL, file), 'utf-8');
        assert.ok(content.length > 200, `${file} seems too short`);
      });

      it('has valid frontmatter', () => {
        const parsed = parseFrontmatter(content);
        fm = parsed.frontmatter;
        assert.ok(fm.name, `${file} missing name`);
        assert.ok(fm.description, `${file} missing description`);
        assert.ok(fm.model, `${file} missing model`);
        assert.ok(fm.tools, `${file} missing tools`);
      });

      it('has Read tool', () => {
        const tools = Array.isArray(fm.tools) ? fm.tools : [];
        assert.ok(tools.includes('Read'), `${file} must have Read tool`);
      });

      it('does NOT have Playwright tools', () => {
        const tools = Array.isArray(fm.tools) ? fm.tools : [];
        const playwright = tools.filter(t =>
          t.includes('playwright') || t.includes('browser')
        );
        assert.equal(playwright.length, 0,
          `${file} must not have Playwright tools, found: ${playwright.join(', ')}`);
      });

      it('does NOT have Write or Edit tools', () => {
        const tools = Array.isArray(fm.tools) ? fm.tools : [];
        assert.ok(!tools.includes('Write'), `${file} must not have Write`);
        assert.ok(!tools.includes('Edit'), `${file} must not have Edit`);
      });

      it('does NOT have Bash or Glob or Grep tools', () => {
        const tools = Array.isArray(fm.tools) ? fm.tools : [];
        assert.ok(!tools.includes('Bash'), `${file} must not have Bash`);
        assert.ok(!tools.includes('Glob'), `${file} must not have Glob`);
        assert.ok(!tools.includes('Grep'), `${file} must not have Grep`);
      });

      it('references scoring.md or ai-slop-patterns.md', () => {
        assert.ok(
          content.includes('scoring.md') || content.includes('ai-slop-patterns.md'),
          `${file} should reference its rubric source`
        );
      });

      it('requires evidence citation', () => {
        assert.ok(
          content.toLowerCase().includes('evidence') &&
          (content.toLowerCase().includes('citation') || content.toLowerCase().includes('cite') || content.toLowerCase().includes('reference')),
          `${file} should require evidence citation in findings`
        );
      });
    });
  }
});
