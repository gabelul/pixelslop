/**
 * Personas Tool Tests
 *
 * `personas write` validates and saves a project-specific persona to
 * .pixelslop/personas/, and `personas list` reports built-ins + custom ones so
 * the orchestrator can discover generated personas. The id doubles as the
 * filename, so validation (slug-only, no built-in collisions, no traversal) is
 * a safety boundary, not a nicety.
 *
 * Run: node --test tests/personas-tool.test.js
 */

import { describe, it, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TOOLS = join(ROOT, 'bin', 'pixelslop-tools.cjs');

function run(args) {
  const stdout = execFileSync('node', [TOOLS, ...args], { encoding: 'utf-8' });
  try { return JSON.parse(stdout); } catch { return { _raw: stdout }; }
}
const persona = (over = {}) => JSON.stringify({
  id: 'stressed-bride', name: 'Stressed Bride', category: 'context',
  description: 'A bride three weeks from her wedding, evaluating a planner',
  designPriorities: { hierarchy: 4 },
  frustrationTriggers: ['buried pricing'], positiveSignals: ['clear timeline'],
  ...over
});

describe('personas write / list', () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'pxs-personas-')); });
  const cleanup = () => { try { rmSync(dir, { recursive: true, force: true }); } catch {} };

  it('lists the 8 built-ins and no custom on a fresh project', () => {
    const r = run(['personas', 'list', '--root', dir, '--raw']);
    assert.equal(r.builtin.length, 8);
    assert.deepEqual(r.custom, []);
    cleanup();
  });

  it('writes a valid persona and lists it', () => {
    const w = run(['personas', 'write', '--root', dir, '--raw', '--json', persona()]);
    assert.equal(w.ok, true);
    assert.equal(w.id, 'stressed-bride');
    assert.ok(existsSync(join(dir, '.pixelslop', 'personas', 'stressed-bride.json')));
    const l = run(['personas', 'list', '--root', dir, '--raw']);
    assert.deepEqual(l.custom, ['stressed-bride']);
    cleanup();
  });

  it('rejects an id that collides with a built-in', () => {
    const w = run(['personas', 'write', '--root', dir, '--raw', '--json', persona({ id: 'design-critic' })]);
    assert.equal(w.ok, false);
    assert.match(w.error, /collides/i);
    cleanup();
  });

  it('rejects a non-slug / path-traversal id', () => {
    for (const bad of ['../evil', 'Has Spaces', 'a/b', 'UPPER']) {
      const w = run(['personas', 'write', '--root', dir, '--raw', '--json', persona({ id: bad })]);
      assert.equal(w.ok, false, `id "${bad}" must be rejected`);
    }
    // and nothing escaped the personas dir
    assert.ok(!existsSync(join(dir, 'evil.json')));
    cleanup();
  });

  it('rejects a persona missing required fields', () => {
    const w = run(['personas', 'write', '--root', dir, '--raw', '--json', '{"id":"x"}']);
    assert.equal(w.ok, false);
    assert.match(w.error, /Missing persona fields/i);
    cleanup();
  });

  it('rejects non-array frustrationTriggers', () => {
    const w = run(['personas', 'write', '--root', dir, '--raw', '--json', persona({ frustrationTriggers: 'nope' })]);
    assert.equal(w.ok, false);
    cleanup();
  });

  it('rejects invalid JSON cleanly', () => {
    const w = run(['personas', 'write', '--root', dir, '--raw', '--json', '{not json']);
    assert.equal(w.ok, false);
    assert.match(w.error, /Invalid --json/i);
    cleanup();
  });
});

describe('persona generation is wired into the orchestrator', () => {
  const orch = readFileSync(join(ROOT, 'dist', 'agents', 'pixelslop.md'), 'utf-8');

  it('the orchestrator generates project personas and discovers them', () => {
    assert.ok(orch.includes('personas write'), 'orchestrator writes generated personas');
    assert.ok(orch.includes('personas list'), 'orchestrator discovers custom personas');
    assert.ok(/project-specific persona|project's actual users|tuned to/i.test(orch), 'frames them as project-specific');
  });
});
