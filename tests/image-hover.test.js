/**
 * Image-hover-transform detector tests (slop pattern 26).
 *
 * The detector flags the "templated card" fingerprint — the SAME hover transform copy-pasted across
 * a whole image grid — while leaving a legitimate lone product-zoom alone. These tests pin the pure
 * decision logic (classifyImageHoverSamples), the transform parser (scaleFromTransform), and the
 * doc/agent wiring that surfaces the pattern. The real browser behaviour is exercised in the
 * end-to-end smoke path; here we stay dependency-free.
 *
 * Run: node --test tests/image-hover.test.js
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { __testHooks } = require('../bin/pixelslop-browser.cjs');
const { classifyImageHoverSamples, scaleFromTransform, buildConfig } = __testHooks;

const readDist = (rel) => readFileSync(join(ROOT, 'dist', rel), 'utf-8');
const readBin = (rel) => readFileSync(join(ROOT, 'bin', rel), 'utf-8');

const ZOOM = 'matrix(1.05, 0, 0, 1.05, 0, 0)';
const ZOOM_BIG = 'matrix(1.08, 0, 0, 1.08, 0, 0)';
const moved = (after) => ({ after, transformed: true });
const still = () => ({ after: 'none', transformed: false });

describe('classifyImageHoverSamples — the uniform-slop decision', () => {
  it('flags 3+ images sharing the identical transform', () => {
    const r = classifyImageHoverSamples([moved(ZOOM), moved(ZOOM), moved(ZOOM), moved(ZOOM)]);
    assert.equal(r.uniform, true);
    assert.equal(r.uniformCount, 4);
    assert.equal(r.uniformTransform, ZOOM);
    assert.equal(r.transformed, 4);
    assert.equal(r.tested, 4);
  });

  it('does NOT flag a single lone product-zoom', () => {
    const r = classifyImageHoverSamples([moved(ZOOM), still(), still()]);
    assert.equal(r.uniform, false, 'one image zooming is a legit pattern, not slop');
    assert.equal(r.uniformTransform, null);
    assert.equal(r.transformed, 1);
  });

  it('does NOT flag just two matching transforms (below the 3-image floor)', () => {
    const r = classifyImageHoverSamples([moved(ZOOM), moved(ZOOM), still(), still()]);
    assert.equal(r.uniform, false);
    assert.equal(r.uniformCount, 2);
  });

  it('does NOT flag a spread of different transforms even if many move', () => {
    // Four images all animate, but each differently — that reads as intentional, not templated.
    const r = classifyImageHoverSamples([
      moved('matrix(1.02, 0, 0, 1.02, 0, 0)'),
      moved('matrix(1.05, 0, 0, 1.05, 0, 0)'),
      moved('matrix(1, 0, 0, 1, 0, -8)'),
      moved('matrix(1.1, 0, 0, 1.1, 0, 0)'),
    ]);
    assert.equal(r.uniform, false, 'diverse transforms are not the templated fingerprint');
    assert.equal(r.uniformCount, 1);
  });

  it('requires the shared transform to cover ≥60% of movers', () => {
    // 3 identical but 4 others all different → 3/7 ≈ 43%, under the threshold.
    const r = classifyImageHoverSamples([
      moved(ZOOM), moved(ZOOM), moved(ZOOM),
      moved('matrix(1.01, 0, 0, 1.01, 0, 0)'),
      moved('matrix(1.02, 0, 0, 1.02, 0, 0)'),
      moved('matrix(1.03, 0, 0, 1.03, 0, 0)'),
      moved('matrix(1.04, 0, 0, 1.04, 0, 0)'),
    ]);
    assert.equal(r.uniform, false, '3 of 7 movers is not "most of them"');
  });

  it('handles empty and junk input without throwing', () => {
    for (const input of [[], null, undefined]) {
      const r = classifyImageHoverSamples(input);
      assert.equal(r.uniform, false);
      assert.equal(r.tested, 0);
      assert.equal(r.transformed, 0);
    }
  });
});

describe('scaleFromTransform — parsing the scale out of a matrix', () => {
  it('pulls the scale from a 2D matrix', () => {
    assert.equal(Math.round(scaleFromTransform(ZOOM) * 100) / 100, 1.05);
  });

  it('returns null for identity and none', () => {
    assert.equal(scaleFromTransform('none'), null);
    assert.equal(scaleFromTransform('matrix(1, 0, 0, 1, 0, 0)'), null);
    assert.equal(scaleFromTransform(''), null);
  });

  it('pulls the scale from a 3D matrix', () => {
    const s = scaleFromTransform('matrix3d(1.08, 0, 0, 0, 0, 1.08, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)');
    assert.equal(Math.round(s * 100) / 100, 1.08);
  });
});

describe('collector wiring', () => {
  const browser = readBin('pixelslop-browser.cjs');

  it('defines the image-hover pass and its target snippet', () => {
    assert.ok(browser.includes('function collectImageHoverPass('), 'pass should exist');
    assert.ok(browser.includes('function snippetImageHoverTargets('), 'target snippet should exist');
  });

  it('runs the pass in the interaction region and stores imageHoverTransforms', () => {
    assert.ok(browser.includes('collectImageHoverPass(bundle, page'), 'pass should be invoked in collectEvidence');
    assert.ok(browser.includes('bundle.imageHoverTransforms = classifyImageHoverSamples'), 'pass should write the classified result');
  });

  it('stamps a unique data attribute instead of guessing a CSS path', () => {
    // Image grids break hand-built nth-of-type selectors; the stamp guarantees uniqueness.
    assert.ok(browser.includes('data-pixelslop-imghover'), 'targets should be stamped for unique selection');
    assert.ok(browser.includes("removeAttribute('data-pixelslop-imghover')"), 'stamps should be cleaned up before later passes');
  });

  it('caps the sample size via config.maxImageHover', () => {
    assert.equal(buildConfig({ deep: false }).maxImageHover, 12);
    assert.equal(buildConfig({ deep: true }).maxImageHover, 24);
  });
});

describe('pattern 26 is documented and wired to the evaluator', () => {
  it('appears in the slop pattern catalog', () => {
    const patterns = readDist('skill/resources/ai-slop-patterns.md');
    assert.ok(patterns.includes('### 26.'), 'catalog should have a pattern 26');
    assert.ok(/hover.?zoom|hover-zoom|Hover-Zoom/i.test(patterns), 'pattern 26 should name the hover-zoom');
    assert.ok(patterns.includes('imageHoverTransforms'), 'pattern 26 should reference the evidence field');
  });

  it('the slop evaluator reads imageHoverTransforms and only counts the uniform case', () => {
    const evaluator = readDist('agents/internal/pixelslop-eval-slop.md');
    assert.ok(evaluator.includes('imageHoverTransforms'), 'evaluator should read the field');
    assert.ok(evaluator.includes('1-26'), 'evaluator should check patterns 1-26');
    assert.ok(/uniform/i.test(evaluator), 'evaluator should gate on the uniform flag');
  });

  it('the evidence schema documents the field', () => {
    const schema = readDist('skill/resources/evidence-schema.md');
    assert.ok(schema.includes('imageHoverTransforms'), 'schema should document imageHoverTransforms');
    assert.ok(schema.includes('uniformTransform'), 'schema should show the uniform fields');
  });
});
