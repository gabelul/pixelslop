/**
 * Doctor Self-Check Tests
 *
 * `pixelslop-tools doctor` is what the skill runs at preflight so a stale or
 * broken install self-diagnoses instead of failing opaquely (the RankShaker
 * "tools.cjs not installed" confusion). It reports the install version, confirms
 * the tool is reachable, and flags when a newer version is published.
 *
 * Stale detection is tested by seeding the throttle cache, so no network is
 * touched and the test is deterministic.
 *
 * Run: node --test tests/doctor.test.js
 */

import { describe, it, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TOOLS = join(ROOT, 'bin', 'pixelslop-tools.cjs');
const CACHE = join(ROOT, '.pixelslop-doctor-cache.json'); // installRoot === repo root when run from here
const VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8')).version;

function doctor(args = []) {
  const out = execFileSync('node', [TOOLS, 'doctor', ...args], { encoding: 'utf-8' });
  try { return JSON.parse(out); } catch { return { _raw: out.trim() }; }
}
const seedCache = (latest) => writeFileSync(CACHE, JSON.stringify({ checkedAt: new Date().toISOString(), latest }));

describe('pixelslop-tools doctor', () => {
  afterEach(() => { if (existsSync(CACHE)) rmSync(CACHE); });

  it('reports the install version and reachability (offline, no network)', () => {
    const r = doctor(['--offline', '--raw']);
    assert.equal(r.ok, true);
    assert.equal(r.reachable, true);
    assert.equal(r.version, VERSION, 'version comes from package.json in repo context');
    assert.equal(r.stale, false, 'no latest known offline, so not stale');
    assert.equal(r.latestSource, 'offline');
    assert.ok(r.toolPath.endsWith('pixelslop-tools.cjs'), 'reports its own path');
  });

  it('flags stale and prints the update command when a newer version is published', () => {
    seedCache('99.0.0');
    const r = doctor(['--raw']);
    assert.equal(r.stale, true, 'current version is behind the seeded latest');
    assert.equal(r.latest, '99.0.0');
    const human = doctor([])._raw;
    assert.match(human, /behind the latest 99\.0\.0/);
    assert.match(human, /npx pixelslop@latest update/, 'tells the user exactly how to fix it');
  });

  it('is not stale when the published version equals the install', () => {
    seedCache(VERSION);
    const r = doctor(['--raw']);
    assert.equal(r.stale, false);
  });

  it('is not stale when the install is ahead of npm (dev build)', () => {
    seedCache('0.0.1');
    const r = doctor(['--raw']);
    assert.equal(r.stale, false, 'an install ahead of npm is fine, not stale');
  });

  it('uses the cache, not the network, when the cache is fresh', () => {
    seedCache('42.0.0');
    // No --offline, but cache is <24h old, so it must use the cached value, not npm.
    assert.equal(doctor(['--raw']).latest, '42.0.0');
  });
});
