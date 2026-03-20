/**
 * Report Format Validation Tests
 *
 * Validates that scanner output follows the structured report format
 * defined in dist/skill/resources/scoring.md. Future agents (fixer,
 * checker) will parse this format — if it breaks, they break.
 *
 * Run: node --test tests/report-format.test.js
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Parse a Pixelslop scanner report from markdown into structured data.
 * This is the function downstream agents would use — if the report
 * format changes, this parser (and its tests) catch the mismatch.
 *
 * @param {string} markdown - Raw markdown report from the scanner
 * @returns {object} Parsed report with scores, slop, findings, screenshots
 */
function parseReport(markdown) {
  const report = {};

  // Header fields
  const titleMatch = markdown.match(/## Pixelslop Report:\s*(.+)/);
  report.title = titleMatch ? titleMatch[1].trim() : null;

  const urlMatch = markdown.match(/URL:\s*(.+)/);
  report.url = urlMatch ? urlMatch[1].trim() : null;

  const dateMatch = markdown.match(/Date:\s*(.+)/);
  report.date = dateMatch ? dateMatch[1].trim() : null;

  const confMatch = markdown.match(/Confidence:\s*(\d+)%/);
  report.confidence = confMatch ? parseInt(confMatch[1]) : null;

  // Pillar scores — parse the markdown table
  report.scores = {};
  const pillarRegex = /\|\s*(Hierarchy|Typography|Color|Responsiveness|Accessibility)\s*\|\s*(\d)\/4\s*\|/g;
  let match;
  while ((match = pillarRegex.exec(markdown)) !== null) {
    report.scores[match[1].toLowerCase()] = parseInt(match[2]);
  }

  // Total score
  const totalMatch = markdown.match(/\*\*Total\*\*\s*\|\s*\*\*(\d+)\/20\*\*/);
  report.total = totalMatch ? parseInt(totalMatch[1]) : null;

  // Rating band
  const bandMatch = markdown.match(/\*\*(\d+)\/20\*\*\s*\|\s*\*\*(.+?)\*\*/);
  report.ratingBand = bandMatch ? bandMatch[2].trim() : null;

  // Slop classification
  const slopMatch = markdown.match(/### AI Slop:\s*(CLEAN|MILD|SLOPPY|TERMINAL)/);
  report.slopLevel = slopMatch ? slopMatch[1] : null;

  const patternCountMatch = markdown.match(/Patterns detected:\s*(\d+)/);
  report.slopCount = patternCountMatch ? parseInt(patternCountMatch[1]) : null;

  // Screenshots
  report.screenshots = {};
  const desktopScreen = markdown.match(/Desktop \(1440x900\):\s*(.+)/);
  report.screenshots.desktop = desktopScreen ? desktopScreen[1].trim() : null;

  const tabletScreen = markdown.match(/Tablet \(768x1024\):\s*(.+)/);
  report.screenshots.tablet = tabletScreen ? tabletScreen[1].trim() : null;

  const mobileScreen = markdown.match(/Mobile \(375x812\):\s*(.+)/);
  report.screenshots.mobile = mobileScreen ? mobileScreen[1].trim() : null;

  return report;
}

// --- Sample report for testing (mirrors the actual scanner output format) ---
const SAMPLE_REPORT = `## Pixelslop Report: DataPulse - SaaS Analytics Dashboard
URL: https://www.uupm.cc/demo/saas-analytics-dashboard
Date: 2026-03-17T20:33:00Z
Confidence: 90%

### Scores
| Pillar | Score | Evidence |
|--------|-------|----------|
| Hierarchy | 3/4 | Clear h1 (60px) with progressive reduction. Primary CTA visually distinct. |
| Typography | 2/4 | Poppins + DM Sans pairing. Functional but common Google Fonts. |
| Color | 2/4 | Standard blue primary. Green CTA. Slate neutrals. Generic palette. |
| Responsiveness | 2/4 | Layout reflows but 71% of touch targets undersized on mobile. |
| Accessibility | 2/4 | Heading hierarchy correct. CTA contrast fails at 2.28:1. |
| **Total** | **11/20** | **Needs Work** |

### AI Slop: TERMINAL
Patterns detected: 11
1. **Glassmorphism Everywhere** -- 20 elements with backdrop-filter.
2. **Gradient Text** -- 4 instances of background-clip: text.
3. **Hero Metric Layout** -- 10K+, 99.9%, 50M+ at 30px.

### Findings
1. **[Accessibility] CTA contrast failures.** White on green at 2.28:1.
2. **[Responsiveness] 71% of mobile touch targets undersized.**

### Screenshots
- Desktop (1440x900): .pixelslop/screenshots/uupm-cc-desktop-20260317-203300.png
- Tablet (768x1024): .pixelslop/screenshots/uupm-cc-tablet-20260317-203400.png
- Mobile (375x812): .pixelslop/screenshots/uupm-cc-mobile-20260317-203430.png`;


describe('Report Format Parser', () => {

  it('extracts header fields (title, url, date, confidence)', () => {
    const r = parseReport(SAMPLE_REPORT);
    assert.equal(r.title, 'DataPulse - SaaS Analytics Dashboard');
    assert.equal(r.url, 'https://www.uupm.cc/demo/saas-analytics-dashboard');
    assert.equal(r.date, '2026-03-17T20:33:00Z');
    assert.equal(r.confidence, 90);
  });

  it('extracts all 5 pillar scores as integers 1-4', () => {
    const r = parseReport(SAMPLE_REPORT);
    const pillars = ['hierarchy', 'typography', 'color', 'responsiveness', 'accessibility'];
    for (const p of pillars) {
      assert.ok(r.scores[p] !== undefined, `missing pillar: ${p}`);
      assert.ok(r.scores[p] >= 1 && r.scores[p] <= 4, `${p} score out of range: ${r.scores[p]}`);
    }
    assert.equal(Object.keys(r.scores).length, 5, 'should have exactly 5 pillars');
  });

  it('extracts total score and rating band', () => {
    const r = parseReport(SAMPLE_REPORT);
    assert.equal(r.total, 11);
    assert.equal(r.ratingBand, 'Needs Work');
  });

  it('total equals sum of pillar scores', () => {
    const r = parseReport(SAMPLE_REPORT);
    const sum = Object.values(r.scores).reduce((a, b) => a + b, 0);
    assert.equal(r.total, sum, `total ${r.total} should equal sum of pillars ${sum}`);
  });

  it('extracts slop classification and pattern count', () => {
    const r = parseReport(SAMPLE_REPORT);
    assert.equal(r.slopLevel, 'TERMINAL');
    assert.equal(r.slopCount, 11);
  });

  it('slop level matches pattern count per severity bands', () => {
    const r = parseReport(SAMPLE_REPORT);
    const count = r.slopCount;
    const level = r.slopLevel;

    if (count <= 1) assert.equal(level, 'CLEAN');
    else if (count <= 3) assert.equal(level, 'MILD');
    else if (count <= 6) assert.equal(level, 'SLOPPY');
    else assert.equal(level, 'TERMINAL');
  });

  it('extracts all 3 screenshot references', () => {
    const r = parseReport(SAMPLE_REPORT);
    assert.ok(r.screenshots.desktop, 'missing desktop screenshot');
    assert.ok(r.screenshots.tablet, 'missing tablet screenshot');
    assert.ok(r.screenshots.mobile, 'missing mobile screenshot');
    // Should be file paths, not "[not captured]"
    assert.ok(r.screenshots.desktop.endsWith('.png'), 'desktop should be a .png path');
  });

  it('rating band matches total score per bands', () => {
    const r = parseReport(SAMPLE_REPORT);
    const total = r.total;
    const band = r.ratingBand;

    if (total >= 17) assert.equal(band, 'Excellent');
    else if (total >= 13) assert.equal(band, 'Good');
    else if (total >= 9) assert.equal(band, 'Needs Work');
    else if (total >= 5) assert.equal(band, 'Poor');
    else assert.equal(band, 'Critical');
  });

  it('handles missing fields gracefully', () => {
    const empty = parseReport('# Nothing here');
    assert.equal(empty.title, null);
    assert.equal(empty.url, null);
    assert.equal(empty.confidence, null);
    assert.equal(empty.total, null);
    assert.equal(empty.slopLevel, null);
    assert.deepEqual(empty.scores, {});
  });
});

// Export the parser for use by other agents/tools
export { parseReport };
