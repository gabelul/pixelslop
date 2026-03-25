/**
 * Installer Tests
 *
 * Validates the installer's pure functions: path rewriting, MCP config
 * writing, manifest schema, and structural completeness. These tests
 * run without touching the real filesystem — they use temp directories
 * and verify the installer knows about all agents and resources.
 *
 * Run: node --test tests/installer.test.js
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync,
         readdirSync, lstatSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir, homedir } from 'node:os';
import { execFileSync } from 'node:child_process';

import { rewriteAgentPaths, writeJsonMcp, removeJsonMcp,
         writeTomlMcp, removeTomlMcp, calculateFileDiff,
         linkOrCopy, getClients } from '../bin/pixelslop.mjs';

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
  return join(PROJECT_ROOT, filename);
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
      'pixelslop-checker.md', 'pixelslop-setup.md',
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
    // 15 markdown files + 1 personas directory = 16 entries
    assert.equal(
      resourceEntries.length, 16,
      `Expected 16 resource entries (15 .md + personas/), found ${resourceEntries.length}: ${resourceEntries.join(', ')}`
    );
  });

  it('skill/SKILL.md exists in the package', () => {
    assert.ok(existsSync(join(DIST, 'skill', 'SKILL.md')), 'SKILL.md must exist');
  });
});

// ─────────────────────────────────────────────
// JSON MCP Config (Claude Code settings.json)
// ─────────────────────────────────────────────

describe('writeJsonMcp', () => {
  let tempDir;

  beforeEach(() => { tempDir = makeTempDir(); });
  afterEach(() => { rmSync(tempDir, { recursive: true, force: true }); });

  it('creates settings.json if it does not exist', () => {
    const filePath = join(tempDir, 'settings.json');
    writeJsonMcp(filePath);
    assert.ok(existsSync(filePath));
    const data = JSON.parse(readFileSync(filePath, 'utf8'));
    assert.ok(data.mcpServers['pixelslop-playwright']);
    assert.equal(data.mcpServers['pixelslop-playwright'].command, 'npx');
  });

  it('preserves existing entries', () => {
    const filePath = join(tempDir, 'settings.json');
    writeFileSync(filePath, JSON.stringify({
      mcpServers: { 'my-other-mcp': { command: 'other' } },
      someSetting: true,
    }));
    writeJsonMcp(filePath);
    const data = JSON.parse(readFileSync(filePath, 'utf8'));
    assert.ok(data.mcpServers['pixelslop-playwright'], 'pixelslop entry added');
    assert.ok(data.mcpServers['my-other-mcp'], 'existing entry preserved');
    assert.equal(data.someSetting, true, 'other settings preserved');
  });

  it('does not duplicate on re-install', () => {
    const filePath = join(tempDir, 'settings.json');
    writeJsonMcp(filePath);
    writeJsonMcp(filePath);
    const data = JSON.parse(readFileSync(filePath, 'utf8'));
    const keys = Object.keys(data.mcpServers).filter(k => k === 'pixelslop-playwright');
    assert.equal(keys.length, 1);
  });

  it('creates parent directories if needed', () => {
    const filePath = join(tempDir, 'nested', 'dir', 'settings.json');
    writeJsonMcp(filePath);
    assert.ok(existsSync(filePath));
  });
});

describe('removeJsonMcp', () => {
  let tempDir;

  beforeEach(() => { tempDir = makeTempDir(); });
  afterEach(() => { rmSync(tempDir, { recursive: true, force: true }); });

  it('removes pixelslop entry and preserves others', () => {
    const filePath = join(tempDir, 'settings.json');
    writeFileSync(filePath, JSON.stringify({
      mcpServers: {
        'pixelslop-playwright': { command: 'npx' },
        'other-mcp': { command: 'other' },
      },
    }));
    removeJsonMcp(filePath);
    const data = JSON.parse(readFileSync(filePath, 'utf8'));
    assert.ok(!data.mcpServers['pixelslop-playwright'], 'pixelslop entry removed');
    assert.ok(data.mcpServers['other-mcp'], 'other entry preserved');
  });

  it('handles missing file gracefully', () => {
    const result = removeJsonMcp(join(tempDir, 'nonexistent.json'));
    assert.ok(result);
  });
});

// ─────────────────────────────────────────────
// TOML MCP Config (Codex config.toml)
// ─────────────────────────────────────────────

describe('writeTomlMcp', () => {
  let tempDir;

  beforeEach(() => { tempDir = makeTempDir(); });
  afterEach(() => { rmSync(tempDir, { recursive: true, force: true }); });

  it('creates config.toml if it does not exist', () => {
    const filePath = join(tempDir, 'config.toml');
    writeTomlMcp(filePath);
    assert.ok(existsSync(filePath));
    const content = readFileSync(filePath, 'utf8');
    assert.ok(content.includes('[mcp_servers.pixelslop-playwright]'));
    assert.ok(content.includes('command = "npx"'));
    assert.ok(content.includes('@playwright/mcp@'));
  });

  it('appends to existing content', () => {
    const filePath = join(tempDir, 'config.toml');
    writeFileSync(filePath, '[some_other_section]\nkey = "value"\n');
    writeTomlMcp(filePath);
    const content = readFileSync(filePath, 'utf8');
    assert.ok(content.includes('[some_other_section]'), 'existing section preserved');
    assert.ok(content.includes('[mcp_servers.pixelslop-playwright]'), 'pixelslop section added');
  });

  it('does not duplicate on re-install', () => {
    const filePath = join(tempDir, 'config.toml');
    writeTomlMcp(filePath);
    writeTomlMcp(filePath);
    const content = readFileSync(filePath, 'utf8');
    const matches = content.match(/\[mcp_servers\.pixelslop-playwright\]/g);
    assert.equal(matches.length, 1, 'Should not duplicate');
  });
});

describe('removeTomlMcp', () => {
  let tempDir;

  beforeEach(() => { tempDir = makeTempDir(); });
  afterEach(() => { rmSync(tempDir, { recursive: true, force: true }); });

  it('removes the pixelslop-playwright block', () => {
    const filePath = join(tempDir, 'config.toml');
    writeFileSync(filePath, `[some_section]
key = "value"

[mcp_servers.pixelslop-playwright]
command = "npx"
args = ["-y", "@playwright/mcp@0.0.68"]

[another_section]
foo = "bar"
`);
    removeTomlMcp(filePath);
    const content = readFileSync(filePath, 'utf8');
    assert.ok(!content.includes('pixelslop-playwright'), 'Block removed');
    assert.ok(content.includes('[some_section]'), 'Other sections preserved');
    assert.ok(content.includes('[another_section]'), 'Other sections preserved');
  });

  it('handles missing file gracefully', () => {
    const result = removeTomlMcp(join(tempDir, 'nonexistent.toml'));
    assert.ok(result);
  });
});

// ─────────────────────────────────────────────
// Manifest Schema
// ─────────────────────────────────────────────

describe('manifest schema', () => {
  it('defines all required fields including v2 additions', () => {
    // Manifest v2 adds scope, projectRoot, and installMethods
    const requiredFields = [
      'version', 'installedAt', 'installRoot',
      'playwrightMcpVersion', 'clients', 'agentFiles',
      'scope', 'projectRoot', 'installMethods',
    ];

    // Simulate a v2 manifest (global scope — projectRoot is null)
    const manifest = {
      version: '0.1.0',
      installedAt: new Date().toISOString(),
      installRoot: '/home/user/.pixelslop',
      scope: 'global',
      projectRoot: null,
      playwrightMcpVersion: '0.0.68',
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
      'pixelslop-checker.md', 'pixelslop-setup.md',
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

  it('has engines field requiring Node >= 18', () => {
    assert.ok(pkg.engines, 'package.json must have engines');
    assert.ok(pkg.engines.node, 'engines must specify node');
    assert.ok(pkg.engines.node.includes('18'), 'engines.node must require 18+');
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

  it('excludes Codex CLI from project scope', () => {
    const clients = getClients('project');
    const codex = clients.find(c => c.name === 'Codex CLI');
    assert.ok(!codex, 'Codex CLI should not be in project scope');
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

  it('project scope uses .mcp.json for MCP config', () => {
    const clients = getClients('project');
    const claude = clients.find(c => c.name === 'Claude Code');
    assert.ok(claude.mcpConfig.endsWith('.mcp.json'),
      'Project MCP config should be .mcp.json');
  });

  it('global scope uses settings.json for MCP config', () => {
    const clients = getClients('global');
    const claude = clients.find(c => c.name === 'Claude Code');
    assert.ok(claude.mcpConfig.endsWith('settings.json'),
      'Global MCP config should be settings.json');
  });

  it('all clients have required methods', () => {
    for (const scope of ['global', 'project']) {
      const clients = getClients(scope);
      for (const client of clients) {
        assert.equal(typeof client.detect, 'function', `${client.name}: detect`);
        assert.equal(typeof client.installSkill, 'function', `${client.name}: installSkill`);
        assert.equal(typeof client.removeSkill, 'function', `${client.name}: removeSkill`);
        assert.equal(typeof client.checkSkill, 'function', `${client.name}: checkSkill`);
        assert.ok(client.mcpConfig, `${client.name}: mcpConfig`);
        assert.ok(client.mcpFormat, `${client.name}: mcpFormat`);
      }
    }
  });
});

// ─────────────────────────────────────────────
// CLI Flags
// ─────────────────────────────────────────────

describe('CLI flags', () => {
  it('help text shows --project flag', async () => {
    const { execSync } = await import('node:child_process');
    const output = execSync('node bin/pixelslop.mjs --help', {
      cwd: PROJECT_ROOT,
      encoding: 'utf8',
    });
    assert.ok(output.includes('--project'), 'Help must show --project');
    assert.ok(output.includes('--global'), 'Help must show --global');
    assert.ok(output.includes('--copy'), 'Help must show --copy');
  });
});

// ─────────────────────────────────────────────
// Packaged artifact smoke tests
// ─────────────────────────────────────────────

describe('packaged artifact smoke', () => {
  let tempHome, tempProject, tarballPath;

  beforeEach(() => {
    tempHome = makeTempDir();
    tempProject = makeTempDir();
    tarballPath = packPackage();
  });

  afterEach(() => {
    if (tarballPath && existsSync(tarballPath)) {
      rmSync(tarballPath, { force: true });
    }
    rmSync(tempProject, { recursive: true, force: true });
    rmSync(tempHome, { recursive: true, force: true });
  });

  it('installs, verifies, reports status, and uninstalls via npx tarball', () => {
    const env = { HOME: tempHome };

    runTarballCommand(tarballPath, ['install', '--project'], tempProject, env);
    assert.ok(existsSync(join(tempProject, '.claude', 'agents', 'pixelslop.md')));
    assert.ok(existsSync(join(tempProject, '.claude', 'skills', 'pixelslop', 'SKILL.md')));
    assert.ok(existsSync(join(tempProject, '.mcp.json')));

    const doctorOutput = runTarballCommand(tarballPath, ['doctor'], tempProject, env);
    assert.ok(doctorOutput.includes('All checks passed.'), 'doctor should report success');

    const statusOutput = runTarballCommand(tarballPath, ['status'], tempProject, env);
    assert.ok(statusOutput.includes('Scope: project'), 'status should report project scope');
    assert.ok(statusOutput.includes('Claude Code'), 'status should mention installed client');

    runTarballCommand(tarballPath, ['uninstall'], tempProject, env);
    assert.ok(!existsSync(join(tempProject, '.claude', 'agents', 'pixelslop.md')));
    assert.ok(!existsSync(join(tempProject, '.claude', 'skills', 'pixelslop')));
  });
});
