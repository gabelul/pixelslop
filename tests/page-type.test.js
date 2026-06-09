/**
 * Page Type Heuristic Unit Tests
 *
 * Validates the PAGE_TYPE_PERSONAS mapping and classification logic
 * without requiring a browser. Tests the data contract that the
 * analyze-page command depends on.
 *
 * Run: node --test tests/page-type.test.js
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BROWSER_CJS = join(__dirname, '..', 'bin', 'pixelslop-browser.cjs');

/**
 * Extract the PAGE_TYPE_PERSONAS mapping from pixelslop-browser.cjs.
 * Parses the source text to pull out each page type's ids and names arrays.
 * @returns {Record<string, {ids: string[], names: string[]}>}
 */
function extractMapping() {
  const src = readFileSync(BROWSER_CJS, 'utf-8');
  assert.ok(src.includes('PAGE_TYPE_PERSONAS'), 'PAGE_TYPE_PERSONAS should exist in pixelslop-browser.cjs');

  const mapping = {};
  // Match each page type entry: 'type-name': { ids: [...], names: [...] }
  const entryRegex = /'([a-z-]+)':\s*\{\s*ids:\s*\[([^\]]+)\],\s*names:\s*\[([^\]]+)\]/g;
  let m;
  while ((m = entryRegex.exec(src)) !== null) {
    const type = m[1];
    const ids = m[2].match(/'([^']+)'/g).map(s => s.replace(/'/g, ''));
    const names = m[3].match(/'([^']+)'/g).map(s => s.replace(/'/g, ''));
    mapping[type] = { ids, names };
  }
  return mapping;
}

/** All valid persona IDs (must match the 8 built-in personas) */
const VALID_PERSONA_IDS = [
  'screen-reader-user', 'low-vision-user', 'keyboard-user',
  'rushed-mobile-user', 'first-time-visitor', 'slow-connection-user',
  'non-native-english', 'design-critic',
];

/** Expected humanName mapping */
const ID_TO_NAME = {
  'screen-reader-user': 'Sam',
  'low-vision-user': 'Pat',
  'keyboard-user': 'Alex',
  'rushed-mobile-user': 'Casey',
  'first-time-visitor': 'Jordan',
  'slow-connection-user': 'Morgan',
  'non-native-english': 'Ren',
  'design-critic': 'Quinn',
};

describe('PAGE_TYPE_PERSONAS mapping', () => {
  const mapping = extractMapping();

  it('covers all expected page types', () => {
    const expected = ['landing-page', 'e-commerce', 'content', 'form-heavy', 'app-like', 'general'];
    for (const type of expected) {
      assert.ok(mapping[type], `Missing page type: ${type}`);
    }
  });

  it('every page type maps to 3-4 personas', () => {
    for (const [type, data] of Object.entries(mapping)) {
      assert.ok(data.ids.length >= 3 && data.ids.length <= 4,
        `${type} should have 3-4 personas, got ${data.ids.length}`);
    }
  });

  it('every persona ID in every mapping is a valid built-in persona', () => {
    for (const [type, data] of Object.entries(mapping)) {
      for (const id of data.ids) {
        assert.ok(VALID_PERSONA_IDS.includes(id),
          `${type} references invalid persona ID: ${id}`);
      }
    }
  });

  it('names array matches ids array via humanName mapping', () => {
    for (const [type, data] of Object.entries(mapping)) {
      assert.equal(data.ids.length, data.names.length,
        `${type}: ids and names arrays must have same length`);
      for (let i = 0; i < data.ids.length; i++) {
        const expectedName = ID_TO_NAME[data.ids[i]];
        assert.equal(data.names[i], expectedName,
          `${type}[${i}]: name "${data.names[i]}" should be "${expectedName}" for ${data.ids[i]}`);
      }
    }
  });

  it('general fallback always includes screen-reader-user', () => {
    assert.ok(mapping['general'].ids.includes('screen-reader-user'),
      'general fallback must include screen-reader-user for accessibility baseline');
  });

  it('no page type has an empty persona list', () => {
    for (const [type, data] of Object.entries(mapping)) {
      assert.ok(data.ids.length > 0, `${type} has empty persona list`);
    }
  });

  it('every persona appears in at least one page type', () => {
    const allMapped = new Set();
    for (const data of Object.values(mapping)) {
      data.ids.forEach(id => allMapped.add(id));
    }
    for (const id of VALID_PERSONA_IDS) {
      assert.ok(allMapped.has(id),
        `Persona ${id} is not used by any page type mapping`);
    }
  });
});

describe('analyze-page command existence', () => {
  it('pixelslop-browser.cjs contains the analyze-page command', () => {
    const src = readFileSync(BROWSER_CJS, 'utf-8');
    assert.ok(src.includes("'analyze-page'"), 'should have analyze-page case in runBrowserCommand');
    assert.ok(src.includes('analyzePageCommand'), 'should have analyzePageCommand function');
    assert.ok(src.includes('analyzePageType'), 'should have analyzePageType function');
  });

  it('content heuristic uses article structure signals, not only body text density', () => {
    const src = readFileSync(BROWSER_CJS, 'utf-8');
    assert.ok(src.includes('paragraphCount'), 'should track paragraphCount');
    assert.ok(src.includes('headingCount'), 'should track headingCount');
    assert.ok(src.includes('articleTextDensity'), 'should track articleTextDensity');
    assert.ok(src.includes('signals.articleTextDensity >= 220'), 'should classify content using articleTextDensity threshold');
    assert.ok(src.includes('signals.paragraphCount >= 4'), 'should consider paragraph count for content pages');
    assert.ok(src.includes('signals.headingCount >= 2'), 'should consider heading count for content pages');
  });
});
