/**
 * Skill Discoverability Tests
 *
 * SKILL.md is what an AI agent reads when it invokes /pixelslop — it's the only
 * place the agent (and through it, the user) learns what Pixelslop can do. The
 * failure mode is drift: we add a flag or a command in the code, and forget to
 * advertise it in SKILL.md, so nobody ever uses it.
 *
 * These tests are the guard. The setting keys are extracted live from
 * pixelslop-tools.cjs, so adding a setting and forgetting to document it fails
 * the build. The flag/command/capability lists are curated — when you add one,
 * add it here and to SKILL.md together. That coupling is the point.
 *
 * Run: node --test tests/skill-discoverability.test.js
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKILL = readFileSync(join(ROOT, 'dist', 'skill', 'SKILL.md'), 'utf-8');
const TOOLS = readFileSync(join(ROOT, 'bin', 'pixelslop-tools.cjs'), 'utf-8');

// Pull the real setting keys straight from SETTING_DEFS so the test tracks code.
function settingKeys() {
  const block = TOOLS.match(/const SETTING_DEFS = \{([\s\S]*?)\};/);
  assert.ok(block, 'SETTING_DEFS block must exist in pixelslop-tools.cjs');
  return [...block[1].matchAll(/^\s*([a-z]+):\s*\{/gm)].map((m) => m[1]);
}

describe('SKILL.md advertises every setting', () => {
  for (const key of settingKeys()) {
    it(`mentions the "${key}" setting`, () => {
      assert.ok(SKILL.includes(key),
        `SKILL.md never mentions the "${key}" setting — an agent won't know it exists. Add it to the Capabilities section and args.`);
    });
  }
});

describe('SKILL.md advertises every run flag', () => {
  // Curated: when you add a flag, add it here and to SKILL.md together.
  const flags = ['--fast', '--thorough', '--deep', '--personas', '--code-check', '--quick', '--headed', '--settings', '--debug'];
  for (const flag of flags) {
    it(`mentions ${flag}`, () => {
      assert.ok(SKILL.includes(flag), `SKILL.md never mentions ${flag}`);
    });
  }
});

describe('SKILL.md advertises every major capability', () => {
  const capabilities = {
    'design-director / judgment layer': /design.director|design judgment|judgment finding/i,
    'project-specific personas': /project-specific persona|personas write|generated from your audience/i,
    'score trends': /scan trend|score trend/i,
    'design tokens': /read-tokens|design tokens/i,
    'fix loop': /fix loop|checkpoint/i,
    'code-check mode': /code-check/i,
  };
  for (const [name, re] of Object.entries(capabilities)) {
    it(`mentions ${name}`, () => {
      assert.ok(re.test(SKILL), `SKILL.md never mentions ${name} — it's invisible to agents and users.`);
    });
  }
});

describe('the frontmatter description sells the breadth', () => {
  const fm = SKILL.slice(0, SKILL.indexOf('user-invokable'));
  it('the trigger description mentions personas, judgment, trends, tokens, and fast', () => {
    for (const word of ['persona', 'judgment', 'trend', 'token', 'fast']) {
      assert.ok(new RegExp(word, 'i').test(fm),
        `frontmatter description omits "${word}" — that surface is what agents see in the skill list before invoking.`);
    }
  });
});

describe('a capabilities overview section exists', () => {
  it('SKILL.md has a Capabilities & Options menu', () => {
    assert.ok(/## Capabilities & Options/i.test(SKILL),
      'SKILL.md must have a single canonical Capabilities & Options section');
  });
});

describe('the skill drives advisory behaviour, not a config form', () => {
  it('has an advise-the-user playbook', () => {
    assert.ok(/## Advise/i.test(SKILL),
      'SKILL.md must have an advisory section so any harness leads with a recommendation, not a settings form');
  });
  it('tells the agent to recommend by intent and not open with raw settings questions', () => {
    assert.ok(/lead with a recommendation/i.test(SKILL), 'must instruct leading with a recommendation');
    assert.ok(/intent/i.test(SKILL), 'must map user intent to a run');
    assert.ok(/advisor, not a config form|advise, don.t interrogate/i.test(SKILL), 'must frame the agent as an advisor');
  });
});
