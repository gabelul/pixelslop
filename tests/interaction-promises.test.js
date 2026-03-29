/**
 * Interaction Promise Verification tests.
 *
 * Exercises Phase 3: detection of interactive promises (mobile menu, anchor links,
 * tabs, accordion) and their strictly-measurable verification probes.
 * All tests run against mock page objects — no real browser needed.
 *
 * Run: node --test tests/interaction-promises.test.js
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { __testHooks } = require('../bin/pixelslop-browser.cjs');

const {
  makeEmptyBundle,
  snippetDetectPromises,
  snippetVerifyVisibilityChange,
  snippetVerifyAnchorJump,
  snippetVerifyAriaStateChange,
  collectPromiseVerification,
  verifyProbe,
  resetProbeState,
  actionClick,
  PROMISE_PASS_BUDGET_MS,
} = __testHooks;

// ─────────────────────────────────────────────
// Mock page factory — tailored for promise testing
// ─────────────────────────────────────────────

/**
 * Build a mock Playwright page with configurable evaluate responses.
 * @param {object} overrides - Method overrides
 * @returns {object} Mock page
 */
function makeMockPage(overrides = {}) {
  // Wrap evaluate to auto-handle snippetIsClickable calls
  const rawEvaluate = overrides.evaluate || (async () => null);
  const wrappedEvaluate = async (fn, ...args) => {
    if (fn && fn.name === 'snippetIsClickable') return { clickable: true };
    if (fn && fn.name === 'snippetResolveSelectorUniqueness') return { count: 1, visible: true };
    return rawEvaluate(fn, ...args);
  };
  // Mock getByRole returns a locator with count() and click()
  // Default: 1 match, click succeeds (so resilientClick uses role strategy)
  const defaultGetByRole = () => ({
    count: async () => 1,
    click: async () => {},
  });

  return {
    hover: overrides.hover || (async () => { throw new Error('hover: not wired'); }),
    click: overrides.click || (async () => {}),
    keyboard: overrides.keyboard || { press: async () => {} },
    mouse: overrides.mouse || { move: async () => {} },
    evaluate: wrappedEvaluate,
    waitForTimeout: overrides.waitForTimeout || (async () => {}),
    setViewportSize: overrides.setViewportSize || (async () => {}),
    url: overrides.url || (() => 'http://localhost:8888/test'),
    goBack: overrides.goBack || (async () => {}),
    getByRole: overrides.getByRole || defaultGetByRole,
  };
}

// ─────────────────────────────────────────────
// Export verification — all Phase 3 functions exist
// ─────────────────────────────────────────────

describe('Phase 3 exports', () => {
  it('snippetDetectPromises is exported as a function', () => {
    assert.equal(typeof snippetDetectPromises, 'function');
  });

  it('snippetVerifyVisibilityChange is exported as a function', () => {
    assert.equal(typeof snippetVerifyVisibilityChange, 'function');
  });

  it('snippetVerifyAnchorJump is exported as a function', () => {
    assert.equal(typeof snippetVerifyAnchorJump, 'function');
  });

  it('snippetVerifyAriaStateChange is exported as a function', () => {
    assert.equal(typeof snippetVerifyAriaStateChange, 'function');
  });

  it('collectPromiseVerification is exported as a function', () => {
    assert.equal(typeof collectPromiseVerification, 'function');
  });

  it('verifyProbe is exported as a function', () => {
    assert.equal(typeof verifyProbe, 'function');
  });

  it('PROMISE_PASS_BUDGET_MS is 12000', () => {
    assert.equal(PROMISE_PASS_BUDGET_MS, 12000);
  });
});

// ─────────────────────────────────────────────
// Bundle schema — interactivePromises field
// ─────────────────────────────────────────────

describe('bundle.interactivePromises schema', () => {
  it('makeEmptyBundle has interactivePromises: null by default', () => {
    const bundle = makeEmptyBundle('http://test.local', null);
    assert.equal(bundle.interactivePromises, null);
  });

  it('makeEmptyBundle has confidence.interactivePromises: false by default', () => {
    const bundle = makeEmptyBundle('http://test.local', null);
    assert.equal(bundle.confidence.interactivePromises, false);
  });
});

// ─────────────────────────────────────────────
// snippetDetectPromises — function body checks
// ─────────────────────────────────────────────

describe('snippetDetectPromises', () => {
  it('is serializable for page.evaluate', () => {
    const src = snippetDetectPromises.toString();
    assert.ok(src.includes('function'), 'should be a serializable function');
  });

  it('detects mobile-menu pattern in its body', () => {
    const src = snippetDetectPromises.toString();
    assert.ok(src.includes("'mobile-menu'"), 'should detect mobile-menu');
  });

  it('detects anchor-link pattern in its body', () => {
    const src = snippetDetectPromises.toString();
    assert.ok(src.includes("'anchor-link'"), 'should detect anchor-link');
  });

  it('detects tabs pattern in its body', () => {
    const src = snippetDetectPromises.toString();
    assert.ok(src.includes("'tabs'"), 'should detect tabs');
  });

  it('detects accordion pattern in its body', () => {
    const src = snippetDetectPromises.toString();
    assert.ok(src.includes("'accordion'"), 'should detect accordion');
  });

  it('requires 2+ signals for mobile menu (conservative)', () => {
    const src = snippetDetectPromises.toString();
    assert.ok(src.includes('signals >= 2'), 'should require 2+ signals');
  });

  it('caps accordion probes at 3', () => {
    const src = snippetDetectPromises.toString();
    assert.ok(src.includes('>= 3'), 'should cap accordion detection');
  });

  it('skips empty anchors (# and #!)', () => {
    const src = snippetDetectPromises.toString();
    assert.ok(src.includes("'#!'"), 'should skip #! anchors');
    assert.ok(src.includes("'#'"), 'should skip # anchors');
  });
});

// ─────────────────────────────────────────────
// snippetVerifyVisibilityChange — function body checks
// ─────────────────────────────────────────────

describe('snippetVerifyVisibilityChange', () => {
  it('is serializable for page.evaluate', () => {
    const src = snippetVerifyVisibilityChange.toString();
    assert.ok(src.includes('getComputedStyle'), 'uses computed style');
    assert.ok(src.includes('visibleLinks'), 'counts visible links');
  });

  it('returns found: false shape when element missing', () => {
    // Can't run in browser, but verify the logic path exists
    const src = snippetVerifyVisibilityChange.toString();
    assert.ok(src.includes('found: false'), 'has not-found path');
  });
});

// ─────────────────────────────────────────────
// snippetVerifyAnchorJump — function body checks
// ─────────────────────────────────────────────

describe('snippetVerifyAnchorJump', () => {
  it('checks scrollY and target position', () => {
    const src = snippetVerifyAnchorJump.toString();
    assert.ok(src.includes('scrollY'), 'checks scroll position');
    assert.ok(src.includes('inViewport'), 'checks viewport position');
  });

  it('uses -10px tolerance for near-viewport elements', () => {
    const src = snippetVerifyAnchorJump.toString();
    assert.ok(src.includes('-10'), 'has negative tolerance');
  });
});

// ─────────────────────────────────────────────
// snippetVerifyAriaStateChange — function body checks
// ─────────────────────────────────────────────

describe('snippetVerifyAriaStateChange', () => {
  it('reads aria-expanded and aria-selected', () => {
    const src = snippetVerifyAriaStateChange.toString();
    assert.ok(src.includes('aria-expanded'), 'reads aria-expanded');
    assert.ok(src.includes('aria-selected'), 'reads aria-selected');
  });
});

// ─────────────────────────────────────────────
// collectPromiseVerification — integration with mock page
// ─────────────────────────────────────────────

describe('collectPromiseVerification', () => {
  it('handles null detected array gracefully', async () => {
    const bundle = makeEmptyBundle('http://test.local', null);
    const page = makeMockPage({
      evaluate: async () => null,
    });
    await collectPromiseVerification(bundle, page, {});
    assert.deepStrictEqual(bundle.interactivePromises, { detected: [], results: [] });
  });

  it('handles empty detected array gracefully', async () => {
    const bundle = makeEmptyBundle('http://test.local', null);
    const page = makeMockPage({
      evaluate: async () => [],
    });
    await collectPromiseVerification(bundle, page, {});
    assert.deepStrictEqual(bundle.interactivePromises, { detected: [], results: [] });
  });

  it('stores detected patterns in bundle.interactivePromises.detected', async () => {
    const fakeDetected = [
      { pattern: 'anchor-link', triggerSelector: 'a[href="#foo"]', targetSelector: '#foo', confidence: 'high', viewport: 'desktop', targetExists: true, text: 'Foo' }
    ];
    let callCount = 0;
    const page = makeMockPage({
      evaluate: async (fn, ...args) => {
        callCount++;
        // First call is snippetDetectPromises
        if (callCount === 1) return fakeDetected;
        // Subsequent calls are verification snippets — return scroll data
        if (typeof args[0] === 'undefined') return 0; // beforeY
        return { found: true, scrollY: 500, targetTop: 10, inViewport: true };
      },
      click: async () => {},
    });

    const bundle = makeEmptyBundle('http://test.local', null);
    await collectPromiseVerification(bundle, page, {});
    assert.equal(bundle.interactivePromises.detected.length, 1);
    assert.equal(bundle.interactivePromises.detected[0].pattern, 'anchor-link');
  });

  it('switches to mobile viewport for mobile probes and restores desktop', async () => {
    const viewportCalls = [];
    const fakeDetected = [
      { pattern: 'mobile-menu', triggerSelector: '#menu-btn', targetSelector: '#nav', confidence: 'high', viewport: 'mobile', ariaExpanded: 'false' }
    ];

    const page = makeMockPage({
      evaluate: async (fn, ...args) => {
        // snippetDetectPromises
        if (!args || args.length === 0) return fakeDetected;
        // snippetVerifyVisibilityChange before/after
        return { found: true, selector: '#nav', display: 'none', visibility: 'visible', height: 0, width: 0, visible: false, visibleLinks: 0 };
      },
      click: async () => {},
      setViewportSize: async (vp) => { viewportCalls.push(vp); },
    });

    const bundle = makeEmptyBundle('http://test.local', null);
    await collectPromiseVerification(bundle, page, {});

    // Should have switched to mobile then back to desktop
    assert.ok(viewportCalls.length >= 2, 'should switch viewports at least twice');
    assert.deepStrictEqual(viewportCalls[0], { width: 375, height: 812 }, 'first switch to mobile');
    assert.deepStrictEqual(viewportCalls[viewportCalls.length - 1], { width: 1440, height: 900 }, 'last switch back to desktop');
  });

  it('caps total verifications at 8', async () => {
    // Create 12 anchor links — only 8 should be verified
    const fakeDetected = Array.from({ length: 12 }, (_, i) => ({
      pattern: 'anchor-link',
      triggerSelector: `a[href="#s${i}"]`,
      targetSelector: `#s${i}`,
      confidence: 'high',
      viewport: 'desktop',
      targetExists: true,
      text: `Section ${i}`,
    }));

    let evalCount = 0;
    const page = makeMockPage({
      evaluate: async (fn, ...args) => {
        evalCount++;
        if (evalCount === 1) return fakeDetected;
        // Return scrollY = 0 for beforeY, then successful jump
        if (typeof args[0] === 'undefined') return 0;
        return { found: true, scrollY: 500, targetTop: 10, inViewport: true };
      },
      click: async () => {},
    });

    const bundle = makeEmptyBundle('http://test.local', null);
    await collectPromiseVerification(bundle, page, {});
    assert.ok(bundle.interactivePromises.results.length <= 8, 'should cap at 8 verifications');
  });

  it('filters out low confidence detections', async () => {
    const fakeDetected = [
      { pattern: 'anchor-link', triggerSelector: 'a[href="#a"]', targetSelector: null, confidence: 'low', viewport: 'desktop', targetExists: false, text: 'Low' },
      { pattern: 'anchor-link', triggerSelector: 'a[href="#b"]', targetSelector: '#b', confidence: 'high', viewport: 'desktop', targetExists: true, text: 'High' },
    ];

    let evalCount = 0;
    const page = makeMockPage({
      evaluate: async (fn, ...args) => {
        evalCount++;
        if (evalCount === 1) return fakeDetected;
        if (typeof args[0] === 'undefined') return 0;
        return { found: true, scrollY: 500, targetTop: 10, inViewport: true };
      },
      click: async () => {},
    });

    const bundle = makeEmptyBundle('http://test.local', null);
    await collectPromiseVerification(bundle, page, {});
    // Only the high-confidence one should be verified
    assert.equal(bundle.interactivePromises.results.length, 1);
    assert.equal(bundle.interactivePromises.results[0].confidence, 'high');
  });

  it('passes containerSelector into resetProbeState between promise probes', async () => {
    const fakeDetected = [
      { pattern: 'anchor-link', triggerSelector: 'a[href="#one"]', targetSelector: '#one', confidence: 'high', viewport: 'desktop', targetExists: true, text: 'One' },
      { pattern: 'anchor-link', triggerSelector: 'a[href="#two"]', targetSelector: '#two', confidence: 'high', viewport: 'desktop', targetExists: true, text: 'Two' },
    ];
    const bundle = makeEmptyBundle('http://test.local', null);
    bundle.scroll = { containerSelector: '#app' };

    let resetCallsWithContainer = 0;
    const page = makeMockPage({
      evaluate: async (fn, ...args) => {
        if (fn === snippetDetectPromises) return fakeDetected;
        const src = fn.toString();
        if (src.includes('window.scrollTo(0, 0)') && args[0] === '#app') {
          resetCallsWithContainer++;
          return undefined;
        }
        if (src.includes('let y = Math.round(window.scrollY)')) return 0;
        if (fn === snippetVerifyAnchorJump) return { found: true, scrollY: 400, targetTop: 10, inViewport: true };
        return null;
      },
      click: async () => {},
    });

    await collectPromiseVerification(bundle, page, {});
    assert.equal(resetCallsWithContainer, 2, 'each desktop probe should reset the container scroll state');
  });
});

// ─────────────────────────────────────────────
// verifyProbe — result shape per pattern type
// ─────────────────────────────────────────────

describe('verifyProbe result shape', () => {
  const RESULT_KEYS = ['pattern', 'triggerSelector', 'targetSelector', 'viewport', 'confidence', 'action', 'expected', 'actual', 'passed'];

  it('returns correct shape for mobile-menu with click failure', async () => {
    const probe = { pattern: 'mobile-menu', triggerSelector: '#btn', targetSelector: '#nav', viewport: 'mobile', confidence: 'high', ariaExpanded: 'false' };
    const page = makeMockPage({
      evaluate: async () => ({ found: true, selector: '#nav', display: 'none', visibility: 'visible', height: 0, width: 0, visible: false, visibleLinks: 0 }),
      click: async () => { throw new Error('timeout'); },
      getByRole: () => ({ count: async () => 0, click: async () => { throw new Error('not found'); } }),
    });

    const result = await verifyProbe(probe, page);
    for (const key of RESULT_KEYS) {
      assert.ok(key in result, `result should have "${key}" field`);
    }
    assert.equal(result.pattern, 'mobile-menu');
    assert.equal(result.passed, false);
    assert.ok(result.actual.includes('click failed'), 'should report click failure');
  });

  it('returns correct shape for mobile-menu with successful open', async () => {
    const probe = { pattern: 'mobile-menu', triggerSelector: '#btn', targetSelector: '#nav', viewport: 'mobile', confidence: 'high', ariaExpanded: 'false' };
    let callNum = 0;
    const page = makeMockPage({
      evaluate: async () => {
        callNum++;
        // Before state: hidden nav
        if (callNum === 1) return { found: true, selector: '#nav', display: 'none', visibility: 'visible', height: 0, width: 375, visible: false, visibleLinks: 0 };
        // After state: visible nav with links
        return { found: true, selector: '#nav', display: 'block', visibility: 'visible', height: 400, width: 375, visible: true, visibleLinks: 5 };
      },
      click: async () => {},
    });

    const result = await verifyProbe(probe, page);
    assert.equal(result.passed, true);
    assert.ok(result.actual.includes('5 links'), 'should report visible links');
  });

  it('returns correct shape for anchor-link with broken target', async () => {
    const probe = { pattern: 'anchor-link', triggerSelector: 'a[href="#missing"]', targetSelector: null, viewport: 'desktop', confidence: 'medium', targetExists: false, text: 'Missing' };
    const page = makeMockPage();

    const result = await verifyProbe(probe, page);
    for (const key of RESULT_KEYS) {
      assert.ok(key in result, `result should have "${key}" field`);
    }
    assert.equal(result.pattern, 'anchor-link');
    assert.equal(result.passed, false);
    assert.equal(result.action, 'none (broken anchor)');
    assert.ok(result.actual.includes('not found'), 'should report broken anchor');
  });

  it('returns correct shape for anchor-link with successful scroll', async () => {
    const probe = { pattern: 'anchor-link', triggerSelector: 'a[href="#about"]', targetSelector: '#about', viewport: 'desktop', confidence: 'high', targetExists: true, text: 'About' };
    let callNum = 0;
    const page = makeMockPage({
      evaluate: async () => {
        callNum++;
        // beforeY
        if (callNum === 1) return 0;
        // jumpCheck
        return { found: true, scrollY: 800, targetTop: 5, inViewport: true };
      },
      click: async () => {},
    });

    const result = await verifyProbe(probe, page);
    assert.equal(result.passed, true);
    assert.ok(result.actual.includes('scrolled to target'), 'should report successful scroll');
  });

  it('returns correct shape for tabs with aria state change', async () => {
    const probe = { pattern: 'tabs', triggerSelector: '#tab-2', targetSelector: '#panel-2', viewport: 'desktop', confidence: 'high', tabCount: 3 };
    let callNum = 0;
    const page = makeMockPage({
      evaluate: async () => {
        callNum++;
        // 1: before aria state
        if (callNum === 1) return { found: true, ariaExpanded: null, ariaSelected: 'false' };
        // 2: before panel visibility
        if (callNum === 2) return { found: true, display: 'none', visibility: 'hidden', height: 0, width: 0, visible: false, visibleLinks: 0 };
        // 3: after aria state (changed)
        if (callNum === 3) return { found: true, ariaExpanded: null, ariaSelected: 'true' };
        // 4: after panel visibility
        return { found: true, display: 'block', visibility: 'visible', height: 200, width: 600, visible: true, visibleLinks: 0 };
      },
      click: async () => {},
    });

    const result = await verifyProbe(probe, page);
    for (const key of RESULT_KEYS) {
      assert.ok(key in result, `result should have "${key}" field`);
    }
    assert.equal(result.pattern, 'tabs');
    assert.equal(result.passed, true);
    assert.ok(result.actual.includes('tab activated'), 'should report tab activation');
  });

  it('returns correct shape for tabs with no state change', async () => {
    const probe = { pattern: 'tabs', triggerSelector: '#tab-2', targetSelector: '#panel-2', viewport: 'desktop', confidence: 'high', tabCount: 3 };
    const page = makeMockPage({
      evaluate: async () => ({ found: true, ariaExpanded: null, ariaSelected: 'false', display: 'none', visibility: 'hidden', height: 0, width: 0, visible: false, visibleLinks: 0 }),
      click: async () => {},
    });

    const result = await verifyProbe(probe, page);
    assert.equal(result.passed, false);
    assert.ok(result.actual.includes('no state change'), 'should report failure');
  });

  it('returns correct shape for accordion with expansion', async () => {
    const probe = { pattern: 'accordion', triggerSelector: '#faq-1', targetSelector: '#faq-content-1', viewport: 'desktop', confidence: 'high', ariaExpanded: 'false' };
    let callNum = 0;
    const page = makeMockPage({
      evaluate: async () => {
        callNum++;
        // 1: before aria state
        if (callNum === 1) return { found: true, ariaExpanded: 'false', ariaSelected: null };
        // 2: before content visibility
        if (callNum === 2) return { found: true, display: 'none', visibility: 'hidden', height: 0, width: 0, visible: false, visibleLinks: 0 };
        // 3: after aria state (changed)
        if (callNum === 3) return { found: true, ariaExpanded: 'true', ariaSelected: null };
        // 4: after content visibility
        return { found: true, display: 'block', visibility: 'visible', height: 150, width: 600, visible: true, visibleLinks: 0 };
      },
      click: async () => {},
    });

    const result = await verifyProbe(probe, page);
    for (const key of RESULT_KEYS) {
      assert.ok(key in result, `result should have "${key}" field`);
    }
    assert.equal(result.pattern, 'accordion');
    assert.equal(result.passed, true);
    assert.ok(result.actual.includes('accordion expanded'), 'should report expansion');
  });

  it('returns correct shape for accordion with no state change', async () => {
    const probe = { pattern: 'accordion', triggerSelector: '#faq-1', targetSelector: '#faq-content-1', viewport: 'desktop', confidence: 'high', ariaExpanded: 'false' };
    const page = makeMockPage({
      evaluate: async () => ({ found: true, ariaExpanded: 'false', ariaSelected: null, display: 'none', visibility: 'hidden', height: 0, width: 0, visible: false, visibleLinks: 0 }),
      click: async () => {},
    });

    const result = await verifyProbe(probe, page);
    assert.equal(result.passed, false);
    assert.ok(result.actual.includes('no state change'), 'should report failure');
  });

  it('handles unknown pattern type gracefully', async () => {
    const probe = { pattern: 'carousel', triggerSelector: '#slide', targetSelector: null, viewport: 'desktop', confidence: 'high' };
    const page = makeMockPage();

    const result = await verifyProbe(probe, page);
    assert.equal(result.passed, false);
    assert.ok(result.actual.includes('unknown pattern'), 'should flag unknown patterns');
  });

  it('catches thrown errors without crashing', async () => {
    const probe = { pattern: 'mobile-menu', triggerSelector: '#btn', targetSelector: '#nav', viewport: 'mobile', confidence: 'high', ariaExpanded: 'false' };
    const page = makeMockPage({
      evaluate: async () => { throw new Error('page crashed'); },
    });

    const result = await verifyProbe(probe, page);
    assert.equal(result.passed, false);
    assert.ok(result.actual.includes('error:'), 'should catch and report error');
  });
});

// ─────────────────────────────────────────────
// Mobile menu — target not found after click
// ─────────────────────────────────────────────

describe('mobile menu edge cases', () => {
  it('reports target not found when after-check returns found: false', async () => {
    const probe = { pattern: 'mobile-menu', triggerSelector: '#btn', targetSelector: '#nav', viewport: 'mobile', confidence: 'high', ariaExpanded: 'false' };
    let callNum = 0;
    const page = makeMockPage({
      evaluate: async () => {
        callNum++;
        // Before: element exists but hidden
        if (callNum === 1) return { found: true, display: 'none', visibility: 'visible', height: 0, width: 0, visible: false, visibleLinks: 0 };
        // After: element vanished
        return { found: false, selector: '#nav' };
      },
      click: async () => {},
    });

    const result = await verifyProbe(probe, page);
    assert.equal(result.passed, false);
    assert.ok(result.actual.includes('target element not found'), 'should report missing target');
  });

  it('fails when nav becomes visible but has zero links', async () => {
    const probe = { pattern: 'mobile-menu', triggerSelector: '#btn', targetSelector: '#nav', viewport: 'mobile', confidence: 'high', ariaExpanded: 'false' };
    let callNum = 0;
    const page = makeMockPage({
      evaluate: async () => {
        callNum++;
        if (callNum === 1) return { found: true, display: 'none', visibility: 'visible', height: 0, width: 0, visible: false, visibleLinks: 0 };
        // Visible but no links
        return { found: true, display: 'block', visibility: 'visible', height: 200, width: 375, visible: true, visibleLinks: 0 };
      },
      click: async () => {},
    });

    const result = await verifyProbe(probe, page);
    assert.equal(result.passed, false, 'nav with zero links should fail');
  });
});

// ─────────────────────────────────────────────
// Anchor link — insufficient scroll
// ─────────────────────────────────────────────

describe('anchor link edge cases', () => {
  it('fails when scroll delta is under 50px', async () => {
    const probe = { pattern: 'anchor-link', triggerSelector: 'a[href="#near"]', targetSelector: '#near', viewport: 'desktop', confidence: 'high', targetExists: true, text: 'Near' };
    let callNum = 0;
    const page = makeMockPage({
      evaluate: async () => {
        callNum++;
        if (callNum === 1) return 0; // beforeY
        return { found: true, scrollY: 20, targetTop: 5, inViewport: true }; // barely moved
      },
      click: async () => {},
    });

    const result = await verifyProbe(probe, page);
    assert.equal(result.passed, false, 'should fail with insufficient scroll');
    assert.ok(result.actual.includes('scroll insufficient'));
  });

  it('fails when target is not in viewport after scroll', async () => {
    const probe = { pattern: 'anchor-link', triggerSelector: 'a[href="#far"]', targetSelector: '#far', viewport: 'desktop', confidence: 'high', targetExists: true, text: 'Far' };
    let callNum = 0;
    const page = makeMockPage({
      evaluate: async () => {
        callNum++;
        if (callNum === 1) return 0;
        return { found: true, scrollY: 500, targetTop: 2000, inViewport: false }; // scrolled but target way down
      },
      click: async () => {},
    });

    const result = await verifyProbe(probe, page);
    assert.equal(result.passed, false, 'should fail when target not in viewport');
  });
});

// ─────────────────────────────────────────────
// Viewport restore on error
// ─────────────────────────────────────────────

describe('collectPromiseVerification — viewport restore on error', () => {
  it('restores desktop viewport even when a mobile probe throws', async () => {
    const viewportHistory = [];
    const fakeDetected = [
      { pattern: 'mobile-menu', triggerSelector: '#btn', targetSelector: '#nav', viewport: 'mobile', confidence: 'high', ariaExpanded: 'false' }
    ];

    const page = makeMockPage({
      setViewportSize: async (vp) => { viewportHistory.push({ ...vp }); },
      evaluate: async (fn, ...args) => {
        // snippetDetectPromises — first call returns detected patterns
        if (!args || args.length === 0) return fakeDetected;
        // Mobile probe evaluate throws to simulate a crash
        throw new Error('probe crashed');
      },
      click: async () => {},
    });

    const bundle = makeEmptyBundle('http://test.local', null);
    await collectPromiseVerification(bundle, page, {});

    // The last viewport set should be the desktop restore (1440x900),
    // even though the mobile probe crashed
    assert.ok(viewportHistory.length >= 2, 'should have set viewport at least twice (mobile + desktop restore)');
    const lastViewport = viewportHistory[viewportHistory.length - 1];
    assert.deepStrictEqual(lastViewport, { width: 1440, height: 900 }, 'final viewport should be desktop');
  });

  it('restores desktop viewport when click action throws during mobile probe', async () => {
    const viewportHistory = [];
    const fakeDetected = [
      { pattern: 'mobile-menu', triggerSelector: '#btn', targetSelector: '#nav', viewport: 'mobile', confidence: 'high', ariaExpanded: 'false' }
    ];

    let evalCount = 0;
    const page = makeMockPage({
      setViewportSize: async (vp) => { viewportHistory.push({ ...vp }); },
      evaluate: async (fn, ...args) => {
        evalCount++;
        if (evalCount === 1) return fakeDetected;
        // Return visibility data for before/after checks
        return { found: true, display: 'none', visibility: 'visible', height: 0, width: 0, visible: false, visibleLinks: 0 };
      },
      click: async () => { throw new Error('click exploded'); },
    });

    const bundle = makeEmptyBundle('http://test.local', null);
    await collectPromiseVerification(bundle, page, {});

    const lastViewport = viewportHistory[viewportHistory.length - 1];
    assert.deepStrictEqual(lastViewport, { width: 1440, height: 900 }, 'should restore desktop after click failure');
  });
});

// ─────────────────────────────────────────────
// Anchor navigation detection
// ─────────────────────────────────────────────

describe('verifyProbe — anchor navigation detection', () => {
  it('detects when anchor click triggers real navigation and returns false', async () => {
    let currentUrl = 'http://localhost/page';
    const navigate = () => { currentUrl = 'http://localhost/other-page'; };
    const page = makeMockPage({
      url: () => currentUrl,
      click: async () => { navigate(); },
      goBack: async () => { currentUrl = 'http://localhost/page'; },
      evaluate: async () => 0,
      getByRole: () => ({ count: async () => 1, click: async () => { navigate(); } }),
    });

    const probe = {
      pattern: 'anchor-link',
      triggerSelector: 'a[href="/other-page"]',
      targetSelector: '#foo',
      viewport: 'desktop',
      confidence: 'high',
      targetExists: true,
      text: 'Other Page',
    };

    const result = await verifyProbe(probe, page);
    assert.equal(result.passed, false, 'should fail when navigation happened');
    assert.ok(result.action.includes('navigation detected'), 'action should mention navigation detected');
    assert.ok(result.actual.includes('navigation'), 'actual should explain the navigation');
  });

  it('calls goBack after detecting navigation to avoid poisoning later probes', async () => {
    let currentUrl = 'http://localhost/page';
    let goBackCalled = false;
    const navigate = () => { currentUrl = 'http://localhost/other-page'; };
    const page = makeMockPage({
      url: () => currentUrl,
      click: async () => { navigate(); },
      goBack: async () => { goBackCalled = true; currentUrl = 'http://localhost/page'; },
      evaluate: async () => 0,
      getByRole: () => ({ count: async () => 1, click: async () => { navigate(); } }),
    });

    const probe = {
      pattern: 'anchor-link',
      triggerSelector: 'a',
      targetSelector: '#section',
      viewport: 'desktop',
      confidence: 'high',
      targetExists: true,
      text: 'Link',
    };

    await verifyProbe(probe, page);
    assert.equal(goBackCalled, true, 'should call goBack after detecting navigation');
  });

  it('passes when same-page anchor scrolls to target', async () => {
    const url = 'http://localhost/page#section';
    let callNum = 0;
    const page = makeMockPage({
      url: () => url,
      click: async () => {},
      evaluate: async () => {
        callNum++;
        if (callNum === 1) return 0; // beforeY
        return { found: true, scrollY: 600, targetTop: 10, inViewport: true }; // jumpCheck
      },
    });

    const probe = {
      pattern: 'anchor-link',
      triggerSelector: 'a[href="#section"]',
      targetSelector: '#section',
      viewport: 'desktop',
      confidence: 'high',
      targetExists: true,
      text: 'Section',
    };

    const result = await verifyProbe(probe, page);
    assert.equal(result.passed, true, 'same-page anchor with scroll should pass');
    assert.ok(result.actual.includes('scrolled to target'));
  });
});
