/**
 * Report Layer Tests
 *
 * Findings now carry a `kind`: "measured" (evidence-backed, the default) or
 * "judgment" (the design-director's subjective read). The HTML report keeps the
 * two visually separate so judgment never reads as measured fact, and a scan with
 * only measured findings looks exactly as it did before (no extra headings).
 *
 * Run: node --test tests/report-layers.test.js
 */

import { describe, it, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TOOLS = join(ROOT, 'bin', 'pixelslop-tools.cjs');

function generate(dir, findings) {
  mkdirSync(join(dir, '.pixelslop'), { recursive: true });
  const scan = {
    title: 'T', url: 'http://x', timestamp: '2026-06-10T00:00:00Z',
    scores: { hierarchy: { score: 3 }, typography: { score: 2 }, color: { score: 2 }, responsiveness: { score: 3 }, accessibility: { score: 2 } },
    findings
  };
  const scanPath = join(dir, '.pixelslop', 'scan-results.json');
  writeFileSync(scanPath, JSON.stringify(scan), 'utf-8');
  execFileSync('node', [TOOLS, 'report', 'generate', '--scan-results', scanPath, '--root', dir, '--raw'], { encoding: 'utf-8' });
  const reportsDir = join(dir, '.pixelslop', 'reports');
  const file = readdirSync(reportsDir).find((f) => f.endsWith('.html'));
  return readFileSync(join(reportsDir, file), 'utf-8');
}

describe('report layers (measured vs judgment)', () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'pxs-layers-')); });
  const cleanup = () => { try { rmSync(dir, { recursive: true, force: true }); } catch {} };

  it('renders no layer headings when every finding is measured (unchanged look)', () => {
    const html = generate(dir, [
      { priority: 'P1', description: 'Contrast weak', kind: 'measured' },
      { priority: 'P2', description: 'No focus ring' } // kind omitted -> measured
    ]);
    assert.ok(html.includes('Contrast weak') && html.includes('No focus ring'), 'measured findings render');
    assert.ok(!html.includes('Design judgment'), 'no judgment section when there are no judgment findings');
    cleanup();
  });

  it('separates measured and judgment findings into labeled layers', () => {
    const html = generate(dir, [
      { priority: 'P1', description: 'Contrast weak', kind: 'measured' },
      { priority: 'P2', description: 'Hero feels generic', kind: 'judgment', confidence: 'medium' }
    ]);
    assert.ok(html.includes('Measured'), 'measured layer heading present');
    assert.ok(html.includes('Design judgment'), 'judgment layer heading present');
    assert.ok(/design director.{0,8}s read, not measured/.test(html), 'judgment labeled as opinion (apostrophe may be HTML-escaped)');
    assert.ok(html.includes('Contrast weak') && html.includes('Hero feels generic'), 'both findings render');
    cleanup();
  });

  it('surfaces a judgment finding confidence inline', () => {
    const html = generate(dir, [
      { priority: 'P2', description: 'Composition is safe', kind: 'judgment', confidence: 'low' }
    ]);
    assert.ok(html.includes('Composition is safe'), 'judgment finding renders');
    assert.ok(html.includes('(low)'), 'confidence shown inline');
    cleanup();
  });

  it('treats a string finding as measured', () => {
    const html = generate(dir, ['Plain string finding']);
    assert.ok(html.includes('Plain string finding'));
    assert.ok(!html.includes('Design judgment'));
    cleanup();
  });
});
