/**
 * HTML Report Template & Generation Tests
 *
 * Validates the report template structure, token coverage,
 * self-containment (no external resources), and round-trip
 * generation from fixture data including safety (XSS escaping,
 * missing screenshots, fail-soft behavior).
 *
 * Run: node --test tests/html-report.test.js
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = join(__dirname, '..', 'dist', 'skill', 'resources', 'report-template.html');
const TOOLS = join(__dirname, '..', 'bin', 'pixelslop-tools.cjs');

/**
 * Run pixelslop-tools with args, return parsed JSON output.
 * @param {string} args - CLI arguments
 * @param {string} cwd - Working directory
 * @param {boolean} expectError - Allow non-zero exit
 * @param {string} toolPath - CLI entrypoint to execute
 * @returns {object} Parsed JSON result
 */
function runJson(args, cwd, expectError = false, toolPath = TOOLS) {
  try {
    const stdout = execSync(`node "${toolPath}" ${args}`, {
      cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    });
    return JSON.parse(stdout.trim());
  } catch (err) {
    if (expectError) {
      try { return JSON.parse(err.stdout?.trim() || '{}'); }
      catch { return { error: err.stderr || err.message }; }
    }
    throw err;
  }
}

/** Minimal valid scan results for round-trip testing */
function makeScanFixture(overrides = {}) {
  return {
    title: 'Test Page',
    url: 'http://localhost:3000',
    timestamp: '2026-03-31T14:30:00Z',
    confidence: 85,
    scores: {
      hierarchy: { score: 3, evidence: 'Good hierarchy' },
      typography: { score: 2, evidence: 'Generic fonts' },
      color: { score: 2, evidence: 'Standard palette' },
      responsiveness: { score: 3, evidence: 'Reflows well' },
      accessibility: { score: 2, evidence: 'Some issues' },
    },
    slop: { band: 'MILD', patternCount: 2, patterns: [] },
    findings: [
      { priority: 'P0', description: 'CTA contrast fails at 2.1:1' },
      { priority: 'P1', description: 'Touch targets undersized on mobile' },
    ],
    screenshots: { desktop: null, tablet: null, mobile: null },
    personaStories: [],
    ...overrides,
  };
}

// ─────────────────────────────────────────────
// Tests: Template structure
// ─────────────────────────────────────────────

describe('report template structure', () => {
  let template;

  it('template file exists', () => {
    assert.ok(existsSync(TEMPLATE_PATH), 'report-template.html should exist');
    template = readFileSync(TEMPLATE_PATH, 'utf-8');
  });

  it('has valid HTML structure', () => {
    template = readFileSync(TEMPLATE_PATH, 'utf-8');
    assert.ok(template.includes('<!DOCTYPE html>'), 'should have doctype');
    assert.ok(template.includes('<html'), 'should have html tag');
    assert.ok(template.includes('<head>'), 'should have head');
    assert.ok(template.includes('<body>'), 'should have body');
    assert.ok(template.includes('</html>'), 'should close html');
  });

  it('has all required token placeholders', () => {
    template = readFileSync(TEMPLATE_PATH, 'utf-8');
    const required = [
      '{{TITLE}}', '{{URL_META}}', '{{DATE}}', '{{CONFIDENCE}}',
      '{{TAB_RADIOS}}', '{{TAB_LABELS}}',
      '{{KPI_BLOCKS}}', '{{PERCEPTUAL_READ}}', '{{SLOP_PATTERNS}}', '{{PILLAR_ROWS}}',
      '{{SCREENSHOT_GRID}}', '{{PERSONA_SECTIONS}}',
      '{{FINDINGS_DETAIL}}', '{{FIX_SECTION}}',
    ];
    for (const token of required) {
      assert.ok(template.includes(token), `Missing token: ${token}`);
    }
  });

  it('has no external resource references', () => {
    template = readFileSync(TEMPLATE_PATH, 'utf-8');
    // No external stylesheets
    assert.ok(!/<link[^>]+href\s*=\s*["']https?:/.test(template),
      'should not link to external stylesheets');
    // No external scripts
    assert.ok(!/<script[^>]+src\s*=\s*["']/.test(template),
      'should not reference external scripts');
    // No external font imports
    assert.ok(!template.includes('fonts.googleapis.com'),
      'should not import Google Fonts');
  });

  it('CSS is inline within style tags', () => {
    template = readFileSync(TEMPLATE_PATH, 'utf-8');
    assert.ok(template.includes('<style>'), 'should have inline style tag');
    assert.ok(template.includes('</style>'), 'should close style tag');
  });

  it('has required sections', () => {
    template = readFileSync(TEMPLATE_PATH, 'utf-8');
    assert.ok(template.includes('tab-section-overview'), 'should have overview section');
    assert.ok(template.includes('tab-section-personas'), 'should reference personas section class');
    assert.ok(template.includes('tab-section-findings'), 'should have findings section');
    assert.ok(template.includes('tab-section-fixes'), 'should reference fixes section class');
  });

  it('has CSS-only tab navigation', () => {
    template = readFileSync(TEMPLATE_PATH, 'utf-8');
    assert.ok(template.includes('.tab-radio'), 'should have tab-radio class');
    assert.ok(template.includes('.tab-bar'), 'should have tab-bar class');
    assert.ok(template.includes('tab-overview:checked'), 'should have overview tab selector');
    assert.ok(template.includes('tab-findings:checked'), 'should have findings tab selector');
  });

  it('forces light mode (no dark mode)', () => {
    template = readFileSync(TEMPLATE_PATH, 'utf-8');
    assert.ok(!template.includes('prefers-color-scheme: dark'), 'should not have dark mode — report is always light');
    assert.ok(template.includes('color-scheme: light'), 'should force light color scheme');
  });

  it('has print stylesheet', () => {
    template = readFileSync(TEMPLATE_PATH, 'utf-8');
    assert.ok(template.includes('@media print'), 'should have print media query');
  });

  it('brands header and footer with the GitHub repo link', () => {
    template = readFileSync(TEMPLATE_PATH, 'utf-8');
    const repoUrl = 'https://github.com/gabelul/pixelslop';
    assert.ok(template.includes(`<a href="${repoUrl}">Pixelslop</a>`),
      'header wordmark should link to the GitHub repo');
    assert.ok(template.includes(`<a href="${repoUrl}">Pixelslop on GitHub</a>`),
      'footer branding should link to the GitHub repo');
  });
});

// ─────────────────────────────────────────────
// Tests: Report generation (round-trip)
// ─────────────────────────────────────────────

describe('report generate command', () => {
  let dir;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pixelslop-report-'));
    mkdirSync(join(dir, '.pixelslop'), { recursive: true });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function writeFakeScreenshot(relativePath, size = 32) {
    const absolutePath = join(dir, relativePath);
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, Buffer.alloc(size, 1));
    return absolutePath;
  }

  it('generates HTML from valid scan results', () => {
    const scanPath = join(dir, 'scan.json');
    writeFileSync(scanPath, JSON.stringify(makeScanFixture()));
    const result = runJson(`report generate --scan-results "${scanPath}" --root "${dir}" --raw`, dir);
    assert.ok(result.ok, `Should succeed: ${result.error}`);
    assert.ok(result.path, 'Should return path');
    assert.ok(existsSync(result.path), 'HTML file should exist');

    const html = readFileSync(result.path, 'utf-8');
    assert.ok(html.includes('<!DOCTYPE html>'), 'Output should be valid HTML');
    assert.ok(html.includes('Test Page'), 'Should contain the title');
    assert.ok(html.includes('12'), 'Should contain the total score');
    assert.ok(html.includes('Needs Work'), 'Should contain the rating band');
    assert.ok(html.includes('MILD'), 'Should contain slop band');
    assert.ok(html.includes('https://github.com/gabelul/pixelslop'),
      'Should contain the GitHub repo branding link');
  });

  it('includes persona stories when present', () => {
    const fixture = makeScanFixture({
      personaStories: [
        {
          humanName: 'Sam', name: 'Screen Reader User',
          narrative: 'The headings skip from h1 to h3.',
          issueCount: 2, priority: 'High',
          positiveSignals: 'landmark regions present',
        },
      ],
    });
    const scanPath = join(dir, 'scan.json');
    writeFileSync(scanPath, JSON.stringify(fixture));
    const result = runJson(`report generate --scan-results "${scanPath}" --root "${dir}" --raw`, dir);
    const html = readFileSync(result.path, 'utf-8');
    assert.ok(html.includes('Persona'), 'Should have persona section heading');
    assert.ok(html.includes('Sam'), 'Should include persona humanName');
    assert.ok(html.includes('Screen Reader User'), 'Should include persona full name');
    assert.ok(html.includes('headings skip'), 'Should include narrative text');
  });

  it('renders The Read card when perceptualRead is present', () => {
    const fixture = makeScanFixture({
      perceptualRead: {
        verdict: 'This reads as generated — a template hero with the content swapped in.',
        confidence: 'high',
        voices: [
          { humanName: 'Casey', reaction: 'bounced before finding the CTA on mobile' },
          { humanName: 'Quinn', reaction: 'called the hero a template' },
        ],
      },
    });
    const scanPath = join(dir, 'scan.json');
    writeFileSync(scanPath, JSON.stringify(fixture));
    const result = runJson(`report generate --scan-results "${scanPath}" --root "${dir}" --raw`, dir);
    const html = readFileSync(result.path, 'utf-8');
    assert.ok(html.includes('The Read'), 'Should render the perceptual card label');
    assert.ok(html.includes('template hero'), 'Should render the verdict');
    assert.ok(html.includes('Casey') && html.includes('bounced before finding the CTA'),
      'Should render the persona voices');
    assert.ok(!html.includes('{{PERCEPTUAL_READ}}'), 'Token must be substituted');
  });

  it('fails soft when perceptualRead is absent — no card, no leftover token', () => {
    const scanPath = join(dir, 'scan.json');
    writeFileSync(scanPath, JSON.stringify(makeScanFixture())); // no perceptualRead
    const result = runJson(`report generate --scan-results "${scanPath}" --root "${dir}" --raw`, dir);
    const html = readFileSync(result.path, 'utf-8');
    assert.ok(result.ok, 'Should still generate without a perceptual read');
    assert.ok(!html.includes('{{PERCEPTUAL_READ}}'), 'Token must be substituted to empty');
    assert.ok(!html.includes('class="the-read"'), 'No card should render without a read');
  });

  it('escapes HTML in the perceptual read', () => {
    const fixture = makeScanFixture({
      perceptualRead: { verdict: '<script>alert(1)</script>', confidence: 'high', voices: [] },
    });
    const scanPath = join(dir, 'scan.json');
    writeFileSync(scanPath, JSON.stringify(fixture));
    const result = runJson(`report generate --scan-results "${scanPath}" --root "${dir}" --raw`, dir);
    const html = readFileSync(result.path, 'utf-8');
    assert.ok(!html.includes('<script>alert(1)</script>'), 'Must escape injected HTML in the verdict');
  });

  it('omits persona section when no personas evaluated', () => {
    const scanPath = join(dir, 'scan.json');
    writeFileSync(scanPath, JSON.stringify(makeScanFixture({ personaStories: [] })));
    const result = runJson(`report generate --scan-results "${scanPath}" --root "${dir}" --raw`, dir);
    const html = readFileSync(result.path, 'utf-8');
    assert.ok(!html.includes('Persona Stories'), 'Should omit persona section heading when empty');
    assert.ok(!html.includes('id="tab-personas"'), 'Should not have personas tab radio when empty');
  });

  it('renders screenshot placeholders when files are missing', () => {
    const scanPath = join(dir, 'scan.json');
    writeFileSync(scanPath, JSON.stringify(makeScanFixture()));
    const result = runJson(`report generate --scan-results "${scanPath}" --root "${dir}" --raw`, dir);
    const html = readFileSync(result.path, 'utf-8');
    assert.ok(html.includes('Not captured'), 'Should show placeholder for missing screenshots');
  });

  it('escapes HTML in title to prevent XSS', () => {
    const fixture = makeScanFixture({ title: '<script>alert("xss")</script>' });
    const scanPath = join(dir, 'scan.json');
    writeFileSync(scanPath, JSON.stringify(fixture));
    const result = runJson(`report generate --scan-results "${scanPath}" --root "${dir}" --raw`, dir);
    const html = readFileSync(result.path, 'utf-8');
    assert.ok(!html.includes('<script>alert'), 'Script tag should be escaped');
    assert.ok(html.includes('&lt;script&gt;'), 'Should contain escaped script tag');
  });

  it('sanitizes numeric-looking fields before injecting them into HTML', () => {
    const fixture = makeScanFixture({
      confidence: '<img src=x onerror=alert(1)>',
      slopCount: '<script>alert(1)</script>',
      scores: {
        hierarchy: { score: '0</span><script>alert(1)</script>' },
        typography: { score: 2 },
        color: { score: 2 },
        responsiveness: { score: 2 },
        accessibility: { score: 2 },
      },
    });
    const scanPath = join(dir, 'scan.json');
    writeFileSync(scanPath, JSON.stringify(fixture));
    const result = runJson(`report generate --scan-results "${scanPath}" --root "${dir}" --raw`, dir);
    const html = readFileSync(result.path, 'utf-8');
    assert.ok(!html.includes('<script>alert(1)</script>'), 'raw script payload should not survive');
    assert.ok(!html.includes('onerror=alert(1)'), 'raw event handler payload should not survive');
  });

  it('neutralizes dangerous URL schemes in the report header', () => {
    const fixture = makeScanFixture({ url: 'javascript:alert(1)' });
    const scanPath = join(dir, 'scan.json');
    writeFileSync(scanPath, JSON.stringify(fixture));
    const result = runJson(`report generate --scan-results "${scanPath}" --root "${dir}" --raw`, dir);
    const html = readFileSync(result.path, 'utf-8');
    assert.ok(!html.includes('href="javascript:alert(1)"'), 'javascript: URLs should not remain clickable');
    assert.ok(html.includes('<span>javascript:alert(1)</span>'), 'unsafe URL should render as plain text');
  });

  it('fails soft with missing scan results file', () => {
    const result = runJson(`report generate --scan-results "${join(dir, 'nonexistent.json')}" --root "${dir}" --raw`, dir);
    assert.equal(result.ok, false, 'Should return ok: false');
    assert.ok(result.error, 'Should return an error message');
  });

  it('fails soft with malformed JSON', () => {
    const scanPath = join(dir, 'bad.json');
    writeFileSync(scanPath, 'not json {{{');
    const result = runJson(`report generate --scan-results "${scanPath}" --root "${dir}" --raw`, dir);
    assert.equal(result.ok, false, 'Should return ok: false for bad JSON');
  });

  it('includes fixes tab when plan snapshot has non-pending issues', () => {
    const scanPath = join(dir, 'scan.json');
    writeFileSync(scanPath, JSON.stringify(makeScanFixture()));
    const planPath = join(dir, 'plan.json');
    writeFileSync(planPath, JSON.stringify({
      baseline_score: 8,
      baseline_slop: 'SLOPPY',
      issues: [
        { id: 'contrast-cta', status: 'fixed', priority: 'P0', category: 'accessibility', description: 'CTA contrast' },
        { id: 'touch-footer', status: 'partial', priority: 'P1', category: 'responsiveness', description: 'Touch targets' },
        { id: 'font-generic', status: 'pending', priority: 'P1', category: 'typography', description: 'Generic fonts' },
      ],
      summary: { fixed: 1, partial: 1, failed: 0, pending: 1, skipped: 0, total: 3 },
    }));
    const result = runJson(`report generate --scan-results "${scanPath}" --plan-snapshot "${planPath}" --root "${dir}" --raw`, dir);
    const html = readFileSync(result.path, 'utf-8');
    assert.ok(html.includes('Fix Outcome'), 'should have fixes section');
    assert.ok(html.includes('FIXED'), 'should show FIXED status');
    assert.ok(html.includes('PARTIAL'), 'should show PARTIAL status');
    assert.ok(html.includes('tab-fixes'), 'should have fixes tab');
    assert.ok(html.includes('Score Comparison'), 'should have score comparison table');
    assert.ok(!html.includes('What Changed'), 'thin snapshots should not force the detailed change section');
  });

  it('renders a What Changed section when plan snapshot includes fix detail', () => {
    const scanPath = join(dir, 'scan.json');
    writeFileSync(scanPath, JSON.stringify(makeScanFixture()));
    const planPath = join(dir, 'plan.json');
    writeFileSync(planPath, JSON.stringify({
      baseline_score: 8,
      issues: [
        {
          id: 'overflow-mobile',
          status: 'fixed',
          priority: 'P0',
          category: 'responsiveness',
          description: 'Table overflowed on mobile',
          whatChanged: 'Header stacks on mobile, low-priority columns hide at 400px, cell padding reduced.',
          evidence: 'Checker PASS — only offscreen skip-link remains; core table overflow resolved.',
          source: 'checker',
        },
      ],
      summary: { fixed: 1, partial: 0, failed: 0, pending: 0, skipped: 0, total: 1 },
    }));
    const result = runJson(`report generate --scan-results "${scanPath}" --plan-snapshot "${planPath}" --root "${dir}" --raw`, dir);
    const html = readFileSync(result.path, 'utf-8');
    assert.ok(html.includes('What Changed'), 'should render the detailed fix section');
    assert.ok(html.includes('Header stacks on mobile'), 'should include whatChanged text');
    assert.ok(html.includes('Checker PASS'), 'should include checker evidence');
    assert.ok(html.includes('Source: CHECKER'), 'should show the detail source');
  });

  it('shows detail notes for partial and skipped issues when present', () => {
    const scanPath = join(dir, 'scan.json');
    writeFileSync(scanPath, JSON.stringify(makeScanFixture()));
    const planPath = join(dir, 'plan.json');
    writeFileSync(planPath, JSON.stringify({
      baseline_score: 8,
      issues: [
        {
          id: 'touch-targets',
          status: 'partial',
          priority: 'P1',
          category: 'responsiveness',
          description: 'Some touch targets remain small',
          whatChanged: 'Primary nav targets now meet 44px minimum; footer links still trail.',
          evidence: 'Checker PARTIAL — footer remains below target on narrow devices.',
          source: 'checker',
        },
        {
          id: 'cognitive-density',
          status: 'skipped',
          priority: 'P2',
          category: 'layout',
          description: 'Dense operator console layout',
          whatChanged: 'Skipped by design for the operator console; dense dashboard layout is intentional.',
          source: 'checker',
        },
      ],
      summary: { fixed: 0, partial: 1, failed: 0, pending: 0, skipped: 1, total: 2 },
    }));
    const result = runJson(`report generate --scan-results "${scanPath}" --plan-snapshot "${planPath}" --root "${dir}" --raw`, dir);
    const html = readFileSync(result.path, 'utf-8');
    assert.ok(html.includes('Primary nav targets now meet 44px minimum'), 'partial issue detail should render');
    assert.ok(html.includes('Skipped by design for the operator console'), 'skipped issue detail should render');
    assert.ok(html.includes('PARTIAL'), 'partial status should still be visible');
    assert.ok(html.includes('SKIPPED'), 'skipped status should still be visible');
  });

  it('omits fixes tab when no plan snapshot', () => {
    const scanPath = join(dir, 'scan.json');
    writeFileSync(scanPath, JSON.stringify(makeScanFixture()));
    const result = runJson(`report generate --scan-results "${scanPath}" --root "${dir}" --raw`, dir);
    const html = readFileSync(result.path, 'utf-8');
    assert.ok(!html.includes('Fix Outcome'), 'should omit fixes section');
    assert.ok(!html.includes('id="tab-fixes"'), 'should not have fixes tab radio input');
  });

  it('renders correct tab count for scan-only (2 tabs)', () => {
    const scanPath = join(dir, 'scan.json');
    writeFileSync(scanPath, JSON.stringify(makeScanFixture({ personaStories: [] })));
    const result = runJson(`report generate --scan-results "${scanPath}" --root "${dir}" --raw`, dir);
    const html = readFileSync(result.path, 'utf-8');
    const radioCount = (html.match(/class="tab-radio"/g) || []).length;
    assert.equal(radioCount, 2, 'scan-only should have 2 tabs (overview + findings)');
  });

  it('renders correct tab count with all data (4 tabs)', () => {
    const scanPath = join(dir, 'scan.json');
    writeFileSync(scanPath, JSON.stringify(makeScanFixture({
      personaStories: [
        { humanName: 'Sam', name: 'Screen Reader User', narrative: 'Test', issueCount: 1, priority: 'High', positiveSignals: 'good' },
      ],
    })));
    const planPath = join(dir, 'plan.json');
    writeFileSync(planPath, JSON.stringify({
      baseline_score: 8, issues: [{ id: 'x', status: 'fixed', priority: 'P1', category: 'a11y', description: 'test' }],
      summary: { fixed: 1, partial: 0, failed: 0, pending: 0, skipped: 0, total: 1 },
    }));
    const result = runJson(`report generate --scan-results "${scanPath}" --plan-snapshot "${planPath}" --root "${dir}" --raw`, dir);
    const html = readFileSync(result.path, 'utf-8');
    const radioCount = (html.match(/class="tab-radio"/g) || []).length;
    assert.equal(radioCount, 4, 'full data should have 4 tabs');
  });

  it('output is self-contained (no external references)', () => {
    const scanPath = join(dir, 'scan.json');
    writeFileSync(scanPath, JSON.stringify(makeScanFixture()));
    const result = runJson(`report generate --scan-results "${scanPath}" --root "${dir}" --raw`, dir);
    const html = readFileSync(result.path, 'utf-8');
    assert.ok(!/<link[^>]+href\s*=\s*["']https?:/.test(html), 'No external stylesheets');
    assert.ok(!/<script[^>]+src\s*=/.test(html), 'No external scripts');
  });

  it('resolves relative screenshot paths against --root', () => {
    writeFakeScreenshot('.pixelslop/screenshots/desktop.png');
    const scanPath = join(dir, 'scan.json');
    writeFileSync(scanPath, JSON.stringify(makeScanFixture({
      screenshots: { desktop: '.pixelslop/screenshots/desktop.png', tablet: null, mobile: null },
    })));
    const result = runJson(`report generate --scan-results "${scanPath}" --root "${dir}" --raw`, dir);
    const html = readFileSync(result.path, 'utf-8');
    assert.ok(html.includes('data:image/png;base64,'), 'safe relative screenshot should embed as data URI');
  });

  it('refuses screenshot paths outside .pixelslop/screenshots', () => {
    const outsidePath = join(dir, 'outside.png');
    writeFileSync(outsidePath, Buffer.alloc(32, 2));
    const scanPath = join(dir, 'scan.json');
    writeFileSync(scanPath, JSON.stringify(makeScanFixture({
      screenshots: { desktop: outsidePath, tablet: null, mobile: null },
    })));
    const result = runJson(`report generate --scan-results "${scanPath}" --root "${dir}" --raw`, dir);
    const html = readFileSync(result.path, 'utf-8');
    assert.ok(!html.includes('data:image/png;base64,'), 'outside screenshot should not be embedded');
    assert.ok(html.includes('Not captured'), 'outside screenshot should fall back to placeholder');
  });

  it('resolves relative --scan-results path against --root', () => {
    // Write scan results inside the project dir
    mkdirSync(join(dir, '.pixelslop'), { recursive: true });
    writeFileSync(join(dir, '.pixelslop', 'scan-results.json'), JSON.stringify(makeScanFixture()));
    // Run from a DIFFERENT directory, using relative scan path + absolute root
    const result = runJson(`report generate --scan-results .pixelslop/scan-results.json --root "${dir}" --raw`, tmpdir());
    assert.ok(result.ok, `Should resolve relative path against --root: ${result.error}`);
    assert.ok(existsSync(result.path), 'HTML file should exist');
  });

  it('finds the report template in the installed skill/resources layout', () => {
    const installRoot = mkdtempSync(join(tmpdir(), 'pixelslop-installed-'));

    try {
      const toolPath = join(installRoot, 'bin', 'pixelslop-tools.cjs');
      mkdirSync(join(installRoot, 'bin'), { recursive: true });
      mkdirSync(join(installRoot, 'skill', 'resources'), { recursive: true });
      copyFileSync(TOOLS, toolPath);
      copyFileSync(TEMPLATE_PATH, join(installRoot, 'skill', 'resources', 'report-template.html'));
      assert.equal(
        existsSync(join(installRoot, 'dist', 'skill', 'resources', 'report-template.html')),
        false,
        'installed layout should not rely on the repo dist path',
      );

      mkdirSync(join(dir, '.pixelslop'), { recursive: true });
      writeFileSync(join(dir, '.pixelslop', 'scan-results.json'), JSON.stringify(makeScanFixture()));

      const result = runJson(
        `report generate --scan-results .pixelslop/scan-results.json --root "${dir}" --raw`,
        tmpdir(),
        false,
        toolPath,
      );

      assert.ok(result.ok, `installed layout should resolve the template: ${result.error}`);
      assert.ok(existsSync(result.path), 'installed layout should still write a report');
    } finally {
      rmSync(installRoot, { recursive: true, force: true });
    }
  });

  it('report generate command appears in help output', () => {
    const { stdout } = (() => {
      try {
        return { stdout: execSync(`node "${TOOLS}" --help`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }) };
      } catch (err) { return { stdout: err.stdout || '' }; }
    })();
    assert.ok(stdout.includes('report generate'), 'Help should mention report generate');
    assert.ok(stdout.includes('scan save-results'), 'Help should mention scan save-results');
  });

  it('shows pillar evidence in the score table', () => {
    const scanPath = join(dir, 'scan.json');
    writeFileSync(scanPath, JSON.stringify(makeScanFixture()));
    const result = runJson(`report generate --scan-results "${scanPath}" --root "${dir}" --raw`, dir);
    const html = readFileSync(result.path, 'utf-8');
    assert.ok(html.includes('Key Observation'), 'pillar table should have evidence header');
    assert.ok(html.includes('Good hierarchy'), 'should render hierarchy evidence text');
    assert.ok(html.includes('Generic fonts'), 'should render typography evidence text');
  });

  it('renders slop patterns when present', () => {
    const fixture = makeScanFixture({
      slop: {
        band: 'SLOPPY',
        patternCount: 2,
        patterns: [
          { name: 'Glassmorphism Everywhere', evidence: '20 elements with backdrop-filter' },
          { name: 'Gradient Text', evidence: '4 instances of background-clip: text' },
        ],
      },
    });
    const scanPath = join(dir, 'scan.json');
    writeFileSync(scanPath, JSON.stringify(fixture));
    const result = runJson(`report generate --scan-results "${scanPath}" --root "${dir}" --raw`, dir);
    const html = readFileSync(result.path, 'utf-8');
    assert.ok(html.includes('Detected Patterns'), 'should have patterns heading');
    assert.ok(html.includes('Glassmorphism Everywhere'), 'should list pattern name');
    assert.ok(html.includes('backdrop-filter'), 'should show pattern evidence');
  });

  it('omits slop patterns section when CLEAN', () => {
    const scanPath = join(dir, 'scan.json');
    writeFileSync(scanPath, JSON.stringify(makeScanFixture()));
    const result = runJson(`report generate --scan-results "${scanPath}" --root "${dir}" --raw`, dir);
    const html = readFileSync(result.path, 'utf-8');
    assert.ok(!html.includes('Detected Patterns'), 'should omit patterns section when CLEAN');
  });

  it('escapes HTML in evidence strings', () => {
    const fixture = makeScanFixture({
      scores: {
        hierarchy: { score: 3, evidence: '<img onerror=alert(1)> in heading' },
        typography: { score: 2, evidence: 'Generic fonts' },
        color: { score: 2, evidence: 'Standard' },
        responsiveness: { score: 3, evidence: 'OK' },
        accessibility: { score: 2, evidence: 'Issues' },
      },
    });
    const scanPath = join(dir, 'scan.json');
    writeFileSync(scanPath, JSON.stringify(fixture));
    const result = runJson(`report generate --scan-results "${scanPath}" --root "${dir}" --raw`, dir);
    const html = readFileSync(result.path, 'utf-8');
    assert.ok(!html.includes('<img onerror'), 'evidence tags should be escaped');
    assert.ok(html.includes('&lt;img onerror'), 'should contain escaped evidence');
  });
});
