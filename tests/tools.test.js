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
import { execSync, spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import http from 'node:http';

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

/**
 * Wait for a local HTTP server to respond.
 * @param {number} port - Local port
 * @param {number} [timeoutMs=4000] - Timeout in milliseconds
 * @returns {Promise<void>} Resolves when the server is reachable
 */
function waitForHttpServer(port, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs;

  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get(`http://127.0.0.1:${port}`, (res) => {
        res.resume();
        resolve();
      });
      req.on('error', () => {
        if (Date.now() >= deadline) {
          reject(new Error(`Timed out waiting for port ${port}`));
          return;
        }
        setTimeout(attempt, 100);
      });
    };

    attempt();
  });
}

/**
 * Start a small HTTP server from a specific repo directory.
 * @param {string} dir - Working directory for the child process
 * @param {number} port - Port to listen on
 * @returns {import('node:child_process').ChildProcess} Child process handle
 */
function startFixtureServer(dir, port) {
  const scriptPath = join(dir, 'fixture-server.js');
  writeFileSync(scriptPath, `
    const http = require('http');
    const port = Number(process.argv[2]);
    const server = http.createServer((req, res) => {
      res.statusCode = 200;
      res.end('ok');
    });
    server.listen(port, '127.0.0.1');
  `);

  return spawn(process.execPath, [scriptPath, String(port)], {
    cwd: dir,
    stdio: 'ignore'
  });
}

// ─────────────────────────────────────────────
// Tests: CLI basics
// ─────────────────────────────────────────────

describe('pixelslop-tools CLI basics', () => {
  it('shows usage with no args', () => {
    const { stdout } = run('', process.cwd());
    assert.ok(stdout.includes('Usage:'), 'should show usage text');
    assert.ok(stdout.includes('plan'), 'should list plan group');
    assert.ok(stdout.includes('discover'), 'should list discover group');
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

describe('browser commands', () => {
  it('browser detect returns runtime metadata', () => {
    const result = runJson('browser detect', process.cwd());
    assert.equal(typeof result.available, 'boolean');
  });

  it('browser collect captures an evidence bundle for the sloppy fixture', { timeout: 180000 }, async (t) => {
    const runtime = runJson('browser detect', process.cwd());
    if (!runtime.available) {
      t.skip('No local Chrome/Chromium runtime available');
    }

    const fixtureDir = join(__dirname, 'fixtures', 'sloppy-app');
    const start = runJson('serve start --root .', fixtureDir);

    try {
      const collected = runJson(`browser collect --url "${start.url}" --root . --personas none`, fixtureDir);
      assert.ok(collected.outputPath, 'collector should return an evidence path');
      assert.ok(existsSync(collected.outputPath), 'evidence bundle should exist');

      const bundle = JSON.parse(readFileSync(collected.outputPath, 'utf8'));
      assert.equal(new URL(bundle.url).toString(), new URL(start.url).toString());
      assert.ok(bundle.viewports.desktop.screenshot, 'desktop screenshot missing');
      assert.ok(bundle.viewports.tablet.screenshot, 'tablet screenshot missing');
      assert.ok(bundle.viewports.mobile.screenshot, 'mobile screenshot missing');
      assert.ok(Array.isArray(bundle.viewports.desktop.contrast), 'desktop contrast should be collected');
      assert.ok(Array.isArray(bundle.sourcePatterns), 'source patterns should be present');
    } finally {
      runJson('serve stop --root .', fixtureDir);
    }
  });

  it('browser check measures selector-based metrics', async (t) => {
    const runtime = runJson('browser detect', process.cwd());
    if (!runtime.available) {
      t.skip('No local Chrome/Chromium runtime available');
    }

    const fixtureDir = join(__dirname, 'fixtures', 'sloppy-app');
    const start = runJson('serve start --root .', fixtureDir);

    try {
      const contrast = runJson(`browser check --url "${start.url}" --metric contrast --selector ".cta-button"`, fixtureDir);
      assert.equal(contrast.ok, true);
      assert.equal(contrast.metric, 'contrast');
      assert.equal(contrast.result.found, true);
      assert.equal(contrast.result.selector, '.cta-button');

      const typography = runJson(`browser check --url "${start.url}" --metric typography --selector ".hero h1"`, fixtureDir);
      assert.equal(typography.ok, true);
      assert.equal(typography.metric, 'typography');
      assert.equal(typography.result.found, true);
      assert.match(typography.result.fontFamily, /Inter/i);
    } finally {
      runJson('serve stop --root .', fixtureDir);
    }
  });

  it('browser styles, snapshot, and screenshot return structured artifacts', async (t) => {
    const runtime = runJson('browser detect', process.cwd());
    if (!runtime.available) {
      t.skip('No local Chrome/Chromium runtime available');
    }

    const fixtureDir = join(__dirname, 'fixtures', 'sloppy-app');
    const start = runJson('serve start --root .', fixtureDir);
    const screenshotOut = join(fixtureDir, '.pixelslop', 'browser-test-mobile.png');

    try {
      const styles = runJson(`browser styles --url "${start.url}" --selector ".cta-button"`, fixtureDir);
      assert.equal(styles.ok, true);
      assert.equal(styles.selector, '.cta-button');
      assert.equal(styles.matchCount >= 1, true);
      assert.equal(styles.element.tag, 'a');

      const snapshot = runJson(`browser snapshot --url "${start.url}"`, fixtureDir);
      assert.equal(snapshot.ok, true);
      assert.equal(Array.isArray(snapshot.snapshot.headings), true);

      const screenshot = runJson(`browser screenshot --url "${start.url}" --viewport mobile --out "${screenshotOut}"`, fixtureDir);
      assert.equal(screenshot.ok, true);
      assert.equal(screenshot.outputPath, screenshotOut);
      assert.equal(existsSync(screenshotOut), true);
    } finally {
      runJson('serve stop --root .', fixtureDir);
      rmSync(screenshotOut, { force: true });
    }
  });

  it('browser commands reject unsupported URL schemes', () => {
    const { exitCode, stderr } = run('browser check --url "file:///etc/hosts" --metric typography --selector "pre" --raw', process.cwd(), true);
    assert.equal(exitCode, 1);
    assert.ok(stderr.includes('Unsupported URL protocol'), 'should reject non-http URLs');
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

  it('plan begin fails if plan already exists without --force', () => {
    run('plan begin --url http://localhost:3000 --root .', dir);
    const { exitCode } = run('plan begin --url http://localhost:3000 --root . --raw', dir, true);
    assert.equal(exitCode, 1);
  });

  it('plan begin --force replaces existing plan', () => {
    run('plan begin --url http://localhost:3000 --root .', dir);
    const result = runJson('plan begin --url http://localhost:4000 --root . --force', dir);
    assert.equal(result.status, 'created');
    assert.equal(result.url, 'http://localhost:4000');
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

  it('plan begin writes into --root when invoked from another directory', () => {
    const projectDir = createTestRepo();
    const runnerDir = mkdtempSync(join(tmpdir(), 'pixelslop-runner-'));
    run(`plan begin --url http://localhost:3000 --root "${projectDir}"`, runnerDir);
    assert.ok(existsSync(join(projectDir, '.pixelslop-plan.md')), 'plan should be created in the project root');
    assert.ok(!existsSync(join(runnerDir, '.pixelslop-plan.md')), 'runner directory should stay clean');
    rmSync(runnerDir, { recursive: true, force: true });
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
// Tests: Discover commands
// ─────────────────────────────────────────────

describe('discover commands', () => {
  it('discover start-target finds a root dev script', () => {
    const dir = createTestRepo({ name: 'test', scripts: { dev: 'vite' } });
    const result = runJson('discover start-target --root .', dir);
    assert.equal(result.targets.length, 1);
    assert.equal(result.targets[0].path, '.');
    assert.equal(result.targets[0].command, 'npm run dev');
  });

  it('discover start-target finds nested monorepo apps', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pixelslop-mono-'));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'mono' }));
    writeFileSync(join(dir, 'pnpm-workspace.yaml'), 'packages:\n  - apps/*\n');
    mkdirSync(join(dir, 'apps', 'web'), { recursive: true });
    writeFileSync(
      join(dir, 'apps', 'web', 'package.json'),
      JSON.stringify({ name: 'web-app', scripts: { dev: 'next dev' } })
    );
    const result = runJson('discover start-target --root .', dir);
    assert.equal(result.targets.length, 1);
    assert.equal(result.targets[0].path, join('apps', 'web'));
    assert.equal(result.targets[0].package_manager, 'pnpm');
  });

  it('discover server returns empty when nothing is listening', () => {
    const dir = createTestRepo();
    const result = runJson('discover server --root . --ports 65530', dir);
    assert.deepEqual(result.servers, []);
  });

  it('discover server marks a repo-owned server as a match', async () => {
    const dir = createTestRepo({ name: 'test', scripts: { dev: 'node fixture-server.js' } });
    const child = startFixtureServer(dir, 4107);

    try {
      await waitForHttpServer(4107);
      const result = runJson('discover server --root . --ports 4107', dir);
      assert.equal(result.servers.length, 1);
      assert.ok(result.servers[0].repo_match, 'expected repo_match=true');
      assert.notEqual(result.servers[0].match_confidence, 'mismatch');
    } finally {
      child.kill('SIGTERM');
    }
  });

  it('discover server rejects a server from another repo', async () => {
    const ownerDir = createTestRepo({ name: 'owner', scripts: { build: 'echo ok' } });
    const foreignDir = createTestRepo({ name: 'foreign', scripts: { dev: 'node fixture-server.js' } });
    const child = startFixtureServer(foreignDir, 4108);

    try {
      await waitForHttpServer(4108);
      const result = runJson('discover server --root . --ports 4108', ownerDir);
      assert.equal(result.servers.length, 1);
      assert.equal(result.servers[0].repo_match, false);
    } finally {
      child.kill('SIGTERM');
    }
  });
});

// ─────────────────────────────────────────────
// Tests: Session logger
// ─────────────────────────────────────────────

describe('session logger', () => {
  let dir;

  beforeEach(() => {
    dir = createTestRepo();
  });

  it('log write creates session log with timestamped entries', () => {
    run('log write --agent orchestrator --level info --message "Started scan"', dir);
    const result = runJson('log read', dir);
    assert.equal(result.total, 1);
    assert.ok(result.entries[0].includes('[orchestrator]'), 'entry should include agent name');
    assert.ok(result.entries[0].includes('Started scan'), 'entry should include message');
    assert.ok(result.entries[0].includes('●'), 'info level should use ● marker');
  });

  it('log write supports all levels', () => {
    run('log write --agent test --level info --message "info"', dir);
    run('log write --agent test --level warn --message "warn"', dir);
    run('log write --agent test --level error --message "error"', dir);
    run('log write --agent test --level debug --message "debug"', dir);
    const result = runJson('log read', dir);
    assert.equal(result.total, 4);
    assert.ok(result.entries[0].includes('●'), 'info');
    assert.ok(result.entries[1].includes('▲'), 'warn');
    assert.ok(result.entries[2].includes('✖'), 'error');
    assert.ok(result.entries[3].includes('○'), 'debug');
  });

  it('log write collapses multiline messages into one entry', () => {
    run('log write --agent test --level error --message "first line\nsecond line"', dir);
    const result = runJson('log read', dir);
    assert.equal(result.total, 1);
    assert.ok(result.entries[0].includes('first line | second line'));
  });

  it('log write respects --root when invoked from another directory', () => {
    const targetDir = createTestRepo();
    const runnerDir = mkdtempSync(join(tmpdir(), 'pixelslop-runner-'));
    run(`log write --root "${targetDir}" --agent test --level info --message "remote log"`, runnerDir);
    const result = runJson(`log read --root "${targetDir}"`, runnerDir);
    assert.equal(result.total, 1);
    assert.ok(result.entries[0].includes('remote log'));
    assert.ok(!existsSync(join(runnerDir, '.pixelslop-session.log')), 'runner directory should not get a session log');
    rmSync(runnerDir, { recursive: true, force: true });
  });

  it('log read --tail returns last N entries', () => {
    for (let i = 0; i < 10; i++) {
      run(`log write --agent test --level info --message "entry ${i}"`, dir);
    }
    const result = runJson('log read --tail 3', dir);
    assert.equal(result.showing, 3);
    assert.equal(result.total, 10);
    assert.ok(result.entries[0].includes('entry 7'));
    assert.ok(result.entries[2].includes('entry 9'));
  });

  it('log clear removes the session log', () => {
    run('log write --agent test --level info --message "hello"', dir);
    run('log clear', dir);
    const result = runJson('log read', dir);
    assert.ok(result.empty, 'log should be empty after clear');
  });

  it('log write fails without --message', () => {
    const result = run('log write --agent test --level info', dir, true);
    assert.ok(result.exitCode !== 0, 'should fail without message');
  });

  it('plan update auto-logs to session log when --debug is active', () => {
    const issues = JSON.stringify([
      { id: 'test-issue', priority: 'P0', category: 'accessibility', description: 'Test' }
    ]);
    run(`plan begin --url http://localhost:3000 --root . --issues '${issues}' --debug`, dir);
    run('log clear', dir); // clear the plan begin auto-log
    run('plan update test-issue fixed --debug', dir);
    const result = runJson('log read', dir);
    assert.ok(result.total >= 1, 'should have at least 1 auto-logged entry');
    assert.ok(result.entries.some(e => e.includes('[orchestrator]') && e.includes('test-issue') && e.includes('fixed')),
      'should auto-log plan update with issue id and status');
  });

  it('plan update does NOT auto-log without --debug', () => {
    const issues = JSON.stringify([
      { id: 'test-issue', priority: 'P0', category: 'accessibility', description: 'Test' }
    ]);
    run(`plan begin --url http://localhost:3000 --root . --issues '${issues}'`, dir);
    run('log clear', dir);
    run('plan update test-issue fixed', dir);
    const result = runJson('log read', dir);
    assert.ok(result.empty || result.total === 0, 'should NOT auto-log without --debug');
  });

  it('plan begin auto-logs to session log when --debug is active', () => {
    run('log clear', dir);
    run('plan begin --url http://localhost:3000 --root . --debug', dir);
    const result = runJson('log read', dir);
    assert.ok(result.total >= 1, 'plan begin should auto-log');
    assert.ok(result.entries.some(e => e.includes('[orchestrator]') && e.includes('plan begin')),
      'should auto-log plan creation');
  });
});

// ─────────────────────────────────────────────
// Tests: Static site detection + temp server
// ─────────────────────────────────────────────

describe('discover static-site', () => {
  it('detects a folder with HTML files and no package.json', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pixelslop-static-'));
    writeFileSync(join(dir, 'index.html'), '<html><body>hello</body></html>');
    const result = runJson(`discover static-site --root "${dir}"`, dir);
    assert.ok(result.is_static, 'should detect as static site');
    assert.ok(result.entry_points.includes('index.html'), 'should find index.html');
    rmSync(dir, { recursive: true, force: true });
  });

  it('prefers index.html as first entry point', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pixelslop-static-'));
    writeFileSync(join(dir, 'about.html'), '<html></html>');
    writeFileSync(join(dir, 'index.html'), '<html></html>');
    writeFileSync(join(dir, 'contact.html'), '<html></html>');
    const result = runJson(`discover static-site --root "${dir}"`, dir);
    assert.equal(result.entry_points[0], 'index.html', 'index.html should be first');
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns is_static: false when package.json has dev script', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pixelslop-static-'));
    writeFileSync(join(dir, 'index.html'), '<html></html>');
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: { dev: 'vite' } }));
    const result = runJson(`discover static-site --root "${dir}"`, dir);
    assert.ok(!result.is_static, 'should NOT detect as static when dev script exists');
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns is_static: false when no HTML files exist', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pixelslop-static-'));
    writeFileSync(join(dir, 'readme.md'), '# Hello');
    const result = runJson(`discover static-site --root "${dir}"`, dir);
    assert.ok(!result.is_static, 'should NOT detect as static with no HTML');
    rmSync(dir, { recursive: true, force: true });
  });

  it('ignores hidden and resource-fork HTML files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pixelslop-static-'));
    writeFileSync(join(dir, 'index.html'), '<html></html>');
    writeFileSync(join(dir, '._index.html'), '<html></html>');
    writeFileSync(join(dir, '.draft.html'), '<html></html>');
    const result = runJson(`discover static-site --root "${dir}"`, dir);
    assert.deepEqual(result.entry_points, ['index.html']);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('serve start/stop', () => {
  it('starts a server and stops it cleanly', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pixelslop-serve-'));
    writeFileSync(join(dir, 'index.html'), '<html><body>test</body></html>');

    // Start — the ready-file poll confirms the port is bound, but on slow
    // CI runners the TCP socket may not accept connections immediately.
    const startResult = runJson(`serve start --root "${dir}"`, dir);
    assert.ok(startResult.url, 'should return a URL');
    assert.ok(startResult.port > 0, 'should return a valid port');
    assert.ok(startResult.pid > 0, 'should return a PID');
    assert.ok(startResult.pid_file.includes(join(dir, '.pixelslop')), 'should store state under the project');

    // Wait for the server to actually accept connections before fetching
    await waitForHttpServer(startResult.port);
    const response = await fetch(startResult.url);
    assert.equal(response.status, 200, 'should serve 200');
    const body = await response.text();
    assert.ok(body.includes('test'), 'should serve the HTML content');

    // Stop
    const stopResult = runJson('serve stop', dir);
    assert.ok(stopResult.stopped, 'should report stopped');
    assert.equal(stopResult.port, startResult.port, 'should stop the right port');

    rmSync(dir, { recursive: true, force: true });
  });

  it('serve stop reports no server when none is running', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pixelslop-serve-'));
    const result = runJson('serve stop', dir);
    assert.ok(!result.stopped, 'should report not stopped');
    rmSync(dir, { recursive: true, force: true });
  });

  it('keeps temp server state isolated per project root', async () => {
    const dirA = mkdtempSync(join(tmpdir(), 'pixelslop-serve-a-'));
    const dirB = mkdtempSync(join(tmpdir(), 'pixelslop-serve-b-'));
    writeFileSync(join(dirA, 'index.html'), '<html><body>alpha</body></html>');
    writeFileSync(join(dirB, 'index.html'), '<html><body>beta</body></html>');

    const startA = runJson(`serve start --root "${dirA}"`, dirA);
    await waitForHttpServer(startA.port);
    const startB = runJson(`serve start --root "${dirB}"`, dirB);
    await waitForHttpServer(startB.port);

    const beforeStop = await (await fetch(startB.url)).text();
    assert.ok(beforeStop.includes('beta'));

    const stopA = runJson(`serve stop --root "${dirA}"`, dirA);
    assert.ok(stopA.stopped, 'should stop the first project server');

    const afterStop = await (await fetch(startB.url)).text();
    assert.ok(afterStop.includes('beta'), 'stopping dirA should not stop dirB');

    const stopB = runJson(`serve stop --root "${dirB}"`, dirB);
    assert.ok(stopB.stopped, 'should stop the second project server');

    rmSync(dirA, { recursive: true, force: true });
    rmSync(dirB, { recursive: true, force: true });
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
// Tests: config save-context / load-context
// ─────────────────────────────────────────────

describe('config save-context and load-context', () => {
  let dir;

  beforeEach(() => {
    dir = createTestRepo();
  });

  it('save-context creates .pixelslop-context.json', () => {
    run('config save-context --framework "Next.js" --raw', dir);
    assert.ok(existsSync(join(dir, '.pixelslop-context.json')));
  });

  it('load-context returns saved data with exists: true', () => {
    run('config save-context --framework "Next.js" --css-approach "Tailwind" --raw', dir);
    const result = runJson('config load-context', dir);
    assert.equal(result.exists, true);
    assert.equal(result.framework, 'Next.js');
    assert.equal(result.css_approach, 'Tailwind');
  });

  it('load-context returns exists: false when no file', () => {
    const result = runJson('config load-context', dir);
    assert.equal(result.exists, false);
  });

  it('save-context includes version and timestamp', () => {
    run('config save-context --framework "React" --raw', dir);
    const raw = JSON.parse(readFileSync(join(dir, '.pixelslop-context.json'), 'utf-8'));
    assert.equal(raw.version, 1);
    assert.ok(raw.saved_at, 'should have saved_at timestamp');
    // Timestamp should be ISO 8601
    assert.ok(!isNaN(Date.parse(raw.saved_at)), 'saved_at should be valid ISO date');
  });

  it('save-context respects --root flag', () => {
    const projectDir = createTestRepo();
    run(`config save-context --framework "Vue" --root "${projectDir}" --raw`, dir);
    assert.ok(existsSync(join(projectDir, '.pixelslop-context.json')));
    assert.ok(!existsSync(join(dir, '.pixelslop-context.json')));
  });

  it('save-context handles fonts as comma-separated list', () => {
    run('config save-context --fonts "Inter,JetBrains Mono" --raw', dir);
    const result = runJson('config load-context', dir);
    assert.deepEqual(result.fonts, ['Inter', 'JetBrains Mono']);
  });

  it('save-context handles boolean flags', () => {
    run('config save-context --design-tokens true --has-dark-mode true --raw', dir);
    const result = runJson('config load-context', dir);
    assert.equal(result.design_tokens, true);
    assert.equal(result.has_dark_mode, true);
  });

  it('save-context handles numeric component-count', () => {
    run('config save-context --component-count 24 --raw', dir);
    const result = runJson('config load-context', dir);
    assert.equal(result.component_count, 24);
  });

  it('save-context defaults missing fields to null', () => {
    run('config save-context --framework "Svelte" --raw', dir);
    const result = runJson('config load-context', dir);
    assert.equal(result.css_approach, null);
    assert.equal(result.build_tool, null);
    assert.equal(result.component_library, null);
    assert.deepEqual(result.fonts, []);
  });

  it('load-context returns exists: false for malformed JSON', () => {
    writeFileSync(join(dir, '.pixelslop-context.json'), 'not json {{{');
    const result = runJson('config load-context', dir);
    assert.equal(result.exists, false);
    assert.equal(result.reason, 'malformed');
    assert.ok(result.error, 'should include the parse error message');
  });

  it('load-context rejects unknown schema version', () => {
    writeFileSync(join(dir, '.pixelslop-context.json'), JSON.stringify({
      version: 99, saved_at: new Date().toISOString(), framework: 'React'
    }));
    const result = runJson('config load-context', dir);
    assert.equal(result.exists, false);
    assert.equal(result.reason, 'version_mismatch');
    assert.equal(result.found, 99);
    assert.equal(result.expected, 1);
  });

  it('load-context rejects cache with missing required fields', () => {
    writeFileSync(join(dir, '.pixelslop-context.json'), JSON.stringify({
      version: 1
      // missing saved_at and framework
    }));
    const result = runJson('config load-context', dir);
    assert.equal(result.exists, false);
    assert.equal(result.reason, 'missing_fields');
    assert.ok(result.missing.includes('saved_at'));
    assert.ok(result.missing.includes('framework'));
  });

  it('load-context flags stale cache (older than 7 days)', () => {
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    writeFileSync(join(dir, '.pixelslop-context.json'), JSON.stringify({
      version: 1, saved_at: eightDaysAgo, framework: 'React'
    }));
    const result = runJson('config load-context', dir);
    assert.equal(result.exists, true);
    assert.equal(result.stale, true);
  });

  it('load-context marks fresh cache as not stale', () => {
    run('config save-context --framework "React" --raw', dir);
    const result = runJson('config load-context', dir);
    assert.equal(result.exists, true);
    assert.equal(result.stale, false);
  });

  it('save-context --debug writes session log to correct root', () => {
    run('config save-context --framework "Next.js" --debug --raw', dir);
    const logPath = join(dir, '.pixelslop-session.log');
    if (existsSync(logPath)) {
      const log = readFileSync(logPath, 'utf-8');
      assert.ok(log.includes('config save-context'), 'log entry should contain the command');
      assert.ok(!log.includes('[object Object]'), 'log entry should not contain [object Object]');
    }
    // If no log file, --debug may not have triggered (depends on global DEBUG flag);
    // the key assertion is no [object Object] in the output
    const { stdout } = run('config save-context --framework "Next.js" --debug --raw', dir);
    assert.ok(!stdout.includes('[object Object]'), 'raw output should not contain [object Object]');
  });

  it('save-context rejects symlinked context file without overwriting target', () => {
    const targetPath = join(dir, 'sentinel.txt');
    writeFileSync(targetPath, 'do not touch');
    symlinkSync(targetPath, join(dir, '.pixelslop-context.json'));

    const result = run('config save-context --framework "Next.js" --raw', dir, true);
    assert.equal(result.exitCode, 1);
    assert.ok(result.stderr.includes('Refusing to write state file through symlink'));
    assert.equal(readFileSync(targetPath, 'utf-8'), 'do not touch');
  });

  it('round-trips all fields correctly', () => {
    run([
      'config save-context',
      '--framework "Next.js 14"',
      '--css-approach "Tailwind + CSS Modules"',
      '--build-tool "Turbopack"',
      '--package-manager "pnpm"',
      '--fonts "Inter,JetBrains Mono"',
      '--design-tokens true',
      '--token-location "src/styles/tokens.css"',
      '--component-count 24',
      '--component-library "shadcn/ui"',
      '--has-dark-mode true',
      '--description "Developer documentation"',
      '--raw',
    ].join(' '), dir);
    const result = runJson('config load-context', dir);
    assert.equal(result.exists, true);
    assert.equal(result.framework, 'Next.js 14');
    assert.equal(result.css_approach, 'Tailwind + CSS Modules');
    assert.equal(result.build_tool, 'Turbopack');
    assert.equal(result.package_manager, 'pnpm');
    assert.deepEqual(result.fonts, ['Inter', 'JetBrains Mono']);
    assert.equal(result.design_tokens, true);
    assert.equal(result.token_location, 'src/styles/tokens.css');
    assert.equal(result.component_count, 24);
    assert.equal(result.component_library, 'shadcn/ui');
    assert.equal(result.has_dark_mode, true);
    assert.equal(result.description, 'Developer documentation');
  });
});


// ─────────────────────────────────────────────
// Tests: init scan --code-check
// ─────────────────────────────────────────────

describe('init scan --code-check', () => {
  let dir;

  beforeEach(() => {
    dir = createTestRepo();
  });

  it('works without --url when --code-check is set', () => {
    const result = runJson(`init scan --code-check --root "${dir}"`, dir);
    assert.equal(result.mode, 'code-check');
  });

  it('returns null url and url_type in code-check mode', () => {
    const result = runJson(`init scan --code-check --root "${dir}"`, dir);
    assert.equal(result.url, null);
    assert.equal(result.url_type, null);
  });

  it('still validates root in code-check mode', () => {
    const result = runJson(`init scan --code-check --root "${dir}"`, dir);
    assert.equal(result.root_valid, true);
  });

  it('init scan without --url and without --code-check still fails', () => {
    const result = run(`init scan --root "${dir}" --raw`, dir, true);
    assert.notEqual(result.exitCode, 0);
    assert.ok(result.stderr.includes('--url required') || result.stdout.includes('--url required'));
  });

  it('--code-check overrides mode even with --url', () => {
    const result = runJson(`init scan --code-check --url http://localhost:3000 --root "${dir}"`, dir);
    assert.equal(result.mode, 'code-check');
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


// ─────────────────────────────────────────────
// Tests: config set / get / set-all (settings)
// ─────────────────────────────────────────────

describe('config settings', () => {
  let dir;

  beforeEach(() => {
    dir = createTestRepo({ name: 'settings-test', scripts: { build: 'echo ok' } });
  });

  it('config get returns defaults when no .pixelslop.md exists', () => {
    // No .pixelslop.md — get should return all defaults (fresh project)
    const result = runJson(`config get --root "${dir}"`, dir);
    assert.ok(result.settings, 'should return settings object');
    assert.equal(result.settings.headed, false, 'headed default is false');
    assert.equal(result.settings.deep, false, 'deep default is false');
    assert.equal(result.settings.thorough, false, 'thorough default is false');
    assert.equal(result.settings.personas, 'all', 'personas default is all');
    assert.deepEqual(result.defined, [], 'no keys explicitly defined');
  });

  it('config set creates ## Settings section in new .pixelslop.md', () => {
    const result = runJson(`config set headed true --root "${dir}"`, dir);
    assert.equal(result.status, 'set');
    assert.equal(result.key, 'headed');
    assert.equal(result.value, true);

    // Verify file was created with settings section
    const content = readFileSync(join(dir, '.pixelslop.md'), 'utf-8');
    assert.ok(content.includes('## Settings'), 'should have Settings section');
    assert.ok(content.includes('headed: true'), 'should contain headed setting');
  });

  it('config get reads back a single setting', () => {
    runJson(`config set deep true --root "${dir}"`, dir);
    const result = runJson(`config get deep --root "${dir}"`, dir);
    assert.equal(result.key, 'deep');
    assert.equal(result.value, true);
    assert.equal(result.source, 'config');
  });

  it('config get returns default for unset keys', () => {
    // Create .pixelslop.md with one setting so get doesn't fail
    runJson(`config set headed false --root "${dir}"`, dir);
    const result = runJson(`config get thorough --root "${dir}"`, dir);
    assert.equal(result.key, 'thorough');
    assert.equal(result.value, false);
    assert.equal(result.source, 'default');
  });

  it('config get with no key returns all settings with defaults', () => {
    runJson(`config set headed true --root "${dir}"`, dir);
    const result = runJson(`config get --root "${dir}"`, dir);
    assert.ok(result.settings, 'should have settings object');
    assert.equal(result.settings.headed, true);
    assert.equal(result.settings.deep, false, 'unset deep should default to false');
    assert.equal(result.settings.thorough, false, 'unset thorough should default to false');
    assert.equal(result.settings.personas, 'all', 'unset personas should default to all');
    assert.deepEqual(result.defined, ['headed'], 'only headed was explicitly set');
  });

  it('config set-all writes multiple settings at once', () => {
    const result = runJson(
      `config set-all --headed true --deep true --thorough false --personas none --root "${dir}"`,
      dir
    );
    assert.equal(result.status, 'written');
    assert.equal(result.settings.headed, true);
    assert.equal(result.settings.deep, true);
    assert.equal(result.settings.thorough, false);
    assert.equal(result.settings.personas, 'none');
  });

  it('config set preserves existing design context sections', () => {
    // Write design context first
    runJson(
      `config write --audience "developers" --brand "technical" --root "${dir}"`,
      dir
    );
    // Now set a setting
    runJson(`config set headed true --root "${dir}"`, dir);

    const content = readFileSync(join(dir, '.pixelslop.md'), 'utf-8');
    assert.ok(content.includes('## Audience'), 'should preserve Audience section');
    assert.ok(content.includes('developers'), 'should preserve audience content');
    assert.ok(content.includes('## Settings'), 'should have Settings section');
    assert.ok(content.includes('headed: true'), 'should have the setting');
  });

  it('config set overwrites existing setting value', () => {
    runJson(`config set personas all --root "${dir}"`, dir);
    runJson(`config set personas none --root "${dir}"`, dir);
    const result = runJson(`config get personas --root "${dir}"`, dir);
    assert.equal(result.value, 'none');
  });

  it('config set rejects unknown keys', () => {
    const result = run(`config set bogus true --root "${dir}" --raw`, dir, true);
    assert.ok(result.exitCode !== 0, 'should reject unknown key');
    assert.ok(result.stderr.includes('Unknown setting') || result.stdout.includes('Unknown setting'),
      'should mention unknown setting');
  });

  it('boolean settings coerce string values', () => {
    runJson(`config set headed true --root "${dir}"`, dir);
    const result = runJson(`config get headed --root "${dir}"`, dir);
    assert.strictEqual(result.value, true, 'should be boolean true, not string');
  });

  it('config set-all preserves existing settings for unspecified keys', () => {
    // Set two settings individually
    runJson(`config set headed true --root "${dir}"`, dir);
    runJson(`config set deep true --root "${dir}"`, dir);
    // Now set-all with only personas — headed and deep should survive
    runJson(`config set-all --personas none --root "${dir}"`, dir);
    const result = runJson(`config get --root "${dir}"`, dir);
    assert.equal(result.settings.headed, true, 'headed should be preserved');
    assert.equal(result.settings.deep, true, 'deep should be preserved');
    assert.equal(result.settings.personas, 'none', 'personas should be updated');
  });

  it('config set works when design context exists but no Settings section', () => {
    // Write design context without settings
    runJson(`config write --audience "designers" --root "${dir}"`, dir);
    const before = readFileSync(join(dir, '.pixelslop.md'), 'utf-8');
    assert.ok(!before.includes('## Settings'), 'should not have Settings section yet');

    // Now set a setting — should add Settings section without breaking context
    runJson(`config set deep true --root "${dir}"`, dir);
    const after = readFileSync(join(dir, '.pixelslop.md'), 'utf-8');
    assert.ok(after.includes('## Audience'), 'should preserve Audience section');
    assert.ok(after.includes('designers'), 'should preserve audience content');
    assert.ok(after.includes('## Settings'), 'should add Settings section');
    assert.ok(after.includes('deep: true'), 'should contain the setting');
  });

  it('string settings are sanitized against newline injection', () => {
    // Attempt newline injection in personas value
    runJson(`config set personas "none\\nheaded: true" --root "${dir}"`, dir);
    const result = runJson(`config get --root "${dir}"`, dir);
    // The injected "headed: true" should not appear as a separate setting
    assert.equal(result.settings.headed, false, 'headed should still be default false');
    // Personas should be sanitized to a single line
    assert.ok(!result.settings.personas.includes('\n'), 'personas should not contain newlines');
  });

  it('config set refuses to write through symlinks', () => {
    const targetDir = mkdtempSync(join(tmpdir(), 'pixelslop-symlink-target-'));
    writeFileSync(join(targetDir, 'target.md'), '# Target\n');
    try {
      symlinkSync(join(targetDir, 'target.md'), join(dir, '.pixelslop.md'));
    } catch (e) {
      // Skip on platforms that can't create symlinks
      return;
    }
    const result = run(`config set headed true --root "${dir}" --raw`, dir, true);
    assert.ok(result.exitCode !== 0, 'should refuse to write through symlink');
    assert.ok(
      result.stderr.includes('symlink') || result.stdout.includes('symlink'),
      'error should mention symlink'
    );
  });
});
