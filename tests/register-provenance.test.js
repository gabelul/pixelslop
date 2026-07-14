/**
 * Register + critique-provenance wiring tests.
 *
 * Two review-framing features, kept on-thesis:
 *   1. Register (brand vs product) — captured at setup, stored in .pixelslop.md, and used to
 *      calibrate ONLY the judgment pass. Measured pillars stay register-blind.
 *   2. Provenance — the report declares whether the 7 evaluators ran isolated or inline, with a
 *      visible DEGRADED banner on the inline path, so a weakened (anchored) run is never silent.
 *
 * These pin the documented wiring so it can't quietly drift apart. The config-write round-trip is
 * exercised in tools.test.js; here we guard the agent/skill prose that drives the behaviour.
 *
 * Run: node --test tests/register-provenance.test.js
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const readDist = (rel) => readFileSync(join(ROOT, 'dist', rel), 'utf-8');
const readBin = (rel) => readFileSync(join(ROOT, 'bin', rel), 'utf-8');

describe('register — captured at setup', () => {
  const setup = readDist('agents/pixelslop-setup.md');

  it('the setup agent forms a register hypothesis and returns it', () => {
    assert.ok(/register hypothesis/i.test(setup), 'setup should describe forming a register hypothesis');
    assert.ok(setup.includes('"register"'), 'findings JSON should carry a register field');
    assert.ok(/brand/.test(setup) && /product/.test(setup), 'both register values should be documented');
  });

  it('the setup agent asks a register question first', () => {
    assert.ok(/Register/.test(setup), 'question guidelines should list register');
  });
});

describe('register — stored and used', () => {
  it('config write accepts and validates the register flag', () => {
    const tools = readBin('pixelslop-tools.cjs');
    assert.ok(tools.includes('args.register'), 'configWrite should read args.register');
    assert.ok(tools.includes("'## Register'".replace(/'/g, '') ) || tools.includes('## Register'),
      'configWrite should write a Register section');
    assert.ok(/reg === 'brand' \|\| reg === 'product'/.test(tools),
      'configWrite should only accept brand/product');
  });

  it('the orchestrator passes register to config write and to the design-director only', () => {
    const orch = readDist('agents/pixelslop.md');
    assert.ok(orch.includes('--register'), 'orchestrator should write register via config write');
    assert.ok(/design-director \(evidence_path, thorough flag, register\)/.test(orch),
      'design-director spawn should receive register');
    assert.ok(/measured specialists stay register-blind|register-blind/i.test(orch),
      'orchestrator should keep measured pillars register-blind');
  });

  it('the design-director calibrates judgment on register but never scores', () => {
    const dd = readDist('agents/internal/pixelslop-eval-design-director.md');
    assert.ok(/\*\*register\*\*/i.test(dd) || /register/.test(dd), 'director should document the register input');
    assert.ok(/brand/.test(dd) && /product/.test(dd), 'director should split brand vs product judgment');
    assert.ok(/never touch the \/20|no.*score|never affects the \/20/i.test(dd),
      'director must still never touch the score');
  });
});

describe('register — the next-action recommendation', () => {
  it('the orchestrator recommends a single highest-leverage next move', () => {
    const orch = readDist('agents/pixelslop.md');
    assert.ok(/Recommended next/i.test(orch), 'scan summary should include a Recommended next block');
    assert.ok(/highest-leverage|biggest lever|biggest win/i.test(orch),
      'the recommendation should lead with the biggest lever');
  });
});

describe('provenance — the report declares how it ran', () => {
  const orch = readDist('agents/pixelslop.md');
  const scoring = readDist('skill/resources/scoring.md');

  it('the report header carries a Method line', () => {
    assert.ok(orch.includes('Method:'), 'orchestrator report template should have a Method line');
    assert.ok(scoring.includes('Method:'), 'scoring.md report contract should document the Method line');
  });

  it('the inline fallback must emit a DEGRADED banner', () => {
    assert.ok(/DEGRADED/.test(orch), 'orchestrator should define the DEGRADED banner');
    assert.ok(/isolated \(7 evaluators spawned\)/.test(orch), 'the isolated (good) path should be spelled out');
    assert.ok(/silent degraded run/i.test(orch), 'the point of the banner — no silent degraded runs — should be stated');
  });

  it('the scoring contract shows both the isolated and degraded forms', () => {
    assert.ok(/isolated/.test(scoring) && /DEGRADED/.test(scoring),
      'scoring.md should show both Method forms');
  });
});
