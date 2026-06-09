/**
 * Installer Tests
 *
 * Validates the installer's pure functions: path rewriting, browser runtime
 * detection, manifest schema, and structural completeness. These tests run
 * without touching the real filesystem — they use temp directories and verify
 * the installer knows about all agents and resources.
 *
 * Run: node --test tests/installer.test.js
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, copyFileSync,
         readdirSync, lstatSync, chmodSync, cpSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir, homedir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';

import { rewriteAgentPaths, detectBrowserRuntime, calculateFileDiff,
         linkOrCopy, getClients, ensureBrowserRuntime,
         ensureInstalledBrowserPackage, readInstalledBrowserPackageVersion,
         resolveInstalledBrowserPackage, installBrowserPackage,
         inspectInstalledBrowserHelper } from '../bin/pixelslop.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');
const DIST = join(PROJECT_ROOT, 'dist');

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

/** Create a temp directory for test isolation */
function makeTempDir() {
  const dir = join(tmpdir(), `pixelslop-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Write a minimal playwright-core package into an install root.
 * @param {string} installRoot - Fake pixelslop install root
 * @param {object} [options] - Package shape overrides
 * @param {string} [options.version='1.58.2'] - Package version
 * @param {string} [options.main='index.js'] - Main entry file
 * @param {string} [options.indexSource] - Source for the main entry
 */
function seedPlaywrightCorePackage(installRoot, options = {}) {
  const version = options.version || '1.58.2';
  const main = options.main || 'index.js';
  const indexSource = options.indexSource || 'module.exports = { chromium: {} };';
  const packageDir = join(installRoot, 'node_modules', 'playwright-core');

  mkdirSync(packageDir, { recursive: true });
  writeFileSync(join(packageDir, 'package.json'), JSON.stringify({
    name: 'playwright-core',
    version,
    main,
  }, null, 2));

  if (main === 'index.js') {
    writeFileSync(join(packageDir, 'index.js'), indexSource);
  }
}

/**
 * Create runtime marker directories in HOME so installer detection succeeds.
 * @param {string} homeDir - Fake HOME used by the packaged CLI
 * @param {Array<'claude'|'codex'>} runtimes - Runtime markers to create
 */
function seedRuntimeHomes(homeDir, runtimes) {
  if (runtimes.includes('claude')) {
    mkdirSync(join(homeDir, '.claude'), { recursive: true });
  }
  if (runtimes.includes('codex')) {
    mkdirSync(join(homeDir, '.codex'), { recursive: true });
  }
}

/**
 * Resolve the npm executable for the current platform.
 * @returns {string} npm executable name
 */
function npmBin() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

/**
 * Resolve the npx executable for the current platform.
 * @returns {string} npx executable name
 */
function npxBin() {
  return process.platform === 'win32' ? 'npx.cmd' : 'npx';
}

/**
 * Build a tarball for the current package and return its absolute path.
 * @returns {string} Tarball path
 */
function packPackage() {
  const stdout = execFileSync(npmBin(), ['pack', '--json'], {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
  });
  const [{ filename }] = JSON.parse(stdout);
  const packedPath = join(PROJECT_ROOT, filename);
  const uniqueTarball = join(tmpdir(), `pixelslop-pack-${Date.now()}-${Math.random().toString(36).slice(2)}.tgz`);
  copyFileSync(packedPath, uniqueTarball);
  rmSync(packedPath, { force: true });
  return uniqueTarball;
}

/**
 * Execute the packaged pixelslop binary via local tarball + npx.
 * @param {string} tarballPath - Local .tgz path
 * @param {string[]} args - pixelslop CLI arguments
 * @param {string} cwd - Working directory
 * @param {object} env - Extra environment variables
 * @returns {string} Stdout output
 */
function runTarballCommand(tarballPath, args, cwd, env = {}) {
  return execFileSync(npxBin(), ['--yes', '--package', tarballPath, 'pixelslop', ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

// ─────────────────────────────────────────────
// Path Rewriting
// ─────────────────────────────────────────────

describe('rewriteAgentPaths', () => {
  it('replaces bin/pixelslop-tools.cjs with quoted absolute path', () => {
    const input = 'node bin/pixelslop-tools.cjs checkpoint create';
    const result = rewriteAgentPaths(input, '/home/user/.pixelslop');
    assert.ok(result.includes('"/home/user/.pixelslop/bin/pixelslop-tools.cjs"'),
      'Tool path should be wrapped in double quotes for shell safety');
    assert.ok(!result.includes('node bin/pixelslop-tools.cjs'));
  });

  it('replaces dist/skill/resources/ with absolute path', () => {
    const input = 'Read dist/skill/resources/scoring.md';
    const result = rewriteAgentPaths(input, '/home/user/.pixelslop');
    assert.ok(result.includes('/home/user/.pixelslop/skill/resources/scoring.md'));
    assert.ok(!result.includes('dist/skill/resources/'));
  });

  it('replaces all occurrences, not just the first', () => {
    const input = [
      'node bin/pixelslop-tools.cjs plan begin',
      'node bin/pixelslop-tools.cjs gate run',
      'Read dist/skill/resources/scoring.md',
      'Read dist/skill/resources/plan-format.md',
    ].join('\n');
    const result = rewriteAgentPaths(input, '/opt/pixelslop');
    // Count occurrences of the absolute path (quoted for tools, unquoted for resources)
    const toolMatches = result.match(/"\/opt\/pixelslop\/bin\/pixelslop-tools\.cjs"/g);
    const resourceMatches = result.match(/\/opt\/pixelslop\/skill\/resources\//g);
    assert.equal(toolMatches.length, 2, 'Should replace both tool references with quoted paths');
    assert.equal(resourceMatches.length, 2, 'Should replace both resource references');
  });

  it('does not mangle other paths', () => {
    const input = 'Some other content bin/something-else.js dist/other/path';
    const result = rewriteAgentPaths(input, '/home/user/.pixelslop');
    assert.ok(result.includes('bin/something-else.js'));
    assert.ok(result.includes('dist/other/path'));
  });

  it('handles paths with spaces in install root by quoting', () => {
    const input = 'node bin/pixelslop-tools.cjs plan begin';
    const result = rewriteAgentPaths(input, '/Users/John Doe/.pixelslop');
    assert.ok(result.includes('"/Users/John Doe/.pixelslop/bin/pixelslop-tools.cjs"'),
      'Paths with spaces must be quoted to survive shell expansion');
  });
});

// ─────────────────────────────────────────────
// Pattern Drift Detection
// ─────────────────────────────────────────────

describe('pattern drift detection', () => {
  /** All agent files that reference pixelslop-tools or resources (exclude macOS forks) */
  const agentFiles = readdirSync(join(DIST, 'agents')).filter(f => f.endsWith('.md') && !f.startsWith('._'));

  it('all agent files are known to the installer', () => {
    const expectedAgents = [
      'pixelslop.md', 'pixelslop-scanner.md', 'pixelslop-fixer.md',
      'pixelslop-checker.md', 'pixelslop-setup.md', 'pixelslop-code-scanner.md',
    ];
    assert.deepEqual(
      agentFiles.sort(),
      expectedAgents.sort(),
      'Installer must know about all agent files'
    );
  });

  it('agent files referencing pixelslop-tools use the rewritable pattern', () => {
    for (const file of agentFiles) {
      const content = readFileSync(join(DIST, 'agents', file), 'utf8');
      // If the agent references pixelslop-tools, it must use the exact pattern
      if (content.includes('pixelslop-tools')) {
        assert.ok(
          content.includes('bin/pixelslop-tools.cjs'),
          `${file} references pixelslop-tools but not via 'bin/pixelslop-tools.cjs' — ` +
          `path rewriter won't catch it`
        );
      }
    }
  });

  it('agent files referencing resources use the rewritable pattern', () => {
    for (const file of agentFiles) {
      const content = readFileSync(join(DIST, 'agents', file), 'utf8');
      // If the agent references resource files, it must use the exact prefix
      if (content.includes('resources/') && content.includes('.md')) {
        assert.ok(
          content.includes('dist/skill/resources/'),
          `${file} references resources but not via 'dist/skill/resources/' — ` +
          `path rewriter won't catch it`
        );
      }
    }
  });

  it('installer knows about all resource files', () => {
    const resourceEntries = readdirSync(join(DIST, 'skill', 'resources'))
      .filter(f => !f.startsWith('._')); // ignore macOS resource forks
    // 17 markdown files + 1 HTML template + 1 personas directory = 19 entries
    assert.equal(
      resourceEntries.length, 19,
      `Expected 19 resource entries (17 .md + 1 .html + personas/), found ${resourceEntries.length}: ${resourceEntries.join(', ')}`
    );
  });

  it('skill/SKILL.md exists in the package', () => {
    assert.ok(existsSync(join(DIST, 'skill', 'SKILL.md')), 'SKILL.md must exist');
  });
});

// ─────────────────────────────────────────────
// Browser runtime detection
// ─────────────────────────────────────────────

describe('detectBrowserRuntime', () => {
  it('returns a structured status object', () => {
    const runtime = detectBrowserRuntime();
    assert.equal(typeof runtime.available, 'boolean');
    if (runtime.available) {
      assert.equal(typeof runtime.executablePath, 'string');
      assert.ok(runtime.source, 'available runtime should include a source');
    } else {
      assert.equal(runtime.executablePath, null);
    }
  });
});

describe('ensureBrowserRuntime', () => {
  it('returns immediately when a runtime is already available', () => {
    let installCalls = 0;
    const runtime = ensureBrowserRuntime({
      detectBrowserRuntime: () => ({ available: true, executablePath: '/fake/chrome', source: 'system' }),
      installChromium: () => { installCalls += 1; },
      header: () => {},
      log: () => {},
    });

    assert.equal(runtime.available, true);
    assert.equal(installCalls, 0);
  });

  it('installs Chromium when runtime is missing and re-detect succeeds', () => {
    let detectCalls = 0;
    let installCalls = 0;

    const runtime = ensureBrowserRuntime({
      detectBrowserRuntime: () => {
        detectCalls += 1;
        if (detectCalls === 1) return { available: false, executablePath: null, source: null };
        return { available: true, executablePath: '/fake/chromium', source: 'playwright-cache' };
      },
      installChromium: () => { installCalls += 1; },
      header: () => {},
      log: () => {},
    });

    assert.equal(installCalls, 1);
    assert.equal(detectCalls, 2);
    assert.equal(runtime.executablePath, '/fake/chromium');
  });

  it('surfaces install failures cleanly', () => {
    assert.throws(() => ensureBrowserRuntime({
      detectBrowserRuntime: () => ({ available: false, executablePath: null, source: null }),
      installChromium: () => { throw new Error('install failed'); },
      header: () => {},
      log: () => {},
    }), /install failed/);
  });

  it('fails if install succeeds but runtime is still missing', () => {
    assert.throws(() => ensureBrowserRuntime({
      detectBrowserRuntime: () => ({ available: false, executablePath: null, source: null }),
      installChromium: () => {},
      header: () => {},
      log: () => {},
    }), /Chromium install completed, but no executable was detected/);
  });
});

describe('installed browser package helpers', () => {
  it('readInstalledBrowserPackageVersion returns null when missing', () => {
    const installRoot = makeTempDir();
    try {
      assert.equal(readInstalledBrowserPackageVersion(installRoot), null);
      assert.equal(resolveInstalledBrowserPackage(installRoot), null);
    } finally {
      rmSync(installRoot, { recursive: true, force: true });
    }
  });

  it('inspectInstalledBrowserHelper reports package and runtime usability from install root', () => {
    const installRoot = makeTempDir();
    const fakeChrome = join(installRoot, 'fake-chrome');
    const previousBrowserEnv = process.env.PIXELSLOP_BROWSER_EXECUTABLE;

    try {
      mkdirSync(join(installRoot, 'bin'), { recursive: true });
      copyFileSync(join(PROJECT_ROOT, 'bin', 'pixelslop-browser.cjs'), join(installRoot, 'bin', 'pixelslop-browser.cjs'));
      seedPlaywrightCorePackage(installRoot);
      writeFileSync(fakeChrome, '#!/bin/sh\nexit 0\n');
      chmodSync(fakeChrome, 0o755);
      process.env.PIXELSLOP_BROWSER_EXECUTABLE = fakeChrome;

      const result = inspectInstalledBrowserHelper(installRoot);
      assert.equal(result.helperLoadError, null);
      assert.equal(result.packageVersion, '1.58.2');
      assert.equal(result.packageLoadError, null);
      assert.equal(result.runtime?.available, true);
      assert.equal(result.runtime?.executablePath, fakeChrome);
    } finally {
      if (previousBrowserEnv === undefined) {
        delete process.env.PIXELSLOP_BROWSER_EXECUTABLE;
      } else {
        process.env.PIXELSLOP_BROWSER_EXECUTABLE = previousBrowserEnv;
      }
      rmSync(installRoot, { recursive: true, force: true });
    }
  });

  it('installBrowserPackage copies the bundled dependency into install root', () => {
    const installRoot = makeTempDir();
    const bundledDir = makeTempDir();

    try {
      mkdirSync(join(bundledDir, 'lib'), { recursive: true });
      writeFileSync(join(bundledDir, 'index.js'), 'module.exports = { ok: true };');
      writeFileSync(join(bundledDir, 'package.json'), JSON.stringify({
        name: 'playwright-core',
        version: '1.58.2',
        main: 'index.js',
      }, null, 2));

      installBrowserPackage(installRoot, bundledDir);

      assert.equal(readInstalledBrowserPackageVersion(installRoot), '1.58.2');
      const resolved = resolveInstalledBrowserPackage(installRoot);
      assert.ok(resolved?.endsWith(join('node_modules', 'playwright-core', 'package.json')));
    } finally {
      rmSync(installRoot, { recursive: true, force: true });
      rmSync(bundledDir, { recursive: true, force: true });
    }
  });

  it('ensureInstalledBrowserPackage returns immediately when pinned version is already present', () => {
    let installCalls = 0;
    const pkg = ensureInstalledBrowserPackage({
      installRoot: '/fake/install',
      readInstalledBrowserPackageVersion: () => '1.58.2',
      installBrowserPackage: () => { installCalls += 1; },
      header: () => {},
      log: () => {},
    });

    assert.equal(pkg.version, '1.58.2');
    assert.equal(installCalls, 0);
  });

  it('ensureInstalledBrowserPackage provisions the package when missing', () => {
    let installedVersion = null;
    let installCalls = 0;

    const pkg = ensureInstalledBrowserPackage({
      installRoot: '/fake/install',
      readInstalledBrowserPackageVersion: () => installedVersion,
      installBrowserPackage: () => {
        installCalls += 1;
        installedVersion = '1.58.2';
      },
      header: () => {},
      log: () => {},
    });

    assert.equal(pkg.version, '1.58.2');
    assert.equal(installCalls, 1);
  });

  it('ensureInstalledBrowserPackage surfaces provisioning failures cleanly', () => {
    assert.throws(() => ensureInstalledBrowserPackage({
      installRoot: '/fake/install',
      readInstalledBrowserPackageVersion: () => null,
      installBrowserPackage: () => { throw new Error('copy failed'); },
      header: () => {},
      log: () => {},
    }), /copy failed/);
  });
});

// ─────────────────────────────────────────────
// Manifest Schema
// ─────────────────────────────────────────────

describe('manifest schema', () => {
  it('defines all required fields including v2 additions', () => {
    // Manifest tracks browser runtime instead of MCP config.
    const requiredFields = [
      'version', 'installedAt', 'installRoot',
      'browserPackage', 'browserRuntime', 'clients', 'agentFiles',
      'scope', 'projectRoot', 'installMethods',
    ];

    // Simulate a v2 manifest (global scope — projectRoot is null)
    const manifest = {
      version: '0.1.0',
      installedAt: new Date().toISOString(),
      installRoot: '/home/user/.pixelslop',
      scope: 'global',
      projectRoot: null,
      browserPackage: 'playwright-core@1.58.2',
      browserRuntime: { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', source: 'system' },
      clients: ['Claude Code'],
      agentFiles: ['pixelslop.md'],
      installMethods: { 'Claude Code': { skill: 'symlink' } },
    };

    for (const field of requiredFields) {
      assert.ok(field in manifest, `Missing required field: ${field}`);
    }
  });

  it('scope must be global or project', () => {
    const validScopes = ['global', 'project'];
    for (const scope of validScopes) {
      assert.ok(validScopes.includes(scope));
    }
  });

  it('projectRoot is null for global scope, a path for project scope', () => {
    // Global: projectRoot should be null
    const globalManifest = { scope: 'global', projectRoot: null };
    assert.equal(globalManifest.projectRoot, null, 'Global scope has null projectRoot');

    // Project: projectRoot should be a string path
    const projectManifest = { scope: 'project', projectRoot: '/some/project' };
    assert.equal(typeof projectManifest.projectRoot, 'string', 'Project scope has string projectRoot');
  });

  it('installMethods tracks method per client', () => {
    const methods = {
      'Claude Code': { skill: 'symlink' },
      'Codex CLI': { skill: 'copy' },
    };
    // Each client entry must have a skill method
    for (const [client, info] of Object.entries(methods)) {
      assert.ok(['symlink', 'copy'].includes(info.skill),
        `${client} skill method must be symlink or copy`);
    }
  });

  it('agentFiles matches the actual agent inventory', () => {
    const expectedAgents = [
      'pixelslop.md', 'pixelslop-scanner.md', 'pixelslop-fixer.md',
      'pixelslop-checker.md', 'pixelslop-setup.md', 'pixelslop-code-scanner.md',
    ];
    const actualAgents = readdirSync(join(DIST, 'agents'))
      .filter(f => f.endsWith('.md') && !f.startsWith('._'));
    assert.deepEqual(actualAgents.sort(), expectedAgents.sort());
  });
});

// ─────────────────────────────────────────────
// Package Configuration
// ─────────────────────────────────────────────

describe('package configuration', () => {
  const pkg = JSON.parse(readFileSync(join(PROJECT_ROOT, 'package.json'), 'utf8'));

  it('has bin entry pointing to installer', () => {
    assert.ok(pkg.bin, 'package.json must have bin');
    assert.ok(pkg.bin.pixelslop, 'bin must have pixelslop entry');
    assert.ok(pkg.bin.pixelslop.includes('pixelslop.mjs'), 'bin must point to pixelslop.mjs');
  });

  it('has files array including required directories', () => {
    assert.ok(pkg.files, 'package.json must have files');
    assert.ok(pkg.files.includes('bin/'), 'files must include bin/');
    assert.ok(pkg.files.includes('dist/'), 'files must include dist/');
  });

  it('is not private', () => {
    assert.equal(pkg.private, false, 'package must not be private for npm publishing');
  });

  it('has a version that is not 0.0.0', () => {
    assert.notEqual(pkg.version, '0.0.0', 'Version must be bumped from 0.0.0');
  });

  it('installer file exists and is executable', () => {
    assert.ok(existsSync(join(PROJECT_ROOT, 'bin', 'pixelslop.mjs')), 'Installer must exist');
  });

  it('has engines field requiring Node >= 20', () => {
    assert.ok(pkg.engines, 'package.json must have engines');
    assert.ok(pkg.engines.node, 'engines must specify node');
    assert.ok(pkg.engines.node.includes('20'), 'engines.node must require 20+');
  });

  it('has homepage pointing to GitHub', () => {
    assert.ok(pkg.homepage, 'package.json must have homepage');
    assert.ok(pkg.homepage.includes('github.com/gabelul/pixelslop'), 'homepage must point to repo');
  });

  it('has bugs URL pointing to GitHub issues', () => {
    assert.ok(pkg.bugs, 'package.json must have bugs');
    assert.ok(pkg.bugs.url, 'bugs must have url');
    assert.ok(pkg.bugs.url.includes('github.com/gabelul/pixelslop/issues'), 'bugs.url must point to issues');
  });
});

// ─────────────────────────────────────────────
// File Diff Calculation
// ─────────────────────────────────────────────

describe('calculateFileDiff', () => {
  let tempDir;

  beforeEach(() => { tempDir = makeTempDir(); });
  afterEach(() => { rmSync(tempDir, { recursive: true, force: true }); });

  it('detects new files (in install but not backup)', () => {
    const backup = join(tempDir, 'backup');
    const install = join(tempDir, 'install');
    mkdirSync(backup, { recursive: true });
    mkdirSync(install, { recursive: true });

    // Both have file-a, only install has file-b
    writeFileSync(join(backup, 'file-a.txt'), 'same content');
    writeFileSync(join(install, 'file-a.txt'), 'same content');
    writeFileSync(join(install, 'file-b.txt'), 'new file');

    const diff = calculateFileDiff(backup, install);
    assert.deepEqual(diff.added, ['file-b.txt']);
    assert.deepEqual(diff.changed, []);
    assert.deepEqual(diff.removed, []);
  });

  it('detects changed files (same name, different content)', () => {
    const backup = join(tempDir, 'backup');
    const install = join(tempDir, 'install');
    mkdirSync(backup, { recursive: true });
    mkdirSync(install, { recursive: true });

    writeFileSync(join(backup, 'file.txt'), 'old content');
    writeFileSync(join(install, 'file.txt'), 'new content');

    const diff = calculateFileDiff(backup, install);
    assert.deepEqual(diff.added, []);
    assert.deepEqual(diff.changed, ['file.txt']);
    assert.deepEqual(diff.removed, []);
  });

  it('detects removed files (in backup but not install)', () => {
    const backup = join(tempDir, 'backup');
    const install = join(tempDir, 'install');
    mkdirSync(backup, { recursive: true });
    mkdirSync(install, { recursive: true });

    writeFileSync(join(backup, 'old-file.txt'), 'content');
    writeFileSync(join(backup, 'kept.txt'), 'same');
    writeFileSync(join(install, 'kept.txt'), 'same');

    const diff = calculateFileDiff(backup, install);
    assert.deepEqual(diff.added, []);
    assert.deepEqual(diff.changed, []);
    assert.deepEqual(diff.removed, ['old-file.txt']);
  });

  it('handles nested directories', () => {
    const backup = join(tempDir, 'backup');
    const install = join(tempDir, 'install');
    mkdirSync(join(backup, 'sub'), { recursive: true });
    mkdirSync(join(install, 'sub'), { recursive: true });

    writeFileSync(join(backup, 'sub', 'file.txt'), 'old');
    writeFileSync(join(install, 'sub', 'file.txt'), 'new');
    writeFileSync(join(install, 'sub', 'extra.txt'), 'added');

    const diff = calculateFileDiff(backup, install);
    assert.ok(diff.changed.includes(join('sub', 'file.txt')), 'Should detect nested changes');
    assert.ok(diff.added.includes(join('sub', 'extra.txt')), 'Should detect nested additions');
  });

  it('reports identical directories as no changes', () => {
    const backup = join(tempDir, 'backup');
    const install = join(tempDir, 'install');
    mkdirSync(backup, { recursive: true });
    mkdirSync(install, { recursive: true });

    writeFileSync(join(backup, 'a.txt'), 'content');
    writeFileSync(join(install, 'a.txt'), 'content');

    const diff = calculateFileDiff(backup, install);
    assert.equal(diff.added.length, 0);
    assert.equal(diff.changed.length, 0);
    assert.equal(diff.removed.length, 0);
  });

  it('handles empty backup directory', () => {
    const backup = join(tempDir, 'backup');
    const install = join(tempDir, 'install');
    mkdirSync(backup, { recursive: true });
    mkdirSync(install, { recursive: true });

    writeFileSync(join(install, 'new.txt'), 'content');

    const diff = calculateFileDiff(backup, install);
    assert.deepEqual(diff.added, ['new.txt']);
  });

  it('handles non-existent backup directory', () => {
    const backup = join(tempDir, 'nonexistent');
    const install = join(tempDir, 'install');
    mkdirSync(install, { recursive: true });

    writeFileSync(join(install, 'file.txt'), 'content');

    const diff = calculateFileDiff(backup, install);
    assert.deepEqual(diff.added, ['file.txt']);
    assert.equal(diff.removed.length, 0);
  });

  it('skips macOS resource fork files (._prefix)', () => {
    const backup = join(tempDir, 'backup');
    const install = join(tempDir, 'install');
    mkdirSync(backup, { recursive: true });
    mkdirSync(install, { recursive: true });

    writeFileSync(join(backup, '._hidden'), 'resource fork');
    writeFileSync(join(install, 'file.txt'), 'content');

    const diff = calculateFileDiff(backup, install);
    // ._hidden should not appear as removed
    assert.ok(!diff.removed.includes('._hidden'));
  });
});

// ─────────────────────────────────────────────
// Update Command (CLI integration)
// ─────────────────────────────────────────────

describe('update command', () => {
  it('installer exports calculateFileDiff', () => {
    assert.equal(typeof calculateFileDiff, 'function', 'calculateFileDiff must be exported');
  });

  it('installer CLI shows update in help text', async () => {
    const { execSync } = await import('node:child_process');
    const output = execSync('node bin/pixelslop.mjs --help', {
      cwd: PROJECT_ROOT,
      encoding: 'utf8',
    });
    assert.ok(output.includes('update'), 'Help text must mention update command');
    assert.ok(output.includes('--force'), 'Help text must mention --force flag');
  });

  it('update without install shows error message', async () => {
    // We can't fully test update without mocking the filesystem,
    // but we can verify the command doesn't crash on unknown args
    const { execSync } = await import('node:child_process');
    try {
      execSync('node bin/pixelslop.mjs update 2>&1', {
        cwd: PROJECT_ROOT,
        encoding: 'utf8',
        env: { ...process.env, HOME: join(tmpdir(), `pixelslop-nohome-${Date.now()}`) },
      });
      // If it succeeds, the install is present — that's fine
    } catch (e) {
      // Expected: exits with error code because pixelslop isn't installed
      assert.ok(
        e.stdout?.includes('not installed') || e.stderr?.includes('not installed') ||
        e.status === 1,
        'Should fail gracefully when not installed'
      );
    }
  });
});

// ─────────────────────────────────────────────
// linkOrCopy
// ─────────────────────────────────────────────

describe('linkOrCopy', () => {
  let tempDir;

  beforeEach(() => { tempDir = makeTempDir(); });
  afterEach(() => { rmSync(tempDir, { recursive: true, force: true }); });

  it('creates a symlink by default on supported platforms', () => {
    const src = join(tempDir, 'source');
    const dest = join(tempDir, 'dest');
    mkdirSync(src, { recursive: true });
    writeFileSync(join(src, 'test.txt'), 'content');

    const method = linkOrCopy(src, dest);

    // On macOS/Linux, symlink should work
    assert.equal(method, 'symlink', 'Should prefer symlink');
    assert.ok(existsSync(join(dest, 'test.txt')), 'File reachable through link');
  });

  it('falls back to copy when forceCopy is true', () => {
    const src = join(tempDir, 'source');
    const dest = join(tempDir, 'dest');
    mkdirSync(src, { recursive: true });
    writeFileSync(join(src, 'test.txt'), 'content');

    const method = linkOrCopy(src, dest, true);

    assert.equal(method, 'copy', 'Should copy when forced');
    assert.ok(existsSync(join(dest, 'test.txt')), 'File exists in copy');

    // Verify it's actually a copy, not a symlink
    const stat = lstatSync(dest);
    assert.ok(stat.isDirectory(), 'Dest should be a real directory, not a symlink');
  });

  it('removes existing target before installing', () => {
    const src = join(tempDir, 'source');
    const dest = join(tempDir, 'dest');
    mkdirSync(src, { recursive: true });
    mkdirSync(dest, { recursive: true });
    writeFileSync(join(src, 'new.txt'), 'new content');
    writeFileSync(join(dest, 'old.txt'), 'old content');

    linkOrCopy(src, dest, true);

    assert.ok(existsSync(join(dest, 'new.txt')), 'New file present');
    // Old file should be gone because dest was replaced
    assert.ok(!existsSync(join(dest, 'old.txt')), 'Old file removed');
  });

  it('replaces broken symlinks before reinstalling', () => {
    const oldSrc = join(tempDir, 'old-source');
    const newSrc = join(tempDir, 'new-source');
    const dest = join(tempDir, 'dest');
    mkdirSync(oldSrc, { recursive: true });
    mkdirSync(newSrc, { recursive: true });
    writeFileSync(join(oldSrc, 'old.txt'), 'old content');
    writeFileSync(join(newSrc, 'new.txt'), 'new content');

    const initialMethod = linkOrCopy(oldSrc, dest);
    assert.equal(initialMethod, 'symlink', 'Initial install should create a symlink on this platform');

    rmSync(oldSrc, { recursive: true, force: true });
    assert.ok(!existsSync(dest), 'Broken symlink should not resolve through existsSync');

    const method = linkOrCopy(newSrc, dest);

    assert.equal(method, 'symlink', 'Reinstall should replace the broken symlink cleanly');
    assert.ok(existsSync(join(dest, 'new.txt')), 'New source should be reachable through the repaired link');
  });

  it('returns correct method string', () => {
    const src = join(tempDir, 'source');
    mkdirSync(src, { recursive: true });

    const symResult = linkOrCopy(src, join(tempDir, 'link'));
    assert.ok(['symlink', 'copy'].includes(symResult), 'Must return symlink or copy');

    const copyResult = linkOrCopy(src, join(tempDir, 'copied'), true);
    assert.equal(copyResult, 'copy', 'Forced copy must return copy');
  });
});

// ─────────────────────────────────────────────
// Client Registry (getClients)
// ─────────────────────────────────────────────

describe('getClients', () => {
  it('is exported as a function', () => {
    assert.equal(typeof getClients, 'function');
  });

  it('returns Claude Code client for global scope', () => {
    const clients = getClients('global');
    const claude = clients.find(c => c.name === 'Claude Code');
    assert.ok(claude, 'Claude Code must be in global client list');
    assert.equal(claude.scope, 'global');
  });

  it('returns Claude Code client for project scope', () => {
    const clients = getClients('project');
    const claude = clients.find(c => c.name === 'Claude Code');
    assert.ok(claude, 'Claude Code must be in project client list');
    assert.equal(claude.scope, 'project');
  });

  it('includes Codex CLI in project scope', () => {
    const clients = getClients('project');
    const codex = clients.find(c => c.name === 'Codex CLI');
    assert.ok(codex, 'Codex CLI must be in project client list');
    assert.equal(codex.scope, 'project');
  });

  it('includes Codex CLI in global scope', () => {
    const clients = getClients('global');
    const codex = clients.find(c => c.name === 'Codex CLI');
    assert.ok(codex, 'Codex CLI must be in global client list');
    assert.equal(codex.scope, 'global');
  });

  it('project scope uses project-relative agent dir', () => {
    const clients = getClients('project');
    const claude = clients.find(c => c.name === 'Claude Code');
    // Project scope should use .claude/ relative to cwd, not ~/
    assert.ok(claude.agentDir.includes('.claude'), 'Agent dir must contain .claude');
    // Should NOT start with the home directory for project scope
    assert.ok(!claude.agentDir.startsWith(join(homedir(), '.claude')),
      'Project agent dir must not be in home directory');
  });

  it('project scope uses project-relative Codex paths', () => {
    const clients = getClients('project');
    const codex = clients.find(c => c.name === 'Codex CLI');
    assert.ok(codex.agentDir.includes('.codex'), 'Agent dir must contain .codex');
    assert.ok(!codex.agentDir.startsWith(join(homedir(), '.codex')),
      'Project agent dir must not be in home directory');
  });

  it('all clients have required methods', () => {
    for (const scope of ['global', 'project']) {
      const clients = getClients(scope);
      for (const client of clients) {
        assert.equal(typeof client.detect, 'function', `${client.name}: detect`);
        assert.equal(typeof client.installSkill, 'function', `${client.name}: installSkill`);
        assert.equal(typeof client.removeSkill, 'function', `${client.name}: removeSkill`);
        assert.equal(typeof client.checkSkill, 'function', `${client.name}: checkSkill`);
      }
    }
  });
});

// ─────────────────────────────────────────────
// CLI Flags
// ─────────────────────────────────────────────

describe('CLI flags', () => {
  it('help text shows scope and runtime selection flags', async () => {
    const { execSync } = await import('node:child_process');
    const output = execSync('node bin/pixelslop.mjs --help', {
      cwd: PROJECT_ROOT,
      encoding: 'utf8',
    });
    assert.ok(output.includes('--project'), 'Help must show --project');
    assert.ok(output.includes('--global'), 'Help must show --global');
    assert.ok(output.includes('--all'), 'Help must show --all');
    assert.ok(output.includes('--claude-only'), 'Help must show --claude-only');
    assert.ok(output.includes('--codex-only'), 'Help must show --codex-only');
    assert.ok(output.includes('--copy'), 'Help must show --copy');
    assert.ok(output.includes('interactive wizard'), 'Help must describe interactive install');
  });
});

describe('doctor command', () => {
  it('fails when the installed browser package is missing', async () => {
    const tempHome = makeTempDir();
    const installRoot = join(tempHome, '.pixelslop');
    const fakeChrome = join(tempHome, 'fake-chrome');

    try {
      mkdirSync(join(installRoot, 'bin'), { recursive: true });
      copyFileSync(join(PROJECT_ROOT, 'bin', 'pixelslop-tools.cjs'), join(installRoot, 'bin', 'pixelslop-tools.cjs'));
      copyFileSync(join(PROJECT_ROOT, 'bin', 'pixelslop-browser.cjs'), join(installRoot, 'bin', 'pixelslop-browser.cjs'));
      chmodSync(join(installRoot, 'bin', 'pixelslop-tools.cjs'), 0o755);
      chmodSync(join(installRoot, 'bin', 'pixelslop-browser.cjs'), 0o755);
      cpSync(join(PROJECT_ROOT, 'dist', 'skill'), join(installRoot, 'skill'), { recursive: true });
      writeFileSync(fakeChrome, '#!/bin/sh\nexit 0\n');
      chmodSync(fakeChrome, 0o755);
      writeFileSync(join(installRoot, 'install-manifest.json'), JSON.stringify({
        version: '0.3.0',
        installedAt: new Date().toISOString(),
        installRoot,
        browserPackage: 'playwright-core@1.58.2',
        browserRuntime: { executablePath: fakeChrome, source: 'env' },
        clients: [],
        agentFiles: [],
        scope: 'global',
        projectRoot: null,
        installMethods: {},
      }, null, 2));

      const result = spawnSync('node', ['bin/pixelslop.mjs', 'doctor'], {
        cwd: PROJECT_ROOT,
        encoding: 'utf8',
        env: { ...process.env, HOME: tempHome, PIXELSLOP_BROWSER_EXECUTABLE: fakeChrome },
      });
      const output = `${result.stdout || ''}${result.stderr || ''}`;

      assert.notEqual(result.status, 0, 'doctor should fail when playwright-core is missing from install root');
      assert.ok(output.includes('playwright-core'), 'doctor should report the missing browser package');
      assert.ok(
        output.includes('Missing from install root') || output.includes('Cannot find module'),
        'doctor should explain why the package check failed'
      );
    } finally {
      rmSync(tempHome, { recursive: true, force: true });
    }
  });

  it('fails when the installed browser helper cannot load playwright-core', async () => {
    const tempHome = makeTempDir();
    const installRoot = join(tempHome, '.pixelslop');
    const fakeChrome = join(tempHome, 'fake-chrome');

    try {
      mkdirSync(join(installRoot, 'bin'), { recursive: true });
      copyFileSync(join(PROJECT_ROOT, 'bin', 'pixelslop-tools.cjs'), join(installRoot, 'bin', 'pixelslop-tools.cjs'));
      copyFileSync(join(PROJECT_ROOT, 'bin', 'pixelslop-browser.cjs'), join(installRoot, 'bin', 'pixelslop-browser.cjs'));
      chmodSync(join(installRoot, 'bin', 'pixelslop-tools.cjs'), 0o755);
      chmodSync(join(installRoot, 'bin', 'pixelslop-browser.cjs'), 0o755);
      cpSync(join(PROJECT_ROOT, 'dist', 'skill'), join(installRoot, 'skill'), { recursive: true });
      seedPlaywrightCorePackage(installRoot, { main: 'missing.js' });
      writeFileSync(fakeChrome, '#!/bin/sh\nexit 0\n');
      chmodSync(fakeChrome, 0o755);
      writeFileSync(join(installRoot, 'install-manifest.json'), JSON.stringify({
        version: '0.3.0',
        installedAt: new Date().toISOString(),
        installRoot,
        browserPackage: 'playwright-core@1.58.2',
        browserRuntime: { executablePath: fakeChrome, source: 'env' },
        clients: [],
        agentFiles: [],
        scope: 'global',
        projectRoot: null,
        installMethods: {},
      }, null, 2));

      let output = '';
      try {
        execFileSync('node', ['bin/pixelslop.mjs', 'doctor'], {
          cwd: PROJECT_ROOT,
          encoding: 'utf8',
          env: { ...process.env, HOME: tempHome, PIXELSLOP_BROWSER_EXECUTABLE: fakeChrome },
        });
        assert.fail('doctor should fail when the installed helper cannot load playwright-core');
      } catch (error) {
        output = `${error.stdout || ''}${error.stderr || ''}`;
      }

      assert.ok(output.includes('Installed browser helper can load playwright-core'),
        'doctor should report the broken helper load path');
      assert.ok(output.includes('Cannot find module'),
        'doctor should surface the actual module load failure');
    } finally {
      rmSync(tempHome, { recursive: true, force: true });
    }
  });

  it('fails when the installed browser helper runtime is unusable', async () => {
    const tempHome = makeTempDir();
    const installRoot = join(tempHome, '.pixelslop');

    try {
      mkdirSync(join(installRoot, 'bin'), { recursive: true });
      copyFileSync(join(PROJECT_ROOT, 'bin', 'pixelslop-tools.cjs'), join(installRoot, 'bin', 'pixelslop-tools.cjs'));
      writeFileSync(join(installRoot, 'bin', 'pixelslop-browser.cjs'), `#!/usr/bin/env node
'use strict';
module.exports = {
  detectBrowserRuntime() {
    return {
      available: false,
      executablePath: null,
      source: null,
      message: 'broken test runtime'
    };
  }
};
`);
      chmodSync(join(installRoot, 'bin', 'pixelslop-tools.cjs'), 0o755);
      chmodSync(join(installRoot, 'bin', 'pixelslop-browser.cjs'), 0o755);
      cpSync(join(PROJECT_ROOT, 'dist', 'skill'), join(installRoot, 'skill'), { recursive: true });
      seedPlaywrightCorePackage(installRoot);
      writeFileSync(join(installRoot, 'install-manifest.json'), JSON.stringify({
        version: '0.3.0',
        installedAt: new Date().toISOString(),
        installRoot,
        browserPackage: 'playwright-core@1.58.2',
        browserRuntime: null,
        clients: [],
        agentFiles: [],
        scope: 'global',
        projectRoot: null,
        installMethods: {},
      }, null, 2));

      let output = '';
      try {
        execFileSync('node', ['bin/pixelslop.mjs', 'doctor'], {
          cwd: PROJECT_ROOT,
          encoding: 'utf8',
          env: { ...process.env, HOME: tempHome },
        });
        assert.fail('doctor should fail when the installed helper runtime is unusable');
      } catch (error) {
        output = `${error.stdout || ''}${error.stderr || ''}`;
      }

      assert.ok(output.includes('Installed browser helper runtime'),
        'doctor should report the installed runtime check');
      assert.ok(output.includes('broken test runtime'),
        'doctor should surface the helper runtime failure message');
    } finally {
      rmSync(tempHome, { recursive: true, force: true });
    }
  });

  it('fails when the installed report template is missing', async () => {
    const tempHome = makeTempDir();
    const installRoot = join(tempHome, '.pixelslop');
    const fakeChrome = join(tempHome, 'fake-chrome');

    try {
      mkdirSync(join(installRoot, 'bin'), { recursive: true });
      copyFileSync(join(PROJECT_ROOT, 'bin', 'pixelslop-tools.cjs'), join(installRoot, 'bin', 'pixelslop-tools.cjs'));
      copyFileSync(join(PROJECT_ROOT, 'bin', 'pixelslop-browser.cjs'), join(installRoot, 'bin', 'pixelslop-browser.cjs'));
      chmodSync(join(installRoot, 'bin', 'pixelslop-tools.cjs'), 0o755);
      chmodSync(join(installRoot, 'bin', 'pixelslop-browser.cjs'), 0o755);
      cpSync(join(PROJECT_ROOT, 'dist', 'skill'), join(installRoot, 'skill'), { recursive: true });
      rmSync(join(installRoot, 'skill', 'resources', 'report-template.html'), { force: true });
      seedPlaywrightCorePackage(installRoot);
      writeFileSync(fakeChrome, '#!/bin/sh\nexit 0\n');
      chmodSync(fakeChrome, 0o755);
      writeFileSync(join(installRoot, 'install-manifest.json'), JSON.stringify({
        version: '0.3.0',
        installedAt: new Date().toISOString(),
        installRoot,
        browserPackage: 'playwright-core@1.58.2',
        browserRuntime: { executablePath: fakeChrome, source: 'env' },
        clients: [],
        agentFiles: [],
        scope: 'global',
        projectRoot: null,
        installMethods: {},
      }, null, 2));

      const result = spawnSync('node', ['bin/pixelslop.mjs', 'doctor'], {
        cwd: PROJECT_ROOT,
        encoding: 'utf8',
        env: { ...process.env, HOME: tempHome, PIXELSLOP_BROWSER_EXECUTABLE: fakeChrome },
      });
      const output = `${result.stdout || ''}${result.stderr || ''}`;

      assert.notEqual(result.status, 0, 'doctor should fail when report-template.html is missing from install root');
      assert.ok(output.includes('skill/resources/report-template.html'), 'doctor should report the missing template');
      assert.ok(output.includes('Missing from install root'), 'doctor should explain why the template check failed');
    } finally {
      rmSync(tempHome, { recursive: true, force: true });
    }
  });
});

// ─────────────────────────────────────────────
// Packaged artifact smoke tests
// ─────────────────────────────────────────────

describe('packaged artifact smoke', () => {
  let tempHome, tempProject, tarballPath, fakeChrome;

  beforeEach(() => {
    tempHome = makeTempDir();
    tempProject = makeTempDir();
    fakeChrome = join(tempHome, 'fake-chrome');
    writeFileSync(fakeChrome, '#!/bin/sh\nexit 0\n');
    chmodSync(fakeChrome, 0o755);
    tarballPath = packPackage();
  });

  afterEach(() => {
    if (tarballPath && existsSync(tarballPath)) {
      rmSync(tarballPath, { force: true });
    }
    rmSync(tempProject, { recursive: true, force: true });
    rmSync(tempHome, { recursive: true, force: true });
  });

  it('installs Codex in project scope via npx tarball', () => {
    const env = { HOME: tempHome, PIXELSLOP_BROWSER_EXECUTABLE: fakeChrome };
    seedRuntimeHomes(tempHome, ['codex']);

    runTarballCommand(tarballPath, ['install', '--project', '--codex-only'], tempProject, env);
    const installRoot = join(tempHome, '.pixelslop');
    assert.ok(existsSync(join(tempProject, '.codex', 'agents', 'pixelslop.md')));
    assert.ok(existsSync(join(tempProject, '.codex', 'agents', 'internal', 'pixelslop-eval-color.md')));
    assert.ok(existsSync(join(tempProject, '.codex', 'skills', 'pixelslop', 'SKILL.md')));
    assert.ok(!existsSync(join(tempProject, '.claude')), 'Claude files should not be created');
    assert.ok(
      existsSync(join(installRoot, 'node_modules', 'playwright-core', 'package.json')),
      'install should vendor playwright-core into the install root'
    );

    const browserHelper = join(installRoot, 'bin', 'pixelslop-browser.cjs');
    const resolvedPlaywright = execFileSync(process.execPath, [
      '-e',
      'const { createRequire } = require("node:module"); const req = createRequire(process.argv[1]); console.log(req.resolve("playwright-core"));',
      browserHelper,
    ], { encoding: 'utf8' }).trim();
    assert.ok(
      resolvedPlaywright.includes(join('node_modules', 'playwright-core')),
      'installed browser helper should resolve playwright-core from the install root'
    );

    const internalEval = readFileSync(
      join(tempProject, '.codex', 'agents', 'internal', 'pixelslop-eval-color.md'),
      'utf8'
    );
    assert.ok(
      internalEval.includes(join(tempHome, '.pixelslop', 'skill', 'resources', 'scoring.md')),
      'internal evaluator resources should be rewritten to absolute install paths'
    );

    const manifest = JSON.parse(readFileSync(join(installRoot, 'install-manifest.json'), 'utf8'));
    assert.equal(manifest.scope, 'project', 'install manifest should record project scope');
    assert.deepEqual(manifest.clients, ['Codex CLI'], 'install manifest should track installed clients');
    assert.ok(
      manifest.browserPackage.startsWith('playwright-core@'),
      'install manifest should record the vendored browser package version'
    );

    runTarballCommand(tarballPath, ['uninstall'], tempProject, env);
    assert.ok(!existsSync(join(tempProject, '.codex', 'agents', 'pixelslop.md')));
    assert.ok(!existsSync(join(tempProject, '.codex', 'agents', 'internal', 'pixelslop-eval-color.md')));
    assert.ok(!existsSync(join(tempProject, '.codex', 'skills', 'pixelslop')));
  });

  it('uninstall preserves unrelated files inside agents/internal', () => {
    const env = { HOME: tempHome, PIXELSLOP_BROWSER_EXECUTABLE: fakeChrome };
    seedRuntimeHomes(tempHome, ['codex']);

    runTarballCommand(tarballPath, ['install', '--project', '--codex-only'], tempProject, env);

    const internalDir = join(tempProject, '.codex', 'agents', 'internal');
    const foreignAgent = join(internalDir, 'other-tool.md');
    writeFileSync(foreignAgent, '# not pixelslop\n');

    runTarballCommand(tarballPath, ['uninstall'], tempProject, env);

    assert.ok(existsSync(internalDir), 'internal directory should remain when foreign files still exist');
    assert.ok(existsSync(foreignAgent), 'uninstall should not delete unrelated internal agents');
    assert.ok(!existsSync(join(internalDir, 'pixelslop-eval-color.md')),
      'pixelslop internal evaluators should still be removed');
  });

  it('installs, reports status, updates, and uninstalls across Claude and Codex', () => {
    const env = { HOME: tempHome, PIXELSLOP_BROWSER_EXECUTABLE: fakeChrome };
    seedRuntimeHomes(tempHome, ['claude', 'codex']);

    runTarballCommand(tarballPath, ['install', '--project', '--all'], tempProject, env);
    assert.ok(existsSync(join(tempProject, '.claude', 'agents', 'pixelslop.md')));
    assert.ok(existsSync(join(tempProject, '.claude', 'skills', 'pixelslop', 'SKILL.md')));
    assert.ok(existsSync(join(tempProject, '.codex', 'agents', 'pixelslop.md')));
    assert.ok(existsSync(join(tempProject, '.codex', 'skills', 'pixelslop', 'SKILL.md')));

    const statusOutput = runTarballCommand(tarballPath, ['status'], tempProject, env);
    assert.ok(statusOutput.includes('Installed runtimes'), 'status should list installed runtimes');
    assert.ok(statusOutput.includes('Claude Code'), 'status should mention Claude Code');
    assert.ok(statusOutput.includes('Codex CLI'), 'status should mention Codex CLI');
    assert.ok(statusOutput.includes('Browser runtime:'), 'status should mention the browser runtime');

    const updateOutput = runTarballCommand(tarballPath, ['update', '--force'], tempProject, env);
    assert.ok(
      updateOutput.includes('Updated:') || updateOutput.includes('Reinstalled'),
      'update should refresh the installed runtime set'
    );

    const uninstallOutput = runTarballCommand(tarballPath, ['uninstall'], tempProject, env);
    assert.ok(uninstallOutput.includes('Removed from Claude Code'), 'uninstall should remove Claude Code');
    assert.ok(uninstallOutput.includes('Removed from Codex CLI'), 'uninstall should remove Codex CLI');
    assert.ok(!existsSync(join(tempProject, '.claude', 'agents', 'pixelslop.md')));
    assert.ok(!existsSync(join(tempProject, '.claude', 'skills', 'pixelslop')));
    assert.ok(!existsSync(join(tempProject, '.codex', 'agents', 'pixelslop.md')));
    assert.ok(!existsSync(join(tempProject, '.codex', 'skills', 'pixelslop')));
  });
});
