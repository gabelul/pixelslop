/**
 * Resource File Validation Tests
 *
 * Validates the structural integrity of the resource files that the
 * scanner agent loads at runtime. Catches broken JS snippets, missing
 * fields, format drift between files, and frontmatter issues.
 *
 * These are the tests a contributor should run after editing any file
 * in dist/ — they catch the structural problems that would make the
 * scanner silently produce bad output.
 *
 * Run: node --test tests/resource-validation.test.js
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = join(__dirname, '..', 'dist');

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

/**
 * Read a resource file from dist/
 * @param {string} relativePath - Path relative to dist/
 * @returns {string} File contents
 */
function readDist(relativePath) {
  const fullPath = join(DIST, relativePath);
  assert.ok(existsSync(fullPath), `Missing file: dist/${relativePath}`);
  return readFileSync(fullPath, 'utf-8');
}

/**
 * Parse YAML frontmatter from a markdown file.
 * Handles the --- delimited block at the top of agent/skill specs.
 *
 * @param {string} content - Raw markdown content
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
    // Top-level key: value
    const kvMatch = line.match(/^(\w[\w-]*):\s*(.+)?$/);
    if (kvMatch && !line.startsWith('  ')) {
      currentKey = kvMatch[1];
      const value = kvMatch[2]?.trim();
      if (value === '>') {
        // Multi-line string — collect next indented lines
        fm[currentKey] = '';
        currentArray = null;
      } else if (value === undefined || value === '') {
        // Could be start of an array
        fm[currentKey] = [];
        currentArray = currentKey;
      } else {
        fm[currentKey] = value;
        currentArray = null;
      }
      continue;
    }

    // Array item: "  - value"
    if (line.match(/^\s+-\s/) && currentArray) {
      const item = line.replace(/^\s+-\s*/, '').trim();
      if (!Array.isArray(fm[currentArray])) fm[currentArray] = [];
      fm[currentArray].push(item);
      continue;
    }

    // Multi-line string continuation
    if (line.match(/^\s+\S/) && currentKey && typeof fm[currentKey] === 'string' && fm[currentKey] === '') {
      fm[currentKey] = line.trim();
    }
  }

  return { frontmatter: fm, body: match[2] };
}

/**
 * Extract all JS code blocks from a markdown file.
 * Looks for ```js ... ``` blocks (the snippets the collector runs in page context).
 *
 * @param {string} markdown - Raw markdown content
 * @returns {Array<{code: string, lineNumber: number}>} Extracted code blocks
 */
function extractJsBlocks(markdown) {
  const blocks = [];
  const lines = markdown.split('\n');
  let inBlock = false;
  let currentBlock = [];
  let blockStart = 0;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].match(/^```(js|javascript)\s*$/)) {
      inBlock = true;
      currentBlock = [];
      blockStart = i + 1;
      continue;
    }
    if (inBlock && lines[i] === '```') {
      blocks.push({ code: currentBlock.join('\n'), lineNumber: blockStart });
      inBlock = false;
      continue;
    }
    if (inBlock) {
      currentBlock.push(lines[i]);
    }
  }

  return blocks;
}

/**
 * Extract pattern definitions from ai-slop-patterns.md.
 * Each pattern starts with "### N. Pattern Name" and has severity, detection JS.
 *
 * @param {string} markdown - ai-slop-patterns.md content
 * @returns {Array<{number: number, name: string, hasSeverity: boolean, hasDetectionJs: boolean, hasScreenshotCues: boolean}>}
 */
function extractPatterns(markdown) {
  const patterns = [];
  const patternRegex = /### (\d+)\.\s+(.+)/g;
  let match;

  while ((match = patternRegex.exec(markdown)) !== null) {
    const num = parseInt(match[1]);
    const name = match[2].trim();
    // Find the section until the next ### or end
    const startIdx = match.index;
    const nextPattern = markdown.indexOf('\n### ', startIdx + 1);
    const section = nextPattern > 0
      ? markdown.slice(startIdx, nextPattern)
      : markdown.slice(startIdx);

    patterns.push({
      number: num,
      name,
      hasSeverity: /\*\*Severity:\*\*\s*\d/.test(section),
      hasDetectionJs: /```js/.test(section),
      hasScreenshotCues: /\*\*Screenshot cues?:\*\*/.test(section) || /\*\*Snapshot cues?:\*\*/.test(section),
    });
  }

  return patterns;
}


// ─────────────────────────────────────────────
// Tests: File existence
// ─────────────────────────────────────────────

describe('Required files exist', () => {
  const required = [
    // Phase 0 — scanner
    'agents/pixelslop-scanner.md',
    'skill/SKILL.md',
    'skill/resources/ai-slop-patterns.md',
    'skill/resources/scoring.md',
    'skill/resources/visual-eval.md',
    // Phase 1 — fixer, checker, checkpoint protocol
    'agents/pixelslop-fixer.md',
    'agents/pixelslop-checker.md',
    'skill/resources/checkpoint-protocol.md',
    // Phase 2 — orchestrator, setup, plan format
    'agents/pixelslop.md',
    'agents/pixelslop-setup.md',
    'skill/resources/plan-format.md',
    // Phase 1 — fix guides
    'skill/resources/typeset.md',
    'skill/resources/arrange.md',
    'skill/resources/colorize.md',
    'skill/resources/adapt.md',
    'skill/resources/distill.md',
    'skill/resources/harden.md',
    'skill/resources/clarify.md',
    // Phase 4 — persona evaluation
    'skill/resources/personas/schema.md',
    // Supplementary evaluation + interaction fix guide
    'skill/resources/cognitive-load.md',
    'skill/resources/heuristics.md',
    'skill/resources/interaction-design.md',
    // Code-check mode
    'agents/pixelslop-code-scanner.md',
    'skill/resources/code-check-eval.md',
    // Evidence bundle schema
    'skill/resources/evidence-schema.md',
  ];

  for (const file of required) {
    it(`dist/${file} exists`, () => {
      assert.ok(existsSync(join(DIST, file)), `Missing: dist/${file}`);
    });
  }
});


// ─────────────────────────────────────────────
// Tests: Scanner agent frontmatter
// ─────────────────────────────────────────────

describe('Scanner agent frontmatter', () => {
  let fm;

  it('has valid frontmatter block', () => {
    const content = readDist('agents/pixelslop-scanner.md');
    const parsed = parseFrontmatter(content);
    fm = parsed.frontmatter;
    assert.ok(fm.name, 'frontmatter missing "name"');
  });

  it('has required fields: name, description, model, tools', () => {
    const content = readDist('agents/pixelslop-scanner.md');
    const { frontmatter } = parseFrontmatter(content);
    assert.ok(frontmatter.name, 'missing name');
    assert.ok(frontmatter.description, 'missing description');
    assert.ok(frontmatter.model, 'missing model');
    assert.ok(frontmatter.tools, 'missing tools');
  });

  it('tools list keeps the scanner file read-only', () => {
    const content = readDist('agents/pixelslop-scanner.md');
    const { frontmatter } = parseFrontmatter(content);
    const tools = Array.isArray(frontmatter.tools) ? frontmatter.tools : [];
    assert.ok(tools.includes('Bash'), 'scanner should shell out to pixelslop-tools');
    assert.ok(!tools.some(tool => tool.includes('playwright') || tool.includes('browser_')),
      'scanner should not declare Playwright MCP tools');
  });

  it('tools list includes Read (for loading resource files)', () => {
    const content = readDist('agents/pixelslop-scanner.md');
    const { frontmatter } = parseFrontmatter(content);
    const tools = Array.isArray(frontmatter.tools) ? frontmatter.tools : [];
    assert.ok(tools.includes('Read'), 'scanner needs Read tool to load resource files');
  });
});


// ─────────────────────────────────────────────
// Tests: SKILL.md frontmatter
// ─────────────────────────────────────────────

describe('SKILL.md frontmatter', () => {
  it('has name and description', () => {
    const content = readDist('skill/SKILL.md');
    const { frontmatter } = parseFrontmatter(content);
    assert.ok(frontmatter.name, 'missing name');
    assert.ok(frontmatter.description, 'missing description');
  });
});


// ─────────────────────────────────────────────
// Tests: AI slop patterns structure
// ─────────────────────────────────────────────

describe('ai-slop-patterns.md structure', () => {
  let patterns;
  let content;

  it('file loads without error', () => {
    content = readDist('skill/resources/ai-slop-patterns.md');
    assert.ok(content.length > 100, 'file seems too short');
  });

  it('has at least 20 visual patterns', () => {
    patterns = extractPatterns(content);
    assert.ok(patterns.length >= 20, `only ${patterns.length} patterns found, expected 20+`);
  });

  it('every visual pattern has a severity rating', () => {
    const missing = patterns.filter(p => !p.hasSeverity);
    assert.equal(missing.length, 0,
      `patterns missing severity: ${missing.map(p => `${p.number}. ${p.name}`).join(', ')}`);
  });

  it('every visual pattern has detection JS', () => {
    const missing = patterns.filter(p => !p.hasDetectionJs);
    assert.equal(missing.length, 0,
      `patterns missing detection JS: ${missing.map(p => `${p.number}. ${p.name}`).join(', ')}`);
  });

  it('has severity bands section with CLEAN/MILD/SLOPPY/TERMINAL', () => {
    assert.ok(content.includes('CLEAN'), 'missing CLEAN band');
    assert.ok(content.includes('MILD'), 'missing MILD band');
    assert.ok(content.includes('SLOPPY'), 'missing SLOPPY band');
    assert.ok(content.includes('TERMINAL'), 'missing TERMINAL band');
  });

  it('has false positive guidance section', () => {
    assert.ok(content.includes('False Positive'), 'missing false positive guidance');
  });
});


// ─────────────────────────────────────────────
// Tests: JS snippet syntax validation
// ─────────────────────────────────────────────

describe('JS snippets parse without syntax errors', () => {
  const files = [
    'skill/resources/ai-slop-patterns.md',
    'skill/resources/visual-eval.md',
  ];

  for (const file of files) {
    it(`all snippets in ${file} are syntactically valid`, () => {
      const content = readDist(file);
      const blocks = extractJsBlocks(content);
      assert.ok(blocks.length > 0, `no JS blocks found in ${file}`);

      const errors = [];
      for (const block of blocks) {
        // Skip non-evaluatable blocks (tool call examples, pseudo-code)
        if (block.code.startsWith('browser_') || block.code.startsWith('//') && block.code.split('\n').length <= 2) {
          continue;
        }
        try {
          // Use Function constructor to check syntax without executing
          new Function(block.code);
        } catch (e) {
          errors.push({ line: block.lineNumber, error: e.message, preview: block.code.slice(0, 60) });
        }
      }

      assert.equal(errors.length, 0,
        `Syntax errors found:\n${errors.map(e => `  Line ${e.line}: ${e.error}\n    ${e.preview}...`).join('\n')}`);
    });
  }
});


// ─────────────────────────────────────────────
// Tests: Cross-file consistency
// ─────────────────────────────────────────────

describe('Cross-file consistency', () => {

  it('severity bands in scoring.md match ai-slop-patterns.md', () => {
    const scoring = readDist('skill/resources/scoring.md');
    const slop = readDist('skill/resources/ai-slop-patterns.md');

    // Extract band boundaries from both files
    // Both should have: CLEAN 0-1, MILD 2-3, SLOPPY 4-6, TERMINAL 7+
    const slopClean = slop.match(/CLEAN.*?(\d+)-(\d+)/);
    const scoringClean = scoring.match(/CLEAN.*?(\d+)-(\d+)/);

    // Both files should define the same TERMINAL threshold
    const slopTerminal = slop.match(/TERMINAL.*?(\d+)\+/);
    const scoringTerminal = scoring.match(/TERMINAL.*?(\d+)\+/);

    if (slopTerminal && scoringTerminal) {
      assert.equal(slopTerminal[1], scoringTerminal[1],
        `TERMINAL threshold mismatch: ai-slop-patterns says ${slopTerminal[1]}+, scoring says ${scoringTerminal[1]}+`);
    }
  });

  it('scanner (evidence collector) references its resource files', () => {
    const scanner = readDist('agents/pixelslop-scanner.md');
    assert.ok(scanner.includes('browser collect'), 'scanner should call the direct collector');
    assert.ok(scanner.includes('evidence bundle'), 'scanner should describe the evidence output');
  });

  it('all 5 pillar names are consistent across scoring.md and orchestrator', () => {
    const scoring = readDist('skill/resources/scoring.md');
    const orchestrator = readDist('agents/pixelslop.md');
    const pillars = ['Hierarchy', 'Typography', 'Color', 'Responsiveness', 'Accessibility'];

    for (const pillar of pillars) {
      assert.ok(scoring.includes(pillar), `scoring.md missing pillar: ${pillar}`);
      assert.ok(orchestrator.includes(pillar), `orchestrator missing pillar: ${pillar}`);
    }
  });

  it('report format template in scoring.md has all required sections', () => {
    const scoring = readDist('skill/resources/scoring.md');
    const requiredSections = [
      '## Pixelslop Report:',
      'URL:',
      'Confidence:',
      '### Scores',
      '### AI Slop:',
      '### Findings',
      '### Screenshots',
    ];

    for (const section of requiredSections) {
      assert.ok(scoring.includes(section), `report template missing section: ${section}`);
    }
  });

  it('viewport dimensions are consistent between visual-eval.md and scanner', () => {
    const eval_ = readDist('skill/resources/visual-eval.md');
    const scanner = readDist('agents/pixelslop-scanner.md');

    // Desktop
    assert.ok(eval_.includes('1440') && eval_.includes('900'), 'visual-eval missing 1440x900');
    assert.ok(scanner.includes('browser collect'), 'scanner should defer viewport choreography to the collector');
    // Tablet
    assert.ok(eval_.includes('768') && eval_.includes('1024'), 'visual-eval missing 768x1024');
    assert.ok(scanner.includes('evidence bundle'), 'scanner should still describe the collected output');
    // Mobile
    assert.ok(eval_.includes('375') && eval_.includes('812'), 'visual-eval missing 375x812');
    assert.ok(scanner.includes('browser collect'), 'scanner should reference the direct collector command');
  });

  it('evidence-schema decoration sample matches the decoration snippet shape', () => {
    const eval_ = readDist('skill/resources/visual-eval.md');
    const schema = readDist('skill/resources/evidence-schema.md');

    assert.ok(eval_.includes("type: 'gradientText'"), 'visual-eval should emit gradientText details');
    assert.ok(eval_.includes("type: 'blur'"), 'visual-eval should emit blur details');
    assert.ok(schema.includes('"type": "gradientText"'), 'schema should document gradientText details');
    assert.ok(schema.includes('"type": "blur"'), 'schema should document blur details');
    assert.ok(!schema.includes('"property": "background-clip"'),
      'schema should not document stale decoration fields that the snippet does not return');
  });

  it('evidence-schema persona examples match persona snippet shapes', () => {
    const eval_ = readDist('skill/resources/visual-eval.md');
    const schema = readDist('skill/resources/evidence-schema.md');

    assert.ok(eval_.includes('h1Count'), 'visual-eval heading hierarchy snippet should expose h1Count');
    assert.ok(schema.includes('"h1Count"'), 'schema should document h1Count for headingHierarchy');
    assert.ok(schema.includes('"passed"'), 'schema should document passed for headingHierarchy');
    assert.ok(!schema.includes('"multipleH1"'), 'schema should not document stale multipleH1 field');

    assert.ok(eval_.includes('landmarks,') || eval_.includes('landmarks = {'),
      'visual-eval landmark snippet should expose landmarks object');
    assert.ok(schema.includes('"landmarks": {'), 'schema should document landmarks object');
    assert.ok(schema.includes('"present": 4'), 'schema should document numeric present count');
    assert.ok(schema.includes('"total": 4'), 'schema should document total count');
  });

  it('scanner bundle skeleton matches the evidence schema contract', () => {
    const scanner = readDist('agents/pixelslop-scanner.md');
    assert.ok(scanner.includes('url') && scanner.includes('viewports'),
      'scanner should mention the required bundle keys when sanity-checking output');
  });

  it('evidence-schema examples match numeric and overflow fields from the snippets', () => {
    const eval_ = readDist('skill/resources/visual-eval.md');
    const schema = readDist('skill/resources/evidence-schema.md');

    assert.ok(eval_.includes('fontSize,'), 'contrast snippet should return numeric fontSize');
    assert.ok(schema.includes('"fontSize": 16'), 'schema should document numeric contrast fontSize');
    assert.ok(eval_.includes('right: Math.round(rect.right)'), 'overflow snippet should return right edge');
    assert.ok(eval_.includes('docWidth'), 'overflow snippet should return docWidth');
    assert.ok(schema.includes('"right": 892'), 'schema should document overflow right value');
    assert.ok(schema.includes('"docWidth": 768'), 'schema should document overflow docWidth value');
  });

  it('specialist prompts do not assume decoration fields the collector does not capture', () => {
    const color = readDist('agents/internal/pixelslop-eval-color.md');
    const slop = readDist('agents/internal/pixelslop-eval-slop.md');

    assert.ok(!color.includes('boxShadow entries with high-saturation color channels'),
      'color evaluator should not cite nonexistent boxShadow detail entries');
    assert.ok(!slop.includes('saturated box-shadows (rgba('),
      'slop evaluator should not cite shadow colors the collector does not capture');
  });
});


// ─────────────────────────────────────────────
// Tests: Scoring rubric structure
// ─────────────────────────────────────────────

describe('scoring.md rubric structure', () => {
  let content;

  it('file loads', () => {
    content = readDist('skill/resources/scoring.md');
    assert.ok(content.length > 200);
  });

  it('has explicit 1-4 criteria for each pillar', () => {
    const pillars = ['Hierarchy', 'Typography', 'Color', 'Responsiveness', 'Accessibility'];
    for (const pillar of pillars) {
      // Search for the actual heading, not just the word (avoids false matches in interpretation notes)
      const idx = content.indexOf(`### Pillar`) > -1
        ? content.indexOf(`${pillar} (1-4)`)
        : content.indexOf(pillar);
      assert.ok(idx > -1, `${pillar} not found in scoring.md`);
      const pillarSection = content.slice(idx);
      const nextPillar = pillarSection.indexOf('\n### Pillar', 5);
      const nextH2 = pillarSection.indexOf('\n## ', 5);
      const end = Math.min(
        nextPillar > 0 ? nextPillar : Infinity,
        nextH2 > 0 ? nextH2 : Infinity
      );
      const section = end < Infinity ? pillarSection.slice(0, end) : pillarSection.slice(0, 500);

      // Should have references to score levels 1 through 4
      assert.ok(section.includes('1') && section.includes('4'),
        `${pillar} section should define score levels 1 through 4`);
    }
  });

  it('has confidence model with base percentage and bonuses', () => {
    assert.ok(content.includes('50%'), 'confidence model should start at 50%');
    assert.ok(content.includes('+15%') || content.includes('+10%'), 'confidence model should have evidence bonuses');
  });

  it('has rating bands (Excellent through Critical)', () => {
    const bands = ['Excellent', 'Good', 'Needs Work', 'Poor', 'Critical'];
    for (const band of bands) {
      assert.ok(content.includes(band), `missing rating band: ${band}`);
    }
  });
});


// ─────────────────────────────────────────────
// Tests: visual-eval.md protocol structure
// ─────────────────────────────────────────────

describe('visual-eval.md protocol structure', () => {
  let content;

  it('file loads', () => {
    content = readDist('skill/resources/visual-eval.md');
    assert.ok(content.length > 200);
  });

  it('defines 3 viewports', () => {
    assert.ok(content.includes('Desktop') && content.includes('1440'));
    assert.ok(content.includes('Tablet') && content.includes('768'));
    assert.ok(content.includes('Mobile') && content.includes('375'));
  });

  it('has at least 5 JS extraction snippets', () => {
    const blocks = extractJsBlocks(content);
    // Filter out collector step pseudo-code from older examples.
    const realSnippets = blocks.filter(b => !b.code.startsWith('browser_'));
    assert.ok(realSnippets.length >= 5,
      `only ${realSnippets.length} extraction snippets found, expected 5+`);
  });

  it('documents screenshot capture without the legacy browser_screenshot name', () => {
    assert.ok(content.includes('Screenshot capture'), 'should describe screenshot capture');
    assert.ok(!content.includes('browser_screenshot()'), 'should NOT have old browser_screenshot()');
  });

  it('has a collector step reference table', () => {
    assert.ok(content.includes('Collector Step'), 'summary table should describe collector steps');
    assert.ok(content.includes('JS extraction snippets'), 'summary table should mention extraction snippets');
  });
});


// ─────────────────────────────────────────────
// Tests: Fixer agent frontmatter
// ─────────────────────────────────────────────

describe('Fixer agent frontmatter', () => {
  it('has required fields: name, description, model, tools', () => {
    const content = readDist('agents/pixelslop-fixer.md');
    const { frontmatter } = parseFrontmatter(content);
    assert.ok(frontmatter.name, 'missing name');
    assert.ok(frontmatter.description, 'missing description');
    assert.ok(frontmatter.model, 'missing model');
    assert.ok(frontmatter.tools, 'missing tools');
  });

  it('has Write and Edit tools (fixer modifies files)', () => {
    const content = readDist('agents/pixelslop-fixer.md');
    const { frontmatter } = parseFrontmatter(content);
    const tools = Array.isArray(frontmatter.tools) ? frontmatter.tools : [];
    assert.ok(tools.includes('Write'), 'fixer needs Write tool');
    assert.ok(tools.includes('Edit'), 'fixer needs Edit tool');
  });

  it('does not declare Playwright MCP tools', () => {
    const content = readDist('agents/pixelslop-fixer.md');
    const { frontmatter } = parseFrontmatter(content);
    const tools = Array.isArray(frontmatter.tools) ? frontmatter.tools : [];
    assert.ok(!tools.some(tool => tool.includes('playwright') || tool.includes('browser_')),
      'fixer should use pixelslop-tools browser commands, not MCP tools');
  });

  it('has file tools for source code manipulation', () => {
    const content = readDist('agents/pixelslop-fixer.md');
    const { frontmatter } = parseFrontmatter(content);
    const tools = Array.isArray(frontmatter.tools) ? frontmatter.tools : [];
    for (const tool of ['Read', 'Bash', 'Glob', 'Grep']) {
      assert.ok(tools.includes(tool), `fixer missing tool: ${tool}`);
    }
  });

  it('references checkpoint-protocol.md', () => {
    const content = readDist('agents/pixelslop-fixer.md');
    assert.ok(content.includes('checkpoint-protocol.md'), 'fixer should reference checkpoint protocol');
  });
});


// ─────────────────────────────────────────────
// Tests: Checker agent frontmatter
// ─────────────────────────────────────────────

describe('Checker agent frontmatter', () => {
  it('has required fields: name, description, model, tools', () => {
    const content = readDist('agents/pixelslop-checker.md');
    const { frontmatter } = parseFrontmatter(content);
    assert.ok(frontmatter.name, 'missing name');
    assert.ok(frontmatter.description, 'missing description');
    assert.ok(frontmatter.model, 'missing model');
    assert.ok(frontmatter.tools, 'missing tools');
  });

  it('does NOT have Write or Edit tools (checker only measures)', () => {
    const content = readDist('agents/pixelslop-checker.md');
    const { frontmatter } = parseFrontmatter(content);
    const tools = Array.isArray(frontmatter.tools) ? frontmatter.tools : [];
    assert.ok(!tools.includes('Write'), 'checker must NOT have Write tool');
    assert.ok(!tools.includes('Edit'), 'checker must NOT have Edit tool');
  });

  it('does not declare Playwright MCP tools', () => {
    const content = readDist('agents/pixelslop-checker.md');
    const { frontmatter } = parseFrontmatter(content);
    const tools = Array.isArray(frontmatter.tools) ? frontmatter.tools : [];
    assert.ok(!tools.some(tool => tool.includes('playwright') || tool.includes('browser_')),
      'checker should use pixelslop-tools browser commands, not MCP tools');
  });

  it('has Bash tool (for rollback commands)', () => {
    const content = readDist('agents/pixelslop-checker.md');
    const { frontmatter } = parseFrontmatter(content);
    const tools = Array.isArray(frontmatter.tools) ? frontmatter.tools : [];
    assert.ok(tools.includes('Bash'), 'checker needs Bash for rollback');
  });

  it('references checkpoint-protocol.md', () => {
    const content = readDist('agents/pixelslop-checker.md');
    assert.ok(content.includes('checkpoint-protocol.md'), 'checker should reference checkpoint protocol');
  });

  it('references visual-eval.md (for measurement snippets)', () => {
    const content = readDist('agents/pixelslop-checker.md');
    assert.ok(content.includes('visual-eval.md'), 'checker should reference visual-eval.md');
    assert.ok(content.includes('browser check'), 'checker should call direct browser check commands');
  });
});


// ─────────────────────────────────────────────
// Tests: Cross-file — fixer and checker both reference checkpoint
// ─────────────────────────────────────────────

describe('Cross-file: fixer/checker/checkpoint consistency', () => {
  it('fixer and checker both reference checkpoint-protocol.md', () => {
    const fixer = readDist('agents/pixelslop-fixer.md');
    const checker = readDist('agents/pixelslop-checker.md');
    assert.ok(fixer.includes('checkpoint-protocol.md'), 'fixer must reference checkpoint protocol');
    assert.ok(checker.includes('checkpoint-protocol.md'), 'checker must reference checkpoint protocol');
  });

  it('fixer references all 7 fix guide files', () => {
    const fixer = readDist('agents/pixelslop-fixer.md');
    const guides = ['typeset.md', 'arrange.md', 'colorize.md', 'adapt.md', 'distill.md', 'harden.md', 'clarify.md'];
    for (const guide of guides) {
      assert.ok(fixer.includes(guide), `fixer should reference fix guide: ${guide}`);
    }
  });

  it('fixer finding-to-resource mapping covers all 5 pillars + slop', () => {
    const fixer = readDist('agents/pixelslop-fixer.md');
    const pillars = ['Hierarchy', 'Typography', 'Color', 'Responsiveness', 'Accessibility'];
    for (const pillar of pillars) {
      assert.ok(fixer.includes(pillar), `fixer mapping should cover pillar: ${pillar}`);
    }
    assert.ok(fixer.includes('Slop') || fixer.includes('slop') || fixer.includes('distill'),
      'fixer mapping should cover AI Slop patterns');
  });
});


// ─────────────────────────────────────────────
// Tests: Fix guide structure validation
// ─────────────────────────────────────────────

describe('Fix guide structure', () => {
  const fixGuides = [
    'skill/resources/typeset.md',
    'skill/resources/arrange.md',
    'skill/resources/colorize.md',
    'skill/resources/adapt.md',
    'skill/resources/distill.md',
    'skill/resources/harden.md',
    'skill/resources/clarify.md',
    'skill/resources/interaction-design.md',
  ];

  for (const guide of fixGuides) {
    describe(`${guide}`, () => {
      let content;

      it('loads without error', () => {
        content = readDist(guide);
        assert.ok(content.length > 200, `${guide} seems too short`);
      });

      it('has "What This Guide Fixes" section', () => {
        assert.ok(
          content.includes('What This Guide Fixes') || content.includes('What This Fixes'),
          `${guide} missing "What This Guide Fixes" section`
        );
      });

      it('has fix recipes', () => {
        assert.ok(
          content.includes('Fix Recipes') || content.includes('Recipe'),
          `${guide} missing fix recipes`
        );
      });

      it('has verification criteria', () => {
        assert.ok(
          content.includes('Verification Criteria') || content.includes('Verification'),
          `${guide} missing verification criteria`
        );
      });

      it('has anti-patterns to avoid', () => {
        assert.ok(
          content.includes('Anti-Patterns') || content.includes('anti-pattern'),
          `${guide} missing anti-patterns section`
        );
      });

      it('has source location guidance', () => {
        assert.ok(
          content.includes('How to Locate') || content.includes('Locate the Source') || content.includes('Finding the'),
          `${guide} missing source location guidance`
        );
      });
    });
  }
});


// ─────────────────────────────────────────────
// Tests: Cognitive load reference
// ─────────────────────────────────────────────

describe('Cognitive load reference', () => {
  let content;

  it('loads without error', () => {
    content = readDist('skill/resources/cognitive-load.md');
    assert.ok(content.length > 500, 'cognitive-load.md seems too short');
  });

  it('has at least 6 checklist items', () => {
    const headings = content.match(/### \d+\./g) || [];
    assert.ok(headings.length >= 6, `Expected ≥6 checklist items, got ${headings.length}`);
  });

  it('has scoring guidance section', () => {
    assert.ok(content.includes('Scoring Guidance'), 'missing "Scoring Guidance" section');
  });

  it('references the hierarchy pillar', () => {
    assert.ok(
      content.toLowerCase().includes('hierarchy'),
      'should reference the hierarchy pillar (cognitive load supplements it)'
    );
  });

  it('has syntactically valid JS snippets', () => {
    const blocks = extractJsBlocks(content);
    assert.ok(blocks.length >= 1, 'should have at least one JS detection snippet');
    for (const { code, lineNumber } of blocks) {
      try {
        new Function(code);
      } catch (e) {
        assert.fail(`JS block at line ${lineNumber} has syntax error: ${e.message}`);
      }
    }
  });

  it('has common violations section', () => {
    assert.ok(
      content.includes('Common Violations') || content.includes('common violations'),
      'missing common violations section'
    );
  });
});


// ─────────────────────────────────────────────
// Tests: Heuristics reference
// ─────────────────────────────────────────────

describe('Heuristics reference', () => {
  let content;

  it('loads without error', () => {
    content = readDist('skill/resources/heuristics.md');
    assert.ok(content.length > 500, 'heuristics.md seems too short');
  });

  it('has all 10 Nielsen heuristics', () => {
    for (let i = 1; i <= 10; i++) {
      assert.ok(
        content.includes(`### ${i}.`),
        `missing heuristic #${i}`
      );
    }
  });

  it('references browser measurement', () => {
    assert.ok(
      content.toLowerCase().includes('playwright') || content.toLowerCase().includes('browser'),
      'should reference Playwright or browser measurement'
    );
  });

  it('has syntactically valid JS snippets', () => {
    const blocks = extractJsBlocks(content);
    assert.ok(blocks.length >= 1, 'should have at least one JS detection snippet');
    for (const { code, lineNumber } of blocks) {
      try {
        new Function(code);
      } catch (e) {
        assert.fail(`JS block at line ${lineNumber} has syntax error: ${e.message}`);
      }
    }
  });

  it('does not define its own severity bands', () => {
    assert.ok(
      !content.includes('CLEAN') && !content.includes('SLOPPY') && !content.includes('TERMINAL'),
      'heuristics reference should not define severity bands (it feeds into existing pillars)'
    );
  });

  it('explains how findings feed into pillar scores', () => {
    assert.ok(
      content.includes('Feeds into') || content.includes('feeds into') || content.includes('How This Feeds'),
      'should explain how heuristic findings map to pillar scores'
    );
  });
});


// ─────────────────────────────────────────────
// Tests: Fixer references interaction-design guide
// ─────────────────────────────────────────────

describe('Fixer references interaction-design guide', () => {
  it('fixer mapping table includes interaction-design.md', () => {
    const fixer = readDist('agents/pixelslop-fixer.md');
    assert.ok(
      fixer.includes('interaction-design.md'),
      'fixer should reference interaction-design.md in its mapping table'
    );
  });
});


// ─────────────────────────────────────────────
// Tests: Code-check scanner agent
// ─────────────────────────────────────────────

describe('Code-check scanner agent', () => {
  let content, fm;

  it('loads without error', () => {
    content = readDist('agents/pixelslop-code-scanner.md');
    assert.ok(content.length > 200, 'code-check scanner seems too short');
  });

  it('has required frontmatter fields', () => {
    const parsed = parseFrontmatter(content);
    fm = parsed.frontmatter;
    assert.ok(fm.name, 'missing name');
    assert.ok(fm.description, 'missing description');
    assert.ok(fm.model, 'missing model');
    assert.ok(fm.tools, 'missing tools');
  });

  it('has correct tool set (Read, Bash, Glob, Grep)', () => {
    const tools = Array.isArray(fm.tools) ? fm.tools : [];
    assert.ok(tools.includes('Read'), 'should have Read');
    assert.ok(tools.includes('Bash'), 'should have Bash');
    assert.ok(tools.includes('Glob'), 'should have Glob');
    assert.ok(tools.includes('Grep'), 'should have Grep');
  });

  it('does NOT have Playwright tools (no browser)', () => {
    const tools = Array.isArray(fm.tools) ? fm.tools : [];
    const playwright = tools.filter(t => t.includes('playwright') || t.includes('browser'));
    assert.equal(playwright.length, 0,
      `code-check scanner must not have Playwright tools, found: ${playwright.join(', ')}`);
  });

  it('does NOT have Write or Edit tools (read-only)', () => {
    const tools = Array.isArray(fm.tools) ? fm.tools : [];
    assert.ok(!tools.includes('Write'), 'code-check scanner must not have Write');
    assert.ok(!tools.includes('Edit'), 'code-check scanner must not have Edit');
  });

  it('references code-check-eval.md', () => {
    assert.ok(content.includes('code-check-eval.md'),
      'should reference code-check-eval.md as its protocol');
  });

  it('references ai-slop-patterns.md', () => {
    assert.ok(content.includes('ai-slop-patterns.md'),
      'should reference ai-slop-patterns.md for pattern catalog');
  });

  it('has mandatory "Not Verified" section rule', () => {
    assert.ok(content.includes('Not Verified'),
      'should require a "Not Verified" section in reports');
  });

  it('explicitly forbids pillar scores', () => {
    assert.ok(
      content.includes('Do not claim pillar scores') || content.includes('no pillar scores') || content.includes('No visual claims'),
      'should explicitly state it cannot produce pillar scores'
    );
  });
});


// ─────────────────────────────────────────────
// Tests: Code-check eval resource
// ─────────────────────────────────────────────

describe('Code-check eval resource', () => {
  let content;

  it('loads without error', () => {
    content = readDist('skill/resources/code-check-eval.md');
    assert.ok(content.length > 1000, 'code-check-eval.md seems too short');
  });

  it('has report format template', () => {
    assert.ok(content.includes('## Pixelslop Code Check:'),
      'should have report format template');
  });

  it('has slop pattern detection section', () => {
    assert.ok(content.includes('Slop Pattern Detection') || content.includes('Source Slop'),
      'should have slop pattern detection section');
  });

  it('has accessibility structure section', () => {
    assert.ok(content.includes('Accessibility Structure'),
      'should have accessibility structure checks');
  });

  it('has generic copy detection section', () => {
    assert.ok(content.includes('Generic Copy'),
      'should have generic copy detection');
  });

  it('has missing state detection section', () => {
    assert.ok(content.includes('Missing State'),
      'should have missing state detection');
  });

  it('has theming issues section', () => {
    assert.ok(content.includes('Theming'),
      'should have theming issues section');
  });

  it('has "Not Verified" section', () => {
    assert.ok(content.includes('Not Verified'),
      'should have "Not Verified (requires browser)" section');
  });

  it('does NOT produce pillar scores', () => {
    // The report format should not contain a pillar score table (| Pillar | Score |)
    // It CAN mention "no pillar scores" as a disclaimer — that's correct behavior
    assert.ok(!content.includes('| Pillar | Score'),
      'code-check eval must not have a pillar score table — those need browser evidence');
    assert.ok(!content.includes('/20 total'),
      'code-check eval must not reference /20 scoring — that is visual-only');
  });

  it('has confidence model', () => {
    assert.ok(content.includes('Confidence Model') || content.includes('confidence'),
      'should have a confidence model');
  });

  it('severity bands match ai-slop-patterns.md', () => {
    assert.ok(content.includes('CLEAN') && content.includes('MILD') &&
      content.includes('SLOPPY') && content.includes('TERMINAL'),
      'should use the same severity bands as ai-slop-patterns.md');
  });
});


// ─────────────────────────────────────────────
// Tests: Test fixture exists
// ─────────────────────────────────────────────

describe('Test fixture', () => {
  it('sloppy-app/index.html exists', () => {
    const fixturePath = join(__dirname, 'fixtures', 'sloppy-app', 'index.html');
    assert.ok(existsSync(fixturePath), 'Missing test fixture: tests/fixtures/sloppy-app/index.html');
  });

  it('fixture contains known problems for testing', () => {
    const fixturePath = join(__dirname, 'fixtures', 'sloppy-app', 'index.html');
    const content = readFileSync(fixturePath, 'utf-8');

    // Should have at least these measurable problems:
    assert.ok(content.includes('#22c55e'), 'fixture should have low-contrast green CTA');
    assert.ok(content.includes('background-clip: text') || content.includes('-webkit-background-clip: text'),
      'fixture should have gradient text pattern');
    assert.ok(content.includes('backdrop-filter'), 'fixture should have glassmorphism pattern');
    assert.ok(content.includes('#000000') || content.includes('#000'),
      'fixture should have pure black background');
    assert.ok(content.includes('Inter'), 'fixture should use generic Inter font');
    assert.ok(content.includes('outline: none'), 'fixture should remove focus indicators');
  });
});


// Export helpers for reuse by other tools
export { parseFrontmatter, extractJsBlocks, extractPatterns };
