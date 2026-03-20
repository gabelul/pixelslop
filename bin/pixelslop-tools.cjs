#!/usr/bin/env node
'use strict';

/**
 * pixelslop-tools — Deterministic CLI for Pixelslop agent state management.
 *
 * Agents call this instead of writing bash themselves. Every command
 * either succeeds with structured output or fails with an error code.
 * No creative interpretation, no formatting drift.
 *
 * Pattern: GSD's gsd-tools.cjs, adapted for Pixelslop's domain.
 * Zero npm dependencies. CJS so it runs anywhere.
 *
 * Usage: pixelslop-tools <group> <command> [options]
 * Groups: plan, checkpoint, gate, config, init, verify
 *
 * Flags:
 *   --raw       JSON output for agent consumption
 *   --cwd <p>   Override working directory
 */

const fs = require('fs');
const path = require('path');
const { execSync, execFileSync } = require('child_process');

// ─────────────────────────────────────────────
// Core Helpers
// ─────────────────────────────────────────────

/** Global flags parsed from argv */
let RAW = false;
let CWD = process.cwd();

/**
 * Output result to stdout. In raw mode, outputs JSON.
 * In human mode, outputs formatted text.
 * Large output (>50KB) goes to a tmpfile with @file: prefix.
 * @param {*} data - The result to output
 * @param {boolean} forceRaw - Override RAW flag
 */
function output(data, forceRaw) {
  const isRaw = forceRaw || RAW;
  const text = isRaw ? JSON.stringify(data, null, 2) : String(data);

  if (text.length > 50000) {
    const tmp = path.join(require('os').tmpdir(), `pixelslop-${Date.now()}.json`);
    fs.writeFileSync(tmp, text);
    console.log(`@file:${tmp}`);
  } else {
    console.log(text);
  }
}

/**
 * Exit with error message and code 1.
 * @param {string} msg - Error description
 */
function fail(msg) {
  if (RAW) {
    console.error(JSON.stringify({ error: msg }));
  } else {
    console.error(`Error: ${msg}`);
  }
  process.exit(1);
}

/**
 * Run a shell command synchronously, return stdout.
 * NOTE: This intentionally uses shell interpretation via execSync because
 * it's used for build gate commands (gateRun, gateBaseline) that execute
 * user-configured build commands like `npm run build`. Those need a shell.
 * Do NOT use this for git commands with file paths — use execGitSafe instead.
 * @param {string} cmd - Shell command
 * @param {object} opts - execSync options
 * @returns {string} stdout trimmed
 */
function exec(cmd, opts = {}) {
  return execSync(cmd, { cwd: CWD, encoding: 'utf-8', ...opts }).trim();
}

/**
 * Run a git command safely using execFileSync (no shell interpolation).
 * File paths passed as arguments are never interpreted by a shell,
 * preventing injection via filenames containing shell metacharacters.
 * @param {...string} args - Git arguments as individual strings
 * @returns {string} stdout trimmed
 */
function execGitSafe(...args) {
  return execFileSync('git', args, { cwd: CWD, encoding: 'utf-8' }).trim();
}

// ─────────────────────────────────────────────
// Markdown / Frontmatter Helpers
// ─────────────────────────────────────────────

/**
 * Normalize markdown for clean file writes.
 * Fixes: MD022 (blank lines around headings), MD031 (fenced code blocks),
 * MD032 (blank lines around lists), MD012 (multiple blank lines),
 * MD047 (file ends with newline).
 * @param {string} md - Raw markdown
 * @returns {string} Normalized markdown
 */
function normalizeMd(md) {
  let out = md;
  // MD012: collapse multiple blank lines to one
  out = out.replace(/\n{3,}/g, '\n\n');
  // MD022: ensure blank line before headings (but not at file start)
  out = out.replace(/([^\n])\n(#{1,6} )/g, '$1\n\n$2');
  // MD022: ensure blank line after headings
  out = out.replace(/(#{1,6} .+)\n([^\n#])/g, '$1\n\n$2');
  // MD031: blank lines around fenced code blocks
  out = out.replace(/([^\n])\n(```)/g, '$1\n\n$2');
  out = out.replace(/(```)\n([^\n])/g, '$1\n\n$2');
  // MD032: blank lines around list items (only top-level lists after non-list)
  out = out.replace(/([^\n-])\n(- \[)/g, '$1\n\n$2');
  // MD047: ensure file ends with exactly one newline
  out = out.replace(/\n*$/, '\n');
  return out;
}

/**
 * Parse YAML frontmatter from markdown (no dependency).
 * Handles simple key: value, arrays (- item), and multiline (>).
 * @param {string} content - Markdown with frontmatter
 * @returns {{ meta: object, body: string }}
 */
function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { meta: {}, body: content };

  const meta = {};
  const lines = match[1].split('\n');
  let currentKey = null;
  let multiline = false;

  for (const line of lines) {
    // Array item: "  - value"
    if (currentKey && line.match(/^\s+-\s+(.+)/)) {
      const val = line.match(/^\s+-\s+(.+)/)[1].trim();
      if (!Array.isArray(meta[currentKey])) meta[currentKey] = [];
      meta[currentKey].push(val);
      continue;
    }

    // Multiline continuation (indented under > key)
    if (multiline && line.startsWith('  ')) {
      meta[currentKey] = (meta[currentKey] || '') + ' ' + line.trim();
      continue;
    }
    multiline = false;

    // Key: value pair
    const kv = line.match(/^([\w_-]+):\s*(.*)$/);
    if (kv) {
      currentKey = kv[1];
      const val = kv[2].trim();
      if (val === '>' || val === '|') {
        multiline = true;
        meta[currentKey] = '';
      } else if (val === '') {
        meta[currentKey] = [];
      } else {
        // Auto-detect types
        if (val === 'true') meta[currentKey] = true;
        else if (val === 'false') meta[currentKey] = false;
        else if (val === 'null') meta[currentKey] = null;
        else if (/^\d+$/.test(val)) meta[currentKey] = parseInt(val, 10);
        else meta[currentKey] = val.replace(/^["']|["']$/g, '');
      }
    }
  }

  // Trim multiline values
  for (const k of Object.keys(meta)) {
    if (typeof meta[k] === 'string') meta[k] = meta[k].trim();
  }

  return { meta, body: match[2] };
}

/**
 * Serialize an object back to YAML frontmatter.
 * @param {object} meta - Frontmatter key-value pairs
 * @returns {string} YAML block (without --- delimiters)
 */
function serializeFrontmatter(meta) {
  const lines = [];
  for (const [key, val] of Object.entries(meta)) {
    if (Array.isArray(val)) {
      lines.push(`${key}:`);
      for (const item of val) lines.push(`  - ${item}`);
    } else if (typeof val === 'string' && val.length > 60) {
      lines.push(`${key}: >`);
      lines.push(`  ${val}`);
    } else if (val === null) {
      lines.push(`${key}: null`);
    } else {
      lines.push(`${key}: ${val}`);
    }
  }
  return lines.join('\n');
}

/**
 * Read the plan file (.pixelslop-plan.md).
 * @returns {{ meta: object, body: string, raw: string, path: string }}
 */
function readPlan() {
  const planPath = path.join(CWD, '.pixelslop-plan.md');
  if (!fs.existsSync(planPath)) fail('No .pixelslop-plan.md found. Run "plan begin" first.');
  const raw = fs.readFileSync(planPath, 'utf-8');
  const { meta, body } = parseFrontmatter(raw);
  return { meta, body, raw, path: planPath };
}

/**
 * Write the plan file with updated frontmatter and/or body.
 * @param {object} meta - Frontmatter fields
 * @param {string} body - Markdown body
 */
function writePlan(meta, body) {
  const planPath = path.join(CWD, '.pixelslop-plan.md');
  const content = `---\n${serializeFrontmatter(meta)}\n---\n${body}`;
  fs.writeFileSync(planPath, normalizeMd(content));
}

/**
 * Parse issues from the plan body.
 * Format: - [status] id priority [category] description
 * @param {string} body - Plan markdown body
 * @returns {Array<{status:string, id:string, priority:string, category:string, description:string, raw:string}>}
 */
function parseIssues(body) {
  const issues = [];
  const issueRegex = /^- \[(\w+)\]\s+(\S+)\s+(P[012])\s+\[([^\]]+)\]\s+(.+)$/gm;
  let m;
  while ((m = issueRegex.exec(body)) !== null) {
    issues.push({
      status: m[1],
      id: m[2],
      priority: m[3],
      category: m[4],
      description: m[5],
      raw: m[0]
    });
  }
  return issues;
}

// ─────────────────────────────────────────────
// Plan Commands
// ─────────────────────────────────────────────

/**
 * Initialize a new pixelslop session and create .pixelslop-plan.md
 * @param {object} args - Parsed arguments (url, root, mode, gate, issues, scores)
 */
function planBegin(args) {
  const planPath = path.join(CWD, '.pixelslop-plan.md');
  if (fs.existsSync(planPath)) fail('.pixelslop-plan.md already exists. Delete it or use plan update.');

  const meta = {
    url: args.url || fail('--url required'),
    root: args.root || '.',
    mode: args.mode || 'visual-editable',
    baseline_score: args['baseline-score'] || 0,
    baseline_slop: args['baseline-slop'] || 'UNKNOWN',
    gate_command: args['gate-command'] || 'none',
    gate_baseline: args['gate-baseline'] || 'unknown',
    session: new Date().toISOString(),
    current_category: args['current-category'] || 'none'
  };

  // Build issue list from --issues (JSON string)
  let issuesMd = '';
  if (args.issues) {
    try {
      const issues = JSON.parse(args.issues);
      issuesMd = issues.map(i =>
        `- [pending] ${i.id} ${i.priority} [${i.category}] ${i.description}`
      ).join('\n');
    } catch (e) {
      fail(`Invalid --issues JSON: ${e.message}`);
    }
  }

  // Build scores table from --scores (JSON string)
  let scoresMd = '';
  if (args.scores) {
    try {
      const scores = JSON.parse(args.scores);
      scoresMd = '| Pillar | Before | After |\n|--------|--------|-------|\n';
      for (const [pillar, score] of Object.entries(scores)) {
        scoresMd += `| ${pillar} | ${score} | — |\n`;
      }
    } catch (e) {
      fail(`Invalid --scores JSON: ${e.message}`);
    }
  }

  const body = `\n## Issues\n\n${issuesMd || '(none yet)'}\n\n## Scores\n\n${scoresMd || '(no scores yet)'}\n`;
  writePlan(meta, body);
  output(RAW ? { status: 'created', path: planPath, ...meta } : `Plan created: ${planPath}`);
}

/**
 * Update one issue's status in the plan.
 * @param {string} issueId - The issue ID to update
 * @param {string} newStatus - New status (fixed, failed, skipped, partial, pending)
 */
function planUpdate(issueId, newStatus) {
  if (!issueId || !newStatus) fail('Usage: plan update <issue-id> <status>');
  const validStatuses = ['pending', 'fixed', 'failed', 'skipped', 'partial', 'in-progress'];
  if (!validStatuses.includes(newStatus)) fail(`Invalid status: ${newStatus}. Valid: ${validStatuses.join(', ')}`);

  const { meta, body } = readPlan();
  // Regex replacement on the status marker — not full file rewrite
  const pattern = new RegExp(`(- \\[)[\\w-]+(\\]\\s+${escapeRegex(issueId)}\\s)`);
  if (!pattern.test(body)) fail(`Issue not found: ${issueId}`);
  const newBody = body.replace(pattern, `$1${newStatus}$2`);
  writePlan(meta, newBody);
  output(RAW ? { status: 'updated', issue: issueId, new_status: newStatus } : `Updated ${issueId} → ${newStatus}`);
}

/**
 * Batch update multiple issues.
 * @param {object} updates - Map of issueId → status from --id flags
 */
function planPatch(updates) {
  if (!updates || Object.keys(updates).length === 0) fail('Usage: plan patch --id1 done --id2 failed');
  const { meta, body } = readPlan();
  let newBody = body;
  const results = [];

  for (const [issueId, status] of Object.entries(updates)) {
    const pattern = new RegExp(`(- \\[)[\\w-]+(\\]\\s+${escapeRegex(issueId)}\\s)`);
    if (pattern.test(newBody)) {
      newBody = newBody.replace(pattern, `$1${status}$2`);
      results.push({ id: issueId, status, ok: true });
    } else {
      results.push({ id: issueId, status, ok: false, error: 'not found' });
    }
  }

  writePlan(meta, newBody);
  output(RAW ? { status: 'patched', results } : results.map(r => `${r.id}: ${r.ok ? r.status : 'NOT FOUND'}`).join('\n'));
}

/**
 * Read a plan field or section.
 * @param {string} field - Field name (frontmatter key or 'issues' or 'scores')
 */
function planGet(field) {
  const { meta, body } = readPlan();
  if (!field) {
    output(RAW ? meta : Object.entries(meta).map(([k, v]) => `${k}: ${v}`).join('\n'));
    return;
  }
  if (field === 'issues') {
    const issues = parseIssues(body);
    output(RAW ? issues : issues.map(i => `[${i.status}] ${i.id} ${i.priority} [${i.category}] ${i.description}`).join('\n'));
    return;
  }
  if (field === 'scores') {
    // Extract scores table from body
    const scoresMatch = body.match(/## Scores\n\n([\s\S]*?)(?=\n## |\n*$)/);
    output(RAW ? { scores_section: scoresMatch?.[1]?.trim() || null } : (scoresMatch?.[1]?.trim() || 'No scores'));
    return;
  }
  if (meta[field] !== undefined) {
    output(RAW ? { [field]: meta[field] } : meta[field]);
  } else {
    fail(`Unknown field: ${field}`);
  }
}

/**
 * Advance to the next pending issue.
 * Updates current_category and returns the next issue.
 */
function planAdvance() {
  const { meta, body } = readPlan();
  const issues = parseIssues(body);
  const next = issues.find(i => i.status === 'pending');
  if (!next) {
    output(RAW ? { status: 'complete', message: 'No pending issues' } : 'All issues resolved.');
    return;
  }
  meta.current_category = next.category;
  writePlan(meta, body);
  output(RAW ? { status: 'advanced', next_issue: next } : `Next: ${next.id} [${next.category}] ${next.description}`);
}

/**
 * Full plan state as JSON — everything an agent needs in one call.
 */
function planSnapshot() {
  const { meta, body, path: planPath } = readPlan();
  const issues = parseIssues(body);
  const summary = {
    pending: issues.filter(i => i.status === 'pending').length,
    fixed: issues.filter(i => i.status === 'fixed').length,
    failed: issues.filter(i => i.status === 'failed').length,
    partial: issues.filter(i => i.status === 'partial').length,
    skipped: issues.filter(i => i.status === 'skipped').length,
    total: issues.length
  };
  output({ ...meta, issues, summary, path: planPath }, true);
}

/**
 * Plan frontmatter as JSON.
 */
function planJson() {
  const { meta } = readPlan();
  output(meta, true);
}

// ─────────────────────────────────────────────
// Checkpoint Commands
// ─────────────────────────────────────────────

/**
 * Create a reversible checkpoint before editing files.
 * Copies target files to .pixelslop/checkpoints/<issueId>/ and writes metadata JSON.
 * @param {string} issueId - Issue identifier
 * @param {string[]} files - Files that will be modified
 */
function checkpointCreate(issueId, files) {
  if (!issueId) fail('Usage: checkpoint create <issue-id> --files file1,file2');
  if (!files || files.length === 0) fail('--files required: comma-separated paths to checkpoint');

  const cpDir = path.join(CWD, '.pixelslop', 'checkpoints');
  fs.mkdirSync(cpDir, { recursive: true });

  // Verify all files are tracked and clean
  for (const f of files) {
    const fullPath = path.join(CWD, f);
    if (!fs.existsSync(fullPath)) fail(`File not found: ${f}`);
    try {
      execGitSafe('ls-files', '--error-unmatch', '--', f);
    } catch {
      fail(`File not tracked by git: ${f}. Pixelslop requires tracked files for safe rollback.`);
    }
  }

  // Check for uncommitted changes in target files
  const dirty = execGitSafe('diff', '--name-only', '--', ...files);
  if (dirty) fail(`Uncommitted changes in target files: ${dirty}. Commit or stash first.`);

  // Save current content as the "before" state
  // We capture the file contents so we can restore even after edits
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const cpId = `${issueId}-${timestamp}`;

  // Save metadata
  const metadata = {
    id: cpId,
    issue_id: issueId,
    files: files,
    created: new Date().toISOString(),
    status: 'pending'
  };

  fs.writeFileSync(path.join(cpDir, `${issueId}.json`), JSON.stringify(metadata, null, 2));

  // Save current state of each file (before any edits)
  // This is more reliable than git diff for rollback
  const beforeDir = path.join(cpDir, issueId);
  fs.mkdirSync(beforeDir, { recursive: true });
  for (const f of files) {
    const dest = path.join(beforeDir, f.replace(/\//g, '__'));
    fs.copyFileSync(path.join(CWD, f), dest);
  }

  output(RAW ? { status: 'created', checkpoint_id: cpId, ...metadata } : `Checkpoint created: ${cpId}`);
}

/**
 * Revert a checkpoint — restore files to their pre-edit state.
 * @param {string} issueId - Issue to revert
 */
function checkpointRevert(issueId) {
  if (!issueId) fail('Usage: checkpoint revert <issue-id>');

  const cpDir = path.join(CWD, '.pixelslop', 'checkpoints');
  const metaPath = path.join(cpDir, `${issueId}.json`);
  if (!fs.existsSync(metaPath)) fail(`No checkpoint found for: ${issueId}`);

  const metadata = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
  const beforeDir = path.join(cpDir, issueId);

  // Restore each file from the saved "before" copy
  for (const f of metadata.files) {
    const saved = path.join(beforeDir, f.replace(/\//g, '__'));
    if (fs.existsSync(saved)) {
      fs.copyFileSync(saved, path.join(CWD, f));
    } else {
      // Fallback: use git checkout
      try {
        execGitSafe('checkout', '--', f);
      } catch (e) {
        fail(`Failed to revert ${f}: ${e.message}`);
      }
    }
  }

  // Verify revert succeeded — files should be clean in git
  const stillDirty = execGitSafe('diff', '--name-only', '--', ...metadata.files);

  // Update metadata status
  metadata.status = 'reverted';
  metadata.reverted_at = new Date().toISOString();
  fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2));

  output(RAW
    ? { status: 'reverted', issue_id: issueId, files: metadata.files, clean: !stillDirty }
    : `Reverted ${issueId}: ${metadata.files.join(', ')}${stillDirty ? ' (warning: some files still dirty)' : ''}`
  );
}

/**
 * Verify a checkpoint patch file exists and is valid.
 * @param {string} issueId - Issue to verify
 */
function checkpointVerify(issueId) {
  if (!issueId) fail('Usage: checkpoint verify <issue-id>');

  const cpDir = path.join(CWD, '.pixelslop', 'checkpoints');
  const metaPath = path.join(cpDir, `${issueId}.json`);
  const exists = fs.existsSync(metaPath);

  if (!exists) {
    output(RAW ? { valid: false, error: 'not found' } : `No checkpoint: ${issueId}`);
    return;
  }

  const metadata = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
  const beforeDir = path.join(cpDir, issueId);
  const hasBackups = fs.existsSync(beforeDir) && metadata.files.every(f =>
    fs.existsSync(path.join(beforeDir, f.replace(/\//g, '__')))
  );

  output(RAW
    ? { valid: true, ...metadata, has_backups: hasBackups }
    : `Checkpoint ${issueId}: ${metadata.status}, files: ${metadata.files.join(', ')}, backups: ${hasBackups}`
  );
}

/**
 * List all checkpoints with their status.
 */
function checkpointList() {
  const cpDir = path.join(CWD, '.pixelslop', 'checkpoints');
  if (!fs.existsSync(cpDir)) {
    output(RAW ? { checkpoints: [] } : 'No checkpoints.');
    return;
  }

  const items = fs.readdirSync(cpDir)
    .filter(f => f.endsWith('.json'))
    .map(f => JSON.parse(fs.readFileSync(path.join(cpDir, f), 'utf-8')));

  output(RAW
    ? { checkpoints: items }
    : items.map(i => `[${i.status}] ${i.issue_id} — ${i.files.join(', ')}`).join('\n') || 'No checkpoints.'
  );
}

// ─────────────────────────────────────────────
// Gate Commands
// ─────────────────────────────────────────────

/**
 * Detect the project's package manager.
 * @returns {string} Package manager command (pnpm, bun, yarn, npm)
 */
function detectPackageManager() {
  if (fs.existsSync(path.join(CWD, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fs.existsSync(path.join(CWD, 'bun.lock'))) return 'bun';
  if (fs.existsSync(path.join(CWD, 'yarn.lock'))) return 'yarn';
  if (fs.existsSync(path.join(CWD, 'package-lock.json'))) return 'npm';
  return 'npm'; // default fallback
}

/**
 * Resolve the build gate command.
 * Priority: explicit flag > .pixelslop.md config > package.json scripts
 * @param {string} explicit - Explicit --build-cmd flag value
 * @returns {{ command: string|null, source: string, package_manager: string }}
 */
function resolveGateCommand(explicit) {
  const pm = detectPackageManager();

  // 1. Explicit flag
  if (explicit && explicit !== 'auto') {
    return { command: explicit, source: 'explicit', package_manager: pm };
  }

  // 2. .pixelslop.md config
  const configPath = path.join(CWD, '.pixelslop.md');
  if (fs.existsSync(configPath)) {
    const configContent = fs.readFileSync(configPath, 'utf-8');
    const buildMatch = configContent.match(/## Build\s*\n+```[^\n]*\n([^\n]+)\n```/);
    if (buildMatch) {
      return { command: buildMatch[1].trim(), source: 'config', package_manager: pm };
    }
  }

  // 3. package.json script detection
  const pkgPath = path.join(CWD, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      const scripts = pkg.scripts || {};
      if (scripts.typecheck) return { command: `${pm} run typecheck`, source: 'package.json:typecheck', package_manager: pm };
      if (scripts.lint) return { command: `${pm} run lint`, source: 'package.json:lint', package_manager: pm };
      if (scripts.build) return { command: `${pm} run build`, source: 'package.json:build', package_manager: pm };
      if (scripts.dev) return { command: null, source: 'skip:dev-only', package_manager: pm };
    } catch { /* invalid package.json */ }
  }

  return { command: null, source: 'none', package_manager: pm };
}

/**
 * Resolve and report the build gate command.
 */
function gateResolve(args) {
  const result = resolveGateCommand(args['build-cmd']);
  output(RAW ? result : `Gate: ${result.command || '(none)'} [${result.source}] via ${result.package_manager}`);
}

/**
 * Run the build gate and return structured result.
 */
function gateRun(args) {
  const { command, source, package_manager } = resolveGateCommand(args['build-cmd']);
  if (!command) {
    output(RAW
      ? { pass: true, skipped: true, reason: source, command: null }
      : `Gate skipped: ${source}`
    );
    return;
  }

  try {
    const stdout = exec(command, { stdio: ['pipe', 'pipe', 'pipe'] });
    output(RAW
      ? { pass: true, exit_code: 0, command, source, package_manager, output: stdout.slice(0, 2000) }
      : `Gate PASS: ${command}`
    );
  } catch (e) {
    output(RAW
      ? { pass: false, exit_code: e.status || 1, command, source, package_manager, output: (e.stdout || e.stderr || '').slice(0, 2000) }
      : `Gate FAIL: ${command}\n${e.stdout || e.stderr || ''}`
    );
  }
}

/**
 * Run gate and record baseline in plan frontmatter.
 */
function gateBaseline(args) {
  const { command, source, package_manager } = resolveGateCommand(args['build-cmd']);
  let pass = true;
  let exitCode = 0;

  if (command) {
    try {
      exec(command, { stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) {
      pass = false;
      exitCode = e.status || 1;
    }
  }

  // If plan exists, update it with baseline info
  const planPath = path.join(CWD, '.pixelslop-plan.md');
  if (fs.existsSync(planPath)) {
    const { meta, body } = readPlan();
    meta.gate_command = command || 'none';
    meta.gate_baseline = pass ? 'pass' : 'fail';
    writePlan(meta, body);
  }

  output(RAW
    ? { pass, exit_code: exitCode, command: command || 'none', source, package_manager, recorded: fs.existsSync(planPath) }
    : `Baseline: ${pass ? 'PASS' : 'FAIL'} — ${command || '(no gate)'}`
  );
}

// ─────────────────────────────────────────────
// Config Commands (.pixelslop.md)
// ─────────────────────────────────────────────

/**
 * Write structured design context to .pixelslop.md
 * @param {object} args - Config fields (audience, brand, aesthetic, principles, off-limits, build-cmd)
 */
function configWrite(args) {
  const configPath = path.join(CWD, '.pixelslop.md');
  const sections = [];

  sections.push('# Pixelslop — Project Design Context\n');
  if (args.audience) sections.push(`## Audience\n\n${args.audience}\n`);
  if (args.brand) sections.push(`## Brand\n\n${args.brand}\n`);
  if (args.aesthetic) sections.push(`## Aesthetic\n\n${args.aesthetic}\n`);
  if (args.principles) sections.push(`## Principles\n\n${args.principles}\n`);
  if (args['off-limits']) sections.push(`## Off Limits\n\n${args['off-limits']}\n`);
  if (args['build-cmd']) sections.push(`## Build\n\n\`\`\`bash\n${args['build-cmd']}\n\`\`\`\n`);

  fs.writeFileSync(configPath, normalizeMd(sections.join('\n')));
  output(RAW ? { status: 'written', path: configPath } : `Config written: ${configPath}`);
}

/**
 * Read .pixelslop.md as structured data.
 */
function configRead() {
  const configPath = path.join(CWD, '.pixelslop.md');
  if (!fs.existsSync(configPath)) fail('No .pixelslop.md found.');

  const content = fs.readFileSync(configPath, 'utf-8');
  const result = {};

  // Extract sections by ## heading
  const sectionRegex = /## ([^\n]+)\n\n([\s\S]*?)(?=\n## |\n*$)/g;
  let m;
  while ((m = sectionRegex.exec(content)) !== null) {
    const key = m[1].trim().toLowerCase().replace(/\s+/g, '_');
    let val = m[2].trim();
    // Extract command from code block if present
    const codeMatch = val.match(/```[^\n]*\n([^\n]+)\n\s*```/);
    if (codeMatch) val = codeMatch[1].trim();
    result[key] = val;
  }

  output(RAW ? result : Object.entries(result).map(([k, v]) => `${k}: ${v}`).join('\n'));
}

/**
 * Check if .pixelslop.md exists.
 */
function configExists() {
  const exists = fs.existsSync(path.join(CWD, '.pixelslop.md'));
  output(RAW ? { exists } : exists ? 'Config exists' : 'No config');
}

// ─────────────────────────────────────────────
// Init Commands (compound context loaders)
// ─────────────────────────────────────────────

/**
 * Load everything needed to start a scan session.
 * Saves 5-6 round trips of agent context.
 * @param {object} args - url, root
 */
function initScan(args) {
  const url = args.url || fail('--url required');
  const root = args.root || '.';
  const resolvedRoot = path.resolve(CWD, root);

  // Validate root
  const rootValid = fs.existsSync(resolvedRoot) && fs.statSync(resolvedRoot).isDirectory();
  let rootHasGit = false;
  let rootHasPackageJson = false;

  if (rootValid) {
    try { execGitSafe('-C', resolvedRoot, 'rev-parse', '--git-dir'); rootHasGit = true; } catch {}
    rootHasPackageJson = fs.existsSync(path.join(resolvedRoot, 'package.json'));
  }

  // Detect monorepo workspace markers
  let monorepo = false;
  let monorepoMarker = null;
  let detectedApps = [];

  if (rootValid) {
    const markers = [
      { file: 'pnpm-workspace.yaml', type: 'pnpm' },
      { file: 'lerna.json', type: 'lerna' },
      { file: 'turbo.json', type: 'turbo' },
      { file: 'nx.json', type: 'nx' },
    ];
    for (const m of markers) {
      if (fs.existsSync(path.join(resolvedRoot, m.file))) {
        monorepo = true;
        monorepoMarker = m.type;
        break;
      }
    }

    // If monorepo, scan for nested apps with dev scripts
    if (monorepo) {
      try {
        const entries = fs.readdirSync(resolvedRoot, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'node_modules') continue;
          // Check common monorepo app directories
          const dirs = [entry.name, path.join(entry.name, 'apps'), path.join(entry.name, 'packages')];
          for (const dir of [entry.name]) {
            const nestedPkg = path.join(resolvedRoot, dir, 'package.json');
            if (fs.existsSync(nestedPkg)) {
              try {
                const pkg = JSON.parse(fs.readFileSync(nestedPkg, 'utf-8'));
                if (pkg.scripts && pkg.scripts.dev) {
                  detectedApps.push({
                    name: pkg.name || dir,
                    path: dir,
                    devScript: pkg.scripts.dev,
                  });
                }
              } catch { /* invalid package.json */ }
            }
          }
        }
      } catch { /* readdir failed */ }
    }
  }

  // Determine URL type
  const urlType = /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)/i.test(url) ? 'local' : 'remote';

  // Determine mode
  let mode = 'visual-report-only';
  if (rootValid && rootHasGit && urlType === 'local') {
    mode = 'visual-editable';
  } else if (rootValid && !rootHasGit) {
    mode = 'visual-report-only'; // can't checkpoint without git
  }

  // If code-check flag is set, override mode
  if (args['code-check']) mode = 'code-check';

  // Resolve gate
  const origCwd = CWD;
  CWD = resolvedRoot;
  const gate = resolveGateCommand(args['build-cmd']);

  // Check baseline
  let baselineGreen = null;
  if (mode === 'visual-editable' && gate.command) {
    try {
      exec(gate.command, { stdio: ['pipe', 'pipe', 'pipe'] });
      baselineGreen = true;
    } catch {
      baselineGreen = false;
      mode = 'visual-report-only'; // can't edit if build is broken
    }
  }
  CWD = origCwd;

  // Check for existing plan
  const planPath = path.join(resolvedRoot, '.pixelslop-plan.md');
  let existingPlan = null;
  if (fs.existsSync(planPath)) {
    try {
      const { meta } = parseFrontmatter(fs.readFileSync(planPath, 'utf-8'));
      existingPlan = meta;
    } catch {}
  }

  // Check for .pixelslop.md config
  let pixelslopConfig = null;
  const configPath = path.join(resolvedRoot, '.pixelslop.md');
  if (fs.existsSync(configPath)) {
    const configContent = fs.readFileSync(configPath, 'utf-8');
    pixelslopConfig = {};
    const sectionRegex = /## ([^\n]+)\n\n([\s\S]*?)(?=\n## |\n*$)/g;
    let m;
    while ((m = sectionRegex.exec(configContent)) !== null) {
      pixelslopConfig[m[1].trim().toLowerCase().replace(/\s+/g, '_')] = m[2].trim();
    }
  }

  const result = {
    mode,
    url,
    url_type: urlType,
    root: root,
    root_resolved: resolvedRoot,
    root_valid: rootValid,
    root_has_git: rootHasGit,
    root_has_package_json: rootHasPackageJson,
    gate_command: gate.command || 'none',
    gate_source: gate.source,
    gate_package_manager: gate.package_manager,
    baseline_green: baselineGreen,
    existing_plan: existingPlan,
    monorepo,
    monorepo_marker: monorepoMarker,
    detected_apps: detectedApps,
    checkpoint_dir: '.pixelslop/checkpoints/',
    screenshot_dir: '.pixelslop/screenshots/',
    pixelslop_config: pixelslopConfig
  };

  output(result, true);
}

/**
 * Load everything needed for the checker agent.
 * @param {object} args - issue (issue ID)
 */
function initCheck(args) {
  const issueId = args.issue || fail('--issue required');

  const { meta, body } = readPlan();
  const issues = parseIssues(body);
  const issue = issues.find(i => i.id === issueId);
  if (!issue) fail(`Issue not found in plan: ${issueId}`);

  // Check for checkpoint
  const cpDir = path.join(CWD, '.pixelslop', 'checkpoints');
  const cpMeta = path.join(cpDir, `${issueId}.json`);
  const cpExists = fs.existsSync(cpMeta);
  let checkpoint = null;
  if (cpExists) {
    checkpoint = JSON.parse(fs.readFileSync(cpMeta, 'utf-8'));
  }

  // Look for screenshots
  const ssDir = path.join(CWD, '.pixelslop', 'screenshots');
  let beforeScreenshot = null;
  if (fs.existsSync(ssDir)) {
    const scanDirs = fs.readdirSync(ssDir).filter(d => d.startsWith('scan-'));
    if (scanDirs.length > 0) {
      const latest = scanDirs.sort().pop();
      const desktop = path.join(ssDir, latest, 'desktop.png');
      if (fs.existsSync(desktop)) beforeScreenshot = `.pixelslop/screenshots/${latest}/desktop.png`;
    }
  }

  const result = {
    issue_id: issueId,
    issue_description: issue.description,
    issue_pillar: issue.category,
    issue_priority: issue.priority,
    before_screenshot: beforeScreenshot,
    checkpoint_exists: cpExists,
    checkpoint: checkpoint,
    gate_command: meta.gate_command || 'none',
    url: meta.url,
    root: meta.root
  };

  output(result, true);
}

// ─────────────────────────────────────────────
// Verify Commands
// ─────────────────────────────────────────────

/**
 * Verify .pixelslop-plan.md structure is valid.
 */
function verifyPlan() {
  const { meta, body } = readPlan();
  const issues = [];

  // Check required frontmatter fields
  const required = ['url', 'root', 'mode', 'session'];
  for (const field of required) {
    if (!meta[field]) issues.push(`Missing frontmatter field: ${field}`);
  }

  // Check for Issues section
  if (!body.includes('## Issues')) issues.push('Missing ## Issues section');
  if (!body.includes('## Scores')) issues.push('Missing ## Scores section');

  // Validate issue format
  const parsedIssues = parseIssues(body);
  for (const issue of parsedIssues) {
    if (!['pending', 'fixed', 'failed', 'skipped', 'partial', 'in-progress'].includes(issue.status)) {
      issues.push(`Invalid status "${issue.status}" on issue ${issue.id}`);
    }
    if (!['P0', 'P1', 'P2'].includes(issue.priority)) {
      issues.push(`Invalid priority "${issue.priority}" on issue ${issue.id}`);
    }
  }

  const valid = issues.length === 0;
  output(RAW
    ? { valid, issues, issue_count: parsedIssues.length }
    : valid ? 'Plan structure valid' : `Plan issues:\n${issues.map(i => `  - ${i}`).join('\n')}`
  );
}

/**
 * Verify all issues have outcomes (no pending remaining).
 */
function verifySession() {
  const { body } = readPlan();
  const issues = parseIssues(body);
  const pending = issues.filter(i => i.status === 'pending');
  const complete = pending.length === 0;

  output(RAW
    ? { complete, pending: pending.map(i => i.id), total: issues.length }
    : complete
      ? `Session complete: ${issues.length} issues resolved`
      : `${pending.length} pending: ${pending.map(i => i.id).join(', ')}`
  );
}

/**
 * Verify screenshots exist for claimed viewports.
 */
function verifyScreenshots() {
  const ssDir = path.join(CWD, '.pixelslop', 'screenshots');
  if (!fs.existsSync(ssDir)) {
    output(RAW ? { valid: false, error: 'no screenshot directory' } : 'No screenshots directory');
    return;
  }

  const scanDirs = fs.readdirSync(ssDir).filter(d => d.startsWith('scan-'));
  const results = scanDirs.map(dir => {
    const files = fs.readdirSync(path.join(ssDir, dir));
    return { scan: dir, files, count: files.length };
  });

  output(RAW
    ? { valid: results.length > 0, scans: results }
    : results.map(r => `${r.scan}: ${r.files.join(', ')}`).join('\n') || 'No scan directories'
  );
}

/**
 * Verify checkpoint patch files are valid.
 */
function verifyCheckpoints() {
  const cpDir = path.join(CWD, '.pixelslop', 'checkpoints');
  if (!fs.existsSync(cpDir)) {
    output(RAW ? { valid: true, count: 0 } : 'No checkpoints to verify');
    return;
  }

  const metaFiles = fs.readdirSync(cpDir).filter(f => f.endsWith('.json'));
  const results = [];

  for (const f of metaFiles) {
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(cpDir, f), 'utf-8'));
      const hasBackupDir = fs.existsSync(path.join(cpDir, meta.issue_id));
      results.push({ id: meta.issue_id, status: meta.status, valid: true, has_backups: hasBackupDir });
    } catch (e) {
      results.push({ file: f, valid: false, error: e.message });
    }
  }

  const allValid = results.every(r => r.valid);
  output(RAW
    ? { valid: allValid, checkpoints: results }
    : results.map(r => `${r.id || r.file}: ${r.valid ? r.status : 'INVALID'}`).join('\n')
  );
}

// ─────────────────────────────────────────────
// Utility
// ─────────────────────────────────────────────

/**
 * Escape special regex characters in a string.
 * @param {string} str - Input string
 * @returns {string} Regex-safe string
 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ─────────────────────────────────────────────
// Argument Parsing
// ─────────────────────────────────────────────

/**
 * Parse CLI arguments into a structured object.
 * Handles: --flag value, --flag=value, positional args.
 * @param {string[]} argv - Raw process.argv (from index 2)
 * @returns {{ positional: string[], flags: object }}
 */
function parseArgs(argv) {
  const positional = [];
  const flags = {};
  let i = 0;

  while (i < argv.length) {
    const arg = argv[i];
    if (arg === '--raw') {
      RAW = true;
    } else if (arg === '--cwd') {
      CWD = path.resolve(argv[++i] || '.');
    } else if (arg.startsWith('--')) {
      const key = arg.slice(2);
      if (key.includes('=')) {
        const [k, v] = key.split('=');
        flags[k] = v;
      } else {
        const next = argv[i + 1];
        if (next && !next.startsWith('--')) {
          flags[key] = next;
          i++;
        } else {
          flags[key] = true;
        }
      }
    } else {
      positional.push(arg);
    }
    i++;
  }

  return { positional, flags };
}

// ─────────────────────────────────────────────
// Router
// ─────────────────────────────────────────────

/**
 * Main entry point. Parses args and routes to the appropriate handler.
 */
function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const [group, command] = positional;

  if (!group) {
    console.log('Usage: pixelslop-tools <group> <command> [options]');
    console.log('Groups: plan, checkpoint, gate, config, init, verify');
    console.log('Flags: --raw (JSON output), --cwd <path> (working directory)');
    process.exit(0);
  }

  switch (group) {
    case 'plan':
      switch (command) {
        case 'begin': return planBegin(flags);
        case 'update': return planUpdate(positional[2], positional[3] || flags.status);
        case 'patch': {
          // Collect --id pairs: remaining flags as id→status map
          const updates = {};
          for (const [k, v] of Object.entries(flags)) {
            if (k !== 'raw' && k !== 'cwd') updates[k] = v;
          }
          return planPatch(updates);
        }
        case 'get': return planGet(positional[2] || flags.field);
        case 'advance': return planAdvance();
        case 'snapshot': return planSnapshot();
        case 'json': return planJson();
        default: fail(`Unknown plan command: ${command}. Valid: begin, update, patch, get, advance, snapshot, json`);
      }
      break;

    case 'checkpoint':
      switch (command) {
        case 'create': return checkpointCreate(positional[2] || flags.id, (flags.files || '').split(',').filter(Boolean));
        case 'revert': return checkpointRevert(positional[2] || flags.id);
        case 'verify': return checkpointVerify(positional[2] || flags.id);
        case 'list': return checkpointList();
        default: fail(`Unknown checkpoint command: ${command}. Valid: create, revert, verify, list`);
      }
      break;

    case 'gate':
      switch (command) {
        case 'resolve': return gateResolve(flags);
        case 'run': return gateRun(flags);
        case 'baseline': return gateBaseline(flags);
        default: fail(`Unknown gate command: ${command}. Valid: resolve, run, baseline`);
      }
      break;

    case 'config':
      switch (command) {
        case 'write': return configWrite(flags);
        case 'read': return configRead();
        case 'exists': return configExists();
        default: fail(`Unknown config command: ${command}. Valid: write, read, exists`);
      }
      break;

    case 'init':
      switch (command) {
        case 'scan': return initScan(flags);
        case 'check': return initCheck(flags);
        default: fail(`Unknown init command: ${command}. Valid: scan, check`);
      }
      break;

    case 'verify':
      switch (command) {
        case 'plan': return verifyPlan();
        case 'session': return verifySession();
        case 'screenshots': return verifyScreenshots();
        case 'checkpoints': return verifyCheckpoints();
        default: fail(`Unknown verify command: ${command}. Valid: plan, session, screenshots, checkpoints`);
      }
      break;

    default:
      fail(`Unknown group: ${group}. Valid: plan, checkpoint, gate, config, init, verify`);
  }
}

main();
