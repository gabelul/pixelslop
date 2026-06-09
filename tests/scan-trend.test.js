/**
 * Score Trend Tests
 *
 * `scan save-results` now appends a compact entry to a per-target history file,
 * and `scan trend` reads it back as a score progression. These tests pin the
 * total computation (sum of five pillar scores, capped at 20), the per-target
 * filtering, the --last window, and the best-effort guarantee: a broken history
 * file must never sink the actual save.
 *
 * Run: node --test tests/scan-trend.test.js
 */

import { describe, it, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TOOLS = join(ROOT, 'bin', 'pixelslop-tools.cjs');

function run(args) {
  const stdout = execFileSync('node', [TOOLS, ...args], { encoding: 'utf-8' });
  try { return { stdout, json: JSON.parse(stdout) }; } catch { return { stdout, json: null }; }
}

// Build a scan-results payload with the given pillar scores and metadata.
function results({ target = 'http://site', ts = '2026-06-01T00:00:00Z', h = 2, t = 2, c = 2, r = 3, a = 2 }) {
  return JSON.stringify({
    url: target,
    timestamp: ts,
    scores: {
      hierarchy: { score: h }, typography: { score: t }, color: { score: c },
      responsiveness: { score: r }, accessibility: { score: a }
    },
    findings: []
  });
}

describe('scan trend', () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'pxs-trend-')); });
  const save = (payload) => run(['scan', 'save-results', '--json', payload, '--root', dir, '--raw']);
  const cleanup = () => { try { rmSync(dir, { recursive: true, force: true }); } catch {} };

  it('returns empty on a project with no history', () => {
    const { json } = run(['scan', 'trend', '--root', dir, '--raw']);
    assert.equal(json.count, 0);
    assert.deepEqual(json.scores, []);
    cleanup();
  });

  it('accrues a score per run and reports the progression', () => {
    save(results({ ts: '2026-06-01T00:00:00Z', h: 2, t: 2 })); // 2+2+2+3+2 = 11
    save(results({ ts: '2026-06-02T00:00:00Z', h: 3, t: 3 })); // 3+3+2+3+2 = 13
    save(results({ ts: '2026-06-03T00:00:00Z', h: 4, t: 3 })); // 4+3+2+3+2 = 14
    const { json } = run(['scan', 'trend', '--root', dir, '--raw']);
    assert.deepEqual(json.scores, [11, 13, 14]);
    assert.equal(json.delta, 3);
    cleanup();
  });

  it('caps the per-run total at 20', () => {
    save(results({ h: 4, t: 4, c: 4, r: 4, a: 4 })); // 20
    const { json } = run(['scan', 'trend', '--root', dir, '--raw']);
    assert.equal(json.scores[0], 20);
    cleanup();
  });

  it('filters by target', () => {
    save(results({ target: 'http://a', h: 2, t: 2 }));   // a -> 11
    save(results({ target: 'http://b', h: 4, t: 4 }));   // b -> 17
    save(results({ target: 'http://a', h: 3, t: 3 }));   // a -> 13
    const { json } = run(['scan', 'trend', '--target', 'http://a', '--root', dir, '--raw']);
    assert.deepEqual(json.scores, [11, 13], 'only target a entries');
    assert.equal(json.count, 2);
    cleanup();
  });

  it('honours --last to window the history', () => {
    for (let i = 0; i < 5; i++) save(results({ ts: `2026-06-0${i + 1}T00:00:00Z`, h: 1 + (i % 4) }));
    const { json } = run(['scan', 'trend', '--last', '2', '--root', dir, '--raw']);
    assert.equal(json.count, 2, 'only the last 2 runs');
    cleanup();
  });

  it('does not duplicate or lose the scan-results.json itself', () => {
    save(results({ h: 3 }));
    assert.ok(existsSync(join(dir, '.pixelslop', 'scan-results.json')), 'results still written');
    assert.ok(existsSync(join(dir, '.pixelslop', 'scan-history.json')), 'history written alongside');
    cleanup();
  });

  it('best-effort: a corrupt history file never breaks the save', () => {
    mkdirSync(join(dir, '.pixelslop'), { recursive: true });
    writeFileSync(join(dir, '.pixelslop', 'scan-history.json'), '{ this is not json', 'utf-8');
    const { json } = save(results({ h: 3 }));
    assert.equal(json.ok, true, 'save still succeeds despite corrupt history');
    // and the history file is rewritten as a valid array on the next save
    const hist = JSON.parse(readFileSync(join(dir, '.pixelslop', 'scan-history.json'), 'utf-8'));
    assert.ok(Array.isArray(hist) && hist.length === 1, 'corrupt history reset to a fresh array');
    cleanup();
  });
});
