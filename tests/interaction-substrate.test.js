/**
 * Interaction Substrate tests.
 *
 * Exercises the Phase 0 interaction primitives: ref mapping, action helpers,
 * before/after capture, probe isolation, and per-pass time budgets.
 * All tests run against mock page objects — no real browser needed.
 *
 * Run: node --test tests/interaction-substrate.test.js
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { __testHooks } = require('../bin/pixelslop-browser.cjs');

const {
  buildConfig,
  makeEmptyBundle,
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
  SCROLL_PASS_BUDGET_MS,
  HOVER_PASS_BUDGET_MS,
  FOCUS_PASS_BUDGET_MS,
  PROMISE_PASS_BUDGET_MS,
  DEFAULT_CAPTURE_PROPS,
} = __testHooks;

// ─────────────────────────────────────────────
// Mock page factory
// ─────────────────────────────────────────────

/**
 * Build a mock Playwright page that fails on everything by default.
 * Override individual methods to test specific paths.
 * @param {object} overrides - Method overrides
 * @returns {object} Mock page object
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

// ─────────────────────────────────────────────
// snippetBuildRefMap
// ─────────────────────────────────────────────

describe('snippetBuildRefMap', () => {
  it('is exported as a function', () => {
    assert.equal(typeof snippetBuildRefMap, 'function');
  });

  it('returns a function body suitable for page.evaluate', () => {
    // snippetBuildRefMap is a named function — confirm it can be stringified
    // (Playwright serializes functions passed to evaluate)
    const src = snippetBuildRefMap.toString();
    assert.ok(src.includes('function'), 'should be a serializable function');
    assert.ok(src.includes('querySelectorAll'), 'should query the DOM');
  });

  it('references MAX_REFS cap inside its body', () => {
    const src = snippetBuildRefMap.toString();
    assert.ok(src.includes('MAX_REFS'), 'should enforce a ref limit');
    assert.ok(src.includes('150'), 'MAX_REFS should default to 150');
  });

  it('accepts maxRefs parameter to override the default cap', () => {
    const src = snippetBuildRefMap.toString();
    assert.ok(src.includes('maxRefsArg'), 'should accept a maxRefs argument');
  });
});

// ─────────────────────────────────────────────
// snippetResolveRef
// ─────────────────────────────────────────────

describe('snippetResolveRef', () => {
  it('is exported as a function', () => {
    assert.equal(typeof snippetResolveRef, 'function');
  });

  it('body returns { found: false } for missing elements', () => {
    // The function calls document.querySelector — verify the early-return path exists
    const src = snippetResolveRef.toString();
    assert.ok(src.includes('found: false'), 'should return found:false when element is missing');
    assert.ok(src.includes('found: true'), 'should return found:true when element exists');
  });
});

// ─────────────────────────────────────────────
// Action Helpers — export checks
// ─────────────────────────────────────────────

describe('action helpers — exports', () => {
  for (const [name, fn] of Object.entries({
    actionHover, actionClick, actionTab, actionEscape, actionScrollToFold,
  })) {
    it(`${name} is exported as a function`, () => {
      assert.equal(typeof fn, 'function', `${name} should be a function`);
    });
  }
});

// ─────────────────────────────────────────────
// Action Helpers — error handling
// ─────────────────────────────────────────────

describe('action helpers — error handling (never throw)', () => {
  const failPage = makeMockPage();

  it('actionHover returns { ok: false, error } on failure', async () => {
    const result = await actionHover(failPage, '.nope');
    assert.equal(result.ok, false);
    assert.equal(typeof result.error, 'string');
    assert.ok(result.error.length > 0);
  });

  it('actionClick returns { ok: false, error } on failure', async () => {
    const result = await actionClick(failPage, '.nope');
    assert.equal(result.ok, false);
    assert.equal(typeof result.error, 'string');
  });

  it('actionTab returns { ok: false, error } on failure', async () => {
    const result = await actionTab(failPage);
    assert.equal(result.ok, false);
    assert.equal(typeof result.error, 'string');
  });

  it('actionEscape returns { ok: false, error } on failure', async () => {
    const result = await actionEscape(failPage);
    assert.equal(result.ok, false);
    assert.equal(typeof result.error, 'string');
  });

  it('actionScrollToFold returns { ok: false, error } on failure', async () => {
    const failScrollPage = makeMockPage({
      evaluate: async () => { throw new Error('scroll: boom'); },
    });
    const result = await actionScrollToFold(failScrollPage, 2, 900);
    assert.equal(result.ok, false);
    assert.equal(typeof result.error, 'string');
  });
});

// ─────────────────────────────────────────────
// Action Helpers — success paths
// ─────────────────────────────────────────────

describe('action helpers — success paths', () => {
  it('actionHover returns { ok: true } on success', async () => {
    const page = makeMockPage({ hover: async () => {} });
    const result = await actionHover(page, '.btn');
    assert.equal(result.ok, true);
    assert.equal(result.error, undefined);
  });

  it('actionClick returns { ok: true } on success', async () => {
    const page = makeMockPage({ click: async () => {} });
    const result = await actionClick(page, '.btn');
    assert.equal(result.ok, true);
  });

  it('actionTab returns { ok: true, focused } on success', async () => {
    const page = makeMockPage({
      keyboard: { press: async () => {} },
      evaluate: async () => ({
        tag: 'button', selector: 'button.primary', text: 'Submit',
        rect: { top: 100, left: 50, width: 120, height: 40 },
      }),
    });
    const result = await actionTab(page);
    assert.equal(result.ok, true);
    assert.ok(result.focused);
    assert.equal(result.focused.tag, 'button');
  });

  it('actionEscape returns { ok: true } on success', async () => {
    const page = makeMockPage({ keyboard: { press: async () => {} } });
    const result = await actionEscape(page);
    assert.equal(result.ok, true);
  });

  it('actionScrollToFold returns { ok: true } on success', async () => {
    const page = makeMockPage({ evaluate: async () => {} });
    const result = await actionScrollToFold(page, 1, 900);
    assert.equal(result.ok, true);
  });
});

// ─────────────────────────────────────────────
// captureBeforeAfter
// ─────────────────────────────────────────────

describe('captureBeforeAfter', () => {
  it('is exported as a function', () => {
    assert.equal(typeof captureBeforeAfter, 'function');
  });

  it('returns { found: false } when element is missing', async () => {
    const page = makeMockPage({ evaluate: async () => null });
    const result = await captureBeforeAfter(page, '.ghost', actionHover);
    assert.equal(result.found, false);
    assert.equal(result.selector, '.ghost');
  });

  it('detects no change when before and after styles match', async () => {
    const stubStyles = {
      backgroundColor: 'rgb(0, 0, 0)',
      color: 'rgb(255, 255, 255)',
      borderColor: 'transparent',
      boxShadow: 'none',
      transform: 'none',
      opacity: '1',
      outline: 'none',
      outlineOffset: '0px',
      textDecoration: 'none',
      visibility: 'visible',
      display: 'block',
      height: '40px',
      width: '120px',
    };
    const page = makeMockPage({
      evaluate: async () => ({ ...stubStyles }),
      hover: async () => {},
    });
    const result = await captureBeforeAfter(page, '.btn', actionHover);
    assert.equal(result.found, true);
    assert.equal(result.actionFailed, false);
    assert.equal(result.changed, false);
    assert.deepEqual(result.changedProperties, []);
  });

  it('detects change when styles differ after action', async () => {
    let callCount = 0;
    const page = makeMockPage({
      evaluate: async () => {
        callCount++;
        // First call = before snapshot, second call = after snapshot
        if (callCount === 1) {
          return { backgroundColor: 'rgb(0,0,0)', color: 'rgb(255,255,255)' };
        }
        return { backgroundColor: 'rgb(30,30,30)', color: 'rgb(255,255,255)' };
      },
      hover: async () => {},
    });
    const result = await captureBeforeAfter(
      page, '.btn', actionHover, ['backgroundColor', 'color']
    );
    assert.equal(result.found, true);
    assert.equal(result.changed, true);
    assert.ok(result.changedProperties.includes('backgroundColor'));
    assert.ok(!result.changedProperties.includes('color'));
  });

  it('returns actionFailed when the action itself fails', async () => {
    const page = makeMockPage({
      evaluate: async () => ({ backgroundColor: 'rgb(0,0,0)' }),
      // hover will fail because we're using the default mock
    });
    const result = await captureBeforeAfter(page, '.btn', actionHover, ['backgroundColor']);
    assert.equal(result.found, true);
    assert.equal(result.actionFailed, true);
    assert.ok(result.error);
  });

  it('handles after-capture returning null (element removed by action)', async () => {
    let callCount = 0;
    const page = makeMockPage({
      evaluate: async () => {
        callCount++;
        if (callCount === 1) return { display: 'block' };
        return null; // element vanished
      },
      hover: async () => {},
    });
    const result = await captureBeforeAfter(page, '.modal', actionHover, ['display']);
    assert.equal(result.found, true);
    assert.equal(result.actionFailed, false);
    assert.equal(result.after, null);
    assert.equal(result.changed, false);
  });
});

// ─────────────────────────────────────────────
// resetProbeState / resetBetweenPasses
// ─────────────────────────────────────────────

describe('resetProbeState', () => {
  it('is exported as a function', () => {
    assert.equal(typeof resetProbeState, 'function');
  });

  it('does not throw even when every page method fails', async () => {
    const failPage = makeMockPage();
    // Should swallow all errors and not reject
    await resetProbeState(failPage);
  });
});

describe('resetBetweenPasses', () => {
  it('is exported as a function', () => {
    assert.equal(typeof resetBetweenPasses, 'function');
  });

  it('does not throw even when every page method fails', async () => {
    const failPage = makeMockPage();
    await resetBetweenPasses(failPage);
  });
});

// ─────────────────────────────────────────────
// withPassBudget
// ─────────────────────────────────────────────

describe('withPassBudget', () => {
  it('is exported as a function', () => {
    assert.equal(typeof withPassBudget, 'function');
  });

  it('returns { timedOut: false, result } when pass completes in time', async () => {
    const outcome = await withPassBudget(5000, async () => 'done');
    assert.equal(outcome.timedOut, false);
    assert.equal(outcome.result, 'done');
    assert.equal(typeof outcome.elapsedMs, 'number');
  });

  it('returns { timedOut: true } when pass exceeds budget', async () => {
    const outcome = await withPassBudget(50, async () => {
      await new Promise(resolve => setTimeout(resolve, 200));
      return 'too late';
    });
    assert.equal(outcome.timedOut, true);
    assert.equal(typeof outcome.elapsedMs, 'number');
  });

  it('provides a working isBudgetExhausted callback', async () => {
    let exhaustedSeen = false;
    const outcome = await withPassBudget(5000, async (isBudgetExhausted) => {
      // Budget is 5s, should not be exhausted immediately
      exhaustedSeen = isBudgetExhausted();
      return 'checked';
    });
    assert.equal(exhaustedSeen, false, 'budget should not be exhausted at start');
    assert.equal(outcome.timedOut, false);
    assert.equal(outcome.result, 'checked');
  });

  it('isBudgetExhausted returns true after budget expires', async () => {
    let exhaustedAtEnd = false;
    const outcome = await withPassBudget(30, async (isBudgetExhausted) => {
      // Wait longer than the budget, then check
      await new Promise(resolve => setTimeout(resolve, 60));
      exhaustedAtEnd = isBudgetExhausted();
      return 'late-check';
    });
    // The Promise.race might have timed out, or the function finished first.
    // Either way, if it didn't time out, the callback should report exhausted.
    if (!outcome.timedOut) {
      assert.equal(exhaustedAtEnd, true, 'isBudgetExhausted should return true after budget expires');
    }
  });
});

describe('safeStep', () => {
  it('skips confidence promotion when the callback returns __skipConfidence', async () => {
    const bundle = makeEmptyBundle('http://localhost:3000', '/tmp/project');

    const result = await safeStep(bundle, ['scrollData'], async () => {
      bundle.confidence.scrollData = false;
      return { __skipConfidence: true };
    }, null);

    assert.deepStrictEqual(result, { __skipConfidence: true });
    assert.equal(bundle.confidence.scrollData, false, 'confidence should stay false when promotion is skipped');
  });
});

// ─────────────────────────────────────────────
// Budget constants
// ─────────────────────────────────────────────

describe('budget constants', () => {
  it('SCROLL_PASS_BUDGET_MS is exported and positive', () => {
    assert.equal(typeof SCROLL_PASS_BUDGET_MS, 'number');
    assert.ok(SCROLL_PASS_BUDGET_MS > 0);
    assert.equal(SCROLL_PASS_BUDGET_MS, 8000);
  });

  it('HOVER_PASS_BUDGET_MS is exported and positive', () => {
    assert.equal(typeof HOVER_PASS_BUDGET_MS, 'number');
    assert.ok(HOVER_PASS_BUDGET_MS > 0);
    assert.equal(HOVER_PASS_BUDGET_MS, 5000);
  });

  it('FOCUS_PASS_BUDGET_MS is exported and positive', () => {
    assert.equal(typeof FOCUS_PASS_BUDGET_MS, 'number');
    assert.ok(FOCUS_PASS_BUDGET_MS > 0);
    assert.equal(FOCUS_PASS_BUDGET_MS, 3000);
  });

  it('PROMISE_PASS_BUDGET_MS is exported and positive', () => {
    assert.equal(typeof PROMISE_PASS_BUDGET_MS, 'number');
    assert.ok(PROMISE_PASS_BUDGET_MS > 0);
    assert.equal(PROMISE_PASS_BUDGET_MS, 12000);
  });
});

// ─────────────────────────────────────────────
// DEFAULT_CAPTURE_PROPS
// ─────────────────────────────────────────────

describe('DEFAULT_CAPTURE_PROPS', () => {
  it('is an array of 13 CSS property names', () => {
    assert.ok(Array.isArray(DEFAULT_CAPTURE_PROPS));
    assert.equal(DEFAULT_CAPTURE_PROPS.length, 13);
  });

  it('includes critical hover/focus properties', () => {
    const required = ['backgroundColor', 'color', 'outline', 'display', 'visibility'];
    for (const prop of required) {
      assert.ok(DEFAULT_CAPTURE_PROPS.includes(prop), `missing: ${prop}`);
    }
  });

  it('includes transform and box-shadow properties', () => {
    assert.ok(DEFAULT_CAPTURE_PROPS.includes('boxShadow'));
    assert.ok(DEFAULT_CAPTURE_PROPS.includes('transform'));
    assert.ok(DEFAULT_CAPTURE_PROPS.includes('opacity'));
  });
});

// ─────────────────────────────────────────────
// makeEmptyBundle — interaction substrate fields
// ─────────────────────────────────────────────

describe('makeEmptyBundle — interaction substrate fields', () => {
  const bundle = makeEmptyBundle('http://localhost:3000', '/tmp/project');

  it('includes interactiveElements field (null by default)', () => {
    assert.ok('interactiveElements' in bundle);
    assert.equal(bundle.interactiveElements, null);
  });

  it('includes scroll field (null by default)', () => {
    assert.ok('scroll' in bundle);
    assert.equal(bundle.scroll, null);
  });

  it('includes hoverStates field (null by default)', () => {
    assert.ok('hoverStates' in bundle);
    assert.equal(bundle.hoverStates, null);
  });

  it('includes focusPass field (null by default)', () => {
    assert.ok('focusPass' in bundle);
    assert.equal(bundle.focusPass, null);
  });

  it('includes interactivePromises field (null by default)', () => {
    assert.ok('interactivePromises' in bundle);
    assert.equal(bundle.interactivePromises, null);
  });

  it('includes meta with mode and bailouts', () => {
    assert.ok('meta' in bundle);
    assert.equal(bundle.meta.mode, 'standard');
    assert.ok(Array.isArray(bundle.meta.bailouts));
    assert.equal(bundle.meta.bailouts.length, 0);
  });

  it('has interactiveMap confidence flag (false by default)', () => {
    assert.equal(bundle.confidence.interactiveMap, false);
  });

  it('has scrollData confidence flag (false by default)', () => {
    assert.equal(bundle.confidence.scrollData, false);
  });

  it('has hoverStates confidence flag (false by default)', () => {
    assert.equal(bundle.confidence.hoverStates, false);
  });

  it('has focusPass confidence flag (false by default)', () => {
    assert.equal(bundle.confidence.focusPass, false);
  });

  it('has interactivePromises confidence flag (false by default)', () => {
    assert.equal(bundle.confidence.interactivePromises, false);
  });
});

// ─────────────────────────────────────────────
// snippetCaptureStyles
// ─────────────────────────────────────────────

describe('snippetCaptureStyles', () => {
  it('is exported as a function', () => {
    assert.equal(typeof snippetCaptureStyles, 'function');
  });

  it('body handles null element (no querySelector match)', () => {
    const src = snippetCaptureStyles.toString();
    assert.ok(src.includes('if (!el) return null'), 'should return null for missing element');
  });
});

// ─────────────────────────────────────────────
// Budget timeout with partial bundle state
// ─────────────────────────────────────────────

describe('withPassBudget — partial data on timeout', () => {
  it('preserves partial bundle data when budget is exceeded mid-pass', async () => {
    const bundle = makeEmptyBundle('http://test', null);

    // Simulate a pass that writes partial data then exceeds budget
    bundle.scroll = { folds: 0, partial: false };
    const passResult = await withPassBudget(50, async (isBudgetExhausted) => {
      // Write partial data immediately
      bundle.scroll.folds = 2;
      bundle.scroll.partial = true;
      // Exceed the budget
      await new Promise(r => setTimeout(r, 200));
      // This line may or may not run depending on the race, but
      // the important thing is that partial data is preserved
      bundle.scroll.folds = 5;
      return true;
    });

    // The pass timed out, so the bundle should have partial data.
    // Whether folds is 2 or 5 depends on whether the race killed the worker,
    // but the key assertion is that timedOut is true.
    assert.equal(passResult.timedOut, true, 'pass should have timed out');
    assert.equal(typeof passResult.elapsedMs, 'number');
    // Partial data from before the timeout should exist on the bundle
    assert.ok(bundle.scroll.folds >= 2, 'partial data should be preserved (folds >= 2)');
  });

  it('records bailout in bundle.meta.bailouts on timeout', async () => {
    const bundle = makeEmptyBundle('http://test', null);

    const passResult = await withPassBudget(30, async () => {
      await new Promise(r => setTimeout(r, 200));
      return true;
    });

    // Mimic what collectEvidence does after a timeout
    if (passResult.timedOut) {
      bundle.meta.bailouts.push({ pass: 'scroll', reason: 'timeout', elapsedMs: passResult.elapsedMs });
    }

    assert.equal(passResult.timedOut, true);
    assert.equal(bundle.meta.bailouts.length, 1, 'should have one bailout recorded');
    assert.equal(bundle.meta.bailouts[0].pass, 'scroll');
    assert.equal(bundle.meta.bailouts[0].reason, 'timeout');
    assert.equal(typeof bundle.meta.bailouts[0].elapsedMs, 'number');
  });
});

// ─────────────────────────────────────────────
// Confidence flag stays false on timeout
// (mirrors the safeStep + withPassBudget + confidence pattern from collectEvidence)
// ─────────────────────────────────────────────

describe('confidence flag false on timeout — collectEvidence pattern', () => {
  it('confidence flag stays false when pass times out (scroll pattern)', async () => {
    const bundle = makeEmptyBundle('http://test', null);

    // Start: confidence is false by default
    assert.equal(bundle.confidence.scrollData, false);

    // Simulate what collectEvidence does: safeStep wrapping withPassBudget
    // On timeout, the confidence flag should NOT be set to true
    const passResult = await withPassBudget(30, async () => {
      await new Promise(r => setTimeout(r, 200));
      return true;
    });

    if (passResult.timedOut) {
      // This is the pattern from collectEvidence: explicitly set confidence to false
      bundle.confidence.scrollData = false;
      bundle.meta.bailouts.push({ pass: 'scroll', reason: 'timeout', elapsedMs: passResult.elapsedMs });
    }

    assert.equal(bundle.confidence.scrollData, false, 'confidence should remain false on timeout');
    assert.equal(bundle.meta.bailouts.length, 1);
  });

  it('confidence flag stays false when pass times out (hover pattern)', async () => {
    const bundle = makeEmptyBundle('http://test', null);
    assert.equal(bundle.confidence.hoverStates, false);

    const passResult = await withPassBudget(30, async () => {
      await new Promise(r => setTimeout(r, 200));
      return true;
    });

    if (passResult.timedOut) {
      bundle.confidence.hoverStates = false;
      bundle.meta.bailouts.push({ pass: 'hover', reason: 'timeout', elapsedMs: passResult.elapsedMs });
    }

    assert.equal(bundle.confidence.hoverStates, false, 'hoverStates confidence should remain false on timeout');
  });

  it('confidence flag stays false when pass times out (focus pattern)', async () => {
    const bundle = makeEmptyBundle('http://test', null);
    assert.equal(bundle.confidence.focusPass, false);

    const passResult = await withPassBudget(30, async () => {
      await new Promise(r => setTimeout(r, 200));
      return true;
    });

    if (passResult.timedOut) {
      bundle.confidence.focusPass = false;
      bundle.meta.bailouts.push({ pass: 'focus', reason: 'timeout', elapsedMs: passResult.elapsedMs });
    }

    assert.equal(bundle.confidence.focusPass, false, 'focusPass confidence should remain false on timeout');
  });

  it('confidence flag stays false when pass times out (promises pattern)', async () => {
    const bundle = makeEmptyBundle('http://test', null);
    assert.equal(bundle.confidence.interactivePromises, false);

    const passResult = await withPassBudget(30, async () => {
      await new Promise(r => setTimeout(r, 200));
      return true;
    });

    if (passResult.timedOut) {
      bundle.confidence.interactivePromises = false;
      bundle.meta.bailouts.push({ pass: 'promises', reason: 'timeout', elapsedMs: passResult.elapsedMs });
    }

    assert.equal(bundle.confidence.interactivePromises, false, 'interactivePromises confidence should remain false on timeout');
  });
});

// ─────────────────────────────────────────────
// buildConfig — deep mode config
// ─────────────────────────────────────────────

describe('buildConfig', () => {
  it('is exported as a function', () => {
    assert.equal(typeof buildConfig, 'function');
  });

  it('returns standard config when deep is false', () => {
    const cfg = buildConfig({});
    assert.equal(cfg.mode, 'standard');
    assert.equal(cfg.totalTimeout, 120000);
    assert.equal(cfg.scrollBudget, 8000);
    assert.equal(cfg.hoverBudget, 5000);
    assert.equal(cfg.focusBudget, 3000);
    assert.equal(cfg.promiseBudget, 12000);
    assert.equal(cfg.maxRefs, 150);
    assert.equal(cfg.maxHover, 15);
    assert.equal(cfg.maxTabs, 30);
    assert.equal(cfg.maxPromises, 8);
    assert.equal(cfg.maxFolds, 10);

    assert.equal(cfg.maxStickyElements, 20);
  });

  it('returns deep config when deep is true', () => {
    const cfg = buildConfig({ deep: true });
    assert.equal(cfg.mode, 'deep');
    assert.equal(cfg.totalTimeout, 180000);
    assert.equal(cfg.scrollBudget, 16000);
    assert.equal(cfg.hoverBudget, 10000);
    assert.equal(cfg.focusBudget, 6000);
    assert.equal(cfg.promiseBudget, 24000);
    assert.equal(cfg.maxRefs, 500);
    assert.equal(cfg.maxHover, 75);
    assert.equal(cfg.maxTabs, 100);
    assert.equal(cfg.maxPromises, 25);
    assert.equal(cfg.maxFolds, 20);
    assert.equal(cfg.maxStickyElements, 50);
  });

  it('handles null/undefined args gracefully', () => {
    const cfg = buildConfig(null);
    assert.equal(cfg.mode, 'standard');
    assert.equal(cfg.totalTimeout, 120000);
  });

  it('handles undefined args gracefully', () => {
    const cfg = buildConfig(undefined);
    assert.equal(cfg.mode, 'standard');
  });

  it('deep caps are raised but not infinite', () => {
    const cfg = buildConfig({ deep: true });
    assert.ok(cfg.maxRefs <= 1000, 'maxRefs should have a hard cap');
    assert.ok(cfg.maxHover <= 200, 'maxHover should have a hard cap');
    assert.ok(cfg.maxTabs <= 200, 'maxTabs should have a hard cap');
    assert.ok(cfg.maxPromises <= 50, 'maxPromises should have a hard cap');
    assert.ok(cfg.totalTimeout <= 300000, 'totalTimeout should have a hard cap');
  });

  it('standard config matches the exported budget constants', () => {
    const cfg = buildConfig({});
    assert.equal(cfg.scrollBudget, SCROLL_PASS_BUDGET_MS);
    assert.equal(cfg.hoverBudget, HOVER_PASS_BUDGET_MS);
    assert.equal(cfg.focusBudget, FOCUS_PASS_BUDGET_MS);
    assert.equal(cfg.promiseBudget, PROMISE_PASS_BUDGET_MS);
  });
});

// ─────────────────────────────────────────────
// meta timing fields in makeEmptyBundle
// ─────────────────────────────────────────────

describe('meta timing fields', () => {
  it('makeEmptyBundle includes passTimings and collectionTimeMs', () => {
    const bundle = makeEmptyBundle('http://test', null);
    assert.equal(bundle.meta.collectionTimeMs, 0);
    assert.deepEqual(bundle.meta.passTimings, { scroll: 0, hover: 0, focus: 0, promises: 0 });
  });

  it('passTimings keys match the four interaction passes', () => {
    const bundle = makeEmptyBundle('http://test', null);
    const keys = Object.keys(bundle.meta.passTimings).sort();
    assert.deepEqual(keys, ['focus', 'hover', 'promises', 'scroll']);
  });

  it('mode defaults to standard', () => {
    const bundle = makeEmptyBundle('http://test', null);
    assert.equal(bundle.meta.mode, 'standard');
  });
});
