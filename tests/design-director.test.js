/**
 * Design Director Contract Tests
 *
 * The design-director is the subjective judgment pass — the one evaluator that
 * looks at screenshots and opines. Its whole value depends on a few invariants
 * that are easy to erode in editing, so they're pinned here:
 *   - it produces judgment findings only and never a /20 score
 *   - it actually looks at the screenshots
 *   - it runs the adversarial second pass (the anti-noise guard)
 *   - the orchestrator spawns it and routes its output to the judgment layer
 *
 * Run: node --test tests/design-director.test.js
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIRECTOR = join(ROOT, 'dist', 'agents', 'internal', 'pixelslop-eval-design-director.md');
const ORCH = join(ROOT, 'dist', 'agents', 'pixelslop.md');

describe('design-director spec', () => {
  assert.ok(existsSync(DIRECTOR), 'design-director spec must exist');
  const spec = readFileSync(DIRECTOR, 'utf-8');

  it('has read-only frontmatter (no Write/Edit)', () => {
    const fm = spec.slice(0, spec.indexOf('---', 3));
    assert.ok(/name:\s*pixelslop-eval-design-director/.test(spec), 'name set');
    assert.ok(/tools:[\s\S]*-\s*Read/.test(spec), 'has Read tool');
    assert.ok(!/-\s*Write/.test(fm) && !/-\s*Edit/.test(fm), 'must not have Write or Edit');
  });

  it('produces judgment only and never a score', () => {
    assert.ok(/never.{0,20}(score|\/20)|no score|stays measured/i.test(spec), 'states it never scores');
    assert.ok(spec.includes('"kind": "judgment"') || /kind.{0,4}judgment/.test(spec), 'findings are kind judgment');
    assert.ok(!/"score"\s*:/.test(spec) || /do not return a `?score/i.test(spec), 'no score field in output, or explicitly forbidden');
  });

  it('actually looks at the screenshots', () => {
    assert.ok(/screenshot/i.test(spec), 'references screenshots');
    assert.ok(/Read.{0,40}(PNG|screenshot)|screenshot you didn/i.test(spec), 'instructed to open the screenshot');
  });

  it('runs the adversarial second pass (anti-noise guard)', () => {
    assert.ok(/argue against (yourself|your own)|second pass/i.test(spec), 'has the self-argument pass');
    assert.ok(/confidence/i.test(spec), 'tags findings with confidence');
    assert.ok(/respect intent|distinctive.{0,4}(!=|≠|is not).{0,10}wrong/i.test(spec), 'respects intentional bold design');
  });
});

describe('orchestrator wiring', () => {
  const orch = readFileSync(ORCH, 'utf-8');

  it('spawns the design-director', () => {
    assert.ok(orch.includes('pixelslop-eval-design-director'), 'orchestrator spawns the director');
  });

  it('routes its findings to a separate judgment layer, not the score', () => {
    assert.ok(/no score|never affects the \/20|never change the \/20/i.test(orch), 'director does not affect the /20');
    assert.ok(/Design judgment/i.test(orch), 'findings go to a Design judgment section');
  });
});
