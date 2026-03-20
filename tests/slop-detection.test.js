/**
 * Slop Detection Logic Tests
 *
 * Tests the detection thresholds and classification logic from
 * ai-slop-patterns.md without needing a browser. These validate
 * that our heuristics (isDark, genericFont, severity bands) work
 * correctly on known inputs.
 *
 * Run: node --test tests/slop-detection.test.js
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';

// --- isDark threshold ---
// Pattern 3 (dark-glow) uses: channels <= 45
// This must catch near-black backgrounds without flagging medium grays.

/**
 * Determine if an rgb string represents a "dark mode" background.
 * Matches the threshold in ai-slop-patterns.md patterns 3, 4, and 15.
 *
 * @param {string} rgb - CSS rgb() value like "rgb(30, 30, 33)"
 * @returns {boolean} Whether this qualifies as a dark background
 */
function isDark(rgb) {
  const m = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return false;
  return Number(m[1]) <= 45 && Number(m[2]) <= 45 && Number(m[3]) <= 45;
}

describe('isDark threshold', () => {
  // Should detect as dark
  it('catches pure black', () => assert.ok(isDark('rgb(0, 0, 0)')));
  it('catches near-black (Linear)', () => assert.ok(isDark('rgb(8, 9, 10)')));
  it('catches dark gray (Supabase)', () => assert.ok(isDark('rgb(18, 18, 18)')));
  it('catches bolt.new dark (the one that was missed before)', () => assert.ok(isDark('rgb(30, 30, 33)')));
  it('catches threshold edge (45,45,45)', () => assert.ok(isDark('rgb(45, 45, 45)')));

  // Should NOT detect as dark
  it('rejects medium gray', () => assert.ok(!isDark('rgb(100, 100, 100)')));
  it('rejects light gray', () => assert.ok(!isDark('rgb(200, 200, 200)')));
  it('rejects white', () => assert.ok(!isDark('rgb(255, 255, 255)')));
  it('rejects off-white (UUPM demos)', () => assert.ok(!isDark('rgb(248, 250, 252)')));
  it('rejects just-above-threshold', () => assert.ok(!isDark('rgb(46, 46, 46)')));
  it('rejects colored dark (dark blue)', () => assert.ok(!isDark('rgb(10, 10, 80)')));
  it('handles rgba format', () => assert.ok(isDark('rgba(20, 20, 20, 1)')));
  it('returns false on invalid input', () => assert.ok(!isDark('not a color')));
});


// --- genericFont check ---
// Pattern 8 uses primary-font-only extraction, not the full fallback stack.

/**
 * Extract the primary font from a CSS font-family value.
 * Matches the logic in ai-slop-patterns.md pattern 8.
 *
 * @param {string} fontFamily - Full CSS font-family string
 * @returns {string} Primary (first) font name, lowercase, unquoted
 */
function primaryFont(fontFamily) {
  return fontFamily.split(',')[0].trim().replace(/['"]/g, '').toLowerCase();
}

/**
 * Check if a primary font name is in the generic/common font list.
 *
 * @param {string} primary - Primary font name (lowercase)
 * @returns {boolean} Whether this is a generic AI-default font
 */
function isGenericFont(primary) {
  const generic = ['inter', 'roboto', 'arial', 'open sans', 'helvetica', 'system-ui', 'segoe ui', '-apple-system'];
  return generic.some(f => primary.includes(f));
}

describe('genericFont detection', () => {
  it('detects Inter as generic', () => {
    assert.ok(isGenericFont(primaryFont('Inter')));
  });

  it('detects Inter Display as generic', () => {
    assert.ok(isGenericFont(primaryFont('"Inter Display"')));
  });

  it('detects Roboto as generic', () => {
    assert.ok(isGenericFont(primaryFont('Roboto, sans-serif')));
  });

  it('does NOT flag Circular with Inter in fallback', () => {
    // Supabase's font stack — Circular is the primary, Inter is fallback only
    assert.ok(!isGenericFont(primaryFont('Circular, custom-font, "Helvetica Neue", Helvetica, Arial, sans-serif')));
  });

  it('does NOT flag Poppins', () => {
    assert.ok(!isGenericFont(primaryFont('Poppins, sans-serif')));
  });

  it('does NOT flag Syne', () => {
    assert.ok(!isGenericFont(primaryFont('Syne, sans-serif')));
  });

  it('does NOT flag Playfair Display SC', () => {
    assert.ok(!isGenericFont(primaryFont('"Playfair Display SC", serif')));
  });

  it('detects Open Sans as generic', () => {
    assert.ok(isGenericFont(primaryFont('"Open Sans", sans-serif')));
  });

  it('handles Inter Variable (with variable axis)', () => {
    assert.ok(isGenericFont(primaryFont('"Inter Variable", "SF Pro Display", -apple-system, sans-serif')));
  });
});


// --- Slop severity band classification ---

/**
 * Classify a slop pattern count into a severity band.
 * Matches the bands in ai-slop-patterns.md and scoring.md.
 *
 * @param {number} count - Number of detected slop patterns
 * @returns {string} Severity band: CLEAN, MILD, SLOPPY, or TERMINAL
 */
function classifySlop(count) {
  if (count <= 1) return 'CLEAN';
  if (count <= 3) return 'MILD';
  if (count <= 6) return 'SLOPPY';
  return 'TERMINAL';
}

describe('slop severity bands', () => {
  it('0 patterns = CLEAN', () => assert.equal(classifySlop(0), 'CLEAN'));
  it('1 pattern = CLEAN', () => assert.equal(classifySlop(1), 'CLEAN'));
  it('2 patterns = MILD', () => assert.equal(classifySlop(2), 'MILD'));
  it('3 patterns = MILD', () => assert.equal(classifySlop(3), 'MILD'));
  it('4 patterns = SLOPPY', () => assert.equal(classifySlop(4), 'SLOPPY'));
  it('6 patterns = SLOPPY', () => assert.equal(classifySlop(6), 'SLOPPY'));
  it('7 patterns = TERMINAL', () => assert.equal(classifySlop(7), 'TERMINAL'));
  it('11 patterns = TERMINAL', () => assert.equal(classifySlop(11), 'TERMINAL'));
});


// --- Rating band classification ---

/**
 * Classify a total score into a rating band.
 * Matches the bands in scoring.md.
 *
 * @param {number} total - Total score out of 20
 * @returns {string} Rating band
 */
function classifyRating(total) {
  if (total >= 17) return 'Excellent';
  if (total >= 13) return 'Good';
  if (total >= 9) return 'Needs Work';
  if (total >= 5) return 'Poor';
  return 'Critical';
}

describe('rating band classification', () => {
  it('20 = Excellent', () => assert.equal(classifyRating(20), 'Excellent'));
  it('17 = Excellent', () => assert.equal(classifyRating(17), 'Excellent'));
  it('16 = Good', () => assert.equal(classifyRating(16), 'Good'));
  it('13 = Good', () => assert.equal(classifyRating(13), 'Good'));
  it('12 = Needs Work', () => assert.equal(classifyRating(12), 'Needs Work'));
  it('9 = Needs Work', () => assert.equal(classifyRating(9), 'Needs Work'));
  it('8 = Poor', () => assert.equal(classifyRating(8), 'Poor'));
  it('5 = Poor', () => assert.equal(classifyRating(5), 'Poor'));
  it('4 = Critical', () => assert.equal(classifyRating(4), 'Critical'));
  it('1 = Critical', () => assert.equal(classifyRating(1), 'Critical'));
});


// --- Glow shadow detection threshold ---

/**
 * Determine if a box-shadow color represents a saturated glow
 * (not just any bright shadow). Matches the calibrated threshold
 * in ai-slop-patterns.md pattern 3.
 *
 * @param {number} r - Red channel 0-255
 * @param {number} g - Green channel 0-255
 * @param {number} b - Blue channel 0-255
 * @returns {boolean} Whether this shadow color is a "glow"
 */
function isGlowShadow(r, g, b) {
  const maxC = Math.max(r, g, b);
  const minC = Math.min(r, g, b);
  return maxC > 100 && (maxC - minC) > 60;
}

describe('glow shadow detection', () => {
  // Should detect as glow (saturated, bright colors)
  it('detects cyan glow', () => assert.ok(isGlowShadow(0, 200, 255)));
  it('detects purple glow', () => assert.ok(isGlowShadow(128, 0, 255)));
  it('detects green glow', () => assert.ok(isGlowShadow(0, 200, 50)));

  // Should NOT detect (desaturated / gray shadows)
  it('rejects gray shadow', () => assert.ok(!isGlowShadow(150, 150, 150)));
  it('rejects slight-warm shadow', () => assert.ok(!isGlowShadow(120, 100, 100)));
  it('rejects dark shadow', () => assert.ok(!isGlowShadow(20, 20, 20)));
  it('rejects black shadow', () => assert.ok(!isGlowShadow(0, 0, 0)));
  it('rejects dim colored (below maxC threshold)', () => assert.ok(!isGlowShadow(50, 0, 90)));
});

// Export for reuse
export { isDark, primaryFont, isGenericFont, classifySlop, classifyRating, isGlowShadow };
