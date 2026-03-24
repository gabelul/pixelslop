/**
 * Orchestrator + Setup Agent Spec Validation Tests
 *
 * Validates the structural integrity of the orchestrator and setup
 * agent specs — frontmatter fields, tool boundaries, protocol steps,
 * and cross-agent references.
 *
 * Run: node --test tests/orchestrator.test.js
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = join(__dirname, '..', 'dist');

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
// Tests: Orchestrator agent spec
// ─────────────────────────────────────────────

describe('orchestrator agent spec (pixelslop.md)', () => {
  let content, fm, body;

  it('file exists', () => {
    content = readDist('agents/pixelslop.md');
    const parsed = parseFrontmatter(content);
    fm = parsed.frontmatter;
    body = parsed.body;
  });

  it('has correct name', () => {
    assert.equal(fm.name, 'pixelslop');
  });

  it('uses opus model', () => {
    assert.equal(fm.model, 'opus', 'orchestrator should use opus for judgment calls');
  });

  it('has description', () => {
    assert.ok(fm.description, 'missing description');
    assert.ok(fm.description.length > 20, 'description too short');
  });

  it('has correct tool set', () => {
    assert.ok(Array.isArray(fm.tools), 'tools should be an array');
    assert.ok(fm.tools.includes('Read'), 'should have Read tool');
    assert.ok(fm.tools.includes('Bash'), 'should have Bash tool');
    assert.ok(fm.tools.includes('Glob'), 'should have Glob tool');
    assert.ok(fm.tools.includes('Grep'), 'should have Grep tool');
  });

  it('does NOT have Write or Edit tools (capability boundary)', () => {
    assert.ok(!fm.tools.includes('Write'), 'orchestrator must NOT have Write tool');
    assert.ok(!fm.tools.includes('Edit'), 'orchestrator must NOT have Edit tool');
  });

  it('references pixelslop-tools for state management', () => {
    assert.ok(body.includes('pixelslop-tools'), 'should reference pixelslop-tools CLI');
    assert.ok(body.includes('bin/pixelslop-tools.cjs'), 'should reference tool path');
  });

  it('references all subagents', () => {
    assert.ok(body.includes('pixelslop-scanner'), 'should reference scanner');
    assert.ok(body.includes('pixelslop-fixer'), 'should reference fixer');
    assert.ok(body.includes('pixelslop-checker'), 'should reference checker');
    assert.ok(body.includes('pixelslop-setup'), 'should reference setup');
  });

  it('has protocol steps', () => {
    const steps = body.match(/### Step \d+/g) || [];
    assert.ok(steps.length >= 6, `should have at least 6 protocol steps, found ${steps.length}`);
  });

  it('delegates discovery to parent session', () => {
    assert.ok(body.includes('parent session') || body.includes('parent'),
      'should reference parent session handling discovery');
    assert.ok(body.includes('URL is always provided') || body.includes('receives a URL'),
      'should expect URL to be pre-resolved');
  });

  it('handles scan results and fix strategy', () => {
    assert.ok(body.includes('fix strategy') || body.includes('strategy'),
      'should handle fix strategy from parent');
    assert.ok(body.includes('PARTIAL'), 'should handle PARTIAL results');
  });

  it('documents mode selection', () => {
    assert.ok(body.includes('visual-editable'), 'should document visual-editable mode');
    assert.ok(body.includes('visual-report-only'), 'should document report-only mode');
    assert.ok(body.includes('code-check'), 'should document code-check mode');
  });

  it('documents --personas flag', () => {
    assert.ok(body.includes('personas') || body.includes('Personas'),
      'should document personas flag');
  });

  it('documents --thorough flag', () => {
    assert.ok(body.includes('thorough') || body.includes('Thorough'),
      'should document thorough flag');
  });

  it('has rules section', () => {
    assert.ok(body.includes('## Rules'), 'should have rules section');
    assert.ok(body.includes('No direct file edits') || body.includes('no Write'),
      'rules should prohibit direct edits');
  });
});

// ─────────────────────────────────────────────
// Tests: Setup subagent spec
// ─────────────────────────────────────────────

describe('setup subagent spec (pixelslop-setup.md)', () => {
  let content, fm, body;

  it('file exists', () => {
    content = readDist('agents/pixelslop-setup.md');
    const parsed = parseFrontmatter(content);
    fm = parsed.frontmatter;
    body = parsed.body;
  });

  it('has correct name', () => {
    assert.equal(fm.name, 'pixelslop-setup');
  });

  it('uses sonnet model (not opus)', () => {
    assert.equal(fm.model, 'sonnet', 'setup is a subagent, should use sonnet');
  });

  it('has correct tool set (read-only)', () => {
    assert.ok(Array.isArray(fm.tools));
    assert.ok(fm.tools.includes('Read'));
    assert.ok(fm.tools.includes('Bash'));
    assert.ok(fm.tools.includes('Glob'));
    assert.ok(fm.tools.includes('Grep'));
  });

  it('does NOT have Write or Edit tools', () => {
    assert.ok(!fm.tools.includes('Write'), 'setup agent must NOT have Write');
    assert.ok(!fm.tools.includes('Edit'), 'setup agent must NOT have Edit');
  });

  it('returns structured JSON with inferred and questions', () => {
    assert.ok(body.includes('"inferred"'), 'should return inferred context');
    assert.ok(body.includes('"questions"'), 'should return questions array');
  });

  it('detects common frameworks', () => {
    const frameworks = ['Next.js', 'React', 'Vue', 'Svelte', 'Tailwind'];
    let foundCount = 0;
    for (const fw of frameworks) {
      if (body.includes(fw)) foundCount++;
    }
    assert.ok(foundCount >= 3, `should detect multiple frameworks, found ${foundCount}`);
  });

  it('limits questions to 2-4', () => {
    assert.ok(body.includes('2-4 questions') || body.includes('2-4'),
      'should limit question count');
  });

  it('explicitly cannot ask user questions directly', () => {
    assert.ok(body.includes('cannot talk to the user') || body.includes('not ask the user'),
      'should state it cannot ask user directly');
  });
});

// ─────────────────────────────────────────────
// Tests: Agent cross-references
// ─────────────────────────────────────────────

describe('agent cross-references', () => {
  it('all referenced agent files exist', () => {
    const agents = ['pixelslop.md', 'pixelslop-scanner.md', 'pixelslop-fixer.md',
      'pixelslop-checker.md', 'pixelslop-setup.md'];
    for (const agent of agents) {
      const fullPath = join(DIST, 'agents', agent);
      assert.ok(existsSync(fullPath), `Missing agent file: ${agent}`);
    }
  });

  it('fixer uses pixelslop-tools for checkpoints', () => {
    const fixer = readDist('agents/pixelslop-fixer.md');
    assert.ok(fixer.includes('pixelslop-tools') || fixer.includes('pixelslop-tools.cjs'),
      'fixer should reference pixelslop-tools');
    assert.ok(fixer.includes('checkpoint create'), 'fixer should use checkpoint create');
  });

  it('checker uses pixelslop-tools for plan updates', () => {
    const checker = readDist('agents/pixelslop-checker.md');
    assert.ok(checker.includes('pixelslop-tools') || checker.includes('pixelslop-tools.cjs'),
      'checker should reference pixelslop-tools');
    assert.ok(checker.includes('plan update') || checker.includes('checkpoint'),
      'checker should use pixelslop-tools commands');
  });

  it('fixer has Write/Edit tools (capability boundary)', () => {
    const fixer = readDist('agents/pixelslop-fixer.md');
    const parsed = parseFrontmatter(fixer);
    assert.ok(parsed.frontmatter.tools.includes('Write'), 'fixer must have Write');
    assert.ok(parsed.frontmatter.tools.includes('Edit'), 'fixer must have Edit');
  });

  it('checker does NOT have Write/Edit tools (capability boundary)', () => {
    const checker = readDist('agents/pixelslop-checker.md');
    const parsed = parseFrontmatter(checker);
    assert.ok(!parsed.frontmatter.tools.includes('Write'), 'checker must NOT have Write');
    assert.ok(!parsed.frontmatter.tools.includes('Edit'), 'checker must NOT have Edit');
  });

  it('SKILL.md references all agents', () => {
    const skill = readDist('skill/SKILL.md');
    assert.ok(skill.includes('pixelslop-scanner'), 'SKILL should reference scanner');
    assert.ok(skill.includes('pixelslop-fixer'), 'SKILL should reference fixer');
    assert.ok(skill.includes('pixelslop-checker'), 'SKILL should reference checker');
    assert.ok(skill.includes('pixelslop-setup'), 'SKILL should reference setup');
  });

  it('SKILL.md references pixelslop-tools', () => {
    const skill = readDist('skill/SKILL.md');
    assert.ok(skill.includes('pixelslop-tools'), 'SKILL should reference pixelslop-tools');
  });

  it('SKILL.md handles discovery and server startup before orchestrator', () => {
    const skill = readDist('skill/SKILL.md');
    assert.ok(skill.includes('discover server'), 'SKILL should handle server discovery');
    assert.ok(skill.includes('discover start-target'), 'SKILL should handle start-target discovery');
    assert.ok(skill.includes('discover static-site'), 'SKILL should handle static-site discovery');
    assert.ok(skill.includes('serve start'), 'SKILL should handle temp server startup');
    assert.ok(skill.includes('serve stop'), 'SKILL should handle temp server cleanup');
    assert.ok(skill.includes('AskUserQuestion'), 'SKILL should use AskUserQuestion for user prompts');
  });
});
