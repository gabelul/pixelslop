#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const NAVIGATION_TIMEOUT_MS = 15000;
const EVALUATE_TIMEOUT_MS = 5000;
const SCREENSHOT_TIMEOUT_MS = 10000;
const TOTAL_TIMEOUT_MS = 120000;
const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  tablet: { width: 768, height: 1024 },
  mobile: { width: 375, height: 812 },
};

const SOURCE_PATTERNS = [
  { id: 'S11', name: 'Repeated Identical Section Structures', regex: /<section\b/gi },
  { id: 'S12', name: 'Placeholder Content Markers', regex: /Lorem ipsum|Coming soon|\[Your .* here\]|\[Insert|placeholder/gi },
  { id: 'S13', name: 'Excessive Utility Class Stacking', regex: /class(Name)?="[^"]{200,}"/g },
  { id: 'S14', name: 'Identical Button Labels Across Sections', regex: />Learn More<|>Get Started<|>Read More<|>Try Now<|>Sign Up</g },
  { id: 'S15', name: 'Stock Photo Alt Text Patterns', regex: /alt="[^"]*(?:diverse team|professional|working on laptop|business meeting|happy customer|smiling person|team collaboration)[^"]*"/gi },
  { id: 'S16', name: 'Inline Style Proliferation', regex: /style="[^"]{100,}"/g },
];

function detectBrowserRuntime() {
  const envPath = process.env.PIXELSLOP_BROWSER_EXECUTABLE || process.env.CHROME_EXECUTABLE || process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  if (envPath && fs.existsSync(envPath)) {
    return { available: true, executablePath: envPath, source: 'env' };
  }

  for (const candidate of browserCandidates()) {
    if (fs.existsSync(candidate)) {
      return { available: true, executablePath: candidate, source: 'system' };
    }
  }

  for (const bin of browserBins()) {
    const resolved = which(bin);
    if (resolved) {
      return { available: true, executablePath: resolved, source: 'path' };
    }
  }

  const playwrightCache = findPlaywrightCacheExecutable();
  if (playwrightCache) {
    return { available: true, executablePath: playwrightCache, source: 'playwright-cache' };
  }

  return {
    available: false,
    executablePath: null,
    source: null,
    message: 'No supported Chrome/Chromium executable found. Install Google Chrome or run `npx playwright install chromium`.'
  };
}

function browserCandidates() {
  if (process.platform === 'darwin') {
    return [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    ];
  }

  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA || '';
    const programFiles = process.env.PROGRAMFILES || 'C:\\Program Files';
    const programFilesX86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';
    return [
      path.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(local, 'Chromium', 'Application', 'chrome.exe'),
      path.join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    ];
  }

  return [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
    '/opt/google/chrome/chrome',
  ];
}

function browserBins() {
  if (process.platform === 'win32') return [];
  return ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'msedge'];
}

function which(bin) {
  try {
    return execFileSync('which', [bin], { encoding: 'utf8' }).trim() || null;
  } catch {
    return null;
  }
}

function findPlaywrightCacheExecutable() {
  const cacheRoots = process.platform === 'darwin'
    ? [path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright')]
    : process.platform === 'win32'
      ? [path.join(process.env.LOCALAPPDATA || '', 'ms-playwright')]
      : [path.join(os.homedir(), '.cache', 'ms-playwright')];

  const suffix = process.platform === 'darwin'
    ? path.join('chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium')
    : process.platform === 'win32'
      ? path.join('chrome-win', 'chrome.exe')
      : path.join('chrome-linux', 'chrome');

  for (const root of cacheRoots) {
    if (!root || !fs.existsSync(root)) continue;
    for (const entry of fs.readdirSync(root)) {
      if (!entry.startsWith('chromium-')) continue;
      const candidate = path.join(root, entry, suffix);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return null;
}

function requirePlaywright() {
  try {
    return require('playwright-core');
  } catch (error) {
    const wrapped = new Error('playwright-core is not installed. Run `npm install` in the repo or reinstall pixelslop.');
    wrapped.cause = error;
    throw wrapped;
  }
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function resolveExistingDir(dirPath) {
  const resolved = path.resolve(dirPath);
  const stats = fs.statSync(resolved);
  if (!stats.isDirectory()) {
    throw new Error(`Expected a directory: ${resolved}`);
  }
  return fs.realpathSync(resolved);
}

function isWithinRoot(candidatePath, rootPath) {
  return candidatePath === rootPath || candidatePath.startsWith(`${rootPath}${path.sep}`);
}

function validateTargetUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid URL: ${rawUrl}`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Unsupported URL protocol: ${parsed.protocol}`);
  }

  const trimmedInput = String(rawUrl).trim();
  if (parsed.pathname === '/' && !parsed.search && !parsed.hash && !trimmedInput.endsWith('/')) {
    return `${parsed.protocol}//${parsed.host}`;
  }

  return parsed.toString();
}

function timestampStamp() {
  const now = new Date();
  const yyyy = String(now.getFullYear());
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const mi = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  return `${yyyy}${mm}${dd}-${hh}${mi}${ss}`;
}

function domainSlug(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, '').replace(/\./g, '-');
    return parsed.port ? `${host}-${parsed.port}` : host;
  } catch {
    return 'page';
  }
}

function screenshotPath(root, url, viewportName, stamp) {
  const shotsDir = path.join(root, '.pixelslop', 'screenshots');
  ensureDir(shotsDir);
  return path.join(shotsDir, `${domainSlug(url)}-${viewportName}-${stamp}.png`);
}

function defaultOutPath() {
  return path.join(os.tmpdir(), `pixelslop-evidence-${Date.now()}.json`);
}

function makeEmptyBundle(url, root) {
  return {
    url,
    title: null,
    timestamp: new Date().toISOString(),
    root: root || null,
    confidence: {
      screenshots: false,
      computedStyles: false,
      contrastRatios: false,
      a11ySnapshot: false,
      sourceGrepped: false,
      multiViewport: false,
      interactiveMap: false,
      scrollData: false,
      hoverStates: false,
      focusPass: false,
      interactivePromises: false
    },
    viewports: {
      desktop: {
        ...VIEWPORTS.desktop,
        screenshot: null,
        typography: null,
        colors: null,
        spacing: null,
        decorations: null,
        contrast: null,
        a11ySnapshot: null,
        overflow: null
      },
      tablet: {
        ...VIEWPORTS.tablet,
        screenshot: null,
        overflow: null
      },
      mobile: {
        ...VIEWPORTS.mobile,
        screenshot: null,
        overflow: null,
        touchTargets: null
      }
    },
    console: { errors: [], warnings: [] },
    network: { failed: [] },
    personaChecks: {},
    sourcePatterns: [],
    interactiveElements: null,
    scroll: null,
    hoverStates: null,
    focusPass: null,
    interactivePromises: null,
    meta: { mode: 'standard', collectionTimeMs: 0, passTimings: { scroll: 0, hover: 0, focus: 0, promises: 0 }, bailouts: [] }
  };
}

function validateBundleShape(bundle) {
  const required = ['url', 'timestamp', 'confidence', 'viewports', 'console', 'network', 'personaChecks', 'sourcePatterns'];
  for (const key of required) {
    if (!(key in bundle)) {
      throw new Error(`Evidence bundle missing required key: ${key}`);
    }
  }
  for (const viewportName of ['desktop', 'tablet', 'mobile']) {
    if (!bundle.viewports[viewportName]) {
      throw new Error(`Evidence bundle missing viewport: ${viewportName}`);
    }
  }
}

async function withTotalTimeout(run, timeoutMs) {
  const ms = timeoutMs || TOTAL_TIMEOUT_MS;
  return await Promise.race([
    run(),
    new Promise((_, reject) => setTimeout(() => reject(new Error(`Browser command timed out after ${ms}ms`)), ms))
  ]);
}

async function safeStep(bundle, flagKeys, fn, fallback = null) {
  try {
    const result = await fn();
    const skipConfidence = !!(result && typeof result === 'object' && result.__skipConfidence === true);
    if (!skipConfidence && Array.isArray(flagKeys)) {
      for (const key of flagKeys) bundle.confidence[key] = true;
    }
    return result;
  } catch {
    return fallback;
  }
}

function defaultCollectDeps() {
  return {
    detectBrowserRuntime,
    requirePlaywright,
    writeBundle,
    timestampStamp,
    withTotalTimeout,
    collectPersonaChecks,
    collectSourcePatterns,
  };
}

/**
 * Build collection config based on mode. Deep mode raises limits
 * but keeps hard safety rails -- no uncapped values.
 * @param {Object} args - CLI args, checked for args.deep
 * @returns {Object} Config with budget/cap values for the selected mode
 */
function buildConfig(args) {
  const isDeep = !!args?.deep;
  return {
    mode: isDeep ? 'deep' : 'standard',
    totalTimeout: isDeep ? 180000 : TOTAL_TIMEOUT_MS,
    scrollBudget: isDeep ? 16000 : SCROLL_PASS_BUDGET_MS,
    hoverBudget: isDeep ? 10000 : HOVER_PASS_BUDGET_MS,
    focusBudget: isDeep ? 6000 : FOCUS_PASS_BUDGET_MS,
    promiseBudget: isDeep ? 24000 : PROMISE_PASS_BUDGET_MS,
    maxRefs: isDeep ? 500 : 150,
    maxHover: isDeep ? 75 : 15,
    maxTabs: isDeep ? 100 : 30,
    maxPromises: isDeep ? 25 : 8,
    maxFolds: isDeep ? 20 : 10,
    maxLazyImages: isDeep ? 50 : 999,
    maxStickyElements: isDeep ? 50 : 20,
  };
}

async function collectEvidence(args, deps = {}) {
  const runtimeDeps = { ...defaultCollectDeps(), ...deps };
  const root = resolveExistingDir(path.resolve(args.cwd || process.cwd(), args.root || '.'));
  const outPath = args.out ? path.resolve(args.cwd || process.cwd(), args.out) : defaultOutPath();
  if (!args.url) throw new Error('--url is required');
  const requestedUrl = String(args.url).trim();
  const navigationUrl = validateTargetUrl(requestedUrl);

  ensureDir(path.dirname(outPath));
  const bundle = makeEmptyBundle(requestedUrl, args.root ? root : null);
  const config = buildConfig(args);
  bundle.meta.mode = config.mode;
  const runtime = runtimeDeps.detectBrowserRuntime();
  const stamp = runtimeDeps.timestampStamp();

  if (!runtime.available) {
    bundle.navigationError = runtime.message;
    runtimeDeps.writeBundle(outPath, bundle);
    return { ok: false, outputPath: outPath, runtime, collected: bundle.confidence };
  }

  const { chromium } = runtimeDeps.requirePlaywright();
  return await runtimeDeps.withTotalTimeout(async () => {
    const browser = await chromium.launch({
      headless: !args.headed,
      executablePath: runtime.executablePath
    });
    const context = await browser.newContext({ viewport: VIEWPORTS.desktop });
    const page = await context.newPage();
    const consoleErrors = [];
    const consoleWarnings = [];
    const failedRequests = [];

    page.on('console', msg => {
      const payload = { type: msg.type(), text: msg.text(), url: msg.location()?.url || '' };
      if (msg.type() === 'error') consoleErrors.push(payload);
      else if (msg.type() === 'warning') consoleWarnings.push(payload);
    });

    page.on('requestfailed', request => {
      failedRequests.push({
        url: request.url(),
        status: 0,
        type: request.resourceType()
      });
    });

    page.on('response', response => {
      if (response.status() >= 400) {
        failedRequests.push({
          url: response.url(),
          status: response.status(),
          type: response.request().resourceType()
        });
      }
    });

    // Timer covers the full collection run — navigation, desktop, interaction passes,
    // tablet, mobile, personas, source patterns. Everything.
    const collectionStart = Date.now();

    try {
      await page.goto(navigationUrl, { waitUntil: 'domcontentloaded', timeout: NAVIGATION_TIMEOUT_MS });
      try {
        await page.waitForLoadState('networkidle', { timeout: 3000 });
      } catch {
        // Network idle is a bonus, not a hard requirement.
      }
      bundle.title = await safeStep(bundle, [], () => page.title(), null);

      await collectDesktop(bundle, page, root, requestedUrl, stamp);

      // Build the interactive element ref map while we're still on desktop viewport.
      // Note: rect values are relative to scroll position 0, desktop viewport.
      // Subsequent passes that scroll/resize must not rely on these rects for pixel-accurate
      // targeting — they're used for sort priority (above-fold first) and area comparisons.
      bundle.interactiveElements = await safeStep(bundle, ['interactiveMap'], () => page.evaluate(snippetBuildRefMap, config.maxRefs), null);

      // Scroll pass — per-fold screenshots, sticky elements, lazy images
      const scrollPassResult = await safeStep(bundle, ['scrollData'], async () => {
        const passResult = await withPassBudget(config.scrollBudget, async (isBudgetExhausted) => {
          await collectScrollPass(bundle, page, root, requestedUrl, stamp, isBudgetExhausted, config);
          return true;
        });
        bundle.meta.passTimings.scroll = passResult.elapsedMs || 0;
        if (passResult.timedOut) {
          bundle.meta.bailouts.push({ pass: 'scroll', reason: 'timeout', elapsedMs: passResult.elapsedMs });
          bundle.confidence.scrollData = false;
        }
        return { __skipConfidence: passResult.timedOut };
      }, null);
      // Container selector discovered by scroll pass (SPA apps scroll inside a child element)
      const cs = bundle.scroll?.containerSelector || null;
      await resetBetweenPasses(page, cs);

      // Hover pass — desktop only, captures style diffs on interactive elements
      const hoverPassResult = await safeStep(bundle, ['hoverStates'], async () => {
        const passResult = await withPassBudget(config.hoverBudget, async (isBudgetExhausted) => {
          await collectHoverPass(bundle, page, isBudgetExhausted, config);
          return true;
        });
        bundle.meta.passTimings.hover = passResult.elapsedMs || 0;
        if (passResult.timedOut) {
          bundle.meta.bailouts.push({ pass: 'hover', reason: 'timeout', elapsedMs: passResult.elapsedMs });
          bundle.confidence.hoverStates = false;
        }
        return { __skipConfidence: passResult.timedOut };
      }, null);
      await resetBetweenPasses(page, cs);

      // Focus pass — tabs through focusable elements, checks indicators
      const focusPassResult = await safeStep(bundle, ['focusPass'], async () => {
        const passResult = await withPassBudget(config.focusBudget, async (isBudgetExhausted) => {
          await collectFocusPass(bundle, page, isBudgetExhausted, config);
          return true;
        });
        bundle.meta.passTimings.focus = passResult.elapsedMs || 0;
        if (passResult.timedOut) {
          bundle.meta.bailouts.push({ pass: 'focus', reason: 'timeout', elapsedMs: passResult.elapsedMs });
          bundle.confidence.focusPass = false;
        }
        return { __skipConfidence: passResult.timedOut };
      }, null);
      await resetBetweenPasses(page, cs);

      // Promise verification — mobile menu, anchor links, tabs/accordion
      const promisePassResult = await safeStep(bundle, ['interactivePromises'], async () => {
        const passResult = await withPassBudget(config.promiseBudget, async (isBudgetExhausted) => {
          await collectPromiseVerification(bundle, page, context, isBudgetExhausted, config);
          return true;
        });
        bundle.meta.passTimings.promises = passResult.elapsedMs || 0;
        if (passResult.timedOut) {
          bundle.meta.bailouts.push({ pass: 'promises', reason: 'timeout', elapsedMs: passResult.elapsedMs });
          bundle.confidence.interactivePromises = false;
        }
        return { __skipConfidence: passResult.timedOut };
      }, null);
      await resetBetweenPasses(page, cs);

      await collectTablet(bundle, page, root, requestedUrl, stamp);
      await collectMobile(bundle, page, root, requestedUrl, stamp);
      if ((args.personas || 'all') !== 'none') {
        bundle.personaChecks = await runtimeDeps.collectPersonaChecks(page);
      }
      if (args.root) {
        bundle.sourcePatterns = runtimeDeps.collectSourcePatterns(root);
        bundle.confidence.sourceGrepped = bundle.sourcePatterns.length >= 0;
      }
    } catch (error) {
      bundle.navigationError = error.message;
    } finally {
      bundle.meta.collectionTimeMs = Date.now() - collectionStart;
      bundle.console = { errors: dedupeByJson(consoleErrors), warnings: dedupeByJson(consoleWarnings) };
      bundle.network = { failed: dedupeByJson(failedRequests) };
      validateBundleShape(bundle);
      runtimeDeps.writeBundle(outPath, bundle);
      await context.close();
      await browser.close();
    }

    return {
      ok: !bundle.navigationError,
      outputPath: outPath,
      runtime,
      timing: { totalTimeoutMs: config.totalTimeout },
      collected: bundle.confidence
    };
  }, config.totalTimeout);
}

async function collectDesktop(bundle, page, root, url, stamp) {
  await page.setViewportSize(VIEWPORTS.desktop);
  const shot = screenshotPath(root, url, 'desktop', stamp);
  bundle.viewports.desktop.screenshot = await safeStep(bundle, ['screenshots'], async () => {
    await page.screenshot({ path: shot, timeout: SCREENSHOT_TIMEOUT_MS, fullPage: false });
    return shot;
  }, null);

  bundle.viewports.desktop.typography = await safeStep(bundle, ['computedStyles'], () => page.evaluate(snippetTypography), null);
  bundle.viewports.desktop.colors = await safeStep(bundle, ['computedStyles'], () => page.evaluate(snippetColors), null);
  bundle.viewports.desktop.spacing = await safeStep(bundle, ['computedStyles'], () => page.evaluate(snippetSpacing), null);
  bundle.viewports.desktop.decorations = await safeStep(bundle, ['computedStyles'], () => page.evaluate(snippetDecorations), null);
  bundle.viewports.desktop.contrast = await safeStep(bundle, ['contrastRatios'], () => page.evaluate(snippetContrast), null);
  bundle.viewports.desktop.a11ySnapshot = await safeStep(bundle, ['a11ySnapshot'], () => page.evaluate(snippetA11ySummary), null);
  bundle.viewports.desktop.overflow = await safeStep(bundle, ['multiViewport'], () => page.evaluate(snippetOverflow), null);
}

async function collectTablet(bundle, page, root, url, stamp) {
  await page.setViewportSize(VIEWPORTS.tablet);
  const shot = screenshotPath(root, url, 'tablet', stamp);
  bundle.viewports.tablet.screenshot = await safeStep(bundle, ['screenshots'], async () => {
    await page.screenshot({ path: shot, timeout: SCREENSHOT_TIMEOUT_MS, fullPage: false });
    return shot;
  }, null);
  bundle.viewports.tablet.overflow = await safeStep(bundle, ['multiViewport'], () => page.evaluate(snippetOverflow), null);
}

async function collectMobile(bundle, page, root, url, stamp) {
  await page.setViewportSize(VIEWPORTS.mobile);
  const shot = screenshotPath(root, url, 'mobile', stamp);
  bundle.viewports.mobile.screenshot = await safeStep(bundle, ['screenshots'], async () => {
    await page.screenshot({ path: shot, timeout: SCREENSHOT_TIMEOUT_MS, fullPage: false });
    return shot;
  }, null);
  bundle.viewports.mobile.overflow = await safeStep(bundle, ['multiViewport'], () => page.evaluate(snippetOverflow), null);
  bundle.viewports.mobile.touchTargets = await safeStep(bundle, ['computedStyles'], () => page.evaluate(snippetTouchTargets), null);
}

async function collectPersonaChecks(page) {
  const result = {};
  result.headingHierarchy = await page.evaluate(snippetHeadingHierarchy);
  result.landmarks = await page.evaluate(snippetLandmarks);
  result.skipNav = await page.evaluate(snippetSkipNav);
  result.aboveFoldCta = await page.evaluate(snippetAboveFoldCta);
  result.readingLevel = await page.evaluate(snippetReadingLevel);
  result.imageOptimization = await page.evaluate(snippetImageOptimization);
  result.cognitiveDensity = await page.evaluate(snippetCognitiveDensity);
  return result;
}

function collectSourcePatterns(root) {
  const files = walkSearchableFiles(root);
  const results = [];

  for (const pattern of SOURCE_PATTERNS) {
    let matches = 0;
    const matchedFiles = [];
    let evidence = null;

    for (const file of files) {
      const content = fs.readFileSync(file, 'utf8');
      const lines = content.split('\n');
      pattern.regex.lastIndex = 0;
      let fileMatched = false;

      for (let index = 0; index < lines.length; index++) {
        pattern.regex.lastIndex = 0;
        if (pattern.regex.test(lines[index])) {
          matches++;
          fileMatched = true;
          matchedFiles.push(`${path.relative(root, file)}:${index + 1}`);
          evidence = evidence || lines[index].trim().slice(0, 120);
          if (matchedFiles.length >= 10) break;
        }
      }

      if (fileMatched && matchedFiles.length >= 10) break;
    }

    if (matches > 0) {
      results.push({
        id: pattern.id,
        name: pattern.name,
        matches,
        files: matchedFiles,
        evidence
      });
    }
  }

  return results;
}

function walkSearchableFiles(root) {
  const rootReal = resolveExistingDir(root);
  const allowed = new Set(['.html', '.htm', '.jsx', '.tsx', '.js', '.ts', '.css', '.scss', '.mdx']);
  const ignoredDirs = new Set(['.git', 'node_modules', '.next', 'dist', 'build', '.pixelslop']);
  const result = [];

  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('._')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (!ignoredDirs.has(entry.name)) walk(full);
        continue;
      }
      const real = fs.realpathSync(full);
      if (!isWithinRoot(real, rootReal)) continue;
      if (allowed.has(path.extname(entry.name)) && fs.statSync(real).size < 1024 * 1024) {
        result.push(full);
      }
    }
  }

  walk(rootReal);
  return result;
}

function writeBundle(outPath, bundle) {
  fs.writeFileSync(outPath, JSON.stringify(bundle, null, 2) + '\n');
}

function dedupeByJson(items) {
  const seen = new Set();
  const deduped = [];
  for (const item of items) {
    const key = JSON.stringify(item);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }
  return deduped;
}

async function browserStyles(args) {
  const { page, browser, context, runtime } = await openPage(args);
  try {
    const selector = args.selector;
    if (!selector) throw new Error('--selector is required');
    const data = await page.evaluate(snippetStylesForSelector, selector);
    return { ok: true, runtime, selector, ...data };
  } finally {
    await context.close();
    await browser.close();
  }
}

async function browserSnapshot(args) {
  const { page, browser, context, runtime } = await openPage(args);
  try {
    const snapshot = await page.evaluate(snippetA11ySummary);
    return { ok: true, runtime, snapshot };
  } finally {
    await context.close();
    await browser.close();
  }
}

async function browserScreenshot(args) {
  const root = path.resolve(args.cwd || process.cwd(), args.root || '.');
  const outPath = args.out ? path.resolve(args.cwd || process.cwd(), args.out) : screenshotPath(root, args.url, normalizeViewportName(args.viewport), timestampStamp());
  ensureDir(path.dirname(outPath));
  const { page, browser, context, runtime } = await openPage(args);
  try {
    await applyViewport(page, args.viewport);
    await page.screenshot({ path: outPath, timeout: SCREENSHOT_TIMEOUT_MS, fullPage: !!args.fullPage });
    return { ok: true, runtime, outputPath: outPath };
  } finally {
    await context.close();
    await browser.close();
  }
}

async function browserCheck(args) {
  const metric = args.metric;
  if (!metric) throw new Error('--metric is required');
  const { page, browser, context, runtime } = await openPage(args);
  try {
    let result;
    switch (metric) {
      case 'contrast':
        if (!args.selector) throw new Error('--selector is required for contrast checks');
        await applyViewport(page, args.viewport || 'desktop');
        result = await page.evaluate(snippetContrastForSelector, args.selector);
        break;
      case 'touch-targets':
        await applyViewport(page, args.viewport || 'mobile');
        result = args.selector
          ? await page.evaluate(snippetTouchTargetForSelector, args.selector)
          : await page.evaluate(snippetTouchTargets);
        break;
      case 'overflow':
        await applyViewport(page, args.viewport || 'mobile');
        result = await page.evaluate(snippetOverflow);
        break;
      case 'heading-hierarchy':
        result = await page.evaluate(snippetHeadingHierarchy);
        break;
      case 'landmarks':
        result = await page.evaluate(snippetLandmarks);
        break;
      case 'typography':
        if (!args.selector) throw new Error('--selector is required for typography checks');
        await applyViewport(page, args.viewport || 'desktop');
        result = await page.evaluate(snippetTypographyForSelector, args.selector);
        break;
      case 'spacing':
        if (!args.selector) throw new Error('--selector is required for spacing checks');
        await applyViewport(page, args.viewport || 'desktop');
        result = await page.evaluate(snippetSpacingForSelector, args.selector);
        break;
      default:
        throw new Error(`Unsupported metric: ${metric}`);
    }

    return { ok: true, runtime, metric, result };
  } finally {
    await context.close();
    await browser.close();
  }
}

async function openPage(args) {
  if (!args.url) throw new Error('--url is required');
  const url = validateTargetUrl(args.url);
  const runtime = detectBrowserRuntime();
  if (!runtime.available) throw new Error(runtime.message);
  const { chromium } = requirePlaywright();
  const browser = await chromium.launch({ headless: !args.headed, executablePath: runtime.executablePath });
  const context = await browser.newContext({ viewport: VIEWPORTS.desktop });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAVIGATION_TIMEOUT_MS });
  return { browser, context, page, runtime, url };
}

async function applyViewport(page, viewportArg) {
  const viewport = parseViewport(viewportArg);
  await page.setViewportSize(viewport);
}

function normalizeViewportName(viewportArg) {
  if (!viewportArg) return 'desktop';
  if (VIEWPORTS[viewportArg]) return viewportArg;
  return String(viewportArg).replace(/[^a-z0-9]+/gi, '-').toLowerCase();
}

function parseViewport(viewportArg) {
  if (!viewportArg || viewportArg === 'desktop') return VIEWPORTS.desktop;
  if (viewportArg === 'tablet') return VIEWPORTS.tablet;
  if (viewportArg === 'mobile') return VIEWPORTS.mobile;
  const match = String(viewportArg).match(/^(\d+)x(\d+)$/);
  if (!match) throw new Error(`Invalid viewport: ${viewportArg}`);
  return { width: Number(match[1]), height: Number(match[2]) };
}

async function runBrowserCommand(command, args) {
  switch (command) {
    case 'collect':
      return await collectEvidence(args);
    case 'check':
      return await browserCheck(args);
    case 'styles':
      return await browserStyles(args);
    case 'snapshot':
      return await browserSnapshot(args);
    case 'screenshot':
      return await browserScreenshot(args);
    case 'detect':
      return detectBrowserRuntime();
    default:
      throw new Error(`Unknown browser command: ${command}`);
  }
}

function snippetTypography() {
  const selectors = ['h1','h2','h3','h4','h5','h6','p','button','a','li','label','input','th','td'];
  const results = {};
  selectors.forEach(sel => {
    const el = document.querySelector(sel);
    if (!el) return;
    const s = getComputedStyle(el);
    results[sel] = {
      fontFamily: s.fontFamily,
      fontSize: s.fontSize,
      fontWeight: s.fontWeight,
      lineHeight: s.lineHeight,
      letterSpacing: s.letterSpacing,
      color: s.color
    };
  });
  return results;
}

function snippetColors() {
  const samples = [];
  const key = document.querySelectorAll('body, main, header, footer, nav, section, article, aside, [class*="card"], [class*="hero"], [class*="banner"], button, a');
  key.forEach(el => {
    const s = getComputedStyle(el);
    samples.push({
      tag: el.tagName.toLowerCase(),
      classes: el.className?.toString().slice(0, 80) || '',
      bg: s.backgroundColor,
      color: s.color,
      borderColor: s.borderColor,
      backgroundImage: s.backgroundImage !== 'none' ? s.backgroundImage.slice(0, 200) : null
    });
  });
  return samples.slice(0, 50);
}

function snippetSpacing() {
  const containers = document.querySelectorAll('main, section, article, [class*="container"], [class*="wrapper"], [class*="content"]');
  return Array.from(containers).slice(0, 20).map(el => {
    const s = getComputedStyle(el);
    return {
      tag: el.tagName.toLowerCase(),
      classes: el.className?.toString().slice(0, 60) || '',
      padding: s.padding,
      margin: s.margin,
      gap: s.gap,
      maxWidth: s.maxWidth
    };
  });
}

function snippetDecorations() {
  const all = document.querySelectorAll('*');
  const decorations = { shadows: 0, blurs: 0, roundedElements: 0, gradientTexts: 0 };
  const details = [];
  all.forEach(el => {
    const s = getComputedStyle(el);
    if (s.boxShadow && s.boxShadow !== 'none') decorations.shadows++;
    if (s.backdropFilter && s.backdropFilter !== 'none') {
      decorations.blurs++;
      details.push({ type: 'blur', tag: el.tagName, classes: el.className?.toString().slice(0, 40) });
    }
    const br = parseFloat(s.borderRadius);
    if (br > 12) decorations.roundedElements++;
    if (s.backgroundClip === 'text' || s.webkitBackgroundClip === 'text') {
      decorations.gradientTexts++;
      details.push({ type: 'gradientText', tag: el.tagName, text: el.textContent?.slice(0, 40) });
    }
  });
  return { counts: decorations, details: details.slice(0, 20) };
}

function snippetContrast() {
  function luminance(r, g, b) {
    const [rs, gs, bs] = [r, g, b].map(c => {
      c = c / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
  }

  function parseColor(color) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return { r, g, b };
  }

  function contrastRatio(c1, c2) {
    const l1 = luminance(c1.r, c1.g, c1.b);
    const l2 = luminance(c2.r, c2.g, c2.b);
    const lighter = Math.max(l1, l2);
    const darker = Math.min(l1, l2);
    return (lighter + 0.05) / (darker + 0.05);
  }

  function getEffectiveBg(el) {
    let current = el;
    while (current) {
      const bg = getComputedStyle(current).backgroundColor;
      if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') return bg;
      current = current.parentElement;
    }
    return 'rgb(255, 255, 255)';
  }

  const results = [];
  const textElements = document.querySelectorAll('h1,h2,h3,h4,h5,h6,p,a,button,label,li,span,td,th');
  const checked = new Set();

  textElements.forEach(el => {
    if (checked.size >= 30) return;
    const text = el.textContent?.trim();
    if (!text || text.length < 2) return;

    const key = el.tagName + ':' + text.slice(0, 20);
    if (checked.has(key)) return;
    checked.add(key);

    const s = getComputedStyle(el);
    const fg = s.color;
    const bg = getEffectiveBg(el);
    const fgParsed = parseColor(fg);
    const bgParsed = parseColor(bg);
    if (!fgParsed || !bgParsed) return;
    const ratio = contrastRatio(fgParsed, bgParsed);
    const fontSize = parseFloat(s.fontSize);
    const fontWeight = parseInt(s.fontWeight);
    const isLarge = fontSize >= 24 || (fontSize >= 18.66 && fontWeight >= 700);
    const wcagAA = isLarge ? ratio >= 3 : ratio >= 4.5;

    results.push({
      tag: el.tagName.toLowerCase(),
      text: text.slice(0, 30),
      fg, bg,
      ratio: Math.round(ratio * 100) / 100,
      fontSize,
      isLarge,
      passesAA: wcagAA
    });
  });

  return results;
}

function snippetTouchTargets() {
  const interactive = document.querySelectorAll('a, button, input, select, textarea, [role="button"], [onclick]');
  const issues = [];
  interactive.forEach(el => {
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      if (rect.width < 44 || rect.height < 44) {
        issues.push({
          tag: el.tagName.toLowerCase(),
          text: el.textContent?.trim().slice(0, 30) || el.getAttribute('aria-label') || '',
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        });
      }
    }
  });
  return { totalInteractive: interactive.length, undersized: issues.length, issues: issues.slice(0, 20) };
}

function snippetOverflow() {
  const docWidth = document.documentElement.clientWidth;
  const overflow = [];
  document.querySelectorAll('*').forEach(el => {
    const rect = el.getBoundingClientRect();
    if (rect.right > docWidth + 5 || rect.left < -5) {
      overflow.push({
        tag: el.tagName.toLowerCase(),
        classes: el.className?.toString().slice(0, 40) || '',
        right: Math.round(rect.right),
        docWidth
      });
    }
  });
  return { hasOverflow: overflow.length > 0, count: overflow.length, elements: overflow.slice(0, 10) };
}

function snippetA11ySummary() {
  const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6')).map(h => ({
    level: Number(h.tagName[1]),
    text: h.textContent.trim().slice(0, 80),
    tag: h.tagName.toLowerCase()
  }));
  const landmarks = [];
  if (document.querySelector('header, [role="banner"]')) landmarks.push('banner');
  if (document.querySelector('nav, [role="navigation"]')) landmarks.push('navigation');
  if (document.querySelector('main, [role="main"]')) landmarks.push('main');
  if (document.querySelector('footer, [role="contentinfo"]')) landmarks.push('contentinfo');
  const images = Array.from(document.querySelectorAll('img')).slice(0, 20).map(img => ({
    src: (img.getAttribute('src') || '').slice(0, 120),
    alt: img.getAttribute('alt'),
    hasAlt: img.hasAttribute('alt')
  }));
  const forms = Array.from(document.querySelectorAll('form')).slice(0, 10).map(form => {
    const inputs = Array.from(form.querySelectorAll('input, select, textarea'));
    const missingLabels = [];
    let labels = 0;
    inputs.forEach(input => {
      const id = input.getAttribute('id');
      const labeled = !!form.querySelector(`label[for="${id}"]`) || !!input.closest('label') || !!input.getAttribute('aria-label');
      if (labeled) labels += 1;
      else missingLabels.push(id || input.getAttribute('name') || input.tagName.toLowerCase());
    });
    return { inputs: inputs.length, labels, missingLabels };
  });
  const ariaRoles = Array.from(document.querySelectorAll('[role]')).slice(0, 30).map(el => el.getAttribute('role'));
  return {
    headings,
    landmarks,
    images,
    forms,
    ariaRoles,
    skipLink: !!document.querySelector('a[href^="#main"], a[href^="#content"]'),
    langAttribute: document.documentElement.getAttribute('lang')
  };
}

function snippetHeadingHierarchy() {
  const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6'));
  const levels = headings.map(h => parseInt(h.tagName[1]));
  const issues = [];
  let prevLevel = 0;
  for (let i = 0; i < levels.length; i++) {
    if (levels[i] > prevLevel + 1 && prevLevel > 0) {
      issues.push({
        expected: `h${prevLevel + 1}`,
        found: `h${levels[i]}`,
        text: headings[i].textContent.trim().slice(0, 40),
        index: i
      });
    }
    prevLevel = levels[i];
  }
  const h1Count = levels.filter(l => l === 1).length;
  return {
    check: 'heading-hierarchy-sequential',
    totalHeadings: headings.length,
    h1Count,
    skips: issues,
    passed: issues.length === 0 && h1Count === 1
  };
}

function snippetLandmarks() {
  const landmarks = {
    main: !!document.querySelector('main, [role="main"]'),
    nav: !!document.querySelector('nav, [role="navigation"]'),
    header: !!document.querySelector('header, [role="banner"]'),
    footer: !!document.querySelector('footer, [role="contentinfo"]')
  };
  const present = Object.values(landmarks).filter(Boolean).length;
  return {
    check: 'landmark-regions-present',
    landmarks,
    present,
    total: 4,
    passed: present >= 3
  };
}

function snippetSkipNav() {
  const focusable = document.querySelectorAll('a, button, input, [tabindex]');
  const first5 = Array.from(focusable).slice(0, 5);
  const skipLink = first5.find(el => {
    const text = (el.textContent || el.getAttribute('aria-label') || '').toLowerCase();
    const href = el.getAttribute('href') || '';
    return (text.includes('skip') && (text.includes('nav') || text.includes('content') || text.includes('main')))
      || href.startsWith('#main') || href.startsWith('#content');
  });
  return {
    check: 'skip-navigation-link',
    found: !!skipLink,
    text: skipLink ? skipLink.textContent.trim().slice(0, 40) : null,
    passed: !!skipLink
  };
}

function snippetAboveFoldCta() {
  const viewportHeight = window.innerHeight;
  const ctas = document.querySelectorAll('a[class*="btn"], a[class*="button"], a[class*="cta"], button[class*="btn"], button[class*="cta"], [role="button"]');
  const aboveFold = [];
  const belowFold = [];
  ctas.forEach(el => {
    const rect = el.getBoundingClientRect();
    if (rect.height === 0 || rect.width === 0) return;
    const entry = { tag: el.tagName.toLowerCase(), text: el.textContent.trim().slice(0, 30), top: Math.round(rect.top) };
    if (rect.top < viewportHeight) {
      aboveFold.push(entry);
    } else {
      belowFold.push(entry);
    }
  });
  return {
    check: 'above-fold-cta',
    aboveFold: aboveFold.length,
    belowFold: belowFold.length,
    viewportHeight,
    passed: aboveFold.length > 0,
    details: { aboveFold: aboveFold.slice(0, 5), belowFold: belowFold.slice(0, 3) }
  };
}

function snippetReadingLevel() {
  const textElements = document.querySelectorAll('h1, h2, h3, h4, p, li, label, figcaption');
  let totalWords = 0, totalSentences = 0, totalSyllables = 0;
  const sampleText = [];
  textElements.forEach(el => {
    const text = el.textContent.trim();
    if (text.length < 10) return;
    sampleText.push(text.slice(0, 100));
    const words = text.split(/\s+/).filter(w => w.length > 0);
    totalWords += words.length;
    totalSentences += (text.match(/[.!?]+/g) || []).length || 1;
    words.forEach(word => {
      const clean = word.replace(/[^a-zA-Z]/g, '').toLowerCase();
      if (clean.length <= 3) { totalSyllables += 1; return; }
      const vowelGroups = clean.match(/[aeiouy]+/gi) || [];
      let count = vowelGroups.length;
      if (clean.endsWith('e') && count > 1) count--;
      totalSyllables += Math.max(1, count);
    });
  });
  if (totalWords < 10 || totalSentences < 1) {
    return { check: 'reading-level-estimate', gradeLevel: null, insufficient: true, totalWords };
  }
  const gradeLevel = 0.39 * (totalWords / totalSentences) + 11.8 * (totalSyllables / totalWords) - 15.59;
  return {
    check: 'reading-level-estimate',
    gradeLevel: Math.round(gradeLevel * 10) / 10,
    totalWords,
    totalSentences,
    avgWordsPerSentence: Math.round(totalWords / totalSentences * 10) / 10,
    passed: gradeLevel <= 10,
    sample: sampleText.slice(0, 3)
  };
}

function snippetImageOptimization() {
  const images = document.querySelectorAll('img');
  const issues = [];
  images.forEach(img => {
    const natural = { w: img.naturalWidth, h: img.naturalHeight };
    const displayed = { w: img.clientWidth, h: img.clientHeight };
    const hasSrcset = !!img.srcset;
    const ratio = (natural.w > 0 && displayed.w > 0) ? natural.w / displayed.w : 1;
    if (ratio > 2.5 && natural.w > 200) {
      issues.push({
        src: (img.src || '').slice(-60),
        natural: `${natural.w}x${natural.h}`,
        displayed: `${displayed.w}x${displayed.h}`,
        ratio: Math.round(ratio * 10) / 10,
        hasSrcset
      });
    }
  });
  return {
    check: 'image-optimization-check',
    totalImages: images.length,
    oversized: issues.length,
    issues: issues.slice(0, 5),
    passed: issues.length === 0
  };
}

function snippetCognitiveDensity() {
  const viewportHeight = window.innerHeight;
  const ctaCount = document.querySelectorAll('a[class*="btn"], a[class*="button"], button:not([type="reset"]):not([type="button"])').length;
  const navItems = document.querySelectorAll('nav a, nav button, [role="navigation"] a').length;
  const textBlocks = Array.from(document.querySelectorAll('p, [class*="description"]')).filter(el => {
    const rect = el.getBoundingClientRect();
    return rect.top < viewportHeight && el.textContent.trim().split(/\s+/).length > 20;
  }).length;
  const sections = document.querySelectorAll('main section, main > div > div').length;
  return {
    check: 'cognitive-density-scan',
    ctaCount,
    navItems,
    denseTextBlocks: textBlocks,
    visibleSections: sections,
    passed: ctaCount <= 3 && navItems <= 8 && textBlocks <= 2
  };
}

function snippetStylesForSelector(selector) {
  const elements = Array.from(document.querySelectorAll(selector));
  const first = elements[0];
  if (!first) return { matchCount: 0, element: null };
  const s = getComputedStyle(first);
  const rect = first.getBoundingClientRect();
  return {
    matchCount: elements.length,
    element: {
      tag: first.tagName.toLowerCase(),
      id: first.id || null,
      className: first.className?.toString() || '',
      text: first.textContent?.trim().slice(0, 120) || '',
      style: first.getAttribute('style') || null,
      computed: {
        color: s.color,
        backgroundColor: s.backgroundColor,
        borderColor: s.borderColor,
        fontFamily: s.fontFamily,
        fontSize: s.fontSize,
        fontWeight: s.fontWeight,
        lineHeight: s.lineHeight,
        padding: s.padding,
        margin: s.margin,
        gap: s.gap,
      },
      rect: {
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        top: Math.round(rect.top),
        left: Math.round(rect.left),
      }
    }
  };
}

function snippetContrastForSelector(selector) {
  const el = document.querySelector(selector);
  if (!el) return { found: false };

  function luminance(r, g, b) {
    const [rs, gs, bs] = [r, g, b].map(c => {
      c = c / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
  }

  function contrastRatio(c1, c2) {
    const l1 = luminance(c1.r, c1.g, c1.b);
    const l2 = luminance(c2.r, c2.g, c2.b);
    const lighter = Math.max(l1, l2);
    const darker = Math.min(l1, l2);
    return (lighter + 0.05) / (darker + 0.05);
  }

  function parseRgb(color) {
    const match = String(color).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (!match) return null;
    return { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]) };
  }

  function resolveBackground(node) {
    let current = node;
    while (current && current !== document.documentElement) {
      const bg = getComputedStyle(current).backgroundColor;
      if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
        return bg;
      }
      current = current.parentElement;
    }
    return getComputedStyle(document.body).backgroundColor || 'rgb(255, 255, 255)';
  }

  const styles = getComputedStyle(el);
  const fg = styles.color;
  const bg = resolveBackground(el);
  const fgRgb = parseRgb(fg);
  const bgRgb = parseRgb(bg);
  const ratio = fgRgb && bgRgb ? Number(contrastRatio(fgRgb, bgRgb).toFixed(2)) : null;
  const fontSize = parseFloat(styles.fontSize) || 0;
  const fontWeight = parseInt(styles.fontWeight, 10) || 400;
  const largeText = fontSize >= 24 || (fontSize >= 18.66 && fontWeight >= 700);
  const threshold = largeText ? 3 : 4.5;

  return {
    found: true,
    selector,
    fg,
    bg,
    ratio,
    largeText,
    passesAA: ratio === null ? null : ratio >= threshold,
    text: el.textContent?.trim().slice(0, 30) || ''
  };
}

function snippetTouchTargetForSelector(selector) {
  const el = document.querySelector(selector);
  if (!el) return { found: false };
  const rect = el.getBoundingClientRect();
  return {
    found: true,
    selector,
    width: Math.round(rect.width),
    height: Math.round(rect.height),
    passes: rect.width >= 44 && rect.height >= 44,
    tag: el.tagName.toLowerCase(),
    text: el.textContent?.trim().slice(0, 40) || el.getAttribute('aria-label') || ''
  };
}

function snippetTypographyForSelector(selector) {
  const el = document.querySelector(selector);
  if (!el) return { found: false };
  const s = getComputedStyle(el);
  return {
    found: true,
    selector,
    fontFamily: s.fontFamily,
    fontSize: s.fontSize,
    fontWeight: s.fontWeight,
    lineHeight: s.lineHeight,
    letterSpacing: s.letterSpacing,
    color: s.color
  };
}

function snippetSpacingForSelector(selector) {
  const el = document.querySelector(selector);
  if (!el) return { found: false };
  const s = getComputedStyle(el);
  return {
    found: true,
    selector,
    padding: s.padding,
    margin: s.margin,
    gap: s.gap,
    maxWidth: s.maxWidth
  };
}

// ── Interaction Substrate ──
// Foundation for all interaction-based evidence collection.
// snippetBuildRefMap and snippetResolveRef run inside page.evaluate().
// Action helpers and capture functions run in Node, wrapping Playwright calls.

/**
 * Enumerates interactive + content elements on the page, assigns stable refs.
 * Runs inside page.evaluate() — no Node APIs available.
 * @returns {Array} Array of ref objects with selectors, rects, categories, ARIA state
 */
function snippetBuildRefMap(maxRefsArg) {
  const INTERACTIVE_SELECTORS = 'button, a[href], input, select, textarea, [role="button"], [role="tab"], [role="link"], [role="menuitem"]';
  const LANDMARK_SELECTORS = 'nav, main, header, footer, [role="dialog"], [role="tabpanel"], [role="tablist"]';

  const refs = [];
  const seen = new Set();
  let refIndex = 0;
  const MAX_REFS = maxRefsArg || 150;

  // Build a reasonably unique CSS selector for re-finding this element later.
  // Falls back to nth-of-type when the simple selector isn't globally unique.
  function buildSelector(el) {
    if (el.id) return '#' + CSS.escape(el.id);
    const tag = el.tagName.toLowerCase();
    const classes = Array.from(el.classList).slice(0, 3).map(c => '.' + CSS.escape(c)).join('');
    const candidate = tag + classes;

    // Check global uniqueness — if this selector matches multiple elements, disambiguate
    if (document.querySelectorAll(candidate).length <= 1) return candidate;

    // Try with nth-of-type among siblings
    const parent = el.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(s => s.tagName === el.tagName);
      if (siblings.length > 1) {
        const idx = siblings.indexOf(el);
        const withNth = candidate + ':nth-of-type(' + (idx + 1) + ')';
        if (document.querySelectorAll(withNth).length <= 1) return withNth;
      }
      // Still not unique — prepend parent context
      const parentTag = parent.tagName.toLowerCase();
      const parentId = parent.id ? '#' + CSS.escape(parent.id) : parentTag;
      const siblings2 = Array.from(parent.children).filter(s => s.tagName === el.tagName);
      const idx2 = siblings2.indexOf(el);
      return parentId + ' > ' + candidate + ':nth-of-type(' + (idx2 + 1) + ')';
    }

    return candidate;
  }

  function addRef(el, category, nonSemanticReason) {
    if (refIndex >= MAX_REFS) return;
    if (seen.has(el)) return;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return;
    seen.add(el);
    refs.push({
      ref: 'r' + refIndex++,
      tag: el.tagName.toLowerCase(),
      text: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 80),
      classes: el.className ? String(el.className).trim().slice(0, 120) : '',
      role: el.getAttribute('role') || null,
      selector: buildSelector(el),
      rect: { top: Math.round(rect.top), left: Math.round(rect.left), width: Math.round(rect.width), height: Math.round(rect.height) },
      isSemanticInteractive: category !== 'non-semantic-clickable' && category !== 'landmark',
      category: category,
      nonSemanticReason: nonSemanticReason || null,
      ariaExpanded: el.getAttribute('aria-expanded'),
      ariaControls: el.getAttribute('aria-controls'),
      ariaHaspopup: el.getAttribute('aria-haspopup'),
    });
  }

  // Semantic interactive elements first — buttons, links, form controls, tabs
  document.querySelectorAll(INTERACTIVE_SELECTORS).forEach(el => {
    const tag = el.tagName.toLowerCase();
    const role = el.getAttribute('role');
    let category = 'button';
    if (tag === 'a') category = 'link';
    else if (tag === 'input' || tag === 'select' || tag === 'textarea') category = 'form-input';
    else if (role === 'tab') category = 'tab-trigger';
    else if (role === 'menuitem') category = 'nav-item';
    addRef(el, category, null);
  });

  // Non-semantic clickables — divs with cursor:pointer, onclick, or tabindex
  document.querySelectorAll('*').forEach(el => {
    if (refIndex >= MAX_REFS) return;
    if (seen.has(el)) return;
    const tag = el.tagName.toLowerCase();
    if (['button', 'a', 'input', 'select', 'textarea'].includes(tag)) return;
    if (el.getAttribute('role') && ['button', 'tab', 'link', 'menuitem'].includes(el.getAttribute('role'))) return;

    const style = getComputedStyle(el);
    const hasCursorPointer = style.cursor === 'pointer';
    const hasOnclick = el.hasAttribute('onclick') || (el.onclick !== null && el.onclick !== undefined);
    const tabindex = el.getAttribute('tabindex');
    const hasTabindex = tabindex !== null && tabindex !== '-1';

    if (!hasCursorPointer && !hasOnclick && !hasTabindex) return;

    // Skip if parent also has cursor:pointer (avoid child-of-clickable noise)
    if (hasCursorPointer && !hasOnclick && !hasTabindex && el.parentElement) {
      if (getComputedStyle(el.parentElement).cursor === 'pointer') return;
    }

    const text = (el.textContent || '').trim();
    if (!text) return;

    const reasons = [];
    if (hasCursorPointer) reasons.push('cursor:pointer');
    if (hasOnclick) reasons.push('onclick');
    if (hasTabindex) reasons.push('tabindex=' + tabindex);

    addRef(el, 'non-semantic-clickable', reasons.join(', '));
  });

  // Content landmarks — nav, main, dialogs, tab panels
  document.querySelectorAll(LANDMARK_SELECTORS).forEach(el => {
    if (seen.has(el)) return;
    addRef(el, 'landmark', null);
  });

  return refs;
}

/**
 * Re-finds an element by CSS selector, returns current rect + visibility.
 * Runs inside page.evaluate().
 * @param {string} selector - CSS selector to locate
 * @returns {Object} Element state: found, visible, rect, display, visibility
 */
function snippetResolveRef(selector) {
  const el = document.querySelector(selector);
  if (!el) return { found: false, selector };
  const rect = el.getBoundingClientRect();
  const style = getComputedStyle(el);
  return {
    found: true,
    selector,
    visible: style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0,
    rect: { top: Math.round(rect.top), left: Math.round(rect.left), width: Math.round(rect.width), height: Math.round(rect.height) },
    display: style.display,
    visibility: style.visibility,
  };
}

// ── Action Helpers ──
// These run in Node, wrapping Playwright page API calls with error handling.
// Each returns { ok: true/false, error? } so callers don't need try/catch.

/**
 * Hover over an element and wait for any transitions to settle.
 * @param {import('playwright-core').Page} page - Playwright page
 * @param {string} selector - CSS selector to hover
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
async function actionHover(page, selector) {
  try {
    await page.hover(selector, { timeout: 2000 });
    await page.waitForTimeout(350);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Click an element and wait for any resulting state changes.
 * @param {import('playwright-core').Page} page - Playwright page
 * @param {string} selector - CSS selector to click
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
async function actionClick(page, selector) {
  try {
    await page.click(selector, { timeout: 3000 });
    await page.waitForTimeout(500);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Press Tab and return info about whatever element got focus.
 * @param {import('playwright-core').Page} page - Playwright page
 * @returns {Promise<{ok: boolean, focused?: Object, error?: string}>}
 */
async function actionTab(page) {
  try {
    await page.keyboard.press('Tab');
    await page.waitForTimeout(100);
    const focused = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const rect = el.getBoundingClientRect();

      // Build a selector that's as unique as possible for loop detection.
      // ID is best, then tag+classes with nth-of-type, then positional fallback.
      let selector;
      if (el.id) {
        selector = '#' + CSS.escape(el.id);
      } else {
        const tag = el.tagName.toLowerCase();
        const classes = el.className ? '.' + Array.from(el.classList).slice(0, 3).map(c => CSS.escape(c)).join('.') : '';
        const candidate = tag + classes;
        if (document.querySelectorAll(candidate).length <= 1) {
          selector = candidate;
        } else {
          // Disambiguate with nth-of-type in parent context
          const parent = el.parentElement;
          const siblings = parent ? Array.from(parent.children).filter(s => s.tagName === el.tagName) : [];
          const idx = siblings.indexOf(el);
          selector = candidate + ':nth-of-type(' + (idx + 1) + ')';
        }
      }

      return {
        tag: el.tagName.toLowerCase(),
        selector,
        text: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 80),
        rect: { top: Math.round(rect.top), left: Math.round(rect.left), width: Math.round(rect.width), height: Math.round(rect.height) },
        // Include position for secondary loop detection — even if selectors collide,
        // different positions mean different elements
        _loopKey: selector + '|' + Math.round(rect.top) + ',' + Math.round(rect.left),
      };
    });
    return { ok: true, focused };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Press Escape — close modals, dropdowns, whatever.
 * @param {import('playwright-core').Page} page - Playwright page
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
async function actionEscape(page) {
  try {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Scroll to a specific fold (viewport-height multiple).
 * @param {import('playwright-core').Page} page - Playwright page
 * @param {number} foldIndex - Which fold to scroll to (0 = top, 1 = second screen, etc.)
 * @param {number} viewportHeight - Height of the viewport in px
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
async function actionScrollToFold(page, foldIndex, viewportHeight, containerSelector) {
  try {
    await page.evaluate(([idx, vh, cs]) => {
      const y = idx * vh;
      if (cs) {
        const container = document.querySelector(cs);
        if (container) { container.scrollTo(0, y); return; }
      }
      window.scrollTo(0, y);
    }, [foldIndex, viewportHeight, containerSelector || null]);
    await page.waitForTimeout(500);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ── Before/After Capture ──
// Snapshot computed styles, perform an action, snapshot again, diff.

const DEFAULT_CAPTURE_PROPS = [
  'backgroundColor', 'color', 'borderColor', 'boxShadow', 'transform',
  'opacity', 'outline', 'outlineOffset', 'textDecoration', 'visibility',
  'display', 'height', 'width'
];

/**
 * Grab computed styles for a set of CSS properties on a single element.
 * Runs inside page.evaluate(). Handles camelCase → kebab-case for getPropertyValue.
 * @param {string} selector - CSS selector
 * @param {string[]} props - camelCase property names to capture
 * @returns {Object|null} Map of prop → computed value, or null if element missing
 */
function snippetCaptureStyles(args) {
  const [selector, props] = Array.isArray(args) ? args : [args, []];
  const el = document.querySelector(selector);
  if (!el) return null;
  const style = getComputedStyle(el);
  const result = {};
  for (const prop of props) {
    // Convert camelCase to kebab-case for getPropertyValue
    const kebab = prop.replace(/([A-Z])/g, '-$1').toLowerCase();
    result[prop] = style.getPropertyValue(kebab) || style[prop] || '';
  }
  return result;
}

/**
 * The core snapshot-act-snapshot loop. Captures computed styles before and after
 * an action, returns a diff of what changed.
 * @param {import('playwright-core').Page} page - Playwright page
 * @param {string} selector - CSS selector of the target element
 * @param {Function} actionFn - Async function(page, selector) that performs the action
 * @param {string[]} [propsToCapture] - Which CSS props to track (defaults to DEFAULT_CAPTURE_PROPS)
 * @returns {Promise<Object>} Before/after state with list of changed properties
 */
async function captureBeforeAfter(page, selector, actionFn, propsToCapture) {
  const props = propsToCapture || DEFAULT_CAPTURE_PROPS;
  const before = await page.evaluate(snippetCaptureStyles, [selector, props]);
  if (!before) return { found: false, selector };

  const actionResult = await actionFn(page, selector);
  if (!actionResult.ok) return { found: true, actionFailed: true, error: actionResult.error, selector };

  const after = await page.evaluate(snippetCaptureStyles, [selector, props]);
  if (!after) return { found: true, actionFailed: false, before, after: null, changed: false, changedProperties: [] };

  const changedProperties = [];
  for (const prop of props) {
    if (before[prop] !== after[prop]) changedProperties.push(prop);
  }

  return {
    found: true,
    actionFailed: false,
    selector,
    before,
    after,
    changed: changedProperties.length > 0,
    changedProperties
  };
}

// ── Probe Isolation ──
// Reset page state between interaction probes so one probe's side effects
// don't contaminate the next.

/**
 * Clean slate: dismiss overlays, reset scroll, blur focus, move mouse away.
 * Call between individual probes within a pass.
 * @param {import('playwright-core').Page} page - Playwright page
 */
async function resetProbeState(page, containerSelector) {
  try {
    await page.keyboard.press('Escape');
  } catch { /* ignore */ }
  try {
    await page.mouse.move(0, 0);
  } catch { /* ignore */ }
  try {
    await page.evaluate((cs) => {
      window.scrollTo(0, 0);
      if (cs) {
        const container = document.querySelector(cs);
        if (container) container.scrollTo(0, 0);
      }
      if (document.activeElement && document.activeElement !== document.body) {
        document.activeElement.blur();
      }
    }, containerSelector || null);
  } catch { /* ignore */ }
  await page.waitForTimeout(200);
}

/**
 * Heavier reset between entire passes (scroll, hover, focus, etc.).
 * Also force-closes any open dialogs that might block future interactions.
 * @param {import('playwright-core').Page} page - Playwright page
 */
async function resetBetweenPasses(page, containerSelector) {
  await resetProbeState(page, containerSelector);
  // Extra Escape + body click to dismiss any persistent overlays
  // without mutating DOM styles (which could interfere with later probes)
  try { await page.keyboard.press('Escape'); } catch { /* ignore */ }
  try { await page.click('body', { timeout: 500 }); } catch { /* ignore */ }
  try {
    await page.evaluate((cs) => {
      window.scrollTo(0, 0);
      if (cs) {
        const container = document.querySelector(cs);
        if (container) container.scrollTo(0, 0);
      }
    }, containerSelector || null);
  } catch { /* ignore */ }
  await page.waitForTimeout(100);
}

// ── Per-Pass Time Budgets ──
// Each interaction pass gets a hard time ceiling. If it runs over,
// we bail with partial results instead of blocking the whole collection.

const SCROLL_PASS_BUDGET_MS = 8000;
const HOVER_PASS_BUDGET_MS = 5000;
const FOCUS_PASS_BUDGET_MS = 3000;
const PROMISE_PASS_BUDGET_MS = 12000;

/**
 * Run a pass function with a hard time budget. The pass function receives
 * an isBudgetExhausted() callback it can poll to bail early.
 * @param {number} budgetMs - Maximum milliseconds for this pass
 * @param {Function} passFn - Async function(isBudgetExhausted) to run
 * @returns {Promise<{timedOut: boolean, result: any, elapsedMs: number, error?: string}>}
 */
async function withPassBudget(budgetMs, passFn) {
  const startTime = Date.now();
  let exhausted = false;
  let timerId = null;
  let passPromise = null;

  const isBudgetExhausted = () => {
    if (Date.now() - startTime >= budgetMs) {
      exhausted = true;
      return true;
    }
    return false;
  };

  try {
    passPromise = passFn(isBudgetExhausted);
    const result = await Promise.race([
      passPromise.then(r => ({ fromPass: true, value: r })),
      new Promise((resolve) => {
        timerId = setTimeout(() => {
          exhausted = true;
          resolve({ fromPass: false, value: null });
        }, budgetMs);
      })
    ]);

    if (!result.fromPass) {
      // Timer won the race. Wait for the in-flight Playwright call to finish
      // so it doesn't contaminate the next pass. Cap at 3s — if the orphan
      // is still running after that, it's on its own.
      try { await Promise.race([passPromise, new Promise(r => setTimeout(r, 3000))]); } catch { /* swallow */ }
      return { timedOut: true, result: null, elapsedMs: Date.now() - startTime, error: 'Pass budget exhausted' };
    }

    // Pass function returned, but may have exited early via isBudgetExhausted().
    // Report timedOut: true if the pass bailed cooperatively — the data is partial.
    return { timedOut: exhausted, result: result.value, elapsedMs: Date.now() - startTime };
  } catch (err) {
    return { timedOut: exhausted, result: null, elapsedMs: Date.now() - startTime, error: err.message };
  } finally {
    if (timerId !== null) clearTimeout(timerId);
  }
}

// ── Scroll Pass ──
// Scrolls the page fold-by-fold, capturing screenshots, sticky elements,
// lazy-loaded images, and below-fold typography/color samples.

/**
 * Measure page dimensions and detect scroll strategy (document vs SPA container).
 * Runs inside page.evaluate() — no Node APIs.
 * @returns {Object} scrollHeight, viewportHeight, scrollWidth, viewportWidth, scrollStrategy, containerSelector
 */
function snippetPageDimensions() {
  const vh = window.innerHeight;
  const sh = document.documentElement.scrollHeight;
  const sw = document.documentElement.scrollWidth;
  const vw = window.innerWidth;

  // SPA detection: if doc scroll matches viewport, hunt for an overflow container
  let scrollStrategy = 'document';
  let containerSelector = null;
  let effectiveScrollHeight = sh;
  if (sh <= vh + 10) {
    const candidates = document.querySelectorAll('main, [role="main"], #app, #root, #__next, .app, .main');
    for (const el of candidates) {
      if (el.scrollHeight > el.clientHeight + 50) {
        scrollStrategy = 'container';
        containerSelector = el.id ? '#' + CSS.escape(el.id) : el.tagName.toLowerCase() + (el.className ? '.' + Array.from(el.classList).slice(0, 2).map(c => CSS.escape(c)).join('.') : '');
        effectiveScrollHeight = el.scrollHeight;
        break;
      }
    }
    if (!containerSelector) scrollStrategy = 'none';
  }

  return {
    scrollHeight: effectiveScrollHeight,
    viewportHeight: vh,
    scrollWidth: sw,
    viewportWidth: vw,
    scrollStrategy,
    containerSelector,
  };
}

/**
 * Find all sticky/fixed-position elements at the current scroll position.
 * Runs inside page.evaluate(). Capped at 20 results.
 * @returns {Array} Array of { tag, classes, position, rect }
 */
function snippetStickyElements(maxElements) {
  const cap = maxElements || 20;
  const results = [];
  const all = document.querySelectorAll('*');
  for (const el of all) {
    const style = getComputedStyle(el);
    if (style.position === 'sticky' || style.position === 'fixed') {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        results.push({
          tag: el.tagName.toLowerCase(),
          classes: el.className ? String(el.className).trim().slice(0, 120) : '',
          position: style.position,
          rect: { top: Math.round(rect.top), left: Math.round(rect.left), width: Math.round(rect.width), height: Math.round(rect.height) },
        });
      }
    }
    if (results.length >= cap) break;
  }
  return results;
}

/**
 * Snapshot all <img> elements with their current src, alt, loading attribute, and position.
 * Used to diff against a baseline and detect lazy-loaded images that appear on scroll.
 * Runs inside page.evaluate().
 * @returns {Array} Array of { src, alt, hasAlt, loading, rect }
 */
function snippetImageSrcs() {
  return Array.from(document.querySelectorAll('img')).map(img => ({
    src: img.currentSrc || img.src || '',
    alt: img.alt,
    hasAlt: img.hasAttribute('alt') && img.alt.trim().length > 0,
    loading: img.getAttribute('loading'),
    rect: { top: Math.round(img.getBoundingClientRect().top) }
  }));
}

/**
 * Scroll through the page fold-by-fold, collecting per-fold evidence:
 * screenshots, sticky elements, lazy images, and midpoint typography/colors.
 * Fold 1 is the existing desktop screenshot — we start from fold 2.
 * @param {Object} bundle - Evidence bundle to write scroll data into
 * @param {import('playwright-core').Page} page - Playwright page
 * @param {string} root - Project root for screenshot paths
 * @param {string} url - Target URL for screenshot naming
 * @param {string} stamp - Timestamp string for screenshot naming
 */
async function collectScrollPass(bundle, page, root, url, stamp, isBudgetExhausted, config) {
  if (!isBudgetExhausted) isBudgetExhausted = () => false;
  const dims = await page.evaluate(snippetPageDimensions);

  // Short page — nothing to scroll, record the bare minimum and bail
  if (!dims || dims.scrollStrategy === 'none' || dims.scrollHeight <= dims.viewportHeight + 50) {
    bundle.scroll = {
      totalHeight: dims?.scrollHeight || 0,
      viewportHeight: dims?.viewportHeight || 0,
      folds: 1,
      ratio: 1,
      scrollStrategy: dims?.scrollStrategy || 'none',
      containerSelector: dims?.containerSelector || null,
      foldScreenshots: [],
      stickyElements: [],
      lazyImages: [],
      belowFoldTypography: null,
      belowFoldColors: null,
    };
    return;
  }

  const totalFolds = Math.min(Math.ceil(dims.scrollHeight / dims.viewportHeight), config?.maxFolds || 10);
  const scrollResult = {
    totalHeight: dims.scrollHeight,
    viewportHeight: dims.viewportHeight,
    folds: totalFolds,
    ratio: Math.round((dims.scrollHeight / dims.viewportHeight) * 100) / 100,
    scrollStrategy: dims.scrollStrategy,
    containerSelector: dims.containerSelector || null,
    foldScreenshots: [],
    stickyElements: [],
    lazyImages: [],
    belowFoldTypography: null,
    belowFoldColors: null,
  };

  // Baseline image srcs at top of page — used to detect lazy loads
  const baselineImages = await page.evaluate(snippetImageSrcs);
  const baselineSrcs = new Set(baselineImages.map(img => img.src).filter(Boolean));

  // Track sticky elements across folds to see which ones persist
  const stickyByFold = {};

  const midFold = Math.floor(totalFolds / 2);

  // Fold 1 is the existing desktop screenshot — start from fold 2
  for (let fold = 1; fold < totalFolds; fold++) {
    if (isBudgetExhausted()) break;
    await actionScrollToFold(page, fold, dims.viewportHeight, dims.containerSelector);

    // Screenshot this fold
    const foldShot = screenshotPath(root, url, 'desktop-fold-' + (fold + 1), stamp);
    try {
      await page.screenshot({ path: foldShot, timeout: SCREENSHOT_TIMEOUT_MS, fullPage: false });
      scrollResult.foldScreenshots.push(foldShot);
    } catch { /* skip this fold's screenshot on failure */ }

    // Sticky elements at this scroll position
    const sticky = await page.evaluate(snippetStickyElements, config?.maxStickyElements || 20);
    if (sticky?.length) {
      stickyByFold[fold] = sticky;
    }

    // Diff image srcs to find newly loaded lazy images (capped)
    const maxLazy = config?.maxLazyImages || 999;
    if (scrollResult.lazyImages.length < maxLazy) {
      const currentImages = await page.evaluate(snippetImageSrcs);
      for (const img of currentImages) {
        if (scrollResult.lazyImages.length >= maxLazy) break;
        if (img.src && !baselineSrcs.has(img.src)) {
          baselineSrcs.add(img.src);
          scrollResult.lazyImages.push({
            src: img.src,
            appearedAtFold: fold + 1,
            hasAlt: img.hasAlt,
          });
        }
      }
    }

    // Sample typography and colors at the midpoint fold
    if (fold === midFold) {
      scrollResult.belowFoldTypography = await safeStep(bundle, [], () => page.evaluate(snippetTypography), null);
      scrollResult.belowFoldColors = await safeStep(bundle, [], () => page.evaluate(snippetColors), null);
    }
  }

  // Figure out which sticky elements show up across multiple folds
  const allStickySelectors = new Map();
  for (const [fold, stickyList] of Object.entries(stickyByFold)) {
    for (const el of stickyList) {
      const key = el.tag + '.' + el.classes;
      if (!allStickySelectors.has(key)) {
        allStickySelectors.set(key, { ...el, foldsSeen: 1 });
      } else {
        allStickySelectors.get(key).foldsSeen++;
      }
    }
  }
  scrollResult.stickyElements = Array.from(allStickySelectors.values()).map(el => ({
    tag: el.tag,
    classes: el.classes,
    position: el.position,
    persistsAcrossFolds: el.foldsSeen > 1,
  }));

  // Back to top so the page is in a clean state for subsequent passes
  await actionScrollToFold(page, 0, dims.viewportHeight, dims.containerSelector);

  bundle.scroll = scrollResult;
}

// ── Hover Pass ──
// Desktop only — hovers key interactive elements and captures computed
// style diffs. Buttons, links, and nav items get priority.

/**
 * Hover pass — hovers key interactive elements (desktop only), captures
 * computed style diffs. Max 15 elements, biggest above-fold first.
 * @param {Object} bundle - Evidence bundle with interactiveElements already populated
 * @param {import('playwright-core').Page} page - Playwright page
 */
async function collectHoverPass(bundle, page, isBudgetExhausted, config) {
  if (!isBudgetExhausted) isBudgetExhausted = () => false;
  if (!bundle.interactiveElements || !Array.isArray(bundle.interactiveElements)) return;

  // Only semantic interactive elements that respond to hover in a meaningful way
  const hoverCandidates = bundle.interactiveElements
    .filter(ref => ref.isSemanticInteractive && ['button', 'link', 'nav-item'].includes(ref.category))
    .sort((a, b) => {
      // Above-fold elements win — lower top value means higher on the page
      const aAbove = a.rect.top < (bundle.viewports?.desktop?.height || 900) ? 0 : 1;
      const bAbove = b.rect.top < (bundle.viewports?.desktop?.height || 900) ? 0 : 1;
      if (aAbove !== bAbove) return aAbove - bAbove;
      // Tie-break by area: bigger elements first
      return (b.rect.width * b.rect.height) - (a.rect.width * a.rect.height);
    })
    .slice(0, config?.maxHover || 15);

  const results = [];

  for (const ref of hoverCandidates) {
    if (isBudgetExhausted()) break;
    const capture = await captureBeforeAfter(page, ref.selector, actionHover);
    results.push({
      ref: ref.ref,
      selector: ref.selector,
      text: ref.text,
      category: ref.category,
      before: capture.before || null,
      after: capture.after || null,
      changed: capture.changed || false,
      changedProperties: capture.changedProperties || [],
      transitionValue: capture.after ? (await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        return el ? getComputedStyle(el).transition : '';
      }, ref.selector)) : null,
    });

    await resetProbeState(page);
  }

  bundle.hoverStates = results;
}

// ── Focus Pass Snippets ──
// page.evaluate functions for checking focus indicators and finding
// non-semantic clickables that should probably be <button> or <a>.

/**
 * Force-focus an element and read focus indicator properties.
 * Compares before/after to determine if a visible focus ring shows up.
 * Runs inside page.evaluate().
 *
 * Known limitation: uses el.focus() which is programmatic, not keyboard-triggered.
 * Browsers may not apply :focus-visible styles for programmatic focus. Elements
 * that only style :focus-visible (not :focus) may show false negatives here.
 * The collectFocusPass uses keyboard Tab which DOES trigger :focus-visible, but
 * this snippet runs on the already-focused element — so the indicator should be
 * present if the Tab path triggered it. The before/after diff still catches the
 * change if :focus-visible was applied by the preceding Tab keypress.
 *
 * @param {string} selector - CSS selector to focus
 * @returns {Object|null} Focus indicator analysis or null if element missing
 */
function snippetFocusIndicator(selector) {
  const el = document.querySelector(selector);
  if (!el) return null;

  // Snapshot before focus
  const beforeStyle = getComputedStyle(el);
  const beforeOutline = beforeStyle.outline;
  const beforeOutlineOffset = beforeStyle.outlineOffset;
  const beforeBoxShadow = beforeStyle.boxShadow;
  const beforeBorderColor = beforeStyle.borderColor;

  el.focus();

  // Snapshot after focus
  const afterStyle = getComputedStyle(el);
  const afterOutline = afterStyle.outline;
  const afterOutlineOffset = afterStyle.outlineOffset;
  const afterBoxShadow = afterStyle.boxShadow;
  const afterBorderColor = afterStyle.borderColor;

  // Did anything change?
  const outlineChanged = beforeOutline !== afterOutline;
  const boxShadowChanged = beforeBoxShadow !== afterBoxShadow;
  const borderChanged = beforeBorderColor !== afterBorderColor;
  const hasOutlineNone = afterOutline.includes('none') || afterOutline === '0px none' || afterOutline === '';

  const hasVisibleIndicator = (outlineChanged && !hasOutlineNone) || boxShadowChanged || borderChanged;

  let indicatorType = null;
  if (outlineChanged && !hasOutlineNone) indicatorType = 'outline';
  else if (boxShadowChanged) indicatorType = 'box-shadow';
  else if (borderChanged) indicatorType = 'border';

  // Clean up — don't leave focus state hanging around
  el.blur();

  return {
    selector,
    outline: afterOutline,
    outlineOffset: afterOutlineOffset,
    boxShadow: afterBoxShadow,
    borderColor: afterBorderColor,
    hasVisibleIndicator,
    indicatorType,
    indicatorValue: indicatorType === 'outline' ? afterOutline
      : indicatorType === 'box-shadow' ? afterBoxShadow
      : indicatorType === 'border' ? afterBorderColor
      : null,
  };
}

/**
 * Find elements that look clickable but aren't built with semantic HTML.
 * Divs and spans with cursor:pointer, onclick handlers, or tabindex are
 * the usual culprits. These should almost always be <button> or <a>.
 * Runs inside page.evaluate(). Capped at 30 results.
 * @returns {Array} Array of non-semantic clickable element descriptors
 */
function snippetNonSemanticClickables() {
  const SEMANTIC_TAGS = new Set(['button', 'a', 'input', 'select', 'textarea', 'summary']);
  const SEMANTIC_ROLES = new Set(['button', 'tab', 'link', 'menuitem', 'option', 'checkbox', 'radio']);
  const results = [];

  document.querySelectorAll('*').forEach(el => {
    if (results.length >= 30) return;
    const tag = el.tagName.toLowerCase();
    if (SEMANTIC_TAGS.has(tag)) return;
    const role = el.getAttribute('role');
    if (role && SEMANTIC_ROLES.has(role)) return;

    const style = getComputedStyle(el);
    const hasCursor = style.cursor === 'pointer';
    const hasOnclick = el.hasAttribute('onclick') || (el.onclick !== null && el.onclick !== undefined);
    const tabindex = el.getAttribute('tabindex');
    const hasTabindex = tabindex !== null && tabindex !== '-1';

    if (!hasCursor && !hasOnclick && !hasTabindex) return;

    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    if (style.display === 'none' || style.visibility === 'hidden') return;

    // Skip child elements that just inherit cursor:pointer from a parent
    if (hasCursor && !hasOnclick && !hasTabindex && el.parentElement) {
      if (getComputedStyle(el.parentElement).cursor === 'pointer') return;
    }

    const text = (el.textContent || '').trim().slice(0, 60);
    if (!text) return;

    results.push({
      tag,
      classes: el.className ? String(el.className).trim().slice(0, 80) : '',
      cursor: style.cursor,
      hasOnclick,
      hasRole: !!role,
      role: role || null,
      tabindex: tabindex || null,
      text,
    });
  });

  return results;
}

// ── Focus Pass ──
// Tabs through focusable elements, checks for visible focus indicators,
// and detects non-semantic clickables. Desktop first — mobile later.

/**
 * Focus pass — tabs through focusable elements (max 30), checks for
 * visible focus indicators. Records missing indicators and non-semantic clickables.
 * @param {Object} bundle - Evidence bundle to write focusPass data into
 * @param {import('playwright-core').Page} page - Playwright page
 */
async function collectFocusPass(bundle, page, isBudgetExhausted, config) {
  if (!isBudgetExhausted) isBudgetExhausted = () => false;
  const focusResults = {
    totalFocusable: 0,
    tabbed: 0,
    withIndicator: 0,
    withoutIndicator: 0,
    missingIndicators: [],
    nonSemanticClickables: [],
  };

  const MAX_TABS = config?.maxTabs || 30;
  const tabbedElements = [];

  // Start clean — make sure nothing is focused
  await page.evaluate(() => {
    if (document.activeElement && document.activeElement !== document.body) {
      document.activeElement.blur();
    }
  });

  for (let i = 0; i < MAX_TABS; i++) {
    if (isBudgetExhausted()) break;
    const tabResult = await actionTab(page);
    if (!tabResult.ok || !tabResult.focused) break;

    const focused = tabResult.focused;

    // Loop detection — use _loopKey (selector + position) to avoid false matches
    // on repeated controls with identical selectors
    const loopKey = focused._loopKey || focused.selector;
    if (tabbedElements.length > 0 && (tabbedElements[0]._loopKey || tabbedElements[0].selector) === loopKey) break;

    tabbedElements.push(focused);

    // Check whether the currently-focused element has a visible focus indicator.
    // We read from document.activeElement directly rather than querySelector(selector)
    // because the selector may not be globally unique on pages with repeated controls.
    const indicator = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const style = getComputedStyle(el);
      const outline = style.outline;
      const outlineOffset = style.outlineOffset;
      const boxShadow = style.boxShadow;
      const borderColor = style.borderColor;
      // Check for non-trivial indicator: outline that isn't "none", or boxShadow/border present
      const hasOutlineNone = outline.includes('none') || outline === '0px none' || outline === '';
      const hasVisibleOutline = !hasOutlineNone && outline !== '0px';
      // Heuristic: if boxShadow is not 'none' or borderColor changed, there's a visual indicator
      const hasBoxShadow = boxShadow && boxShadow !== 'none';
      const hasVisibleIndicator = hasVisibleOutline || hasBoxShadow;
      let indicatorType = null;
      if (hasVisibleOutline) indicatorType = 'outline';
      else if (hasBoxShadow) indicatorType = 'box-shadow';
      return {
        selector: el.id ? '#' + el.id : el.tagName.toLowerCase(),
        outline, outlineOffset, boxShadow, borderColor,
        hasVisibleIndicator,
        indicatorType,
        indicatorValue: indicatorType === 'outline' ? outline : indicatorType === 'box-shadow' ? boxShadow : null,
      };
    });
    if (indicator) {
      if (indicator.hasVisibleIndicator) {
        focusResults.withIndicator++;
      } else {
        focusResults.withoutIndicator++;
        focusResults.missingIndicators.push({
          ref: focused.selector,
          selector: focused.selector,
          text: focused.text,
          outline: indicator.outline,
          boxShadow: indicator.boxShadow,
        });
      }
    }
  }

  focusResults.totalFocusable = tabbedElements.length;
  focusResults.tabbed = tabbedElements.length;

  // Find fake-button divs and spans that probably need semantic HTML
  focusResults.nonSemanticClickables = await page.evaluate(snippetNonSemanticClickables) || [];

  bundle.focusPass = focusResults;
}

// ── Promise Verification ──
// Clicks detected interactive patterns (mobile menu, anchor links, tabs,
// accordion) and checks strictly measurable outcomes. Mobile menu probed
// at mobile viewport. Max 8 verifications total.

/**
 * Detect interactive promises on the page. Conservative detection —
 * requires strong ARIA/state signals, not class name guessing.
 * Returns only mobile-menu, anchor-links, and tabs/accordion patterns.
 * Runs inside page.evaluate().
 * @returns {Array} Detected interactive promise patterns
 */
function snippetDetectPromises() {
  const detected = [];

  // ── Mobile Menu Detection (require 2+ signals) ──
  const menuButtons = document.querySelectorAll('button, [role="button"]');
  for (const btn of menuButtons) {
    let signals = 0;
    let targetSelector = null;

    const ariaExpanded = btn.getAttribute('aria-expanded');
    const ariaControls = btn.getAttribute('aria-controls');
    const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
    const text = (btn.textContent || '').toLowerCase().trim();

    // Signal: aria-expanded present
    if (ariaExpanded !== null) signals++;

    // Signal: aria-controls pointing to a nav element
    if (ariaControls) {
      const target = document.getElementById(ariaControls);
      if (target && (target.tagName.toLowerCase() === 'nav' || target.querySelector('nav') || target.querySelectorAll('a').length >= 3)) {
        signals++;
        targetSelector = '#' + CSS.escape(ariaControls);
      }
    }

    // Signal: aria-label contains menu/navigation
    if (ariaLabel.includes('menu') || ariaLabel.includes('navigation') || ariaLabel.includes('nav')) signals++;

    // Signal: text content suggests menu
    if (text === 'menu' || text === '☰' || text === '≡') signals++;

    // Signal: adjacent/sibling nav that's hidden
    if (!targetSelector) {
      const parent = btn.parentElement;
      if (parent) {
        const siblingNav = parent.querySelector('nav') || parent.nextElementSibling;
        if (siblingNav && siblingNav.tagName.toLowerCase() === 'nav') {
          const style = getComputedStyle(siblingNav);
          if (style.display === 'none' || style.visibility === 'hidden' ||
              style.transform.includes('translate') || parseInt(style.height) === 0) {
            signals++;
            targetSelector = siblingNav.id ? '#' + CSS.escape(siblingNav.id) : 'nav';
          }
        }
      }
    }

    // Require 2+ signals
    if (signals >= 2 && targetSelector) {
      const btnSelector = btn.id ? '#' + CSS.escape(btn.id) :
        'button' + (btn.className ? '.' + Array.from(btn.classList).slice(0, 2).map(c => CSS.escape(c)).join('.') : '');
      detected.push({
        pattern: 'mobile-menu',
        triggerSelector: btnSelector,
        targetSelector,
        confidence: signals >= 3 ? 'high' : 'medium',
        viewport: 'mobile',
        ariaExpanded,
      });
      break; // One menu per page
    }
  }

  // ── Anchor Links ──
  const anchorLinks = document.querySelectorAll('a[href^="#"]');
  for (const link of anchorLinks) {
    const href = link.getAttribute('href');
    if (href === '#' || href === '#!') continue; // Skip empty anchors
    const targetId = href.slice(1);
    const targetExists = !!document.getElementById(targetId);
    const linkText = (link.textContent || '').trim().slice(0, 60);
    if (!linkText) continue;

    const linkSelector = link.id ? '#' + CSS.escape(link.id) :
      'a[href="' + CSS.escape(href) + '"]';

    detected.push({
      pattern: 'anchor-link',
      triggerSelector: linkSelector,
      targetSelector: targetExists ? '#' + CSS.escape(targetId) : null,
      confidence: targetExists ? 'high' : 'medium',
      viewport: 'desktop',
      targetExists,
      text: linkText,
    });
  }

  // ── Tabs (ARIA only) ──
  const tablists = document.querySelectorAll('[role="tablist"]');
  for (const tablist of tablists) {
    const tabs = tablist.querySelectorAll('[role="tab"]');
    if (tabs.length < 2) continue;

    // Find the first non-selected tab
    let triggerTab = null;
    for (const tab of tabs) {
      if (tab.getAttribute('aria-selected') !== 'true') {
        triggerTab = tab;
        break;
      }
    }
    if (!triggerTab) continue;

    const ariaControls = triggerTab.getAttribute('aria-controls');
    const targetSelector = ariaControls ? '#' + CSS.escape(ariaControls) : null;
    const triggerSelector = triggerTab.id ? '#' + CSS.escape(triggerTab.id) :
      '[role="tab"]:not([aria-selected="true"])';

    detected.push({
      pattern: 'tabs',
      triggerSelector,
      targetSelector,
      confidence: ariaControls ? 'high' : 'medium',
      viewport: 'desktop',
      tabCount: tabs.length,
      text: (triggerTab.textContent || triggerTab.getAttribute('aria-label') || '').trim().slice(0, 60),
    });
  }

  // ── Accordion (ARIA only — aria-expanded + aria-controls) ──
  const expandTriggers = document.querySelectorAll('[aria-expanded][aria-controls]');
  // Exclude anything already detected as a menu button
  const menuTriggerSelectors = new Set(detected.filter(d => d.pattern === 'mobile-menu').map(d => d.triggerSelector));

  for (const trigger of expandTriggers) {
    const triggerSelector = trigger.id ? '#' + CSS.escape(trigger.id) :
      trigger.tagName.toLowerCase() + '[aria-controls="' + CSS.escape(trigger.getAttribute('aria-controls')) + '"]';
    if (menuTriggerSelectors.has(triggerSelector)) continue;

    const ariaControls = trigger.getAttribute('aria-controls');
    const target = document.getElementById(ariaControls);
    if (!target) continue;

    const expanded = trigger.getAttribute('aria-expanded');
    if (expanded === 'true') continue; // Already open — look for collapsed ones

    detected.push({
      pattern: 'accordion',
      triggerSelector,
      targetSelector: '#' + CSS.escape(ariaControls),
      confidence: 'high',
      viewport: 'desktop',
      ariaExpanded: expanded,
      text: (trigger.textContent || trigger.getAttribute('aria-label') || '').trim().slice(0, 60),
    });

    if (detected.filter(d => d.pattern === 'accordion').length >= 3) break; // Max 3 accordion probes
  }

  return detected;
}

/**
 * Check if an element is currently visible — used as the "after" check
 * in promise verification. Strictly measurable: display, visibility, height.
 * Runs inside page.evaluate().
 * @param {string} selector - CSS selector of the target element
 * @returns {Object} Visibility state with display, height, visible links count
 */
function snippetVerifyVisibilityChange(selector) {
  const el = document.querySelector(selector);
  if (!el) return { found: false, selector };
  const style = getComputedStyle(el);
  const rect = el.getBoundingClientRect();

  // Check for visible links inside (for mobile nav verification)
  const visibleLinks = Array.from(el.querySelectorAll('a')).filter(a => {
    const r = a.getBoundingClientRect();
    return r.height > 0 && r.width > 0;
  }).length;

  return {
    found: true,
    selector,
    display: style.display,
    visibility: style.visibility,
    height: Math.round(rect.height),
    width: Math.round(rect.width),
    visible: style.display !== 'none' && style.visibility !== 'hidden' && rect.height > 0 && rect.width > 0,
    visibleLinks,
  };
}

/**
 * Check if a target element is near the top of the viewport (anchor jump worked).
 * Runs inside page.evaluate().
 * @param {string} targetSelector - CSS selector of the anchor target
 * @returns {Object} Scroll position and target element's viewport position
 */
function snippetVerifyAnchorJump(args) {
  const [targetSelector, containerSelector] = Array.isArray(args) ? args : [args, null];
  const el = document.querySelector(targetSelector);
  if (!el) return { found: false };
  const rect = el.getBoundingClientRect();
  const vh = window.innerHeight;

  // Check both window scroll and container scroll — SPAs may scroll inside a container
  let scrollY = Math.round(window.scrollY);
  if (containerSelector) {
    const container = document.querySelector(containerSelector);
    if (container) scrollY = Math.max(scrollY, Math.round(container.scrollTop));
  }

  return {
    found: true,
    scrollY,
    targetTop: Math.round(rect.top),
    inViewport: rect.top >= -10 && rect.top < vh,
  };
}

/**
 * Check if a trigger's aria-expanded or aria-selected changed to "true".
 * Runs inside page.evaluate().
 * @param {string} triggerSelector - CSS selector of the trigger element
 * @returns {Object} Current ARIA state of the trigger
 */
function snippetVerifyAriaStateChange(triggerSelector) {
  const el = document.querySelector(triggerSelector);
  if (!el) return { found: false };
  return {
    found: true,
    ariaExpanded: el.getAttribute('aria-expanded'),
    ariaSelected: el.getAttribute('aria-selected'),
  };
}

/**
 * Promise verification — clicks detected interactive patterns and verifies
 * strictly measurable outcomes. Mobile menu probed at mobile viewport.
 * Max 8 verifications total.
 * @param {Object} bundle - Evidence bundle to write interactivePromises into
 * @param {import('playwright-core').Page} page - Playwright page
 * @param {import('playwright-core').BrowserContext} context - Playwright browser context
 */
async function collectPromiseVerification(bundle, page, context, isBudgetExhausted, config) {
  if (!isBudgetExhausted) isBudgetExhausted = () => false;
  const detected = await page.evaluate(snippetDetectPromises);
  if (!detected || detected.length === 0) {
    bundle.interactivePromises = { detected: [], results: [] };
    return;
  }

  // Upgrade ad-hoc selectors using the ref map when available.
  // snippetDetectPromises runs in page.evaluate (no bundle access), so it builds
  // its own selectors. Cross-reference against the ref map for better uniqueness.
  // Only upgrade on strong matches — exact selector or unique ariaControls.
  // Text matching is too ambiguous on pages with repeated labels like "Read more".
  if (bundle.interactiveElements && Array.isArray(bundle.interactiveElements)) {
    for (const probe of detected) {
      // Priority 1: exact selector match
      let match = bundle.interactiveElements.find(ref => ref.selector === probe.triggerSelector);
      // Priority 2: unique ariaControls match (e.g. button controlling "mobile-nav")
      if (!match && probe.targetSelector) {
        const targetId = probe.targetSelector.startsWith('#') ? probe.targetSelector.slice(1) : null;
        if (targetId) {
          const controlsMatches = bundle.interactiveElements.filter(ref => ref.ariaControls === targetId);
          if (controlsMatches.length === 1) match = controlsMatches[0];
        }
      }
      // Do NOT fall back to text matching — too many false positives on repeated labels
      if (match) {
        probe.triggerSelector = match.selector;
        probe._refMapMatch = match.ref;
      }
    }
  }

  // Thread container selector into each probe so anchor verification can check it
  const cs = bundle.scroll?.containerSelector || null;
  for (const probe of detected) {
    probe._containerSelector = cs;
  }

  // Only verify high/medium confidence, cap at 8 total
  const toVerify = detected.filter(d => d.confidence !== 'low').slice(0, config?.maxPromises || 8);

  bundle.interactivePromises = {
    detected,
    results: [],
  };

  // Group by viewport
  const desktopProbes = toVerify.filter(d => d.viewport === 'desktop');
  const mobileProbes = toVerify.filter(d => d.viewport === 'mobile');

  // ── Desktop probes first ──
  for (const probe of desktopProbes) {
    if (isBudgetExhausted()) break;
    await resetProbeState(page, cs);
    const result = await verifyProbe(probe, page);
    bundle.interactivePromises.results.push(result);
  }

  // ── Mobile probes (switch viewport, guaranteed restore via try/finally) ──
  if (mobileProbes.length > 0 && !isBudgetExhausted()) {
    try {
      await page.setViewportSize(VIEWPORTS.mobile);
      await page.waitForTimeout(600); // Responsive reflow + media query transitions

      for (const probe of mobileProbes) {
        if (isBudgetExhausted()) break;
        await resetProbeState(page, cs);
        const result = await verifyProbe(probe, page);
        bundle.interactivePromises.results.push(result);
      }
    } finally {
      // Always restore desktop viewport — even if probes throw
      try {
        await page.setViewportSize(VIEWPORTS.desktop);
        await page.waitForTimeout(400);
      } catch { /* page may be gone — best effort */ }
    }
  }
}

/**
 * Check if an element is visible, has non-zero dimensions, and isn't covered.
 * Runs inside page.evaluate(). Returns false if the element can't be clicked.
 */
function snippetIsClickable(selector) {
  const el = document.querySelector(selector);
  if (!el) return { clickable: false, reason: 'not found' };
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return { clickable: false, reason: 'zero dimensions' };
  const style = getComputedStyle(el);
  if (style.display === 'none') return { clickable: false, reason: 'display:none' };
  if (style.visibility === 'hidden') return { clickable: false, reason: 'visibility:hidden' };
  if (parseFloat(style.opacity) === 0) return { clickable: false, reason: 'opacity:0' };
  // Check if the center of the element is covered by another element
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const topEl = document.elementFromPoint(cx, cy);
  if (topEl && topEl !== el && !el.contains(topEl) && !topEl.contains(el)) {
    return { clickable: false, reason: 'covered by ' + topEl.tagName.toLowerCase() };
  }
  return { clickable: true };
}

/**
 * Verify a single interactive probe. Returns strictly measurable pass/fail.
 * Each pattern type has its own verification logic with binary DOM/style checks.
 * Pre-checks element visibility before clicking to avoid false timeout failures.
 * @param {Object} probe - Detected promise pattern from snippetDetectPromises
 * @param {import('playwright-core').Page} page - Playwright page
 * @returns {Promise<Object>} Verification result with passed boolean and evidence
 */
/**
 * Click an element using the most resilient strategy available.
 * Tries getByRole (Expect-style, accessible name matching) first,
 * then falls back to CSS selector. This avoids the CSS.escape
 * fragility that causes false timeout failures on complex sites.
 */
/**
 * Check if a CSS selector resolves to exactly one visible element.
 * Used by resilientClick to avoid ambiguous clicks.
 */
function snippetResolveSelectorUniqueness(selector) {
  const matches = document.querySelectorAll(selector);
  if (matches.length === 0) return { count: 0 };
  if (matches.length > 1) return { count: matches.length };
  const el = matches[0];
  const rect = el.getBoundingClientRect();
  const style = getComputedStyle(el);
  const visible = style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
  return { count: 1, visible };
}

async function resilientClick(page, selector, role, name) {
  // Strategy 1: Role-based locator (Expect-style, most resilient)
  if (role && name) {
    try {
      const locator = page.getByRole(role, { name, exact: true });
      const count = await locator.count();
      if (count === 1) {
        await locator.click({ timeout: 3000 });
        await page.waitForTimeout(500);
        return { ok: true, strategy: 'role' };
      }
      // Multiple matches — role+name isn't unique, skip this strategy
    } catch { /* fall through */ }
  }

  // Strategy 2: CSS selector — but only if it resolves to exactly one visible element
  try {
    const resolution = await page.evaluate(snippetResolveSelectorUniqueness, selector);
    if (resolution && resolution.count === 0) return { ok: false, error: 'selector matched 0 elements', strategy: 'skipped' };
    if (resolution && resolution.count > 1) return { ok: false, error: 'selector matched ' + resolution.count + ' elements (ambiguous)', strategy: 'skipped' };
    if (resolution && resolution.count === 1 && !resolution.visible) return { ok: false, error: 'element not visible', strategy: 'skipped' };
  } catch { /* pre-check failed — proceed to click and let it fail naturally */ }

  const cssResult = await actionClick(page, selector);
  // If the click timed out despite passing uniqueness + visibility checks,
  // classify as skipped — the element exists and looks clickable but the browser
  // couldn't interact with it (JS interception, pointer-events, transparent overlay).
  // A timeout is a resolution failure, not a behavioral failure.
  if (!cssResult.ok && cssResult.error?.includes('Timeout')) {
    return { ok: false, error: 'click timed out on unique visible element', strategy: 'skipped' };
  }
  return { ...cssResult, strategy: 'css' };
}

async function verifyProbe(probe, page) {
  const result = {
    pattern: probe.pattern,
    triggerSelector: probe.triggerSelector,
    targetSelector: probe.targetSelector,
    viewport: probe.viewport,
    confidence: probe.confidence,
    action: 'click',
    expected: null,
    actual: null,
    passed: false,
  };

  // Pre-click visibility check — skip the probe entirely if the trigger
  // isn't visible/clickable. This prevents false timeout failures on elements
  // that are hidden behind overlays, inside collapsed navs, or off-screen.
  if (probe.pattern !== 'anchor-link' || probe.targetExists) {
    try {
      const clickable = await page.evaluate(snippetIsClickable, probe.triggerSelector);
      if (!clickable.clickable) {
        result.actual = 'trigger not clickable: ' + clickable.reason;
        result.action = 'skipped (not clickable)';
        return result;
      }
    } catch { /* if the check itself fails, proceed to the click and let it fail naturally */ }
  }

  try {
    switch (probe.pattern) {
      case 'mobile-menu': {
        result.expected = 'target nav becomes visible with at least one visible link';

        // Capture before state
        const before = await page.evaluate(snippetVerifyVisibilityChange, probe.targetSelector);

        // Click the trigger — role-based for buttons with aria-label
        const clickResult = await resilientClick(page, probe.triggerSelector, 'button', null);
        if (!clickResult.ok) {
          if (clickResult.strategy === 'skipped') {
            result.actual = 'trigger unresolvable: ' + clickResult.error;
            result.action = 'skipped (ambiguous selector)';
            return result;
          }
          result.actual = 'click failed: ' + clickResult.error;
          return result;
        }

        // Check after state
        const after = await page.evaluate(snippetVerifyVisibilityChange, probe.targetSelector);
        if (!after.found) {
          result.actual = 'target element not found';
          return result;
        }

        // PASS: display changed from none OR visibility changed OR height grew, AND visible links > 0
        const displayChanged = before.display === 'none' && after.display !== 'none';
        const visibilityChanged = before.visibility === 'hidden' && after.visibility !== 'hidden';
        const heightGrew = before.height === 0 && after.height > 0;
        const hasVisibleLinks = after.visibleLinks > 0;

        result.passed = (displayChanged || visibilityChanged || heightGrew) && hasVisibleLinks;
        result.actual = result.passed
          ? 'nav visible with ' + after.visibleLinks + ' links'
          : 'no visibility change (display: ' + after.display + ', height: ' + after.height + ', links: ' + after.visibleLinks + ')';
        break;
      }

      case 'anchor-link': {
        if (!probe.targetExists) {
          result.expected = 'target element exists';
          result.actual = 'target #' + probe.targetSelector + ' not found in document';
          result.passed = false;
          result.action = 'none (broken anchor)';
          return result;
        }

        result.expected = 'page scrolls to target element';

        // Record scroll position and URL before click (check container scroll for SPAs)
        const beforeY = await page.evaluate((cs) => {
          let y = Math.round(window.scrollY);
          if (cs) {
            const container = document.querySelector(cs);
            if (container) y = Math.max(y, Math.round(container.scrollTop));
          }
          return y;
        }, probe._containerSelector || null);
        const beforeUrl = page.url();

        // Click the anchor link — role-based first, CSS selector fallback.
        // If the trigger can't be resolved uniquely, skip (not fail).
        const clickResult = await resilientClick(page, probe.triggerSelector, 'link', probe.text);
        if (!clickResult.ok) {
          if (clickResult.strategy === 'skipped') {
            result.actual = 'trigger unresolvable: ' + clickResult.error;
            result.action = 'skipped (ambiguous selector)';
            return result;
          }
          result.actual = 'click failed: ' + clickResult.error;
          return result;
        }

        // Check if the click triggered a real navigation (SPA router hijack)
        const afterUrl = page.url();
        const beforePath = new URL(beforeUrl).pathname;
        const afterPath = new URL(afterUrl).pathname;
        if (beforePath !== afterPath) {
          result.actual = 'anchor click triggered navigation (' + afterPath + '), skipping';
          result.action = 'skipped (navigation detected)';
          // Navigate back to avoid poisoning subsequent probes
          try { await page.goBack({ timeout: 3000 }); } catch { /* best effort */ }
          return result;
        }

        // Wait for smooth scroll to finish — most CSS smooth-scroll takes 500-800ms
        await page.waitForTimeout(800);

        // Check if scroll happened and target is near viewport top
        // Pass containerSelector for SPA apps that scroll inside a container
        const jumpCheck = await page.evaluate(snippetVerifyAnchorJump, [probe.targetSelector, probe._containerSelector || null]);
        if (!jumpCheck.found) {
          result.actual = 'target element not found after click';
          return result;
        }

        const scrolledEnough = Math.abs(jumpCheck.scrollY - beforeY) >= 50;
        const targetInViewport = jumpCheck.inViewport;

        result.passed = scrolledEnough && targetInViewport;
        result.actual = result.passed
          ? 'scrolled to target (scrollY: ' + jumpCheck.scrollY + ', targetTop: ' + jumpCheck.targetTop + ')'
          : 'scroll insufficient (scrollY delta: ' + Math.abs(jumpCheck.scrollY - beforeY) + ', targetTop: ' + jumpCheck.targetTop + ')';
        break;
      }

      case 'tabs': {
        result.expected = 'aria-selected changes and target panel visibility changes';

        // Capture BEFORE state — needed to detect actual change, not just current state
        const tabsBefore = await page.evaluate(snippetVerifyAriaStateChange, probe.triggerSelector);
        let panelBefore = null;
        if (probe.targetSelector) {
          panelBefore = await page.evaluate(snippetVerifyVisibilityChange, probe.targetSelector);
        }

        // Click the non-selected tab — role-based targeting is more reliable
        const clickResult = await resilientClick(page, probe.triggerSelector, 'tab', probe.text || null);
        if (!clickResult.ok) {
          if (clickResult.strategy === 'skipped') {
            result.actual = 'trigger unresolvable: ' + clickResult.error;
            result.action = 'skipped (ambiguous selector)';
            return result;
          }
          result.actual = 'click failed: ' + clickResult.error;
          return result;
        }

        // Check AFTER state and diff against before
        const tabsAfter = await page.evaluate(snippetVerifyAriaStateChange, probe.triggerSelector);
        const ariaSelectedChanged = tabsBefore.found && tabsAfter.found
          && tabsBefore.ariaSelected !== 'true' && tabsAfter.ariaSelected === 'true';
        const ariaExpandedChanged = tabsBefore.found && tabsAfter.found
          && tabsBefore.ariaExpanded !== 'true' && tabsAfter.ariaExpanded === 'true';
        const ariaChanged = ariaSelectedChanged || ariaExpandedChanged;

        let panelBecameVisible = false;
        if (probe.targetSelector && panelBefore) {
          const panelAfter = await page.evaluate(snippetVerifyVisibilityChange, probe.targetSelector);
          panelBecameVisible = panelAfter.found && panelAfter.visible && !panelBefore.visible;
        }

        result.passed = ariaChanged || panelBecameVisible;
        result.actual = result.passed
          ? 'tab activated (aria changed: ' + ariaChanged + ', panel became visible: ' + panelBecameVisible + ')'
          : 'no state change after click (aria-selected: ' + (tabsAfter.ariaSelected) + ', was: ' + (tabsBefore.ariaSelected) + ')';
        break;
      }

      case 'accordion': {
        result.expected = 'aria-expanded changes from false to true and content becomes visible';

        // Capture BEFORE state
        const accBefore = await page.evaluate(snippetVerifyAriaStateChange, probe.triggerSelector);
        let contentBefore = null;
        if (probe.targetSelector) {
          contentBefore = await page.evaluate(snippetVerifyVisibilityChange, probe.targetSelector);
        }

        // Click the accordion trigger — role-based with button role
        const clickResult = await resilientClick(page, probe.triggerSelector, 'button', probe.text || null);
        if (!clickResult.ok) {
          if (clickResult.strategy === 'skipped') {
            result.actual = 'trigger unresolvable: ' + clickResult.error;
            result.action = 'skipped (ambiguous selector)';
            return result;
          }
          result.actual = 'click failed: ' + clickResult.error;
          return result;
        }

        // Check AFTER state and diff
        const accAfter = await page.evaluate(snippetVerifyAriaStateChange, probe.triggerSelector);
        const expandedChanged = accBefore.found && accAfter.found
          && accBefore.ariaExpanded !== 'true' && accAfter.ariaExpanded === 'true';

        let contentBecameVisible = false;
        if (probe.targetSelector && contentBefore) {
          const contentAfter = await page.evaluate(snippetVerifyVisibilityChange, probe.targetSelector);
          contentBecameVisible = contentAfter.found
            && (contentAfter.visible || contentAfter.height > 0)
            && (!contentBefore.visible || contentBefore.height === 0);
        }

        result.passed = expandedChanged || contentBecameVisible;
        result.actual = result.passed
          ? 'accordion expanded (aria-expanded: ' + accBefore.ariaExpanded + ' → ' + accAfter.ariaExpanded + ', content visible: ' + contentBecameVisible + ')'
          : 'no state change (aria-expanded: ' + (accAfter.found ? accBefore.ariaExpanded + ' → ' + accAfter.ariaExpanded : 'not found') + ')';
        break;
      }

      default:
        result.actual = 'unknown pattern: ' + probe.pattern;
    }
  } catch (err) {
    result.actual = 'error: ' + err.message;
  }

  return result;
}

module.exports = {
  runBrowserCommand,
  detectBrowserRuntime,
  collectEvidence,
  collectSourcePatterns,
  __testHooks: {
    buildConfig,
    makeEmptyBundle,
    validateTargetUrl,
    defaultCollectDeps,
    safeStep,
    snippetBuildRefMap,
    snippetResolveRef,
    snippetCaptureStyles,
    actionHover,
    actionClick,
    actionTab,
    actionEscape,
    actionScrollToFold,
    captureBeforeAfter,
    resetProbeState,
    resetBetweenPasses,
    withPassBudget,
    snippetPageDimensions,
    snippetStickyElements,
    snippetImageSrcs,
    collectScrollPass,
    collectHoverPass,
    collectFocusPass,
    snippetFocusIndicator,
    snippetNonSemanticClickables,
    snippetDetectPromises,
    snippetVerifyVisibilityChange,
    snippetVerifyAnchorJump,
    snippetVerifyAriaStateChange,
    collectPromiseVerification,
    verifyProbe,
    snippetIsClickable,
    snippetResolveSelectorUniqueness,
    resilientClick,
    SCROLL_PASS_BUDGET_MS,
    HOVER_PASS_BUDGET_MS,
    FOCUS_PASS_BUDGET_MS,
    PROMISE_PASS_BUDGET_MS,
    DEFAULT_CAPTURE_PROPS,
  },
};
