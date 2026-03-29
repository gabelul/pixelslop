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
    refMapMaxRefs: null,
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
    async waitForTimeout(ms) {
      if (options.waitForTimeout) {
        return await options.waitForTimeout(ms, state);
      }
    },
    async title() {
      return options.title || 'Stub Page';
    },
    keyboard: {
      async press() {},
    },
    mouse: {
      async move() {},
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
    async evaluate(fn, ...args) {
      if (options.evaluate) {
        return await options.evaluate(fn, ...args, state);
      }
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
        case 'snippetBuildRefMap':
          state.refMapMaxRefs = args[0] ?? null;
          return [{ ref: 'r0', tag: 'button', text: 'Click me', selector: 'button', category: 'button', isSemanticInteractive: true }];
        case 'snippetPageDimensions':
          return { scrollHeight: 900, viewportHeight: 900, scrollWidth: 1440, viewportWidth: 1440, scrollStrategy: 'document', containerSelector: null };
        case 'snippetStickyElements':
          return [];
        case 'snippetImageSrcs':
          return [];
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
          // Anonymous functions from inline evaluate calls (e.g. resetProbeState)
          return null;
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
      'confidence', 'console', 'focusPass', 'hoverStates',
      'interactiveElements', 'interactivePromises', 'meta',
      'navigationError', 'network', 'personaChecks',
      'root', 'scroll', 'sourcePatterns', 'timestamp', 'title', 'url', 'viewports',
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

  it('keeps focusPass confidence false when the real collectEvidence path times out', async () => {
    const root = makeTempDir();
    writeRootFixture(root);
    const outPath = join(root, 'evidence.json');

    let focusTabCount = 0;
    const { deps } = makePlaywrightDeps({
      waitForTimeout: async (ms) => {
        if (ms > 0) {
          await new Promise(resolve => setTimeout(resolve, ms + 50));
        }
      },
      evaluate: async (fn, ...args) => {
        const name = fn.name;
        if (name) {
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
            case 'snippetBuildRefMap':
              return [{ ref: 'r0', tag: 'button', text: 'Click me', selector: 'button', category: 'button', isSemanticInteractive: true, rect: { top: 10, left: 0, width: 100, height: 40 } }];
            case 'snippetPageDimensions':
              return { scrollHeight: 900, viewportHeight: 900, scrollWidth: 1440, viewportWidth: 1440, scrollStrategy: 'document', containerSelector: null };
            case 'snippetImageSrcs':
              return [];
            case 'snippetStickyElements':
              return [];
            case 'snippetNonSemanticClickables':
              return [];
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
              break;
          }
        }

        const source = fn.toString();
        if (source.includes('document.activeElement') && source.includes('blur') && !source.includes('getComputedStyle')) {
          return undefined;
        }
        if (source.includes('const el = document.activeElement;') && source.includes('hasVisibleIndicator')) {
          return {
            selector: '#focused',
            outline: '2px solid blue',
            outlineOffset: '2px',
            boxShadow: 'none',
            borderColor: 'rgb(0, 0, 0)',
            hasVisibleIndicator: true,
            indicatorType: 'outline',
            indicatorValue: '2px solid blue',
          };
        }
        if (source.includes('document.activeElement') && source.includes('tagName.toLowerCase()')) {
          focusTabCount += 1;
          if (focusTabCount <= 30) {
            return {
              tag: 'button',
              selector: `button:nth-of-type(${focusTabCount})`,
              text: `Button ${focusTabCount}`,
              rect: { top: 20 + focusTabCount, left: 0, width: 100, height: 40 },
              _loopKey: `button:nth-of-type(${focusTabCount})|${20 + focusTabCount},0`,
            };
          }
          return null;
        }
        return null;
      },
    });

    await collectEvidence({
      url: 'http://example.com',
      root,
      out: outPath,
      personas: 'none',
    }, deps);

    const bundle = JSON.parse(readFileSync(outPath, 'utf8'));
    assert.equal(bundle.meta.bailouts.some(entry => entry.pass === 'focus'), true, 'focus timeout should be recorded');
    assert.equal(bundle.confidence.focusPass, false, 'timed-out focus pass should not be marked collected');
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

  it('deep mode sets meta.mode and populates timing fields', async () => {
    const root = makeTempDir();
    writeRootFixture(root);
    const outPath = join(root, 'evidence.json');
    const { deps } = makePlaywrightDeps();

    await collectEvidence({
      url: 'http://example.com',
      root,
      out: outPath,
      personas: 'none',
      deep: true,
    }, deps);

    const bundle = JSON.parse(readFileSync(outPath, 'utf8'));
    assert.equal(bundle.meta.mode, 'deep', 'deep flag should set meta.mode');
    assert.equal(typeof bundle.meta.collectionTimeMs, 'number', 'collectionTimeMs should be a number');
    assert.ok(bundle.meta.collectionTimeMs >= 0, 'collectionTimeMs should be non-negative');
    assert.equal(typeof bundle.meta.passTimings.scroll, 'number', 'scroll timing should be a number');
    assert.equal(typeof bundle.meta.passTimings.hover, 'number', 'hover timing should be a number');
    assert.equal(typeof bundle.meta.passTimings.focus, 'number', 'focus timing should be a number');
    assert.equal(typeof bundle.meta.passTimings.promises, 'number', 'promises timing should be a number');
  });

  it('deep mode passes raised maxRefs to snippetBuildRefMap', async () => {
    const root = makeTempDir();
    writeRootFixture(root);
    const outPath = join(root, 'evidence.json');
    const { state, deps } = makePlaywrightDeps();

    await collectEvidence({
      url: 'http://example.com',
      root,
      out: outPath,
      personas: 'none',
      deep: true,
    }, deps);

    assert.equal(state.refMapMaxRefs, 500, 'deep mode should pass maxRefs=500 to snippetBuildRefMap');
  });

  it('standard mode passes default maxRefs to snippetBuildRefMap', async () => {
    const root = makeTempDir();
    writeRootFixture(root);
    const outPath = join(root, 'evidence.json');
    const { state, deps } = makePlaywrightDeps();

    await collectEvidence({
      url: 'http://example.com',
      root,
      out: outPath,
      personas: 'none',
    }, deps);

    assert.equal(state.refMapMaxRefs, 150, 'standard mode should pass maxRefs=150 to snippetBuildRefMap');
  });

  it('standard mode sets meta.mode to standard with timing', async () => {
    const root = makeTempDir();
    writeRootFixture(root);
    const outPath = join(root, 'evidence.json');
    const { deps } = makePlaywrightDeps();

    await collectEvidence({
      url: 'http://example.com',
      root,
      out: outPath,
      personas: 'none',
    }, deps);

    const bundle = JSON.parse(readFileSync(outPath, 'utf8'));
    assert.equal(bundle.meta.mode, 'standard', 'default should be standard mode');
    assert.equal(typeof bundle.meta.collectionTimeMs, 'number');
    assert.ok(bundle.meta.collectionTimeMs >= 0);
  });
});
