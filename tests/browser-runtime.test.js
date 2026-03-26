/**
 * Direct browser runtime tests.
 *
 * These tests exercise degraded collector branches without launching a real
 * browser. The CLI smoke tests in tools.test.js still cover the live path.
 *
 * Run: node --test tests/browser-runtime.test.js
 */

import { describe, it, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const require = createRequire(import.meta.url);
const { collectEvidence } = require('../bin/pixelslop-browser.cjs');

const tempDirs = [];

function makeTempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'pixelslop-browser-runtime-'));
  tempDirs.push(dir);
  return dir;
}

function writeRootFixture(root, fileName = 'inside.js', contents = 'const placeholder = "Coming soon";\n') {
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, fileName), contents);
}

function makePlaywrightDeps(options = {}) {
  const state = {
    evaluateNames: [],
    screenshotViewports: [],
  };

  const page = {
    currentViewport: 'desktop',
    handlers: {},
    on(event, handler) {
      this.handlers[event] = this.handlers[event] || [];
      this.handlers[event].push(handler);
    },
    async goto() {
      if (options.gotoError) throw new Error(options.gotoError);
    },
    async waitForLoadState() {},
    async title() {
      return options.title || 'Stub Page';
    },
    async setViewportSize(viewport) {
      if (viewport.width === 1440) this.currentViewport = 'desktop';
      else if (viewport.width === 768) this.currentViewport = 'tablet';
      else if (viewport.width === 375) this.currentViewport = 'mobile';
      else this.currentViewport = `${viewport.width}x${viewport.height}`;
    },
    async screenshot({ path }) {
      state.screenshotViewports.push(this.currentViewport);
      if (options.screenshotErrorViewport === this.currentViewport) {
        throw new Error(`screenshot failed for ${this.currentViewport}`);
      }
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, `${this.currentViewport} screenshot`);
    },
    async evaluate(fn) {
      const name = fn.name;
      state.evaluateNames.push(name);
      if (options.evaluateErrors?.includes(name)) {
        throw new Error(`${name} failed`);
      }

      switch (name) {
        case 'snippetTypography':
          return { h1: { fontFamily: 'Inter', fontSize: '32px' } };
        case 'snippetColors':
          return [{ tag: 'body', bg: 'rgb(0, 0, 0)', color: 'rgb(255, 255, 255)' }];
        case 'snippetSpacing':
          return [{ tag: 'main', padding: '24px' }];
        case 'snippetDecorations':
          return { counts: { shadows: 1, blurs: 0, roundedElements: 2, gradientTexts: 0 }, details: [] };
        case 'snippetContrast':
          return [{ tag: 'p', text: 'Hello', ratio: 4.8, passesAA: true }];
        case 'snippetA11ySummary':
          return { headings: [], landmarks: [], images: [], forms: [], ariaRoles: [], skipLink: false, langAttribute: 'en' };
        case 'snippetOverflow':
          return { hasOverflow: false, count: 0, elements: [] };
        case 'snippetTouchTargets':
          return { totalInteractive: 1, undersized: 0, issues: [] };
        case 'snippetHeadingHierarchy':
          return { passed: true, skips: [], h1Count: 1, totalHeadings: 1 };
        case 'snippetLandmarks':
          return { passed: true, missing: [] };
        case 'snippetSkipNav':
          return { passed: true };
        case 'snippetAboveFoldCta':
          return { passed: true };
        case 'snippetReadingLevel':
          return { passed: true, score: 8 };
        case 'snippetImageOptimization':
          return { passed: true, issues: [] };
        case 'snippetCognitiveDensity':
          return { passed: true, ctaCount: 1, navItems: 3, denseTextBlocks: 0, visibleSections: 2 };
        default:
          throw new Error(`Unhandled evaluate stub: ${name}`);
      }
    },
  };

  const context = {
    async newPage() {
      return page;
    },
    async close() {},
  };

  const browser = {
    async newContext() {
      return context;
    },
    async close() {},
  };

  return {
    state,
    deps: {
      detectBrowserRuntime: () => ({ available: true, executablePath: '/tmp/chrome', source: 'test' }),
      requirePlaywright: () => ({
        chromium: {
          async launch() {
            return browser;
          },
        },
      }),
      timestampStamp: () => '20260326-120000',
      withTotalTimeout: async (run) => await run(),
    },
  };
}

afterEach(() => {
  while (tempDirs.length) {
    rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

describe('collectEvidence degraded paths', () => {
  it('writes a valid degraded bundle when no browser runtime is available', async () => {
    const root = makeTempDir();
    writeRootFixture(root);
    const outPath = join(root, 'evidence.json');

    const result = await collectEvidence({
      url: 'http://example.com',
      root,
      out: outPath,
      personas: 'none',
    }, {
      detectBrowserRuntime: () => ({ available: false, executablePath: null, source: null, message: 'no browser runtime' }),
      timestampStamp: () => '20260326-120000',
    });

    const bundle = JSON.parse(readFileSync(outPath, 'utf8'));
    assert.equal(result.ok, false);
    assert.equal(bundle.navigationError, 'no browser runtime');
    assert.equal(bundle.viewports.desktop.screenshot, null);
    assert.deepEqual(Object.keys(bundle).sort(), [
      'confidence', 'console', 'network', 'personaChecks',
      'root', 'sourcePatterns', 'timestamp', 'title', 'url', 'viewports', 'navigationError',
    ].sort());
  });

  it('writes a degraded bundle when navigation fails', async () => {
    const root = makeTempDir();
    writeRootFixture(root);
    const outPath = join(root, 'evidence.json');
    const { deps } = makePlaywrightDeps({ gotoError: 'navigation failed' });

    const result = await collectEvidence({
      url: 'http://example.com',
      root,
      out: outPath,
      personas: 'none',
    }, deps);

    const bundle = JSON.parse(readFileSync(outPath, 'utf8'));
    assert.equal(result.ok, false);
    assert.equal(bundle.navigationError, 'navigation failed');
    assert.equal(bundle.viewports.mobile.touchTargets, null);
    assert.deepEqual(bundle.console, { errors: [], warnings: [] });
  });

  it('keeps other desktop data when contrast extraction fails', async () => {
    const root = makeTempDir();
    writeRootFixture(root);
    const outPath = join(root, 'evidence.json');
    const { deps } = makePlaywrightDeps({ evaluateErrors: ['snippetContrast'] });

    await collectEvidence({
      url: 'http://example.com',
      root,
      out: outPath,
      personas: 'none',
    }, deps);

    const bundle = JSON.parse(readFileSync(outPath, 'utf8'));
    assert.equal(bundle.viewports.desktop.contrast, null);
    assert.ok(bundle.viewports.desktop.typography);
    assert.equal(bundle.confidence.contrastRatios, false);
  });

  it('keeps other screenshots when one viewport screenshot fails', async () => {
    const root = makeTempDir();
    writeRootFixture(root);
    const outPath = join(root, 'evidence.json');
    const { deps } = makePlaywrightDeps({ screenshotErrorViewport: 'tablet' });

    await collectEvidence({
      url: 'http://example.com',
      root,
      out: outPath,
      personas: 'none',
    }, deps);

    const bundle = JSON.parse(readFileSync(outPath, 'utf8'));
    assert.ok(bundle.viewports.desktop.screenshot);
    assert.equal(bundle.viewports.tablet.screenshot, null);
    assert.ok(bundle.viewports.mobile.screenshot);
  });

  it('skips persona collection when personas is none', async () => {
    const root = makeTempDir();
    writeRootFixture(root);
    const outPath = join(root, 'evidence.json');
    const { deps, state } = makePlaywrightDeps();

    await collectEvidence({
      url: 'http://example.com',
      root,
      out: outPath,
      personas: 'none',
    }, deps);

    const bundle = JSON.parse(readFileSync(outPath, 'utf8'));
    assert.deepEqual(bundle.personaChecks, {});
    assert.equal(state.evaluateNames.includes('snippetHeadingHierarchy'), false);
  });

  it('collects persona checks when personas is all', async () => {
    const root = makeTempDir();
    writeRootFixture(root);
    const outPath = join(root, 'evidence.json');
    const { deps } = makePlaywrightDeps();

    await collectEvidence({
      url: 'http://example.com',
      root,
      out: outPath,
      personas: 'all',
    }, deps);

    const bundle = JSON.parse(readFileSync(outPath, 'utf8'));
    assert.equal(bundle.personaChecks.headingHierarchy.passed, true);
    assert.equal(bundle.personaChecks.landmarks.passed, true);
  });

  it('ignores symlinked files that point outside the requested root', async () => {
    const root = makeTempDir();
    const outside = makeTempDir();
    writeRootFixture(root, 'inside.js', 'const message = "Coming soon";\n');
    writeFileSync(join(outside, 'secret.js'), 'const token = "Coming soon secret";\n');
    symlinkSync(join(outside, 'secret.js'), join(root, 'leak.js'));
    const outPath = join(root, 'evidence.json');
    const { deps } = makePlaywrightDeps();

    await collectEvidence({
      url: 'http://example.com',
      root,
      out: outPath,
      personas: 'none',
    }, deps);

    const bundle = JSON.parse(readFileSync(outPath, 'utf8'));
    const matchedFiles = bundle.sourcePatterns.flatMap(pattern => pattern.files);
    assert.ok(matchedFiles.includes('inside.js:1'));
    assert.equal(matchedFiles.some(file => file.startsWith('leak.js:')), false);
  });
});
