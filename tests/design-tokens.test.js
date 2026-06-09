/**
 * Design Tokens Tests
 *
 * Covers the fix-target token layer: pixelslop-tools `config read-tokens` /
 * `config write-tokens`, and the contract that the fixer reads tokens, the
 * setup agent writes them, and the fix guides prefer them.
 *
 * The point of tokens is that a fix moves *toward* the project's intended
 * palette/type/spacing instead of inventing a generic value. These tests pin
 * the storage (flat key: value under ## Design Tokens), the merge behaviour,
 * and that writing tokens never clobbers design context or settings.
 *
 * Run: node --test tests/design-tokens.test.js
 */

import { describe, it, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TOOLS = join(ROOT, 'bin', 'pixelslop-tools.cjs');
const readDist = (rel) => readFileSync(join(ROOT, 'dist', rel), 'utf-8');

// Run the CLI, return { ok, stdout, json } — json parsed when --raw output is JSON.
function run(args, { expectFail = false } = {}) {
  try {
    const stdout = execFileSync('node', [TOOLS, ...args], { encoding: 'utf-8' });
    let json = null;
    try { json = JSON.parse(stdout); } catch { /* not json */ }
    return { ok: true, stdout, json };
  } catch (e) {
    if (!expectFail) throw e;
    return { ok: false, stdout: (e.stdout || '') + (e.stderr || '') };
  }
}

describe('config read-tokens / write-tokens', () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'pxs-tokens-')); });
  const cleanup = () => { try { rmSync(dir, { recursive: true, force: true }); } catch {} };

  it('reads no tokens on a fresh project', () => {
    const { json } = run(['config', 'read-tokens', '--root', dir, '--raw']);
    assert.deepEqual(json, { tokens: {}, hasTokens: false });
    cleanup();
  });

  it('round-trips tokens written as JSON', () => {
    run(['config', 'write-tokens', '--root', dir, '--raw', '--json',
      '{"color-primary":"#b8422e","font-body":"Inter, sans-serif","type-scale":"1.25"}']);
    const { json } = run(['config', 'read-tokens', '--root', dir, '--raw']);
    assert.equal(json.hasTokens, true);
    assert.equal(json.tokens['color-primary'], '#b8422e');
    assert.equal(json.tokens['font-body'], 'Inter, sans-serif');
    assert.equal(json.tokens['type-scale'], '1.25');
    cleanup();
  });

  it('merges on a second write, preserving earlier tokens', () => {
    run(['config', 'write-tokens', '--root', dir, '--raw', '--json', '{"color-primary":"#b8422e"}']);
    run(['config', 'write-tokens', '--root', dir, '--raw', '--json', '{"color-bg":"#faf7f2"}']);
    const { json } = run(['config', 'read-tokens', '--root', dir, '--raw']);
    assert.equal(json.tokens['color-primary'], '#b8422e', 'first token survives the second write');
    assert.equal(json.tokens['color-bg'], '#faf7f2');
    cleanup();
  });

  it('a later write updates an existing token value', () => {
    run(['config', 'write-tokens', '--root', dir, '--raw', '--json', '{"color-primary":"#b8422e"}']);
    run(['config', 'write-tokens', '--root', dir, '--raw', '--json', '{"color-primary":"#15803d"}']);
    const { json } = run(['config', 'read-tokens', '--root', dir, '--raw']);
    assert.equal(json.tokens['color-primary'], '#15803d');
    cleanup();
  });

  it('does not clobber design context or settings', () => {
    // Context is the initializer, settings layer on, then tokens — the real flow.
    run(['config', 'write', '--audience', 'developers', '--brand', 'technical', '--root', dir, '--raw']);
    run(['config', 'set', 'headed', 'true', '--root', dir, '--raw']);
    run(['config', 'write-tokens', '--root', dir, '--raw', '--json', '{"color-primary":"#b8422e"}']);

    const content = readFileSync(join(dir, '.pixelslop.md'), 'utf-8');
    assert.ok(content.includes('## Audience'), 'audience section survives token write');
    assert.ok(content.includes('developers'), 'audience content survives');
    assert.ok(content.includes('## Settings'), 'settings section survives token write');
    assert.ok(content.includes('headed: true'), 'setting value survives');
    assert.ok(content.includes('## Design Tokens'), 'tokens section is present');
    assert.ok(content.includes('color-primary: #b8422e'), 'token value is present');

    // And every layer still reads back correctly.
    assert.equal(run(['config', 'read-tokens', '--root', dir, '--raw']).json.tokens['color-primary'], '#b8422e');
    assert.equal(run(['config', 'get', 'headed', '--root', dir, '--raw']).json.value, true);
    cleanup();
  });

  it('rejects invalid JSON', () => {
    const { ok, stdout } = run(['config', 'write-tokens', '--root', dir, '--raw', '--json', '{not json}'], { expectFail: true });
    assert.equal(ok, false);
    assert.match(stdout, /Invalid --json/i);
    cleanup();
  });

  it('rejects a JSON array (must be an object)', () => {
    const { ok } = run(['config', 'write-tokens', '--root', dir, '--raw', '--json', '["a","b"]'], { expectFail: true });
    assert.equal(ok, false);
    cleanup();
  });

  it('sanitizes newline injection in token values', () => {
    run(['config', 'write-tokens', '--root', dir, '--raw', '--json',
      '{"color-primary":"#b8422e\\n## Settings\\nheaded: true"}']);
    const { json } = run(['config', 'read-tokens', '--root', dir, '--raw']);
    // The newline is flattened, so no fake Settings section is injected.
    assert.ok(!/\n/.test(json.tokens['color-primary']), 'value must not contain a newline');
    assert.equal(run(['config', 'get', 'headed', '--root', dir, '--raw']).json.source, 'default',
      'injected Settings must not take effect');
    cleanup();
  });

  it('accepts tokens via --data lines too', () => {
    run(['config', 'write-tokens', '--root', dir, '--raw', '--data', 'color-primary: #b8422e\nspace-unit: 4px']);
    const { json } = run(['config', 'read-tokens', '--root', dir, '--raw']);
    assert.equal(json.tokens['color-primary'], '#b8422e');
    assert.equal(json.tokens['space-unit'], '4px');
    cleanup();
  });
});

describe('token fix-target wiring contract', () => {
  it('the fixer loads tokens before applying a fix', () => {
    const fixer = readDist('agents/pixelslop-fixer.md');
    assert.ok(fixer.includes('config read-tokens'), 'fixer should read tokens');
    assert.ok(/fix.*toward|toward.*token/i.test(fixer), 'fixer should fix toward tokens');
  });

  it('the setup agent captures tokens', () => {
    const setup = readDist('agents/pixelslop-setup.md');
    assert.ok(setup.includes('config write-tokens'), 'setup should write tokens it discovers');
  });

  it('the color, type, and spacing guides prefer project tokens', () => {
    assert.ok(/read-tokens|project's colors first/i.test(readDist('skill/resources/colorize.md')));
    assert.ok(/read-tokens|type tokens first/i.test(readDist('skill/resources/typeset.md')));
    assert.ok(/read-tokens|spacing scale first/i.test(readDist('skill/resources/arrange.md')));
  });
});
