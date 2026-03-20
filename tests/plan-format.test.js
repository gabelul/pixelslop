/**
 * Plan Format Contract Tests
 *
 * Validates the plan-format.md resource file — the contract
 * between orchestrator, fixer, and checker agents. Ensures the
 * documented format matches what pixelslop-tools actually produces.
 *
 * Run: node --test tests/plan-format.test.js
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = join(__dirname, '..', 'dist');

/**
 * Read a resource file from dist/.
 * @param {string} relativePath - Path relative to dist/
 * @returns {string} File contents
 */
function readDist(relativePath) {
  const fullPath = join(DIST, relativePath);
  assert.ok(existsSync(fullPath), `Missing file: dist/${relativePath}`);
  return readFileSync(fullPath, 'utf-8');
}

// ─────────────────────────────────────────────
// Tests: plan-format.md structure
// ─────────────────────────────────────────────

describe('plan-format.md resource file', () => {
  let content;

  it('file exists and is non-trivial', () => {
    content = readDist('skill/resources/plan-format.md');
    assert.ok(content.length > 500, 'file seems too short for a format spec');
  });

  it('has a title heading', () => {
    assert.ok(content.includes('# Plan Format'), 'missing title heading');
  });

  it('documents the file structure with an example', () => {
    assert.ok(content.includes('.pixelslop-plan.md'), 'should reference plan filename');
    assert.ok(content.includes('```'), 'should have code block example');
  });

  it('documents frontmatter fields', () => {
    const requiredFields = ['url', 'root', 'mode', 'baseline_score', 'baseline_slop',
      'gate_command', 'gate_baseline', 'session', 'current_category'];
    for (const field of requiredFields) {
      assert.ok(content.includes(field), `missing frontmatter field: ${field}`);
    }
  });

  it('documents issue line format', () => {
    assert.ok(content.includes('[status]'), 'should document status placeholder');
    assert.ok(content.includes('issue-id'), 'should document issue-id');
    assert.ok(content.includes('priority'), 'should document priority');
    assert.ok(content.includes('[category]'), 'should document category');
  });

  it('documents valid statuses', () => {
    const statuses = ['pending', 'fixed', 'failed', 'partial', 'skipped'];
    for (const status of statuses) {
      assert.ok(content.includes(status), `missing status: ${status}`);
    }
  });

  it('documents priority levels P0, P1, P2', () => {
    assert.ok(content.includes('P0'), 'missing P0 priority');
    assert.ok(content.includes('P1'), 'missing P1 priority');
    assert.ok(content.includes('P2'), 'missing P2 priority');
  });

  it('documents priority criteria', () => {
    assert.ok(content.includes('AA-fail contrast') || content.includes('4.5:1'),
      'P0 should mention contrast threshold');
    assert.ok(content.includes('TERMINAL'), 'P0 should mention TERMINAL slop');
  });

  it('documents category mapping', () => {
    const categories = ['accessibility', 'typography', 'layout', 'responsiveness', 'color', 'slop', 'copy'];
    for (const cat of categories) {
      assert.ok(content.includes(cat), `missing category: ${cat}`);
    }
  });

  it('mentions pixelslop-tools for mutations', () => {
    assert.ok(content.includes('pixelslop-tools'), 'should reference pixelslop-tools CLI');
    assert.ok(content.includes('never edit this file directly') || content.includes('Agents never edit'),
      'should warn against direct edits');
  });

  it('documents the Scores table format', () => {
    assert.ok(content.includes('## Scores') || content.includes('Scores'), 'should document scores section');
    assert.ok(content.includes('Before'), 'should include Before column');
    assert.ok(content.includes('After'), 'should include After column');
  });
});

// ─────────────────────────────────────────────
// Tests: Plan format consistency with scoring.md
// ─────────────────────────────────────────────

describe('plan format consistency with scoring.md', () => {
  let planFormat, scoring;

  it('both files exist', () => {
    planFormat = readDist('skill/resources/plan-format.md');
    scoring = readDist('skill/resources/scoring.md');
  });

  it('plan format references the same 5 pillars as scoring', () => {
    const pillars = ['Hierarchy', 'Typography', 'Color', 'Responsiveness', 'Accessibility'];
    for (const pillar of pillars) {
      assert.ok(planFormat.includes(pillar), `plan-format missing pillar: ${pillar}`);
      assert.ok(scoring.includes(pillar), `scoring missing pillar: ${pillar}`);
    }
  });

  it('slop severity bands match between plan format and slop patterns', () => {
    const slopPatterns = readDist('skill/resources/ai-slop-patterns.md');
    const bands = ['CLEAN', 'MILD', 'SLOPPY', 'TERMINAL'];
    for (const band of bands) {
      assert.ok(slopPatterns.includes(band), `ai-slop-patterns missing band: ${band}`);
    }
    // Plan format should reference at least TERMINAL (P0) and SLOPPY (P1)
    assert.ok(planFormat.includes('TERMINAL'), 'plan format should reference TERMINAL');
    assert.ok(planFormat.includes('SLOPPY'), 'plan format should reference SLOPPY');
  });
});
