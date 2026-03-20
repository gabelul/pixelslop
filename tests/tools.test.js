/**
 * pixelslop-tools CLI Unit Tests
 *
 * Tests every command group against temp directories.
 * Validates both human and --raw output modes, error handling,
 * frontmatter parsing, plan state management, and checkpoint operations.
 *
 * Run: node --test tests/tools.test.js
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { execSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TOOLS = join(__dirname, '..', 'bin', 'pixelslop-tools.cjs');

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

/**
 * Run pixelslop-tools with given args in a specific working directory.
 * @param {string} args - CLI arguments
 * @param {string} cwd - Working directory
 * @param {boolean} expectError - If true, don't throw on non-zero exit
 * @returns {{ stdout: string, stderr: string, exitCode: number }}
 */
function run(args, cwd, expectError = false) {
  try {
    const stdout = execSync(`node "${TOOLS}" ${args}`, {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
    return { stdout: stdout.trim(), stderr: '', exitCode: 0 };
  } catch (e) {
    if (!expectError) throw e;
    return {
      stdout: (e.stdout || '').trim(),
      stderr: (e.stderr || '').trim(),
      exitCode: e.status || 1
    };
  }
}

/**
 * Run pixelslop-tools and parse JSON output.
 * @param {string} args - CLI arguments (--raw is appended)
 * @param {string} cwd - Working directory
 * @returns {object} Parsed JSON result
 */
function runJson(args, cwd) {
  const { stdout } = run(`${args} --raw`, cwd);
  return JSON.parse(stdout);
}

/**
 * Create a temp directory with a git repo and package.json.
 * @param {object} pkg - package.json contents
 * @returns {string} Path to temp directory
 */
function createTestRepo(pkg = { name: 'test', scripts: { build: 'echo ok' } }) {
  const dir = mkdtempSync(join(tmpdir(), 'pixelslop-test-'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg));
  execSync('git init && git add . && git commit -m "init"', {
    cwd: dir,
    encoding: 'utf-8',
    stdio: 'pipe'
  });
  return dir;
}

// ─────────────────────────────────────────────
// Tests: CLI basics
// ─────────────────────────────────────────────

describe('pixelslop-tools CLI basics', () => {
  it('shows usage with no args', () => {
    const { stdout } = run('', process.cwd());
    assert.ok(stdout.includes('Usage:'), 'should show usage text');
    assert.ok(stdout.includes('plan'), 'should list plan group');
  });

  it('fails on unknown group', () => {
    const { exitCode, stderr } = run('nonexistent foo', process.cwd(), true);
    assert.equal(exitCode, 1, 'should exit with code 1');
    assert.ok(stderr.includes('Unknown group'), 'should mention unknown group');
  });

  it('fails on unknown command in valid group', () => {
    const { exitCode, stderr } = run('plan nonexistent', process.cwd(), true);
    assert.equal(exitCode, 1);
    assert.ok(stderr.includes('Unknown plan command'));
  });
});

// ─────────────────────────────────────────────
// Tests: Plan commands
// ─────────────────────────────────────────────

describe('plan commands', () => {
  let dir;

  beforeEach(() => {
    dir = createTestRepo();
  });

  it('plan begin creates .pixelslop-plan.md', () => {
    const result = runJson('plan begin --url http://localhost:3000 --root .', dir);
    assert.equal(result.status, 'created');
    assert.ok(existsSync(join(dir, '.pixelslop-plan.md')));
  });

  it('plan begin fails without --url', () => {
    const { exitCode } = run('plan begin --raw', dir, true);
    assert.equal(exitCode, 1);
  });

  it('plan begin fails if plan already exists', () => {
    run('plan begin --url http://localhost:3000 --root .', dir);
    const { exitCode } = run('plan begin --url http://localhost:3000 --root . --raw', dir, true);
    assert.equal(exitCode, 1);
  });

  it('plan begin writes issues from JSON', () => {
    const issues = JSON.stringify([
      { id: 'contrast-cta', priority: 'P0', category: 'accessibility', description: 'Low contrast' },
      { id: 'gradient-h1', priority: 'P1', category: 'slop', description: 'Gradient text' }
    ]);
    run(`plan begin --url http://localhost:3000 --root . --issues '${issues}'`, dir);
    const content = readFileSync(join(dir, '.pixelslop-plan.md'), 'utf-8');
    assert.ok(content.includes('[pending] contrast-cta P0 [accessibility]'));
    assert.ok(content.includes('[pending] gradient-h1 P1 [slop]'));
  });

  it('plan begin writes scores table', () => {
    const scores = JSON.stringify({ Hierarchy: 3, Typography: 2 });
    run(`plan begin --url http://localhost:3000 --root . --scores '${scores}'`, dir);
    const content = readFileSync(join(dir, '.pixelslop-plan.md'), 'utf-8');
    assert.ok(content.includes('Hierarchy'));
    assert.ok(content.includes('| Pillar | Before | After |'));
  });

  it('plan update changes issue status', () => {
    const issues = JSON.stringify([{ id: 'test-issue', priority: 'P0', category: 'accessibility', description: 'Test' }]);
    run(`plan begin --url http://localhost:3000 --root . --issues '${issues}'`, dir);
    const result = runJson('plan update test-issue fixed', dir);
    assert.equal(result.new_status, 'fixed');

    const content = readFileSync(join(dir, '.pixelslop-plan.md'), 'utf-8');
    assert.ok(content.includes('[fixed] test-issue'));
    assert.ok(!content.includes('[pending] test-issue'));
  });

  it('plan update works on in-progress status (hyphenated)', () => {
    const issues = JSON.stringify([{ id: 'x', priority: 'P0', category: 'a', description: 'b' }]);
    run(`plan begin --url http://localhost:3000 --root . --issues '${issues}'`, dir);
    run('plan update x in-progress', dir);
    // Now update from in-progress to fixed — tests the [\w-]+ regex
    const result = runJson('plan update x fixed', dir);
    assert.equal(result.new_status, 'fixed');
    const content = readFileSync(join(dir, '.pixelslop-plan.md'), 'utf-8');
    assert.ok(content.includes('[fixed] x'));
  });

  it('plan update rejects invalid status', () => {
    const issues = JSON.stringify([{ id: 'x', priority: 'P0', category: 'a', description: 'b' }]);
    run(`plan begin --url http://localhost:3000 --root . --issues '${issues}'`, dir);
    const { exitCode } = run('plan update x invalid-status --raw', dir, true);
    assert.equal(exitCode, 1);
  });

  it('plan get returns frontmatter fields', () => {
    run('plan begin --url http://localhost:3000 --root . --mode visual-editable', dir);
    const result = runJson('plan get mode', dir);
    assert.equal(result.mode, 'visual-editable');
  });

  it('plan get issues returns parsed issues', () => {
    const issues = JSON.stringify([
      { id: 'a', priority: 'P0', category: 'accessibility', description: 'Issue A' },
      { id: 'b', priority: 'P1', category: 'slop', description: 'Issue B' }
    ]);
    run(`plan begin --url http://localhost:3000 --root . --issues '${issues}'`, dir);
    const result = runJson('plan get issues', dir);
    assert.equal(result.length, 2);
    assert.equal(result[0].id, 'a');
    assert.equal(result[1].priority, 'P1');
  });

  it('plan advance moves to next pending issue', () => {
    const issues = JSON.stringify([
      { id: 'a', priority: 'P0', category: 'accessibility', description: 'Issue A' },
      { id: 'b', priority: 'P1', category: 'slop', description: 'Issue B' }
    ]);
    run(`plan begin --url http://localhost:3000 --root . --issues '${issues}'`, dir);
    const result = runJson('plan advance', dir);
    assert.equal(result.next_issue.id, 'a');
    assert.equal(result.next_issue.category, 'accessibility');
  });

  it('plan snapshot returns full state', () => {
    const issues = JSON.stringify([
      { id: 'a', priority: 'P0', category: 'accessibility', description: 'Issue A' }
    ]);
    run(`plan begin --url http://localhost:3000 --root . --issues '${issues}'`, dir);
    run('plan update a fixed', dir);
    const snapshot = runJson('plan snapshot', dir);
    assert.equal(snapshot.summary.fixed, 1);
    assert.equal(snapshot.summary.pending, 0);
    assert.equal(snapshot.summary.total, 1);
    assert.equal(snapshot.url, 'http://localhost:3000');
  });

  it('plan json returns frontmatter only', () => {
    run('plan begin --url http://localhost:3000 --root . --mode visual-editable', dir);
    const result = runJson('plan json', dir);
    assert.equal(result.url, 'http://localhost:3000');
    assert.equal(result.mode, 'visual-editable');
    assert.ok(!result.issues, 'json should not include issues array');
  });

  it('plan patch updates multiple issues at once', () => {
    const issues = JSON.stringify([
      { id: 'a', priority: 'P0', category: 'accessibility', description: 'A' },
      { id: 'b', priority: 'P1', category: 'slop', description: 'B' }
    ]);
    run(`plan begin --url http://localhost:3000 --root . --issues '${issues}'`, dir);
    const result = runJson('plan patch --a fixed --b failed', dir);
    assert.ok(result.results.every(r => r.ok), 'all updates should succeed');

    const content = readFileSync(join(dir, '.pixelslop-plan.md'), 'utf-8');
    assert.ok(content.includes('[fixed] a'));
    assert.ok(content.includes('[failed] b'));
  });
});

// ─────────────────────────────────────────────
// Tests: Checkpoint commands
// ─────────────────────────────────────────────

describe('checkpoint commands', () => {
  let dir;

  beforeEach(() => {
    dir = createTestRepo();
  });

  it('checkpoint create saves metadata and backup', () => {
    const result = runJson('checkpoint create test-issue --files package.json', dir);
    assert.equal(result.issue_id, 'test-issue');
    assert.equal(result.status, 'pending');
    assert.ok(existsSync(join(dir, '.pixelslop', 'checkpoints', 'test-issue.json')));
    assert.ok(existsSync(join(dir, '.pixelslop', 'checkpoints', 'test-issue')));
  });

  it('checkpoint create fails for untracked files', () => {
    writeFileSync(join(dir, 'untracked.txt'), 'hello');
    const { exitCode, stderr } = run('checkpoint create test --files untracked.txt --raw', dir, true);
    assert.equal(exitCode, 1);
    assert.ok(stderr.includes('not tracked'));
  });

  it('checkpoint revert restores original file', () => {
    // Create checkpoint
    run('checkpoint create test-issue --files package.json', dir);

    // Modify the file
    const original = readFileSync(join(dir, 'package.json'), 'utf-8');
    writeFileSync(join(dir, 'package.json'), '{"name":"modified"}');

    // Revert
    const result = runJson('checkpoint revert test-issue', dir);
    assert.ok(result.status, 'reverted');

    // Verify content restored
    const restored = readFileSync(join(dir, 'package.json'), 'utf-8');
    assert.equal(restored, original);
  });

  it('checkpoint verify checks metadata', () => {
    run('checkpoint create test-issue --files package.json', dir);
    const result = runJson('checkpoint verify test-issue', dir);
    assert.ok(result.valid);
    assert.equal(result.issue_id, 'test-issue');
    assert.ok(result.has_backups);
  });

  it('checkpoint verify returns invalid for missing checkpoint', () => {
    const result = runJson('checkpoint verify nonexistent', dir);
    assert.ok(!result.valid);
  });

  it('checkpoint list shows all checkpoints', () => {
    run('checkpoint create issue-a --files package.json', dir);
    const result = runJson('checkpoint list', dir);
    assert.equal(result.checkpoints.length, 1);
    assert.equal(result.checkpoints[0].issue_id, 'issue-a');
  });

  it('checkpoint list returns empty when no checkpoints', () => {
    const result = runJson('checkpoint list', dir);
    assert.equal(result.checkpoints.length, 0);
  });
});

// ─────────────────────────────────────────────
// Tests: Gate commands
// ─────────────────────────────────────────────

describe('gate commands', () => {
  it('gate resolve detects build script from package.json', () => {
    const dir = createTestRepo({ name: 'test', scripts: { build: 'echo ok' } });
    const result = runJson('gate resolve', dir);
    assert.ok(result.command.includes('build'));
    assert.equal(result.source, 'package.json:build');
  });

  it('gate resolve prefers typecheck over build', () => {
    const dir = createTestRepo({ name: 'test', scripts: { typecheck: 'tsc', build: 'vite build' } });
    const result = runJson('gate resolve', dir);
    assert.ok(result.command.includes('typecheck'));
    assert.equal(result.source, 'package.json:typecheck');
  });

  it('gate resolve returns null for dev-only projects', () => {
    const dir = createTestRepo({ name: 'test', scripts: { dev: 'vite' } });
    const result = runJson('gate resolve', dir);
    assert.equal(result.command, null);
    assert.equal(result.source, 'skip:dev-only');
  });

  it('gate run reports pass for successful command', () => {
    const dir = createTestRepo({ name: 'test', scripts: { build: 'echo ok' } });
    const result = runJson('gate run', dir);
    assert.ok(result.pass);
    assert.equal(result.exit_code, 0);
  });

  it('gate run reports fail for broken command', () => {
    const dir = createTestRepo({ name: 'test', scripts: { build: 'exit 1' } });
    const result = runJson('gate run', dir);
    assert.ok(!result.pass);
    assert.equal(result.exit_code, 1);
  });

  it('gate baseline records result in plan if exists', () => {
    const dir = createTestRepo({ name: 'test', scripts: { build: 'echo ok' } });
    run('plan begin --url http://localhost:3000 --root .', dir);
    const result = runJson('gate baseline', dir);
    assert.ok(result.pass);
    assert.ok(result.recorded);
  });
});

// ─────────────────────────────────────────────
// Tests: Config commands
// ─────────────────────────────────────────────

describe('config commands', () => {
  let dir;

  beforeEach(() => {
    dir = createTestRepo();
  });

  it('config write creates .pixelslop.md', () => {
    run('config write --audience "Young devs" --brand "Minimal"', dir);
    assert.ok(existsSync(join(dir, '.pixelslop.md')));
    const content = readFileSync(join(dir, '.pixelslop.md'), 'utf-8');
    assert.ok(content.includes('## Audience'));
    assert.ok(content.includes('Young devs'));
  });

  it('config read parses sections', () => {
    run('config write --audience "Young devs" --brand "Minimal" --build-cmd "npm run build"', dir);
    const result = runJson('config read', dir);
    assert.equal(result.audience, 'Young devs');
    assert.equal(result.brand, 'Minimal');
    assert.equal(result.build, 'npm run build');
  });

  it('config exists returns true when config exists', () => {
    run('config write --audience "test"', dir);
    const result = runJson('config exists', dir);
    assert.ok(result.exists);
  });

  it('config exists returns false when no config', () => {
    const result = runJson('config exists', dir);
    assert.ok(!result.exists);
  });
});

// ─────────────────────────────────────────────
// Tests: Init commands
// ─────────────────────────────────────────────

describe('init commands', () => {
  it('init scan returns full context for local URL + git repo', () => {
    const dir = createTestRepo({ name: 'test', scripts: { build: 'echo ok' } });
    const result = runJson('init scan --url http://localhost:3000 --root .', dir);
    assert.equal(result.mode, 'visual-editable');
    assert.equal(result.url_type, 'local');
    assert.ok(result.root_valid);
    assert.ok(result.root_has_git);
    assert.ok(result.root_has_package_json);
    assert.ok(result.gate_command);
  });

  it('init scan returns report-only for remote URLs', () => {
    const dir = createTestRepo();
    const result = runJson('init scan --url https://example.com --root .', dir);
    assert.equal(result.mode, 'visual-report-only');
    assert.equal(result.url_type, 'remote');
  });

  it('init scan detects existing plan', () => {
    const dir = createTestRepo();
    run('plan begin --url http://localhost:3000 --root .', dir);
    const result = runJson('init scan --url http://localhost:3000 --root .', dir);
    assert.ok(result.existing_plan);
    assert.equal(result.existing_plan.url, 'http://localhost:3000');
  });

  it('init scan detects config', () => {
    const dir = createTestRepo();
    run('config write --audience "Young devs"', dir);
    const result = runJson('init scan --url http://localhost:3000 --root .', dir);
    assert.ok(result.pixelslop_config);
    assert.equal(result.pixelslop_config.audience, 'Young devs');
  });

  it('init check returns issue context', () => {
    const dir = createTestRepo();
    const issues = JSON.stringify([
      { id: 'contrast-cta', priority: 'P0', category: 'accessibility', description: 'CTA contrast 2.28:1' }
    ]);
    run(`plan begin --url http://localhost:3000 --root . --issues '${issues}'`, dir);
    run('checkpoint create contrast-cta --files package.json', dir);
    const result = runJson('init check --issue contrast-cta', dir);
    assert.equal(result.issue_id, 'contrast-cta');
    assert.equal(result.issue_pillar, 'accessibility');
    assert.ok(result.checkpoint_exists);
  });
});

// ─────────────────────────────────────────────
// Tests: Verify commands
// ─────────────────────────────────────────────

describe('verify commands', () => {
  let dir;

  beforeEach(() => {
    dir = createTestRepo();
  });

  it('verify plan passes for valid plan', () => {
    run('plan begin --url http://localhost:3000 --root . --mode visual-editable', dir);
    const result = runJson('verify plan', dir);
    assert.ok(result.valid);
  });

  it('verify session detects pending issues', () => {
    const issues = JSON.stringify([
      { id: 'a', priority: 'P0', category: 'accessibility', description: 'A' }
    ]);
    run(`plan begin --url http://localhost:3000 --root . --issues '${issues}'`, dir);
    const result = runJson('verify session', dir);
    assert.ok(!result.complete);
    assert.equal(result.pending.length, 1);
  });

  it('verify session reports complete when all resolved', () => {
    const issues = JSON.stringify([
      { id: 'a', priority: 'P0', category: 'accessibility', description: 'A' }
    ]);
    run(`plan begin --url http://localhost:3000 --root . --issues '${issues}'`, dir);
    run('plan update a fixed', dir);
    const result = runJson('verify session', dir);
    assert.ok(result.complete);
  });

  it('verify checkpoints validates checkpoint files', () => {
    run('checkpoint create test-issue --files package.json', dir);
    const result = runJson('verify checkpoints', dir);
    assert.ok(result.valid);
    assert.equal(result.checkpoints.length, 1);
  });

  it('verify screenshots handles missing directory', () => {
    const result = runJson('verify screenshots', dir);
    assert.ok(!result.valid);
  });
});

// ─────────────────────────────────────────────
// Tests: --cwd flag
// ─────────────────────────────────────────────

describe('--cwd flag', () => {
  it('--cwd overrides working directory', () => {
    const dir = createTestRepo({ name: 'test', scripts: { build: 'echo ok' } });
    const result = runJson(`--cwd "${dir}" gate resolve`, process.cwd());
    assert.ok(result.command);
  });
});
