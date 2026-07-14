/**
 * Vision-first persona engine tests.
 *
 * Personas used to be synthesized inline by the orchestrator by matching triggers against measured
 * findings — a voice narrating a spreadsheet. Now each page-relevant persona is a spawned vision
 * agent that opens the screenshots and reacts as that human first, then grounds the reaction in
 * evidence. These guard that wiring: the new evaluator, page-relevant selection, the spawn + inline
 * fallback, and the docs that drive it. (Read-only boundary + TOML conversion are covered in
 * evaluator.test.js / codex-toml.test.js, which auto-discover internal agents.)
 *
 * Run: node --test tests/vision-personas.test.js
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const readDist = (rel) => readFileSync(join(ROOT, 'dist', rel), 'utf-8');
const readBin = (rel) => readFileSync(join(ROOT, 'bin', rel), 'utf-8');

describe('the persona evaluator is vision-first', () => {
  const agent = readDist('agents/internal/pixelslop-eval-persona.md');

  it('exists with the right name and read-only tools', () => {
    assert.ok(/name:\s*pixelslop-eval-persona/.test(agent), 'agent should be named pixelslop-eval-persona');
    // Inspect the frontmatter only — the body legitimately contains words like "write" in prose.
    // The full read-only boundary is enforced in evaluator.test.js against parsed frontmatter.
    const frontmatter = agent.split('---')[1] || '';
    assert.ok(/tools:\s*\n\s*-\s*Read/.test(frontmatter), 'agent should have only the Read tool');
    assert.ok(!/Write|Edit|Bash|playwright|browser_/.test(frontmatter), 'frontmatter must not grant write/exec/browser tools');
  });

  it('opens the screenshots and reacts before measuring', () => {
    assert.ok(/screenshot/i.test(agent), 'must reference opening screenshots');
    assert.ok(/react first|five-second|React first/i.test(agent), 'must react first, before measuring');
    assert.ok(/reactedTo/.test(agent), 'must return reactedTo (the viewports it opened)');
    // The order rule — reaction leads, measurement grounds — is the whole point.
    assert.ok(/react first, measure second|reaction leads/i.test(agent),
      'must state that reaction leads and measurement grounds it');
  });

  it('produces the rigid persona anchors, never a score', () => {
    assert.ok(/humanName/.test(agent) && /workedWell/.test(agent) && /priority/i.test(agent),
      'output must carry the fields the Persona Insights anchors need');
    assert.ok(/never a score|no.*score|\/20/i.test(agent), 'must never produce a /20 score');
  });
});

describe('the orchestrator selects page-relevant personas', () => {
  const orch = readDist('agents/pixelslop.md');

  it('uses analyze-page to pick the page-relevant set', () => {
    assert.ok(/analyze-page/.test(orch), 'orchestrator should call browser analyze-page for selection');
    assert.ok(/suggestedPersonas/.test(orch), 'orchestrator should read suggestedPersonas');
    assert.ok(/page-relevant/i.test(orch), 'orchestrator should frame selection as page-relevant');
  });

  it('honors the personas setting: none skips, all = suggested + project, explicit overrides', () => {
    assert.ok(/`none`[^\n]*skip/i.test(orch), 'none should skip persona evaluation');
    assert.ok(/project-specific persona/i.test(orch), 'all should add project-specific personas');
    assert.ok(/explicit list|override/i.test(orch), 'an explicit list should override page-type selection');
  });
});

describe('the orchestrator spawns persona evaluators with a fallback', () => {
  const orch = readDist('agents/pixelslop.md');

  it('spawns one persona evaluator per selected persona', () => {
    assert.ok(/pixelslop-eval-persona/.test(orch), 'orchestrator should spawn pixelslop-eval-persona');
    assert.ok(/one per persona|per persona selected|× N/i.test(orch), 'one evaluator per selected persona');
  });

  it('passes register to the persona evaluators too', () => {
    assert.ok(/persona evaluator/i.test(orch) && /register/.test(orch),
      'register should reach the persona evaluators, not just the design-director');
  });

  it('has an inline fallback that still opens the screenshots', () => {
    assert.ok(/inline/i.test(orch), 'must document an inline fallback');
    assert.ok(/adopting each persona.?s lens|open the screenshots and react/i.test(orch),
      'inline fallback must still be vision-first');
  });

  it('renders Persona Insights from the returned JSON, not inline synthesis', () => {
    // The old "Match frustrationTriggers ... against specialist findings" instruction must be gone.
    assert.ok(!/Match frustrationTriggers and positiveSignals against specialist findings/.test(orch),
      'the old data-first persona synthesis must be replaced');
    assert.ok(/persona evaluator that returned findings|formatting their reads/i.test(orch),
      'Persona Insights should format the spawned evaluators\' reads');
  });
});

describe('docs teach the vision-first read', () => {
  it('scoring.md Rule 1 allows visual evidence', () => {
    const scoring = readDist('skill/resources/scoring.md');
    assert.ok(/vision-first/i.test(scoring), 'scoring.md should say persona reactions are vision-first');
    assert.ok(/screenshot IS browser evidence|A screenshot IS/i.test(scoring),
      'scoring.md should state a screenshot counts as evidence');
  });

  it('the persona schema documents the vision-first engine', () => {
    const schema = readDist('skill/resources/personas/schema.md');
    assert.ok(/vision-first/i.test(schema), 'schema should document the vision-first read');
    assert.ok(/pixelslop-eval-persona/.test(schema), 'schema should name the persona evaluator');
  });
});
