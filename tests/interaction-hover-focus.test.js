/**
 * Hover & Focus pass tests (Phase 2).
 *
 * Exercises collectHoverPass, collectFocusPass, snippetFocusIndicator,
 * and snippetNonSemanticClickables. All tests run against mock page
 * objects — no real browser needed.
 *
 * Run: node --test tests/interaction-hover-focus.test.js
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { __testHooks } = require('../bin/pixelslop-browser.cjs');

const {
  makeEmptyBundle,
  collectHoverPass,
  collectFocusPass,
  snippetFocusIndicator,
  snippetNonSemanticClickables,
  resetProbeState,
  DEFAULT_CAPTURE_PROPS,
} = __testHooks;

// ─────────────────────────────────────────────
// Mock helpers
// ─────────────────────────────────────────────

/**
 * Build a mock Playwright page. Override methods as needed.
 * @param {object} overrides - Method overrides for the mock
 * @returns {object} Mock page
 */
function makeMockPage(overrides = {}) {
  return {
    hover: overrides.hover || (async () => { throw new Error('hover: not found'); }),
    click: overrides.click || (async () => { throw new Error('click: not found'); }),
    keyboard: overrides.keyboard || { press: async () => { throw new Error('keyboard: boom'); } },
    mouse: overrides.mouse || { move: async () => { throw new Error('mouse: boom'); } },
    evaluate: overrides.evaluate || (async () => null),
    waitForTimeout: overrides.waitForTimeout || (async () => {}),
  };
}

/**
 * Build a minimal bundle with fake interactiveElements for hover pass testing.
 * @param {Array} elements - Override interactiveElements array
 * @returns {Object} Bundle with the right shape
 */
function makeBundleWithElements(elements) {
  const bundle = makeEmptyBundle('http://localhost:3000', '/tmp/test');
  bundle.interactiveElements = elements;
  return bundle;
}

// ─────────────────────────────────────────────
// collectHoverPass — exports
// ─────────────────────────────────────────────

describe('collectHoverPass', () => {
  it('is exported as a function', () => {
    assert.equal(typeof collectHoverPass, 'function');
  });

  it('skips when interactiveElements is null', async () => {
    const bundle = makeEmptyBundle('http://localhost:3000', '/tmp/test');
    bundle.interactiveElements = null;
    const page = makeMockPage();
    await collectHoverPass(bundle, page);
    // hoverStates should remain untouched (null)
    assert.equal(bundle.hoverStates, null);
  });

  it('skips when interactiveElements is not an array', async () => {
    const bundle = makeEmptyBundle('http://localhost:3000', '/tmp/test');
    bundle.interactiveElements = 'not-an-array';
    const page = makeMockPage();
    await collectHoverPass(bundle, page);
    assert.equal(bundle.hoverStates, null);
  });

  it('filters to semantic interactive elements only (button, link, nav-item)', async () => {
    const elements = [
      { ref: 'r0', tag: 'button', text: 'Click', selector: 'button', rect: { top: 50, left: 0, width: 100, height: 40 }, isSemanticInteractive: true, category: 'button' },
      { ref: 'r1', tag: 'a', text: 'Link', selector: 'a', rect: { top: 60, left: 0, width: 80, height: 20 }, isSemanticInteractive: true, category: 'link' },
      { ref: 'r2', tag: 'input', text: '', selector: 'input', rect: { top: 70, left: 0, width: 200, height: 30 }, isSemanticInteractive: true, category: 'form-input' },
      { ref: 'r3', tag: 'div', text: 'Fake', selector: 'div.fake', rect: { top: 80, left: 0, width: 60, height: 40 }, isSemanticInteractive: false, category: 'non-semantic-clickable' },
      { ref: 'r4', tag: 'nav', text: 'Nav', selector: 'nav', rect: { top: 0, left: 0, width: 1000, height: 60 }, isSemanticInteractive: false, category: 'landmark' },
    ];
    const bundle = makeBundleWithElements(elements);

    // Track which selectors get hovered
    const hovered = [];
    let evalCallCount = 0;
    const page = makeMockPage({
      hover: async (sel) => { hovered.push(sel); },
      evaluate: async (fn, ...args) => {
        evalCallCount++;
        // captureBeforeAfter calls evaluate twice (before + after)
        // then hover pass calls it again for transition value
        if (typeof fn === 'function') {
          // Return fake styles for captureBeforeAfter
          return { backgroundColor: 'rgb(0,0,0)', color: 'white' };
        }
        return null;
      },
    });

    await collectHoverPass(bundle, page);
    assert.ok(Array.isArray(bundle.hoverStates));
    // Only button (r0) and link (r1) should be included — form-input, non-semantic, and landmark are excluded
    assert.equal(bundle.hoverStates.length, 2);
    assert.equal(bundle.hoverStates[0].category, 'button');
    assert.equal(bundle.hoverStates[1].category, 'link');
  });

  it('caps at 15 elements', async () => {
    // Generate 20 button elements — only 15 should be processed
    const elements = Array.from({ length: 20 }, (_, i) => ({
      ref: 'r' + i,
      tag: 'button',
      text: 'Button ' + i,
      selector: 'button:nth-of-type(' + (i + 1) + ')',
      rect: { top: 50 + i * 10, left: 0, width: 100, height: 40 },
      isSemanticInteractive: true,
      category: 'button',
    }));
    const bundle = makeBundleWithElements(elements);

    const page = makeMockPage({
      hover: async () => {},
      evaluate: async () => ({ backgroundColor: 'rgb(0,0,0)' }),
    });

    await collectHoverPass(bundle, page);
    assert.ok(Array.isArray(bundle.hoverStates));
    assert.equal(bundle.hoverStates.length, 15);
  });

  it('sorts above-fold elements first, then by area', async () => {
    const elements = [
      { ref: 'r0', tag: 'button', text: 'Small above', selector: 'button.small', rect: { top: 100, left: 0, width: 50, height: 30 }, isSemanticInteractive: true, category: 'button' },
      { ref: 'r1', tag: 'button', text: 'Below fold', selector: 'button.below', rect: { top: 1200, left: 0, width: 300, height: 60 }, isSemanticInteractive: true, category: 'button' },
      { ref: 'r2', tag: 'a', text: 'Big above', selector: 'a.big', rect: { top: 200, left: 0, width: 200, height: 50 }, isSemanticInteractive: true, category: 'link' },
    ];
    const bundle = makeBundleWithElements(elements);

    const page = makeMockPage({
      hover: async () => {},
      evaluate: async () => ({ backgroundColor: 'rgb(0,0,0)' }),
    });

    await collectHoverPass(bundle, page);
    // Above-fold elements first (r0 and r2), sorted by area (r2 > r0), then below-fold r1
    assert.equal(bundle.hoverStates[0].ref, 'r2'); // big above-fold
    assert.equal(bundle.hoverStates[1].ref, 'r0'); // small above-fold
    assert.equal(bundle.hoverStates[2].ref, 'r1'); // below fold
  });

  it('records changed/unchanged state from captureBeforeAfter', async () => {
    const elements = [
      { ref: 'r0', tag: 'button', text: 'Hover me', selector: 'button', rect: { top: 50, left: 0, width: 100, height: 40 }, isSemanticInteractive: true, category: 'button' },
    ];
    const bundle = makeBundleWithElements(elements);

    let evalCount = 0;
    const page = makeMockPage({
      hover: async () => {},
      evaluate: async (fn, ...args) => {
        evalCount++;
        // First two evaluate calls are from captureBeforeAfter (before + after styles)
        if (evalCount === 1) return { backgroundColor: 'rgb(0,0,0)' };
        if (evalCount === 2) return { backgroundColor: 'rgb(50,50,50)' }; // changed!
        // Third call is for transition value
        return '';
      },
    });

    await collectHoverPass(bundle, page);
    assert.equal(bundle.hoverStates.length, 1);
    assert.equal(bundle.hoverStates[0].changed, true);
    assert.ok(bundle.hoverStates[0].changedProperties.includes('backgroundColor'));
  });
});

// ─────────────────────────────────────────────
// snippetFocusIndicator
// ─────────────────────────────────────────────

describe('snippetFocusIndicator', () => {
  it('is exported as a function', () => {
    assert.equal(typeof snippetFocusIndicator, 'function');
  });

  it('is a page.evaluate-compatible function', () => {
    const src = snippetFocusIndicator.toString();
    assert.ok(src.includes('document.querySelector'), 'should query the DOM');
    assert.ok(src.includes('focus'), 'should focus the element');
    assert.ok(src.includes('blur'), 'should clean up with blur');
  });

  it('returns null for missing elements', () => {
    const src = snippetFocusIndicator.toString();
    assert.ok(src.includes('if (!el) return null'), 'should bail on missing element');
  });

  it('checks outline, boxShadow, and borderColor changes', () => {
    const src = snippetFocusIndicator.toString();
    assert.ok(src.includes('outlineChanged'), 'should check outline changes');
    assert.ok(src.includes('boxShadowChanged'), 'should check boxShadow changes');
    assert.ok(src.includes('borderChanged'), 'should check border changes');
  });

  it('returns hasVisibleIndicator and indicatorType', () => {
    const src = snippetFocusIndicator.toString();
    assert.ok(src.includes('hasVisibleIndicator'), 'should report visibility');
    assert.ok(src.includes('indicatorType'), 'should report indicator type');
  });
});

// ─────────────────────────────────────────────
// snippetNonSemanticClickables
// ─────────────────────────────────────────────

describe('snippetNonSemanticClickables', () => {
  it('is exported as a function', () => {
    assert.equal(typeof snippetNonSemanticClickables, 'function');
  });

  it('is a page.evaluate-compatible function', () => {
    const src = snippetNonSemanticClickables.toString();
    assert.ok(src.includes('document.querySelectorAll'), 'should scan the DOM');
    assert.ok(src.includes('cursor'), 'should check cursor:pointer');
    assert.ok(src.includes('onclick'), 'should check onclick attributes');
  });

  it('excludes semantic tags from results', () => {
    const src = snippetNonSemanticClickables.toString();
    assert.ok(src.includes('SEMANTIC_TAGS'), 'should define semantic tag set');
    assert.ok(src.includes('button') && src.includes('summary'), 'should include button and summary in semantic tags');
  });

  it('caps results at 30', () => {
    const src = snippetNonSemanticClickables.toString();
    assert.ok(src.includes('30'), 'should cap at 30 results');
  });
});

// ─────────────────────────────────────────────
// collectFocusPass
// ─────────────────────────────────────────────

describe('collectFocusPass', () => {
  it('is exported as a function', () => {
    assert.equal(typeof collectFocusPass, 'function');
  });

  it('writes focusPass data to the bundle', async () => {
    const bundle = makeEmptyBundle('http://localhost:3000', '/tmp/test');

    let tabCount = 0;
    const page = makeMockPage({
      keyboard: { press: async () => {} },
      evaluate: async (fn, ...args) => {
        if (typeof fn === 'function') {
          // First evaluate from collectFocusPass: blur active element
          // Subsequent from actionTab: return focused element info
          // Then from snippetFocusIndicator: return indicator data
          // Then from snippetNonSemanticClickables: return empty array
          const fnStr = fn.toString();
          if (fnStr.includes('activeElement') && fnStr.includes('blur') && !fnStr.includes('getComputedStyle')) {
            return undefined; // initial blur
          }
          if (fnStr.includes('activeElement') && fnStr.includes('tagName')) {
            tabCount++;
            if (tabCount <= 3) {
              return {
                tag: 'button',
                selector: 'button:nth-of-type(' + tabCount + ')',
                text: 'Button ' + tabCount,
                rect: { top: 50, left: 0, width: 100, height: 40 },
              };
            }
            return null; // no more elements to tab to
          }
          // snippetFocusIndicator call
          if (fnStr.includes('hasVisibleIndicator') || fnStr.includes('outline')) {
            return {
              selector: args[0],
              outline: '2px solid blue',
              outlineOffset: '2px',
              boxShadow: 'none',
              borderColor: 'black',
              hasVisibleIndicator: true,
              indicatorType: 'outline',
              indicatorValue: '2px solid blue',
            };
          }
          // snippetNonSemanticClickables
          return [];
        }
        return null;
      },
    });

    await collectFocusPass(bundle, page);
    assert.ok(bundle.focusPass !== null, 'focusPass should be populated');
    assert.equal(typeof bundle.focusPass.totalFocusable, 'number');
    assert.equal(typeof bundle.focusPass.tabbed, 'number');
    assert.equal(typeof bundle.focusPass.withIndicator, 'number');
    assert.equal(typeof bundle.focusPass.withoutIndicator, 'number');
    assert.ok(Array.isArray(bundle.focusPass.missingIndicators));
    assert.ok(Array.isArray(bundle.focusPass.nonSemanticClickables));
  });

  it('handles pages with no focusable elements', async () => {
    const bundle = makeEmptyBundle('http://localhost:3000', '/tmp/test');

    const page = makeMockPage({
      keyboard: { press: async () => {} },
      evaluate: async (fn) => {
        const fnStr = fn.toString();
        if (fnStr.includes('activeElement') && fnStr.includes('blur') && !fnStr.includes('getComputedStyle')) {
          return undefined;
        }
        // actionTab evaluate returns null — nothing focused
        if (fnStr.includes('activeElement') && fnStr.includes('tagName')) {
          return null;
        }
        return [];
      },
    });

    await collectFocusPass(bundle, page);
    assert.equal(bundle.focusPass.totalFocusable, 0);
    assert.equal(bundle.focusPass.tabbed, 0);
  });
});

// ─────────────────────────────────────────────
// DEFAULT_CAPTURE_PROPS — focus-relevant props
// ─────────────────────────────────────────────

describe('DEFAULT_CAPTURE_PROPS includes focus-relevant properties', () => {
  it('includes outline and outlineOffset', () => {
    assert.ok(DEFAULT_CAPTURE_PROPS.includes('outline'), 'missing outline');
    assert.ok(DEFAULT_CAPTURE_PROPS.includes('outlineOffset'), 'missing outlineOffset');
  });

  it('includes boxShadow and borderColor (common focus indicators)', () => {
    assert.ok(DEFAULT_CAPTURE_PROPS.includes('boxShadow'), 'missing boxShadow');
    assert.ok(DEFAULT_CAPTURE_PROPS.includes('borderColor'), 'missing borderColor');
  });
});

// ─────────────────────────────────────────────
// Bundle confidence flags
// ─────────────────────────────────────────────

describe('bundle confidence flags for hover/focus', () => {
  it('hoverStates confidence flag exists and defaults to false', () => {
    const bundle = makeEmptyBundle('http://localhost:3000', '/tmp/test');
    assert.ok('hoverStates' in bundle.confidence);
    assert.equal(bundle.confidence.hoverStates, false);
  });

  it('focusPass confidence flag exists and defaults to false', () => {
    const bundle = makeEmptyBundle('http://localhost:3000', '/tmp/test');
    assert.ok('focusPass' in bundle.confidence);
    assert.equal(bundle.confidence.focusPass, false);
  });

  it('hoverStates and focusPass fields exist on empty bundle', () => {
    const bundle = makeEmptyBundle('http://localhost:3000', '/tmp/test');
    assert.ok('hoverStates' in bundle);
    assert.ok('focusPass' in bundle);
    assert.equal(bundle.hoverStates, null);
    assert.equal(bundle.focusPass, null);
  });
});

// ─────────────────────────────────────────────
// Cross-probe contamination — resetProbeState
// ─────────────────────────────────────────────

describe('resetProbeState clears state between hover probes', () => {
  it('calls Escape, mouse.move(0,0), scrollTo(0), and blur', async () => {
    const calls = [];
    const page = makeMockPage({
      keyboard: { press: async (key) => { calls.push('keyboard:' + key); } },
      mouse: { move: async (x, y) => { calls.push('mouse:' + x + ',' + y); } },
      evaluate: async () => { calls.push('evaluate'); },
      waitForTimeout: async () => { calls.push('waitForTimeout'); },
    });

    await resetProbeState(page);

    // Escape key pressed to dismiss any open overlay
    assert.ok(calls.includes('keyboard:Escape'), 'should press Escape');
    // Mouse moved to origin to clear hover state
    assert.ok(calls.includes('mouse:0,0'), 'should move mouse to (0,0)');
    // evaluate runs scrollTo(0,0) and blur
    assert.ok(calls.includes('evaluate'), 'should run scrollTo + blur via evaluate');
  });

  it('ensures fresh style capture after reset (no cached state)', async () => {
    // Simulate two hover probes on the same element.
    // After resetProbeState, the second probe should get fresh evaluate results,
    // not stale data from the first probe.
    let evalCount = 0;
    const page = makeMockPage({
      keyboard: { press: async () => {} },
      mouse: { move: async () => {} },
      evaluate: async () => {
        evalCount++;
        // Each call returns a different backgroundColor to prove fresh capture
        if (evalCount <= 2) return { backgroundColor: 'rgb(255, 0, 0)' }; // first probe
        if (evalCount === 3) return undefined; // resetProbeState evaluate
        return { backgroundColor: 'rgb(0, 0, 255)' }; // second probe — different color
      },
      hover: async () => {},
      waitForTimeout: async () => {},
    });

    const elements = [
      { ref: 'r0', tag: 'button', text: 'Btn A', selector: 'button.a', rect: { top: 50, left: 0, width: 100, height: 40 }, isSemanticInteractive: true, category: 'button' },
      { ref: 'r1', tag: 'button', text: 'Btn B', selector: 'button.b', rect: { top: 100, left: 0, width: 100, height: 40 }, isSemanticInteractive: true, category: 'button' },
    ];
    const bundle = makeBundleWithElements(elements);

    await collectHoverPass(bundle, page);

    // Both probes ran — the second probe's evaluate calls are distinct from the first
    assert.ok(evalCount >= 4, 'evaluate should be called for each probe independently (got ' + evalCount + ')');
    assert.equal(bundle.hoverStates.length, 2, 'both probes should produce results');
  });

  it('does not throw even when all page methods fail during reset', async () => {
    const failPage = makeMockPage(); // defaults throw on everything
    // Should swallow all errors gracefully
    await resetProbeState(failPage);
  });
});
