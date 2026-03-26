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
      multiViewport: false
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
    sourcePatterns: []
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

async function withTotalTimeout(run) {
  return await Promise.race([
    run(),
    new Promise((_, reject) => setTimeout(() => reject(new Error(`Browser command timed out after ${TOTAL_TIMEOUT_MS}ms`)), TOTAL_TIMEOUT_MS))
  ]);
}

async function safeStep(bundle, flagKeys, fn, fallback = null) {
  try {
    const result = await fn();
    if (Array.isArray(flagKeys)) {
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

async function collectEvidence(args, deps = {}) {
  const runtimeDeps = { ...defaultCollectDeps(), ...deps };
  const root = resolveExistingDir(path.resolve(args.cwd || process.cwd(), args.root || '.'));
  const outPath = args.out ? path.resolve(args.cwd || process.cwd(), args.out) : defaultOutPath();
  if (!args.url) throw new Error('--url is required');
  const requestedUrl = String(args.url).trim();
  const navigationUrl = validateTargetUrl(requestedUrl);

  ensureDir(path.dirname(outPath));
  const bundle = makeEmptyBundle(requestedUrl, args.root ? root : null);
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

    try {
      await page.goto(navigationUrl, { waitUntil: 'domcontentloaded', timeout: NAVIGATION_TIMEOUT_MS });
      try {
        await page.waitForLoadState('networkidle', { timeout: 3000 });
      } catch {
        // Network idle is a bonus, not a hard requirement.
      }
      bundle.title = await safeStep(bundle, [], () => page.title(), null);

      await collectDesktop(bundle, page, root, requestedUrl, stamp);
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
      timing: { totalTimeoutMs: TOTAL_TIMEOUT_MS },
      collected: bundle.confidence
    };
  });
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

module.exports = {
  runBrowserCommand,
  detectBrowserRuntime,
  collectEvidence,
  collectSourcePatterns,
  __testHooks: {
    makeEmptyBundle,
    validateTargetUrl,
    defaultCollectDeps,
  },
};
