/**
 * Perceptual co-headline tests.
 *
 * The design read used to be a footnote — the design-director's verdict buried inside `### Findings`,
 * personas nowhere near the top. Now the perceptual read co-headlines the report: a `Reads as:` line,
 * a `### The Read` section above the Scores, a co-led Scan Results summary, and an HTML card next to
 * the /20. These guard that wiring across the markdown contract, the orchestrator, and the HTML
 * generator. (The render behaviour is exercised in html-report.test.js.)
 *
 * The hard invariant: the read is prose, never a competing number.
 *
 * Run: node --test tests/perceptual-headline.test.js
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const readDist = (rel) => readFileSync(join(ROOT, 'dist', rel), 'utf-8');
const readBin = (rel) => readFileSync(join(ROOT, 'bin', rel), 'utf-8');

describe('the markdown report co-headlines the read', () => {
  const scoring = readDist('skill/resources/scoring.md');
  const orch = readDist('agents/pixelslop.md');

  it('documents a Reads as: line and a ### The Read section in the contract', () => {
    assert.ok(scoring.includes('Reads as:'), 'scoring.md contract should carry a Reads as: line');
    assert.ok(scoring.includes('### The Read'), 'scoring.md contract should carry a ### The Read section');
  });

  it('the orchestrator report template has both', () => {
    assert.ok(orch.includes('Reads as:'), 'orchestrator report should have a Reads as: line');
    assert.ok(orch.includes('### The Read'), 'orchestrator report should have a ### The Read section');
  });

  it('The Read sits above the Scores, not buried in Findings', () => {
    const readIdx = orch.indexOf('### The Read');
    const scoresIdx = orch.indexOf('### Scores');
    assert.ok(readIdx > 0 && scoresIdx > 0 && readIdx < scoresIdx,
      'The Read must appear before the Scores table in the report template');
  });

  it('the Scan Results summary co-leads measured + perceptual', () => {
    assert.ok(/\*\*Measured: X\/20\*\*/.test(orch), 'summary should lead with Measured: X/20');
    assert.ok(/\*\*Reads as:\*\*/.test(orch), 'summary should co-lead with Reads as:');
  });

  it('keeps the read as prose — never a competing number', () => {
    // The Read must not introduce a second score. Guard against a "/10" or "design score" sneaking in.
    const readBlock = orch.slice(orch.indexOf('### The Read'), orch.indexOf('### Scores'));
    assert.ok(!/\/10\b|design score|perceptual score/i.test(readBlock),
      'The Read must be a verdict, not a number');
    assert.ok(/verdict|judgment|not.*measurement|never a number/i.test(readBlock),
      'The Read should frame itself as judgment, not measurement');
  });
});

describe('the HTML report carries the perceptual card', () => {
  it('the template has the {{PERCEPTUAL_READ}} placeholder in the overview', () => {
    const tpl = readDist('skill/resources/report-template.html');
    assert.ok(tpl.includes('{{PERCEPTUAL_READ}}'), 'template should have the perceptual token');
    // It should sit in the overview, right after the KPI strip.
    const kpiIdx = tpl.indexOf('{{KPI_BLOCKS}}');
    const readIdx = tpl.indexOf('{{PERCEPTUAL_READ}}');
    assert.ok(kpiIdx > 0 && readIdx > kpiIdx, 'perceptual card should follow the KPI strip in the overview');
    assert.ok(tpl.includes('.the-read'), 'template should style the .the-read card');
  });

  it('the generator builds and substitutes the perceptual block from scan.perceptualRead', () => {
    const tools = readBin('pixelslop-tools.cjs');
    assert.ok(tools.includes('scan.perceptualRead'), 'generator should read scan.perceptualRead');
    // The token appears in the source as an escaped regex literal in the .replace() call.
    assert.ok(tools.includes('PERCEPTUAL_READ'), 'generator should substitute the PERCEPTUAL_READ token');
    assert.ok(tools.includes('perceptualHtml'), 'generator should build the perceptual block');
  });
});

describe('the orchestrator persists the read', () => {
  it('documents a perceptualRead object in the saved scan JSON', () => {
    const orch = readDist('agents/pixelslop.md');
    assert.ok(orch.includes('perceptualRead'), 'orchestrator should save a perceptualRead object');
    assert.ok(/"verdict"/.test(orch) && /"voices"/.test(orch),
      'the saved perceptualRead should carry verdict + voices');
  });
});
