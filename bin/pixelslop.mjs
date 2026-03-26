#!/usr/bin/env node

/**
 * pixelslop — Installer CLI for the Pixelslop design quality reviewer.
 *
 * Installs pixelslop-tools, skill files, agent specs, and Playwright MCP
 * into Claude Code and Codex CLI runtimes. Handles path rewriting so
 * agent specs reference absolute paths to the install root.
 *
 * Commands:
 *   install    — Copy files, configure runtimes, verify
 *   update     — Upgrade existing install with backup + diff
 *   uninstall  — Remove all installed files and config entries
 *   doctor     — Verify installation health
 *   status     — Show what's installed where
 *
 * Usage: npx pixelslop install
 *        npx pixelslop@latest update
 */

import { readFileSync, writeFileSync, mkdirSync, copyFileSync,
         readdirSync, rmSync, rmdirSync, existsSync, lstatSync, symlinkSync,
         chmodSync, statSync } from 'fs';
import { join, dirname, resolve, relative } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';
import { createHash } from 'crypto';
import { createInterface } from 'readline/promises';

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────

/** Root of the pixelslop npm package (wherever this script lives) */
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PACKAGE_ROOT = resolve(__dirname, '..');

/** User's home directory */
const HOME = homedir();

/** Global install root — always exists, even for project installs */
const INSTALL_ROOT = join(HOME, '.pixelslop');

/** Read version from package.json */
const PKG = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'));
const VERSION = PKG.version;

/** Playwright MCP version — single source of truth */
const PLAYWRIGHT_MCP_VERSION = '0.0.68';

/** Agent files to install (basenames) */
const AGENT_FILES = [
  'pixelslop.md',
  'pixelslop-scanner.md',
  'pixelslop-fixer.md',
  'pixelslop-checker.md',
  'pixelslop-setup.md',
  'pixelslop-code-scanner.md',
];

/**
 * Valid install scopes.
 * - global: install into user-level runtime config (~/.claude, ~/.codex)
 * - project: install into project-level runtime config (./.claude, ./.codex, ./.mcp.json)
 */
const SCOPES = ['global', 'project'];
const RUNTIMES = ['Claude Code', 'Codex CLI'];

// ─────────────────────────────────────────────
// Logging helpers
// ─────────────────────────────────────────────

/**
 * Print a styled log message to stdout.
 * @param {string} icon - Emoji/symbol prefix
 * @param {string} msg - Message text
 */
function log(icon, msg) {
  console.log(`  ${icon} ${msg}`);
}

/** Print a section header */
function header(text) {
  console.log(`\n  ${text}`);
  console.log(`  ${'─'.repeat(text.length)}`);
}

// ─────────────────────────────────────────────
// Path rewriting
// ─────────────────────────────────────────────

/**
 * Rewrite relative paths in agent spec content to absolute install paths.
 *
 * Agent specs reference `bin/pixelslop-tools.cjs` and `dist/skill/resources/`
 * — these only resolve inside the repo. This function replaces them with
 * absolute paths pointing to the install root.
 *
 * @param {string} content - Raw agent spec markdown
 * @param {string} installRoot - Absolute path to install root (e.g. ~/.pixelslop)
 * @returns {string} Content with rewritten paths
 */
export function rewriteAgentPaths(content, installRoot) {
  const toolsPath = join(installRoot, 'bin', 'pixelslop-tools.cjs');
  const resourcesPath = join(installRoot, 'skill', 'resources') + '/';

  return content
    .replaceAll('bin/pixelslop-tools.cjs', `"${toolsPath}"`)
    .replaceAll('dist/skill/resources/', resourcesPath);
}

// ─────────────────────────────────────────────
// MCP Config Writers
// ─────────────────────────────────────────────

/**
 * MCP entry that gets added to runtime configs.
 * Playwright runs locally via npx — no API key needed.
 */
const MCP_ENTRY = {
  command: 'npx',
  args: ['-y', `@playwright/mcp@${PLAYWRIGHT_MCP_VERSION}`],
};

/**
 * Add Playwright MCP entry to a JSON config file (Claude Code settings.json).
 * Creates the file if it doesn't exist. Preserves existing entries.
 *
 * @param {string} filePath - Path to settings.json
 * @returns {boolean} True if entry was added or already present
 */
export function writeJsonMcp(filePath) {
  let data = {};
  if (existsSync(filePath)) {
    try {
      data = JSON.parse(readFileSync(filePath, 'utf8'));
    } catch {
      // If the file is corrupt, start fresh but warn
      log('⚠', `Could not parse ${filePath} — creating new`);
      data = {};
    }
  }

  if (!data.mcpServers) {
    data.mcpServers = {};
  }

  // Don't duplicate if already present
  if (data.mcpServers['pixelslop-playwright']) {
    return true;
  }

  data.mcpServers['pixelslop-playwright'] = MCP_ENTRY;
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
  return true;
}

/**
 * Remove Playwright MCP entry from a JSON config file.
 *
 * @param {string} filePath - Path to settings.json
 * @returns {boolean} True if entry was removed or wasn't present
 */
export function removeJsonMcp(filePath) {
  if (!existsSync(filePath)) return true;

  try {
    const data = JSON.parse(readFileSync(filePath, 'utf8'));
    if (data.mcpServers && data.mcpServers['pixelslop-playwright']) {
      delete data.mcpServers['pixelslop-playwright'];
      writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
    }
    return true;
  } catch {
    log('⚠', `Could not parse ${filePath}`);
    return false;
  }
}

/**
 * Add Playwright MCP entry to a TOML config file (Codex config.toml).
 * Appends the TOML block if not already present.
 *
 * @param {string} filePath - Path to config.toml
 * @returns {boolean} True if entry was added or already present
 */
export function writeTomlMcp(filePath) {
  let content = '';
  if (existsSync(filePath)) {
    content = readFileSync(filePath, 'utf8');
  }

  // Don't duplicate — check if the section header already exists
  if (content.includes('[mcp_servers.pixelslop-playwright]')) {
    return true;
  }

  const tomlBlock = `
[mcp_servers.pixelslop-playwright]
command = "npx"
args = ["-y", "@playwright/mcp@${PLAYWRIGHT_MCP_VERSION}"]
`;

  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, content.trimEnd() + '\n' + tomlBlock);
  return true;
}

/**
 * Remove Playwright MCP entry from a TOML config file.
 * Uses regex to remove the [mcp_servers.pixelslop-playwright] block.
 *
 * @param {string} filePath - Path to config.toml
 * @returns {boolean} True if entry was removed or wasn't present
 */
export function removeTomlMcp(filePath) {
  if (!existsSync(filePath)) return true;

  let content = readFileSync(filePath, 'utf8');

  // Remove the entire block: header + key-value pairs until next section or EOF
  // Match the section header and all lines until the next [section] or end of file
  const pattern = /\n?\[mcp_servers\.pixelslop-playwright\][^\[]*/g;
  const updated = content.replace(pattern, '\n');

  if (updated !== content) {
    writeFileSync(filePath, updated);
  }
  return true;
}

// ─────────────────────────────────────────────
// Directory copy and link helpers
// ─────────────────────────────────────────────

/**
 * Recursively copy a directory.
 * @param {string} src - Source directory
 * @param {string} dest - Destination directory
 */
function copyDir(src, dest) {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * Install a directory via symlink, falling back to copy if symlinks
 * aren't available (Windows without Developer Mode, restricted filesystems).
 *
 * Why this matters: symlinks propagate updates instantly (update the
 * install root and all linked clients see the change). Copies are stale
 * until explicitly re-copied. The manifest tracks which method was used
 * so doctor and update know what to expect.
 *
 * @param {string} src - Source directory to link/copy from
 * @param {string} dest - Destination path for symlink or copy
 * @param {boolean} [forceCopy=false] - Skip symlink attempt, always copy
 * @returns {'symlink'|'copy'} Which method was actually used
 */
export function linkOrCopy(src, dest, forceCopy = false) {
  // Remove existing target first
  if (existsSync(dest)) {
    rmSync(dest, { recursive: true, force: true });
  }

  if (!forceCopy) {
    try {
      symlinkSync(src, dest);
      return 'symlink';
    } catch {
      // Symlink failed (Windows without Developer Mode, restricted fs, etc.)
      // Fall through to copy
    }
  }

  copyDir(src, dest);
  return 'copy';
}

// ─────────────────────────────────────────────
// Client Registry
// ─────────────────────────────────────────────

/**
 * Build the client registry for the given install scope.
 *
 * Each client knows how to detect its runtime, where to put agents/skills/MCP,
 * and how to install/remove/check the skill directory. The install method
 * (symlink vs copy) is determined at install time by linkOrCopy and tracked
 * in the manifest.
 *
 * @param {'global'|'project'} scope - Where to install
 * @param {boolean} forceCopy - Force copy mode (skip symlink attempts)
 * @returns {Array<object>} Client definitions
 */
export function getClients(scope, forceCopy = false) {
  const projectRoot = process.cwd();
  const clients = [];

  // ── Claude Code ──────────────────────────────
  // Global: ~/.claude/agents, ~/.claude/skills, ~/.claude/settings.json
  // Project: ./.claude/agents, ./.claude/skills, ./.mcp.json
  const claudeBase = scope === 'project'
    ? join(projectRoot, '.claude')
    : join(HOME, '.claude');
  const claudeSkillDir = join(claudeBase, 'skills', 'pixelslop');

  const claudeMcpConfig = scope === 'project'
    ? join(projectRoot, '.mcp.json')
    : join(HOME, '.claude', 'settings.json');

  clients.push({
    id: 'claude',
    name: 'Claude Code',
    scope,
    baseDir: claudeBase,
    detectPath: join(HOME, '.claude'),
    detect: () => existsSync(join(HOME, '.claude')),
    agentDir: join(claudeBase, 'agents'),
    skillDir: claudeSkillDir,
    /**
     * Install skill directory via linkOrCopy.
     * @param {boolean} [forceCopyOverride]
     * @returns {{ path: string, method: 'symlink'|'copy' }}
     */
    installSkill: (forceCopyOverride = forceCopy) => {
      const skillSrc = join(INSTALL_ROOT, 'skill');
      mkdirSync(join(claudeBase, 'skills'), { recursive: true });
      const method = linkOrCopy(skillSrc, claudeSkillDir, forceCopyOverride);
      return { path: claudeSkillDir, method };
    },
    removeSkill: () => {
      if (existsSync(claudeSkillDir)) {
        rmSync(claudeSkillDir, { recursive: true, force: true });
      }
    },
    /** Check skill exists and SKILL.md is reachable (works for both symlinks and copies) */
    checkSkill: () => existsSync(claudeSkillDir) && existsSync(join(claudeSkillDir, 'SKILL.md')),
    mcpConfig: claudeMcpConfig,
    mcpFormat: 'json',
  });

  // ── Codex CLI ────────────────────────────────
  const codexBase = scope === 'project'
    ? join(projectRoot, '.codex')
    : join(HOME, '.codex');
  const codexSkillDir = join(codexBase, 'skills', 'pixelslop');
  clients.push({
    id: 'codex',
    name: 'Codex CLI',
    scope,
    baseDir: codexBase,
    detectPath: join(HOME, '.codex'),
    detect: () => existsSync(join(HOME, '.codex')),
    agentDir: join(codexBase, 'agents'),
    skillDir: codexSkillDir,
    /**
     * Install skill directory via linkOrCopy.
     * @param {boolean} [forceCopyOverride]
     * @returns {{ path: string, method: 'symlink'|'copy' }}
     */
    installSkill: (forceCopyOverride = forceCopy) => {
      const skillSrc = join(INSTALL_ROOT, 'skill');
      mkdirSync(join(codexBase, 'skills'), { recursive: true });
      const method = linkOrCopy(skillSrc, codexSkillDir, forceCopyOverride);
      return { path: codexSkillDir, method };
    },
    removeSkill: () => {
      if (existsSync(codexSkillDir)) {
        rmSync(codexSkillDir, { recursive: true, force: true });
      }
    },
    checkSkill: () => existsSync(codexSkillDir) && existsSync(join(codexSkillDir, 'SKILL.md')),
    mcpConfig: join(codexBase, 'config.toml'),
    mcpFormat: 'toml',
  });

  return clients;
}

/**
 * Return all runtimes detected on this machine.
 * Detection is machine-level and always checks the user home directory.
 *
 * @returns {Array<object>} Detected client definitions
 */
function getDetectedClients() {
  return getClients('global').filter(client => client.detect());
}

/**
 * Resolve client definitions by name and preserve registry order.
 *
 * @param {Array<object>} clients - Available client definitions
 * @param {string[]} clientNames - Selected runtime names
 * @returns {Array<object>} Selected client definitions
 */
function resolveClients(clients, clientNames = []) {
  const selected = [];
  for (const client of clients) {
    if (clientNames.includes(client.name)) {
      selected.push(client);
    }
  }
  return selected;
}

/**
 * Parse a runtime selection flag.
 *
 * @param {string[]} args - Raw CLI args
 * @returns {'all'|'claude-only'|'codex-only'|null}
 */
function parseRuntimeFlag(args) {
  const flags = [
    ['--all', 'all'],
    ['--claude-only', 'claude-only'],
    ['--codex-only', 'codex-only'],
  ].filter(([flag]) => args.includes(flag));

  if (flags.length > 1) {
    throw new Error('Choose only one runtime flag: --all, --claude-only, or --codex-only.');
  }

  return flags[0]?.[1] || null;
}

/**
 * Parse a scope flag.
 *
 * @param {string[]} args - Raw CLI args
 * @returns {'global'|'project'|null}
 */
function parseScopeFlag(args) {
  const hasGlobal = args.includes('--global');
  const hasProject = args.includes('--project');

  if (hasGlobal && hasProject) {
    throw new Error('Choose only one scope flag: --global or --project.');
  }

  if (hasProject) return 'project';
  if (hasGlobal) return 'global';
  return null;
}

/**
 * Print the runtime detection summary.
 *
 * @param {Array<object>} allClients - Full runtime registry
 * @param {Array<object>} detectedClients - Detected runtime subset
 */
function reportDetectedClients(allClients, detectedClients) {
  header('Detected runtimes');
  for (const client of detectedClients) {
    log('✓', `${client.name} (${client.detectPath})`);
  }
  for (const client of allClients.filter(item => !detectedClients.some(found => found.name === item.name))) {
    log('·', `${client.name} (not found at ${client.detectPath})`);
  }
}

/**
 * Turn a runtime flag into a concrete runtime list.
 *
 * @param {'all'|'claude-only'|'codex-only'|null} runtimeFlag - Parsed runtime flag
 * @param {Array<object>} detectedClients - Detected runtime subset
 * @returns {string[]|null} Selected runtime names
 */
function selectClientsFromFlag(runtimeFlag, detectedClients) {
  if (!runtimeFlag) return null;

  if (runtimeFlag === 'all') {
    return detectedClients.map(client => client.name);
  }

  if (runtimeFlag === 'claude-only') {
    return ['Claude Code'];
  }

  return ['Codex CLI'];
}

/**
 * Validate that the requested runtimes are available on this machine.
 *
 * @param {string[]} selectedClients - Requested runtime names
 * @param {Array<object>} detectedClients - Detected runtime subset
 */
function validateSelectedClients(selectedClients, detectedClients) {
  const detectedNames = detectedClients.map(client => client.name);
  const unavailable = selectedClients.filter(name => !detectedNames.includes(name));

  if (unavailable.length === 0) return;

  const found = detectedNames.length > 0 ? detectedNames.join(', ') : 'none';
  throw new Error(`Requested runtime not found: ${unavailable.join(', ')}. Detected: ${found}.`);
}

/**
 * Prompt for a numbered choice.
 *
 * @param {import('readline/promises').Interface} rl - Readline interface
 * @param {string} prompt - Prompt label
 * @param {Array<{label: string, value: any, detail?: string}>} choices - Menu choices
 * @returns {Promise<any>} Selected value
 */
async function promptChoice(rl, prompt, choices) {
  while (true) {
    for (const [index, choice] of choices.entries()) {
      log(`${index + 1}.`, choice.label);
      if (choice.detail) {
        log(' ', choice.detail);
      }
    }

    const answer = (await rl.question(`\n  ${prompt} `)).trim();
    const picked = Number(answer);

    if (Number.isInteger(picked) && picked >= 1 && picked <= choices.length) {
      return choices[picked - 1].value;
    }

    if (!process.stdin.isTTY && answer === '') {
      throw new Error('Installer needs prompt answers. Re-run with flags like --global and --all.');
    }

    log('⚠', 'Pick one of the numbered options.');
    console.log('');
  }
}

/**
 * Collect install selections from flags and, when needed, interactive prompts.
 *
 * @param {object} options - Initial selections from CLI flags
 * @param {'global'|'project'|null} options.scope - Preselected scope
 * @param {'all'|'claude-only'|'codex-only'|null} options.runtimeFlag - Preselected runtime flag
 * @returns {Promise<{ scope: 'global'|'project', selectedClients: string[] }>}
 */
async function collectInstallSelections({ scope, runtimeFlag }) {
  const allClients = getClients('global');
  const detectedClients = getDetectedClients();

  if (detectedClients.length === 0) {
    throw new Error('No supported runtimes found (checked: ~/.claude, ~/.codex). Install Claude Code or Codex CLI first.');
  }

  reportDetectedClients(allClients, detectedClients);

  let selectedClients = selectClientsFromFlag(runtimeFlag, detectedClients);
  if (selectedClients) {
    validateSelectedClients(selectedClients, detectedClients);
  }

  let rl;
  try {
    if (!selectedClients || !scope) {
      header('Install wizard');
      rl = createInterface({ input: process.stdin, output: process.stdout });
    }

    if (!selectedClients) {
      if (detectedClients.length === 1) {
        selectedClients = [detectedClients[0].name];
        log('ℹ', `Using ${selectedClients[0]} — only supported runtime found.`);
      } else {
        selectedClients = await promptChoice(
          rl,
          'Choose runtime(s):',
          [
            {
              label: 'Both Claude Code and Codex CLI',
              value: ['Claude Code', 'Codex CLI'],
            },
            {
              label: 'Claude Code only',
              value: ['Claude Code'],
            },
            {
              label: 'Codex CLI only',
              value: ['Codex CLI'],
            },
          ]
        );
      }
    }

    if (!scope) {
      scope = await promptChoice(
        rl,
        'Choose scope:',
        [
          {
            label: 'Global',
            value: 'global',
            detail: 'Install into ~/.claude and ~/.codex. Available in every project.',
          },
          {
            label: 'Project-local',
            value: 'project',
            detail: 'Install into .claude/, .codex/, .mcp.json for this project only.',
          },
        ]
      );
    }
  } finally {
    rl?.close();
  }

  return { scope, selectedClients };
}

// ─────────────────────────────────────────────
// Install Manifest
// ─────────────────────────────────────────────

/**
 * Write install manifest — tracks what was installed where and how.
 *
 * The manifest is the source of truth for doctor, update, and status.
 * It records not just what was installed, but the install method per client
 * (symlink vs copy) and the scope (global vs project). This lets update
 * know which clients need re-copying after an upgrade.
 *
 * @param {object} details - Install details
 * @param {string[]} details.clientNames - Names of installed clients
 * @param {'global'|'project'} details.scope - Install scope
 * @param {object} details.installMethods - Install method per client
 *   e.g. { "Claude Code": { skill: "symlink" }, "Codex CLI": { skill: "copy" } }
 */
function writeManifest({ clientNames, scope, installMethods }) {
  const manifest = {
    version: VERSION,
    installedAt: new Date().toISOString(),
    installRoot: INSTALL_ROOT,
    scope: scope,
    projectRoot: scope === 'project' ? process.cwd() : null,
    playwrightMcpVersion: PLAYWRIGHT_MCP_VERSION,
    clients: clientNames,
    agentFiles: AGENT_FILES,
    installMethods: installMethods,
  };
  writeFileSync(
    join(INSTALL_ROOT, 'install-manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n'
  );
}

/**
 * Read install manifest, or return null if not found.
 * @returns {object|null}
 */
function readManifest() {
  const path = join(INSTALL_ROOT, 'install-manifest.json');
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────
// File Diff Helpers
// ─────────────────────────────────────────────

/**
 * Compute MD5 hash of a file's contents for quick comparison.
 * @param {string} filePath - Absolute path to the file
 * @returns {string} Hex-encoded MD5 hash
 */
function fileHash(filePath) {
  const content = readFileSync(filePath);
  return createHash('md5').update(content).digest('hex');
}

/**
 * Recursively collect all file paths relative to a root directory.
 * @param {string} dir - Directory to walk
 * @param {string} [base] - Base directory for relative paths (defaults to dir)
 * @returns {string[]} Array of relative file paths
 */
function walkFiles(dir, base) {
  if (!base) base = dir;
  const results = [];
  if (!existsSync(dir)) return results;

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    // Skip macOS resource forks
    if (entry.name.startsWith('._')) continue;
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkFiles(fullPath, base));
    } else {
      results.push(relative(base, fullPath));
    }
  }
  return results.sort();
}

/**
 * Calculate the diff between a backup directory and the current install.
 * Returns arrays of new, changed, and removed files.
 *
 * @param {string} backupDir - Path to the backup directory
 * @param {string} installDir - Path to the current install directory
 * @returns {{ added: string[], changed: string[], removed: string[] }}
 */
export function calculateFileDiff(backupDir, installDir) {
  const backupFiles = new Set(walkFiles(backupDir));
  const installFiles = new Set(walkFiles(installDir));

  const added = [];
  const changed = [];
  const removed = [];

  // Files in new install but not in backup → added
  // Files in both → compare hashes for changes
  for (const file of installFiles) {
    if (!backupFiles.has(file)) {
      added.push(file);
    } else {
      // Compare file contents via hash
      const backupHash = fileHash(join(backupDir, file));
      const installHash = fileHash(join(installDir, file));
      if (backupHash !== installHash) {
        changed.push(file);
      }
    }
  }

  // Files in backup but not in new install → removed
  for (const file of backupFiles) {
    if (!installFiles.has(file)) {
      removed.push(file);
    }
  }

  return { added, changed, removed };
}

// ─────────────────────────────────────────────
// Commands
// ─────────────────────────────────────────────

/**
 * Install pixelslop into selected runtimes.
 * Copies tools, skill files, and agent specs. Configures MCP.
 * Tracks install method (symlink vs copy) per client in the manifest.
 * Runs doctor automatically after install.
 *
 * @param {object} [options] - Install options
 * @param {boolean} [options.force] - Force re-install even if same version
 * @param {boolean} [options.isUpdate] - Called from update command (skip banner)
 * @param {'global'|'project'} [options.scope='global'] - Install scope
 * @param {boolean} [options.copy] - Force copy mode (no symlinks)
 * @param {string[]} [options.selectedClients] - Runtime names to configure
 * @param {object} [options.installMethods] - Previous per-client install methods
 * @returns {string|null} Backup directory path if backup was created, null otherwise
 */
function install(options = {}) {
  const scope = options.scope || 'global';
  const forceCopy = options.copy || false;

  if (!options.isUpdate) {
    console.log(`\n  ╭─────────────────────────────────╮`);
    console.log(`  │  pixelslop installer v${VERSION.padEnd(14)}│`);
    console.log(`  ╰─────────────────────────────────╯`);
    if (scope === 'project') {
      log('ℹ', `Scope: project (${process.cwd()})`);
    }
    if (forceCopy) {
      log('ℹ', 'Mode: copy (symlinks disabled)');
    }
  }

  // Build client registry for this scope
  const allClients = getClients(scope, forceCopy);
  const selectedClientNames = options.selectedClients?.length
    ? options.selectedClients
    : allClients.filter(client => client.detect()).map(client => client.name);
  const selectedClients = resolveClients(allClients, selectedClientNames);

  if (selectedClients.length === 0) {
    throw new Error('No runtimes selected for install.');
  }

  if (!options.isUpdate) {
    header('Installing for');
    for (const client of selectedClients) {
      log('→', client.name);
    }
  }

  // Backup existing install if present
  let backupDirCreated = null;
  const existingManifest = readManifest();
  if (existingManifest) {
    const backupDir = join(INSTALL_ROOT, `backup-${existingManifest.version}`);
    if (!existsSync(backupDir)) {
      header('Backing up previous install');
      mkdirSync(backupDir, { recursive: true });
      // Copy current bin and skill to backup
      if (existsSync(join(INSTALL_ROOT, 'bin'))) {
        copyDir(join(INSTALL_ROOT, 'bin'), join(backupDir, 'bin'));
      }
      if (existsSync(join(INSTALL_ROOT, 'skill'))) {
        copyDir(join(INSTALL_ROOT, 'skill'), join(backupDir, 'skill'));
      }
      log('✓', `Backed up v${existingManifest.version} → ${backupDir}`);
      backupDirCreated = backupDir;
    }
  }

  // Step 1: Copy pixelslop-tools to install root (always global)
  header('Installing core files');
  mkdirSync(join(INSTALL_ROOT, 'bin'), { recursive: true });
  copyFileSync(
    join(PACKAGE_ROOT, 'bin', 'pixelslop-tools.cjs'),
    join(INSTALL_ROOT, 'bin', 'pixelslop-tools.cjs')
  );
  chmodSync(join(INSTALL_ROOT, 'bin', 'pixelslop-tools.cjs'), 0o755);
  log('✓', 'bin/pixelslop-tools.cjs');

  // Step 2: Copy skill directory to install root (source of truth)
  copyDir(
    join(PACKAGE_ROOT, 'dist', 'skill'),
    join(INSTALL_ROOT, 'skill')
  );
  const resourceCount = readdirSync(join(INSTALL_ROOT, 'skill', 'resources')).length;
  log('✓', `skill/SKILL.md + ${resourceCount} resources`);

  // Step 3: Install into each detected client
  const installedClients = [];
  const installMethods = {};

  for (const client of selectedClients) {
    header(`Configuring ${client.name}`);

    // Copy agent files with path rewriting
    mkdirSync(client.agentDir, { recursive: true });
    for (const agentFile of AGENT_FILES) {
      const srcPath = join(PACKAGE_ROOT, 'dist', 'agents', agentFile);
      const raw = readFileSync(srcPath, 'utf8');
      const rewritten = rewriteAgentPaths(raw, INSTALL_ROOT);
      writeFileSync(join(client.agentDir, agentFile), rewritten);
    }
    log('✓', `${AGENT_FILES.length} agent specs → ${client.agentDir}`);

    // Copy internal evaluator agents (not in AGENT_FILES — orchestrator-only)
    const internalSrc = join(PACKAGE_ROOT, 'dist', 'agents', 'internal');
    if (existsSync(internalSrc)) {
      const internalDest = join(client.agentDir, 'internal');
      mkdirSync(internalDest, { recursive: true });
      const internalFiles = readdirSync(internalSrc).filter(f => f.endsWith('.md') && !f.startsWith('._'));
      for (const file of internalFiles) {
        const raw = readFileSync(join(internalSrc, file), 'utf8');
        writeFileSync(join(internalDest, file), rewriteAgentPaths(raw, INSTALL_ROOT));
      }
      log('✓', `${internalFiles.length} internal evaluators → ${internalDest}`);
    }

    // Install skill via linkOrCopy — method is tracked
    const preferredMethod = options.installMethods?.[client.name]?.skill;
    const { path: skillPath, method: skillMethod } = client.installSkill(
      preferredMethod === 'copy' || forceCopy
    );
    log('✓', `Skill → ${skillPath} (${skillMethod})`);

    // Track install method for this client
    installMethods[client.name] = { skill: skillMethod };

    // Add Playwright MCP entry (never symlinked — always written directly)
    if (client.mcpFormat === 'json') {
      writeJsonMcp(client.mcpConfig);
    } else {
      writeTomlMcp(client.mcpConfig);
    }
    log('✓', `Playwright MCP → ${client.mcpConfig}`);

    installedClients.push(client.name);
  }

  // Step 4: Write manifest with method tracking
  writeManifest({ clientNames: installedClients, scope, installMethods });

  // Step 5: Run doctor
  console.log('');
  doctor();

  // Summary (skip if called from update — it prints its own)
  if (!options.isUpdate) {
    header('Done');
    log('→', 'Use /pixelslop <url> in Claude Code to scan a page');
    if (selectedClients.some(client => client.name === 'Codex CLI')) {
      log('→', 'Use $pixelslop <url> in Codex CLI');
    }
    console.log('');
  }

  return backupDirCreated;
}

/**
 * Update an existing pixelslop install to the current package version.
 * Backs up the previous install, runs the standard install flow,
 * then calculates and displays a file diff showing what changed.
 *
 * Respects the original install scope and method. If the previous install
 * used --project, update continues in project scope. If clients used copy
 * mode, update re-copies (symlink clients get updates for free via the
 * updated install root).
 *
 * @param {object} [options] - Update options
 * @param {boolean} [options.force] - Force update even if same version
 * @param {'global'|'project'} [options.scope] - Override scope (defaults to manifest's scope)
 * @param {boolean} [options.copy] - Force copy mode
 */
function update(options = {}) {
  console.log(`\n  ╭─────────────────────────────────╮`);
  console.log(`  │  pixelslop updater  v${VERSION.padEnd(14)}│`);
  console.log(`  ╰─────────────────────────────────╯`);

  // Step 1: Check for existing install
  const manifest = readManifest();
  if (!manifest) {
    log('✗', 'Pixelslop is not installed.');
    log(' ', 'Run `npx pixelslop install` first.');
    process.exit(1);
  }

  const installedVersion = manifest.version;

  // Step 2: Compare versions
  if (installedVersion === VERSION && !options.force) {
    log('✓', `Already up to date (v${VERSION}).`);
    log(' ', 'Use `--force` to re-install the same version.');
    console.log('');
    return;
  }

  // Use manifest's scope unless explicitly overridden
  const scope = options.scope || manifest.scope || 'global';

  // If this is a project install, switch to the stored project root
  // so getClients() builds the correct paths
  const originalCwd = process.cwd();
  if (scope === 'project' && manifest.projectRoot) {
    if (originalCwd !== manifest.projectRoot) {
      log('ℹ', `Switching to project install directory: ${manifest.projectRoot}`);
    }
    process.chdir(manifest.projectRoot);
  }

  header('Updating');
  log('ℹ', `Installed: v${installedVersion}`);
  log('ℹ', `Available: v${VERSION}`);
  log('ℹ', `Scope: ${scope}`);

  // Step 3: Run install (it handles backup internally)
  const backupDir = install({
    isUpdate: true,
    force: options.force,
    scope,
    copy: options.copy,
    selectedClients: manifest.clients || [],
    installMethods: manifest.installMethods || {},
  });

  // Step 4: Calculate and display file diff
  // Use the backup dir from install, or reconstruct the path
  const actualBackupDir = backupDir || join(INSTALL_ROOT, `backup-${installedVersion}`);

  if (existsSync(actualBackupDir)) {
    const diff = calculateFileDiff(actualBackupDir, INSTALL_ROOT);

    // Filter out non-content files from diff (manifest, backup dirs)
    const filterDiff = (files) => files.filter(f =>
      !f.startsWith('backup-') &&
      !f.includes('install-manifest.json')
    );

    const added = filterDiff(diff.added);
    const changed = filterDiff(diff.changed);
    const removed = filterDiff(diff.removed);

    if (added.length || changed.length || removed.length) {
      header('Changed files');
      for (const file of added) {
        log('+', `${file} (new)`);
      }
      for (const file of changed) {
        log('~', `${file} (updated)`);
      }
      for (const file of removed) {
        log('-', `${file} (removed)`);
      }
    }

    console.log('');
    log('✓', `Backed up previous version to ${actualBackupDir}`);
    log('ℹ', `Updated: v${installedVersion} → v${VERSION}`);
    console.log('');
    log(' ', 'Note: your previous version is at');
    log(' ', `  ${actualBackupDir}`);
    log(' ', 'if you had local modifications you want to preserve.');
  } else {
    // No backup exists (same version forced reinstall with existing backup)
    log('✓', `Reinstalled v${VERSION}`);
  }

  // Restore original working directory
  if (scope === 'project' && manifest.projectRoot && originalCwd !== manifest.projectRoot) {
    process.chdir(originalCwd);
  }

  console.log('');
}

/**
 * Uninstall pixelslop from all runtimes.
 * Reads the manifest to determine scope, then removes agent files,
 * skill links/copies, MCP entries, and the install root.
 */
function uninstall() {
  console.log(`\n  Uninstalling pixelslop...`);

  // Read manifest to know what scope was used
  const manifest = readManifest();
  if (!manifest) {
    log('·', 'Pixelslop is not installed');
    console.log('');
    return;
  }

  const scope = manifest?.scope || 'global';

  // If this is a project install, use the stored project root so uninstall
  // works correctly even when run from a different directory
  const originalCwd = process.cwd();
  if (scope === 'project' && manifest?.projectRoot) {
    if (originalCwd !== manifest.projectRoot) {
      log('ℹ', `Project was installed in: ${manifest.projectRoot}`);
      log('ℹ', `Cleaning up project files from original install location`);
    }
    // Temporarily override cwd so getClients builds the right paths
    process.chdir(manifest.projectRoot);
  }

  // Build the exact client list captured in the manifest.
  const clients = resolveClients(getClients(scope), manifest.clients || RUNTIMES);
  for (const client of clients) {
    // Remove agent files
    for (const agentFile of AGENT_FILES) {
      const agentPath = join(client.agentDir, agentFile);
      if (existsSync(agentPath)) {
        rmSync(agentPath);
      }
    }

    // Remove internal evaluator agents (only pixelslop-eval-* files, not the whole directory)
    const internalDir = join(client.agentDir, 'internal');
    if (existsSync(internalDir)) {
      for (const file of readdirSync(internalDir).filter(f => f.startsWith('pixelslop-eval-') && f.endsWith('.md'))) {
        rmSync(join(internalDir, file));
      }
      // Remove the directory only if it's empty (don't nuke other tools' files)
      try {
        const remaining = readdirSync(internalDir).filter(f => !f.startsWith('.'));
        if (remaining.length === 0) rmdirSync(internalDir);
      } catch { /* directory not empty or already gone — fine */ }
    }

    // Remove skill
    client.removeSkill();

    // Remove MCP entry
    if (client.mcpFormat === 'json') {
      removeJsonMcp(client.mcpConfig);
    } else {
      removeTomlMcp(client.mcpConfig);
    }

    log('✓', `Removed from ${client.name} (${scope})`);
  }

  // Restore original working directory if we changed it
  if (scope === 'project' && manifest?.projectRoot && originalCwd !== manifest.projectRoot) {
    process.chdir(originalCwd);
  }

  // Remove install root
  if (existsSync(INSTALL_ROOT)) {
    rmSync(INSTALL_ROOT, { recursive: true, force: true });
    log('✓', `Removed ${INSTALL_ROOT}`);
  }

  log('✓', 'Uninstall complete');
  console.log('');
}

/**
 * Verify installation health.
 * Checks file existence, resource counts, MCP entries, and agent files.
 * Returns exit code 0 if healthy, 1 if issues found.
 */
function doctor() {
  header('Doctor');

  let issues = 0;

  /**
   * Run a single check, log result, increment issues on failure.
   * @param {string} label - What we're checking
   * @param {boolean} ok - Whether the check passed
   * @param {string} [detail] - Extra detail on failure
   */
  function check(label, ok, detail) {
    if (ok) {
      log('✓', label);
    } else {
      log('✗', detail ? `${label} — ${detail}` : label);
      issues++;
    }
  }

  // Core files
  const manifest = readManifest();
  check('Install manifest', !!manifest, 'Run `npx pixelslop install` first');

  // Warn if running from a different directory than the project install
  if (manifest?.scope === 'project' && manifest.projectRoot) {
    const cwd = process.cwd();
    if (cwd !== manifest.projectRoot) {
      log('⚠', `Running from different directory than project install`);
      log(' ', `  Installed in: ${manifest.projectRoot}`);
      log(' ', `  Current dir:  ${cwd}`);
      issues++;
    }
  }

  check(
    'bin/pixelslop-tools.cjs',
    existsSync(join(INSTALL_ROOT, 'bin', 'pixelslop-tools.cjs')),
    'Missing from install root'
  );

  check(
    'skill/SKILL.md',
    existsSync(join(INSTALL_ROOT, 'skill', 'SKILL.md')),
    'Missing from install root'
  );

  // Resource count (12 markdown files + personas directory = 13 entries)
  const expectedResources = 13;
  let actualResources = 0;
  const resourceDir = join(INSTALL_ROOT, 'skill', 'resources');
  if (existsSync(resourceDir)) {
    actualResources = readdirSync(resourceDir).filter(f => !f.startsWith('._')).length;
  }
  check(
    `Resources (${actualResources}/${expectedResources})`,
    actualResources >= expectedResources,
    `Expected ${expectedResources}, found ${actualResources}`
  );

  // Persona files check
  const personaDir = join(INSTALL_ROOT, 'skill', 'resources', 'personas');
  let personaCount = 0;
  if (existsSync(personaDir)) {
    personaCount = readdirSync(personaDir).filter(f => f.endsWith('.json')).length;
  }
  check(
    `Personas (${personaCount}/8)`,
    personaCount >= 8,
    `Expected 8 persona files, found ${personaCount}`
  );

  // Per-client checks — use manifest scope to get the right client paths
  const scope = manifest?.scope || 'global';
  const clients = manifest?.clients?.length
    ? resolveClients(getClients(scope), manifest.clients)
    : getClients(scope).filter(client => client.detect());
  const methods = manifest?.installMethods || {};

  for (const client of clients) {
    // Agent files
    let agentCount = 0;
    for (const agentFile of AGENT_FILES) {
      if (existsSync(join(client.agentDir, agentFile))) {
        agentCount++;
      }
    }
    check(
      `${client.name}: agents (${agentCount}/${AGENT_FILES.length})`,
      agentCount === AGENT_FILES.length,
      `Missing ${AGENT_FILES.length - agentCount} agent file(s)`
    );

    // Internal evaluator agents
    const internalDir = join(client.agentDir, 'internal');
    if (existsSync(internalDir)) {
      const internalCount = readdirSync(internalDir).filter(f => f.endsWith('.md') && !f.startsWith('._')).length;
      check(
        `${client.name}: internal evaluators (${internalCount})`,
        internalCount >= 6,
        `Expected ≥6 internal evaluators, found ${internalCount}`
      );
    } else {
      check(`${client.name}: internal evaluators`, false, 'Missing internal/ directory');
    }

    // Path rewriting verification — check both a public agent and an internal evaluator
    const orchestratorPath = join(client.agentDir, 'pixelslop.md');
    const internalEvalPath = join(client.agentDir, 'internal', 'pixelslop-eval-color.md');
    const orchestratorRewritten = existsSync(orchestratorPath)
      && readFileSync(orchestratorPath, 'utf8').includes(join(INSTALL_ROOT, 'bin', 'pixelslop-tools.cjs'));
    const internalRewritten = existsSync(internalEvalPath)
      && readFileSync(internalEvalPath, 'utf8').includes(join(INSTALL_ROOT, 'skill', 'resources', 'scoring.md'));
    check(
      `${client.name}: path rewriting`,
      orchestratorRewritten && internalRewritten,
      'Installed agents still reference relative paths'
    );

    // Skill — check existence and report install method
    const clientMethod = methods[client.name]?.skill || 'unknown';
    check(
      `${client.name}: skill (${clientMethod})`,
      client.checkSkill(),
      'Skill directory/symlink missing or broken'
    );

    // If skill was installed as a symlink, verify the link target still resolves
    if (clientMethod === 'symlink') {
      try {
        const stat = lstatSync(client.skillDir);
        if (stat.isSymbolicLink() && !existsSync(client.skillDir)) {
          check(
            `${client.name}: symlink target`,
            false,
            'Symlink exists but target is broken — run update or install'
          );
        }
      } catch {
        // lstatSync failed — already caught by checkSkill above
      }
    }

    // MCP entry
    if (client.mcpFormat === 'json' && existsSync(client.mcpConfig)) {
      try {
        const config = JSON.parse(readFileSync(client.mcpConfig, 'utf8'));
        check(
          `${client.name}: Playwright MCP`,
          !!config.mcpServers?.['pixelslop-playwright'],
          'MCP entry missing from settings.json'
        );
      } catch {
        check(`${client.name}: Playwright MCP`, false, 'Could not parse settings.json');
      }
    } else if (client.mcpFormat === 'toml' && existsSync(client.mcpConfig)) {
      const content = readFileSync(client.mcpConfig, 'utf8');
      check(
        `${client.name}: Playwright MCP`,
        content.includes('[mcp_servers.pixelslop-playwright]'),
        'MCP entry missing from config.toml'
      );
    }
  }

  // Version and scope info
  if (manifest) {
    log('ℹ', `Installed version: ${manifest.version}`);
    log('ℹ', `Scope: ${scope}`);
    log('ℹ', `Installed at: ${manifest.installedAt}`);
  }

  if (issues > 0) {
    console.log(`\n  ${issues} issue(s) found. Run \`npx pixelslop install\` to fix.\n`);
    return 1;
  }

  console.log(`\n  All checks passed.\n`);
  return 0;
}

/**
 * Show installation status — what's installed where.
 */
function status() {
  const manifest = readManifest();

  if (!manifest) {
    log('·', 'Pixelslop is not installed');
    log(' ', 'Run `npx pixelslop install` to get started');
    console.log('');
    return;
  }

  header('Status');
  log('ℹ', `Version: ${manifest.version}`);
  log('ℹ', `Scope: ${manifest.scope || 'global'}`);
  log('ℹ', `Install root: ${manifest.installRoot}`);
  log('ℹ', `Installed: ${manifest.installedAt}`);
  log('ℹ', `Clients: ${(manifest.clients || []).join(', ')}`);
  log('ℹ', `Playwright MCP: @playwright/mcp@${manifest.playwrightMcpVersion}`);

  const clients = resolveClients(getClients(manifest.scope || 'global'), manifest.clients || []);
  if (clients.length > 0) {
    header('Installed runtimes');
    for (const client of clients) {
      const skillMethod = manifest.installMethods?.[client.name]?.skill || 'unknown';
      log('✓', client.name);
      log(' ', `Agents: ${client.agentDir}`);
      log(' ', `Skill: ${client.skillDir} (${skillMethod})`);
      log(' ', `MCP:   ${client.mcpConfig}`);
    }
  }
  console.log('');
}

// ─────────────────────────────────────────────
// CLI Router
// ─────────────────────────────────────────────

/**
 * Parse argv and route to the appropriate command.
 * Supports: install, update, uninstall, doctor, status, --help, --version
 *
 * Scope flags:
 *   --project  Install into project-level runtime config (.claude/, .codex/, .mcp.json)
 *   --global   Install into user-level runtime config (~/.claude/) — default
 *
 * Method flags:
 *   --copy     Force copy mode — skip symlink attempts (portable/team installs)
 *   --force    Force install/update even if same version
 */
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  const hasForce = args.includes('--force');
  const hasCopy = args.includes('--copy');
  const scope = parseScopeFlag(args);
  const runtimeFlag = parseRuntimeFlag(args);

  switch (command) {
    case 'install': {
      const installSelection = await collectInstallSelections({ scope, runtimeFlag });
      install({
        force: hasForce,
        scope: installSelection.scope,
        copy: hasCopy,
        selectedClients: installSelection.selectedClients,
      });
      break;
    }
    case 'update':
      update({ force: hasForce, scope, copy: hasCopy });
      break;
    case 'uninstall':
      uninstall();
      break;
    case 'doctor':
      doctor();
      break;
    case 'status':
      status();
      break;
    case '--version':
    case '-v':
      console.log(VERSION);
      break;
    case '--help':
    case '-h':
    case undefined:
      console.log(`
  pixelslop v${VERSION} — Design quality reviewer installer

  Commands:
    install     Install pixelslop into Claude Code and Codex CLI
    update      Update an existing install to this version
    uninstall   Remove pixelslop from all runtimes
    doctor      Verify installation health
    status      Show what's installed

  Scope:
    --project   Install into this project only (.claude/, .codex/, .mcp.json)
    --global    Install for current user (default)

  Runtimes:
    --all           Install for every detected runtime
    --claude-only   Install for Claude Code only
    --codex-only    Install for Codex CLI only

  Options:
    --copy      Force copy mode (no symlinks — portable for teams/CI)
    --force     Force install/update even if same version
    --version   Show version
    --help      Show this help

  Usage:
    npx pixelslop install                      # interactive wizard
    npx pixelslop install --global --all      # global, every detected runtime
    npx pixelslop install --project --codex-only
                                               # project-local Codex install
    npx pixelslop install --copy              # keep wizard, force copies
    npx pixelslop@latest update          # upgrade existing install
    npx pixelslop doctor                 # verify health
    npx pixelslop uninstall              # remove everything
`);
      break;
    default:
      console.error(`  Unknown command: ${command}`);
      console.error(`  Run \`npx pixelslop --help\` for usage.`);
      process.exit(1);
  }
}

main().catch(error => {
  console.error(`  ${error.message}`);
  process.exit(1);
});
