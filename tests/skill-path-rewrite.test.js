/**
 * Skill Path Rewrite Tests
 *
 * Regression guard for a real bug: the installer copied the skill tree to the
 * install root WITHOUT rewriting its `bin/pixelslop-tools.cjs` references, so
 * SKILL.md (and fix guides like checkpoint-protocol.md) kept relative paths.
 * That made `/pixelslop` work only from the repo checkout and report
 * "tools.cjs not installed" in every other project.
 *
 * rewriteSkillTreePaths rewrites every .md under the installed skill the same
 * way agent specs are rewritten. These tests pin that, and that the shipped
 * source genuinely needs it (so the test can't pass vacuously).
 *
 * Run: node --test tests/skill-path-rewrite.test.js
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { rewriteSkillTreePaths } from '../bin/pixelslop.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('rewriteSkillTreePaths', () => {
  it('rewrites relative tool paths in SKILL.md and nested resources to absolute', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pxs-skillrw-'));
    const installRoot = join(dir, 'root');
    const skillDir = join(installRoot, 'skill');
    mkdirSync(join(skillDir, 'resources'), { recursive: true });

    writeFileSync(join(skillDir, 'SKILL.md'), 'Run `node bin/pixelslop-tools.cjs init`.\n');
    writeFileSync(join(skillDir, 'resources', 'checkpoint-protocol.md'),
      'Run `node bin/pixelslop-tools.cjs checkpoint create`.\n');
    // a non-md file must be left alone
    writeFileSync(join(skillDir, 'resources', 'report-template.html'), '<p>bin/pixelslop-tools.cjs</p>');

    rewriteSkillTreePaths(skillDir, installRoot);

    const skill = readFileSync(join(skillDir, 'SKILL.md'), 'utf8');
    const guide = readFileSync(join(skillDir, 'resources', 'checkpoint-protocol.md'), 'utf8');
    const html = readFileSync(join(skillDir, 'resources', 'report-template.html'), 'utf8');

    assert.ok(skill.includes(join(installRoot, 'bin', 'pixelslop-tools.cjs')), 'SKILL.md → absolute');
    assert.ok(!/[^/]bin\/pixelslop-tools\.cjs/.test(skill), 'no relative ref left in SKILL.md');
    assert.ok(guide.includes(join(installRoot, 'bin', 'pixelslop-tools.cjs')), 'resource guide → absolute');
    assert.ok(html.includes('bin/pixelslop-tools.cjs'), 'non-md files are untouched');

    rmSync(dir, { recursive: true, force: true });
  });

  it('is a no-op on files without paths to rewrite', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pxs-skillrw-'));
    const skillDir = join(dir, 'skill');
    mkdirSync(skillDir, { recursive: true });
    const original = '# Just docs, no tool calls.\n';
    writeFileSync(join(skillDir, 'notes.md'), original);
    rewriteSkillTreePaths(skillDir, dir);
    assert.equal(readFileSync(join(skillDir, 'notes.md'), 'utf8'), original);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('the shipped skill genuinely needs rewriting (no vacuous pass)', () => {
  it('dist/skill/SKILL.md ships with relative tool paths', () => {
    const skill = readFileSync(join(ROOT, 'dist', 'skill', 'SKILL.md'), 'utf8');
    assert.ok(/[^/]bin\/pixelslop-tools\.cjs/.test(skill),
      'source SKILL.md uses relative paths — that is what the install must rewrite');
  });
});
