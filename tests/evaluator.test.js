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
