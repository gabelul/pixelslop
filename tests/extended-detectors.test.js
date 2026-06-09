/**
 * Extended Detector Tests
 *
 * Covers four browser-measured detectors added on top of the typography work:
 *   - broken-image      (img finished loading with zero natural pixels)
 *   - oversized-h1      (hero heading disproportionate to the viewport)
 *   - body-at-edge      (body text flush to the viewport edge)
 *   - clipped-content   (real text cut off horizontally by overflow:hidden)
 *
 * Same two-part shape as the other detector suites: pure threshold logic that
 * mirrors the documented rules, plus contract checks that each detector is wired
 * through collector -> schema -> evaluator. The clipped-content rule is the
 * fussy one — it must NOT fire on deliberate ellipsis or line-clamp.
 *
 * Run: node --test tests/extended-detectors.test.js
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const readDist = (rel) => readFileSync(join(ROOT, 'dist', rel), 'utf-8');
const browser = readFileSync(join(ROOT, 'bin', 'pixelslop-browser.cjs'), 'utf-8');

// ─────────────────────────────────────────────
// Threshold logic
// ─────────────────────────────────────────────

// Broken image: finished loading, zero natural pixels, and it actually had a source.
const isBroken = (img) => img.complete && img.naturalWidth === 0 && (img.src || img.srcset);
// Oversized h1: font-size more than 7% of viewport width.
const isOversizedH1 = (h1Px, vw) => !!h1Px && !!vw && h1Px / vw > 0.07;
// Body at edge: text element within 16px of either viewport edge.
const isAtEdge = (left, right, vw) => left < 16 || right > vw - 16;
// Clipped: overflow hidden/clip, content wider than the box, not deliberate truncation.
const isClipped = (el) =>
  (el.overflowX === 'hidden' || el.overflowX === 'clip') &&
  el.textLen > 20 &&
  el.scrollWidth > el.clientWidth + 4 &&
  el.textOverflow !== 'ellipsis' &&
  el.webkitLineClamp === 'none';

describe('broken image', () => {
  it('flags an image that loaded to 0x0 with a src', () =>
    assert.ok(isBroken({ complete: true, naturalWidth: 0, src: '/missing.png' })));
  it('does not flag a decorative img with no src', () =>
    assert.ok(!isBroken({ complete: true, naturalWidth: 0, src: '', srcset: '' })));
  it('does not flag a healthy image', () =>
    assert.ok(!isBroken({ complete: true, naturalWidth: 800, src: '/hero.png' })));
  it('does not flag an image still loading', () =>
    assert.ok(!isBroken({ complete: false, naturalWidth: 0, src: '/slow.png' })));
});

describe('oversized h1', () => {
  it('flags a 120px h1 on a 1440 viewport', () => assert.ok(isOversizedH1(120, 1440)));
  it('accepts a 64px h1 on a 1440 viewport', () => assert.ok(!isOversizedH1(64, 1440)));
  it('scales with viewport: 40px h1 on a 375 phone is oversized', () => assert.ok(isOversizedH1(40, 375)));
  it('is null-safe', () => assert.ok(!isOversizedH1(null, 1440)) && assert.ok(!isOversizedH1(80, 0)));
});

describe('body text at viewport edge', () => {
  it('flags text starting at x=8', () => assert.ok(isAtEdge(8, 1200, 1440)));
  it('flags text ending within 16px of the right edge', () => assert.ok(isAtEdge(40, 1430, 1440)));
  it('accepts text with comfortable side margins', () => assert.ok(!isAtEdge(120, 1320, 1440)));
});

describe('clipped content (conservative)', () => {
  const base = { overflowX: 'hidden', textLen: 50, scrollWidth: 400, clientWidth: 300, textOverflow: 'clip', webkitLineClamp: 'none' };
  it('flags real text cut off by overflow:hidden', () => assert.ok(isClipped(base)));
  it('does NOT flag deliberate ellipsis truncation', () =>
    assert.ok(!isClipped({ ...base, textOverflow: 'ellipsis' })));
  it('does NOT flag -webkit-line-clamp', () =>
    assert.ok(!isClipped({ ...base, webkitLineClamp: '3' })));
  it('does NOT flag a scroll container (overflow visible/auto)', () =>
    assert.ok(!isClipped({ ...base, overflowX: 'auto' })));
  it('does NOT flag a box whose content fits', () =>
    assert.ok(!isClipped({ ...base, scrollWidth: 300 })));
  it('ignores tiny text snippets (icons, single chars)', () =>
    assert.ok(!isClipped({ ...base, textLen: 5 })));
});

// ─────────────────────────────────────────────
// Wiring contract
// ─────────────────────────────────────────────

describe('detectors are wired through the collector', () => {
  it('collects broken-image fields', () => {
    assert.ok(/broken/.test(browser) && browser.includes('brokenImages'), 'snippet returns broken/brokenImages');
    assert.ok(browser.includes('natural.w === 0'), 'broken check uses zero natural width');
  });
  it('collects oversizedH1 and bodyAtViewportEdge', () => {
    assert.ok(browser.includes('oversizedH1'), 'returns oversizedH1');
    assert.ok(browser.includes('bodyAtViewportEdge'), 'returns bodyAtViewportEdge');
  });
  it('collects clipped content and excludes deliberate truncation', () => {
    assert.ok(browser.includes('clippedCount') && browser.includes('clipped'), 'returns clipped fields');
    assert.ok(browser.includes("textOverflow !== 'ellipsis'"), 'excludes ellipsis');
    assert.ok(browser.includes("webkitLineClamp === 'none'"), 'excludes line-clamp');
  });
});

describe('detectors are documented in the schema', () => {
  const schema = readDist('skill/resources/evidence-schema.md');
  it('schema shows oversizedH1 / bodyAtViewportEdge', () => {
    assert.ok(schema.includes('oversizedH1') && schema.includes('bodyAtViewportEdge'));
  });
  it('schema shows broken image fields', () => {
    assert.ok(schema.includes('"broken"') && schema.includes('brokenImages'));
  });
  it('schema shows clipped fields', () => {
    assert.ok(schema.includes('clippedCount') && schema.includes('"clipped"'));
  });
});

describe('detectors are scored by the right evaluator', () => {
  it('typography evaluator handles oversized-h1 and body-at-edge', () => {
    const t = readDist('agents/internal/pixelslop-eval-typography.md');
    assert.ok(t.includes('oversized-h1') && t.includes('body-at-edge'), 'criteria listed');
    assert.ok(t.includes('oversizedH1') && t.includes('bodyAtViewportEdge'), 'reads the fields');
  });
  it('accessibility evaluator handles broken images', () => {
    const a = readDist('agents/internal/pixelslop-eval-accessibility.md');
    assert.ok(a.includes('broken-images'), 'criterion listed');
    assert.ok(/broken/i.test(a) && a.includes('imageOptimization'), 'reads imageOptimization broken count');
  });
  it('responsiveness evaluator handles clipped content', () => {
    const r = readDist('agents/internal/pixelslop-eval-responsiveness.md');
    assert.ok(r.includes('clipped-content'), 'criterion listed');
    assert.ok(r.includes('clippedCount') || r.includes('overflow.clipped'), 'reads clipped data');
  });
});
