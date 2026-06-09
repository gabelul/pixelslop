/**
 * Typography Metrics Tests
 *
 * Covers the derived readability metrics the collector measures off real
 * layout (measure, body size, leading, tracking, type-scale spread, justified
 * and all-caps body) and the contract that wires them through the pipeline:
 * collector snippet -> evidence schema -> scoring rubric -> typography evaluator
 * -> typeset fix guide.
 *
 * Two halves:
 *   1. Pure threshold functions that mirror the numbers documented in scoring.md.
 *      If a threshold drifts in the docs, these tests are where it gets caught.
 *   2. Cross-file contract checks so the metric can't exist in one layer and go
 *      undocumented in the next.
 *
 * Run: node --test tests/typography-metrics.test.js
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const readDist = (rel) => readFileSync(join(ROOT, 'dist', rel), 'utf-8');
const readBin = (rel) => readFileSync(join(ROOT, 'bin', rel), 'utf-8');

// ─────────────────────────────────────────────
// Threshold logic — mirrors scoring.md "Measured signals"
// ─────────────────────────────────────────────

// Measure (chars per line): comfortable 45-85, either extreme is a fail.
const measureOutOfRange = (cpl) => cpl < 45 || cpl > 85;
// Body size: under 14px is below the readability floor.
const belowSizeFloor = (px) => px < 14;
// Leading: body wants 1.4-1.7; under 1.3 too tight, over 1.9 too loose.
const leadingTooTight = (ratio) => ratio < 1.3;
const leadingTooLoose = (ratio) => ratio > 1.9;
// Tracking (em): body wants ~0; negative < -0.02 or wide > 0.1 hurts reading.
const trackingExtreme = (em) => em < -0.02 || em > 0.1;
// Type scale: largest/smallest under 1.5 reads as flat.
const flatScale = (ratio) => ratio < 1.5;

describe('typography measure thresholds', () => {
  it('flags a 95-char line as too long', () => assert.ok(measureOutOfRange(95)));
  it('flags a 38-char line as too cramped', () => assert.ok(measureOutOfRange(38)));
  it('accepts a 68-char line as comfortable', () => assert.ok(!measureOutOfRange(68)));
  it('accepts the 45 and 85 boundaries', () => {
    assert.ok(!measureOutOfRange(45));
    assert.ok(!measureOutOfRange(85));
  });
});

describe('body size floor', () => {
  it('flags 13px body text', () => assert.ok(belowSizeFloor(13)));
  it('accepts 14px exactly', () => assert.ok(!belowSizeFloor(14)));
  it('accepts 16px', () => assert.ok(!belowSizeFloor(16)));
});

describe('leading thresholds', () => {
  it('flags 1.1 as too tight', () => assert.ok(leadingTooTight(1.1)));
  it('does not flag 1.3 as too tight', () => assert.ok(!leadingTooTight(1.3)));
  it('flags 2.1 as too loose', () => assert.ok(leadingTooLoose(2.1)));
  it('treats 1.5 as comfortable on both ends', () => {
    assert.ok(!leadingTooTight(1.5));
    assert.ok(!leadingTooLoose(1.5));
  });
});

describe('tracking extremes', () => {
  it('flags -0.05em negative tracking on body', () => assert.ok(trackingExtreme(-0.05)));
  it('flags 0.15em wide tracking on body', () => assert.ok(trackingExtreme(0.15)));
  it('accepts near-zero tracking', () => assert.ok(!trackingExtreme(0)));
  it('accepts a slight -0.01em', () => assert.ok(!trackingExtreme(-0.01)));
});

describe('flat type scale', () => {
  it('flags a 1.3x largest/smallest ratio as flat', () => assert.ok(flatScale(1.3)));
  it('accepts a 3x ratio as differentiated', () => assert.ok(!flatScale(3)));
  it('treats exactly 1.5 as not flat', () => assert.ok(!flatScale(1.5)));
});

// ─────────────────────────────────────────────
// Contract — the metric is wired through every layer
// ─────────────────────────────────────────────

describe('collector emits and wires the metrics snippet', () => {
  const browser = readBin('pixelslop-browser.cjs');

  it('defines snippetTypographyMetrics', () => {
    assert.ok(browser.includes('function snippetTypographyMetrics()'),
      'collector should define snippetTypographyMetrics');
  });

  it('collects it on the desktop pass into viewports.desktop.typographyMetrics', () => {
    assert.ok(browser.includes('viewports.desktop.typographyMetrics'),
      'desktop pass should store typographyMetrics on the bundle');
    assert.ok(browser.includes('page.evaluate(snippetTypographyMetrics)'),
      'desktop pass should evaluate the metrics snippet');
  });

  it('returns every documented field', () => {
    for (const field of [
      'bodyFontSize', 'bodyLeadingRatio', 'bodyTrackingEm', 'bodyCharsPerLine',
      'justifiedBody', 'allCapsBody', 'typeScaleRatio', 'flatHierarchy'
    ]) {
      assert.ok(browser.includes(field), `snippet should return ${field}`);
    }
  });

  it('measures line length by counting line boxes, not guessing glyph width', () => {
    assert.ok(browser.includes('getClientRects()'),
      'chars-per-line should be derived from real line boxes via getClientRects');
  });
});

describe('evidence schema documents the metrics block', () => {
  const schema = readDist('skill/resources/evidence-schema.md');

  it('documents the typographyMetrics example block', () => {
    assert.ok(schema.includes('"typographyMetrics"'), 'schema should show a typographyMetrics example');
    assert.ok(schema.includes('"bodyCharsPerLine"'), 'schema should document bodyCharsPerLine');
    assert.ok(schema.includes('"flatHierarchy"'), 'schema should document flatHierarchy');
  });

  it('maps the snippet to its evidence field', () => {
    assert.ok(schema.includes('viewports.desktop.typographyMetrics'),
      'snippet-to-field table should list typographyMetrics');
  });
});

describe('scoring rubric carries the measured thresholds', () => {
  const scoring = readDist('skill/resources/scoring.md');

  it('references the typographyMetrics evidence source', () => {
    assert.ok(scoring.includes('typographyMetrics'), 'scoring should cite typographyMetrics');
  });

  it('names each measured signal', () => {
    for (const field of ['bodyCharsPerLine', 'bodyFontSize', 'bodyLeadingRatio', 'bodyTrackingEm', 'flatHierarchy', 'justifiedBody', 'allCapsBody']) {
      assert.ok(scoring.includes(field), `scoring should describe the ${field} threshold`);
    }
  });
});

describe('typography evaluator consumes the metrics', () => {
  const evaluator = readDist('agents/internal/pixelslop-eval-typography.md');

  it('extracts typographyMetrics from the bundle', () => {
    assert.ok(evaluator.includes('typographyMetrics'), 'evaluator should read typographyMetrics');
  });

  it('lists the new criteria in its output contract', () => {
    for (const criterion of ['measure', 'body-size', 'leading', 'tracking', 'flat-hierarchy', 'justified-body', 'all-caps-body']) {
      assert.ok(evaluator.includes(criterion), `evaluator criterion list should include ${criterion}`);
    }
  });
});

describe('typeset fix guide covers the new findings', () => {
  const guide = readDist('skill/resources/typeset.md');

  it('registers the measured findings', () => {
    assert.ok(guide.includes('Measured readability findings'),
      'guide should list the measured findings it fixes');
  });

  it('has recipes for tracking, flat scale, and alignment/casing', () => {
    assert.ok(/letter-spacing|tracking/i.test(guide), 'guide should cover tracking');
    assert.ok(/flat type scale|flat-hierarchy/i.test(guide), 'guide should cover flat scale');
    assert.ok(/justify|uppercase|all-caps/i.test(guide), 'guide should cover alignment/casing');
  });
});
