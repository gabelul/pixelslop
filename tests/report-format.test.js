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

/**
 * Build a report from structured evidence + specialist outputs.
 * This mirrors the collector -> specialists -> orchestrator contract.
 *
 * @param {object} input - Structured report parts
 * @returns {string} Markdown report matching scoring.md format
 */
function buildReport(input) {
  const { evidence, scores, slop, findings, personas } = input;
  const total = Object.values(scores).reduce((sum, pillar) => sum + pillar.score, 0);
  const ratingBand = total >= 17 ? 'Excellent'
    : total >= 13 ? 'Good'
      : total >= 9 ? 'Needs Work'
        : total >= 5 ? 'Poor'
          : 'Critical';

  const lines = [
    `## Pixelslop Report: ${evidence.title}`,
    `URL: ${evidence.url}`,
    `Date: ${evidence.timestamp}`,
    `Confidence: ${evidence.confidence}%`,
    '',
    '### Scores',
    '| Pillar | Score | Evidence |',
    '|--------|-------|----------|',
    `| Hierarchy | ${scores.hierarchy.score}/4 | ${scores.hierarchy.evidence} |`,
    `| Typography | ${scores.typography.score}/4 | ${scores.typography.evidence} |`,
    `| Color | ${scores.color.score}/4 | ${scores.color.evidence} |`,
    `| Responsiveness | ${scores.responsiveness.score}/4 | ${scores.responsiveness.evidence} |`,
    `| Accessibility | ${scores.accessibility.score}/4 | ${scores.accessibility.evidence} |`,
    `| **Total** | **${total}/20** | **${ratingBand}** |`,
    '',
    `### AI Slop: ${slop.band}`,
    `Patterns detected: ${slop.patternCount}`,
    ...slop.patterns.map((pattern, index) =>
      `${index + 1}. **${pattern.name}** -- ${pattern.evidence}`),
    '',
    '### Findings',
    ...findings.map((finding, index) => `${index + 1}. ${finding}`),
  ];

  if (personas.length > 0) {
    lines.push('', '### Persona Insights', ...personas);
  }

  lines.push(
    '',
    '### Screenshots',
    `- Desktop (1440x900): ${evidence.screenshots.desktop}`,
    `- Tablet (768x1024): ${evidence.screenshots.tablet}`,
    `- Mobile (375x812): ${evidence.screenshots.mobile}`,
  );

  return lines.join('\n');
}

const SAMPLE_INPUT = {
  evidence: {
    title: 'DataPulse - SaaS Analytics Dashboard',
    url: 'https://www.uupm.cc/demo/saas-analytics-dashboard',
    timestamp: '2026-03-17T20:33:00Z',
    confidence: 90,
    screenshots: {
      desktop: '.pixelslop/screenshots/uupm-cc-desktop-20260317-203300.png',
      tablet: '.pixelslop/screenshots/uupm-cc-tablet-20260317-203400.png',
      mobile: '.pixelslop/screenshots/uupm-cc-mobile-20260317-203430.png',
    },
  },
  scores: {
    hierarchy: { score: 3, evidence: 'Clear h1 (60px) with progressive reduction. Primary CTA visually distinct.' },
    typography: { score: 2, evidence: 'Poppins + DM Sans pairing. Functional but common Google Fonts.' },
    color: { score: 2, evidence: 'Standard blue primary. Green CTA. Slate neutrals. Generic palette.' },
    responsiveness: { score: 2, evidence: 'Layout reflows but 71% of touch targets undersized on mobile.' },
    accessibility: { score: 2, evidence: 'Heading hierarchy correct. CTA contrast fails at 2.28:1.' },
  },
  slop: {
    band: 'TERMINAL',
    patternCount: 11,
    patterns: [
      { name: 'Glassmorphism Everywhere', evidence: '20 elements with backdrop-filter.' },
      { name: 'Gradient Text', evidence: '4 instances of background-clip: text.' },
      { name: 'Hero Metric Layout', evidence: '10K+, 99.9%, 50M+ at 30px.' },
    ],
  },
  findings: [
    '**[Accessibility] CTA contrast failures.** White on green at 2.28:1.',
    '**[Responsiveness] 71% of mobile touch targets undersized.**',
  ],
  personas: [],
};

// --- Sample report for testing (built from structured outputs) ---
const SAMPLE_REPORT = buildReport(SAMPLE_INPUT);


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

  it('builds the sample report from structured specialist outputs', () => {
    assert.ok(SAMPLE_REPORT.includes('## Pixelslop Report: DataPulse - SaaS Analytics Dashboard'));
    assert.ok(SAMPLE_REPORT.includes('### Scores'));
    assert.ok(SAMPLE_REPORT.includes('### AI Slop: TERMINAL'));
    assert.ok(SAMPLE_REPORT.includes('### Findings'));
    assert.ok(SAMPLE_REPORT.includes('### Screenshots'));
  });

  it('omits Persona Insights when no personas were evaluated', () => {
    assert.ok(!SAMPLE_REPORT.includes('### Persona Insights'),
      'report should omit Persona Insights when persona list is empty');
  });
});

// Export the parser for use by other agents/tools
export { parseReport };
