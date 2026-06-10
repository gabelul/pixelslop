/**
 * Codex Agent TOML Tests
 *
 * agentMdToCodexToml converts a Pixelslop agent spec (Markdown + YAML
 * frontmatter) into a Codex custom-agent TOML so Codex can spawn our agents
 * natively instead of only running them inline.
 *
 * The fragile bits, pinned here:
 *   - the three required Codex fields (name, description, developer_instructions)
 *   - model/sandbox_mode are NOT emitted (they'd wrongly pin a Claude model)
 *   - the body goes in a literal ''' block so backslashes and regex in code
 *     examples survive verbatim (a basic """ string would mangle them)
 *   - real shipped specs all convert; bad input returns null, not garbage
 *
 * Run: node --test tests/codex-toml.test.js
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { agentMdToCodexToml } from '../bin/pixelslop.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const SAMPLE = `---
name: pixelslop-eval-sample
description: >
  A folded multi-line description that should
  collapse onto a single TOML line.
model: sonnet
tools:
  - Read
---

You are the sample evaluator.

Detect with a regex like \\d+px and a Windows path C:\\Users\\x.
`;

describe('agentMdToCodexToml — required fields', () => {
  const toml = agentMdToCodexToml(SAMPLE);

  it('emits name, description, developer_instructions', () => {
    assert.match(toml, /^name = "pixelslop-eval-sample"$/m);
    assert.match(toml, /^description = ".+"$/m);
    assert.match(toml, /developer_instructions = '''/);
    assert.ok(toml.trimEnd().endsWith("'''"), 'closes the literal block');
  });

  it('collapses a folded description onto one line', () => {
    const line = toml.match(/^description = "(.+)"$/m)[1];
    assert.ok(!line.includes('\n'), 'single line');
    assert.ok(line.includes('collapse onto a single TOML line'), 'content preserved');
  });

  it('does NOT emit model or sandbox_mode (they must inherit)', () => {
    assert.ok(!/^model\s*=/m.test(toml), 'no model field — would pin a Claude model');
    assert.ok(!/^sandbox_mode\s*=/m.test(toml), 'no sandbox_mode field');
  });

  it('preserves backslashes and regex verbatim (literal block, not basic)', () => {
    assert.ok(toml.includes('\\d+px'), 'regex backslash survives');
    assert.ok(toml.includes('C:\\Users\\x'), 'windows path backslashes survive');
  });
});

describe('agentMdToCodexToml — edge cases', () => {
  it('returns null with no frontmatter', () => {
    assert.equal(agentMdToCodexToml('# just markdown'), null);
  });
  it('returns null when name is missing', () => {
    assert.equal(agentMdToCodexToml('---\ndescription: x\n---\nbody'), null);
  });
  it('handles an inline (non-folded) description', () => {
    const toml = agentMdToCodexToml('---\nname: a\ndescription: one line desc\n---\nbody');
    assert.match(toml, /^description = "one line desc"$/m);
  });
});

describe('every shipped agent spec converts cleanly', () => {
  const specs = [
    ...readdirSync(join(ROOT, 'dist', 'agents')).filter(f => f.endsWith('.md')),
    ...readdirSync(join(ROOT, 'dist', 'agents', 'internal')).filter(f => f.endsWith('.md') && !f.startsWith('._')).map(f => join('internal', f)),
  ];

  for (const rel of specs) {
    it(`converts ${rel}`, () => {
      const md = readFileSync(join(ROOT, 'dist', 'agents', rel), 'utf-8');
      const toml = agentMdToCodexToml(md);
      assert.ok(toml, `${rel} must convert`);
      assert.match(toml, /^name = ".+"$/m, `${rel} has a name`);
      assert.match(toml, /^description = ".+"$/m, `${rel} has a description`);
      assert.ok(toml.includes("developer_instructions = '''"), `${rel} has instructions`);
      // the literal block must actually close — no stray ''' inside the body
      const opens = (toml.match(/'''/g) || []).length;
      assert.equal(opens, 2, `${rel} literal block opens and closes exactly once`);
    });
  }
});
