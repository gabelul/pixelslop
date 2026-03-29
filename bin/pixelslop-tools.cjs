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
 * Groups: plan, checkpoint, gate, config, init, verify, browser
 *
 * Flags:
 *   --raw       JSON output for agent consumption
 *   --cwd <p>   Override working directory
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, execFileSync } = require('child_process');

// ─────────────────────────────────────────────
// Core Helpers
// ─────────────────────────────────────────────

/** Global flags parsed from argv */
let RAW = false;
let CWD = process.cwd();
let DEBUG = false;

/**
 * Resolve the project root for commands that manage project-local state.
 * `--root` identifies the analyzed project; if omitted, use the current cwd.
 * @param {string|undefined} root - Optional project root override
 * @returns {string} Absolute project root
 */
function resolveProjectRoot(root) {
  return path.resolve(CWD, root || '.');
}

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

// ─────────────────────────────────────────────
// Session Logger
// ─────────────────────────────────────────────

/** Session log file lives next to the plan file in CWD */
const SESSION_LOG = '.pixelslop-session.log';

/**
 * Resolve the session log file path.
 * @returns {string} Absolute path to the session log
 */
function sessionLogPath(root) {
  return path.join(resolveProjectRoot(root), SESSION_LOG);
}

/**
 * Append a timestamped entry to the session log.
 * Creates the file if it doesn't exist. Each entry is one line:
 *   [HH:MM:SS] [AGENT] message
 *
 * @param {string} agent - Agent identifier (orchestrator, scanner, fixer, checker, setup, skill)
 * @param {string} level - Log level (info, warn, error, debug)
 * @param {string} message - What happened
 */
function sessionLog(agent, level, message, root) {
  const now = new Date();
  const ts = now.toISOString().slice(11, 19); // HH:MM:SS
  const prefix = { info: '●', warn: '▲', error: '✖', debug: '○' }[level] || '●';
  const line = `[${ts}] ${prefix} [${agent}] ${sanitizeLogField(message)}\n`;
  fs.appendFileSync(sessionLogPath(root), line);
}

/**
 * Auto-log: only writes when --debug is active.
 * Used by plan update, checkpoint, gate, and init commands to trace
 * orchestrator/subagent activity without cluttering non-debug sessions.
 *
 * @param {string} agent - Agent identifier
 * @param {string} level - Log level
 * @param {string} message - What happened
 * @param {string} [root] - Optional project root
 */
function autoLog(agent, level, message, root) {
  if (!DEBUG) return;
  sessionLog(agent, level, message, root);
}

/**
 * Normalize log values so each entry stays on a single line.
 * @param {string} value - Raw log field value
 * @returns {string} Single-line value safe for the session log
 */
function sanitizeLogField(value) {
  return String(value || '')
    .replace(/\r?\n+/g, ' | ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * CLI handler for `log write`.
 * Agents call this to record what they're doing.
 *
 * Usage: pixelslop-tools log write --agent orchestrator --level info --message "Starting scan"
 *        pixelslop-tools log write --agent fixer --level error --message "Checkpoint failed for contrast-cta"
 *
 * @param {object} args - CLI flags (--agent, --level, --message)
 */
function logWrite(args) {
  const agent = sanitizeLogField(args.agent || 'unknown');
  const level = args.level || 'info';
  const message = sanitizeLogField(args.message || args.msg || '');
  if (!message) fail('--message required');

  sessionLog(agent, level, message, args.root);
  output(RAW ? { logged: true, agent, level, message } : `Logged: [${agent}] ${message}`);
}

/**
 * CLI handler for `log read`.
 * Dump the session log for inspection.
 *
 * @param {object} args - CLI flags (--tail for last N lines)
 */
function logRead(args) {
  const logFile = sessionLogPath(args.root);
  if (!fs.existsSync(logFile)) {
    output(RAW ? { entries: [], empty: true } : 'No session log found.');
    return;
  }

  const content = fs.readFileSync(logFile, 'utf-8');
  const lines = content.trim().split('\n').filter(Boolean);

  if (args.tail) {
    const n = parseInt(args.tail, 10) || 20;
    const tail = lines.slice(-n);
    output(RAW ? { entries: tail, total: lines.length, showing: tail.length } : tail.join('\n'));
  } else {
    output(RAW ? { entries: lines, total: lines.length } : content);
  }
}

/**
 * CLI handler for `log clear`.
 * Wipe the session log (e.g., at the start of a new scan).
 * @param {object} args - CLI flags (--root)
 */
function logClear(args = {}) {
  const logFile = sessionLogPath(args.root);
  if (fs.existsSync(logFile)) {
    fs.unlinkSync(logFile);
  }
  output(RAW ? { cleared: true } : 'Session log cleared.');
}

// ─────────────────────────────────────────────
// Shell Helpers
// ─────────────────────────────────────────────

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
 * @param {string|undefined} root - Optional project root override
 * @returns {{ meta: object, body: string, raw: string, path: string }}
 */
function readPlan(root) {
  const planPath = path.join(resolveProjectRoot(root), '.pixelslop-plan.md');
  if (!fs.existsSync(planPath)) fail('No .pixelslop-plan.md found. Run "plan begin" first.');
  const raw = fs.readFileSync(planPath, 'utf-8');
  const { meta, body } = parseFrontmatter(raw);
  return { meta, body, raw, path: planPath };
}

/**
 * Write the plan file with updated frontmatter and/or body.
 * @param {object} meta - Frontmatter fields
 * @param {string} body - Markdown body
 * @param {string|undefined} root - Optional project root override
 */
function writePlan(meta, body, root) {
  const planPath = path.join(resolveProjectRoot(root || meta.root), '.pixelslop-plan.md');
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
  const projectRoot = resolveProjectRoot(args.root);
  const planPath = path.join(projectRoot, '.pixelslop-plan.md');
  if (fs.existsSync(planPath)) {
    if (args.force) {
      fs.unlinkSync(planPath);
    } else {
      fail('.pixelslop-plan.md already exists. Use --force to replace it, or plan update to modify.');
    }
  }

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
  writePlan(meta, body, args.root);
  // Auto-log plan creation
  const issueCount = issuesMd ? issuesMd.split('\n').filter(l => l.startsWith('- [')).length : 0;
  autoLog('orchestrator', 'info', `plan begin: ${issueCount} issues, url=${meta.url}, mode=${meta.mode}`, args.root);
  output(RAW ? { status: 'created', path: planPath, ...meta } : `Plan created: ${planPath}`);
}

/**
 * Update one issue's status in the plan.
 * @param {string} issueId - The issue ID to update
 * @param {string} newStatus - New status (fixed, failed, skipped, partial, pending)
 */
function planUpdate(issueId, newStatus, args = {}) {
  if (!issueId || !newStatus) fail('Usage: plan update <issue-id> <status>');
  const validStatuses = ['pending', 'fixed', 'failed', 'skipped', 'partial', 'in-progress'];
  if (!validStatuses.includes(newStatus)) fail(`Invalid status: ${newStatus}. Valid: ${validStatuses.join(', ')}`);

  const { meta, body } = readPlan(args.root);
  // Regex replacement on the status marker — not full file rewrite
  const pattern = new RegExp(`(- \\[)[\\w-]+(\\]\\s+${escapeRegex(issueId)}\\s)`);
  if (!pattern.test(body)) fail(`Issue not found: ${issueId}`);
  const newBody = body.replace(pattern, `$1${newStatus}$2`);
  writePlan(meta, newBody, args.root);
  // Auto-log status transitions so the session log captures orchestrator activity
  autoLog('orchestrator', 'info', `plan update: ${issueId} → ${newStatus}`, args.root);
  output(RAW ? { status: 'updated', issue: issueId, new_status: newStatus } : `Updated ${issueId} → ${newStatus}`);
}

/**
 * Batch update multiple issues.
 * @param {object} updates - Map of issueId → status from --id flags
 */
function planPatch(updates, args = {}) {
  if (!updates || Object.keys(updates).length === 0) fail('Usage: plan patch --id1 done --id2 failed');
  const { meta, body } = readPlan(args.root);
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

  writePlan(meta, newBody, args.root);
  output(RAW ? { status: 'patched', results } : results.map(r => `${r.id}: ${r.ok ? r.status : 'NOT FOUND'}`).join('\n'));
}

/**
 * Read a plan field or section.
 * @param {string} field - Field name (frontmatter key or 'issues' or 'scores')
 */
function planGet(field, args = {}) {
  const { meta, body } = readPlan(args.root);
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
function planAdvance(args = {}) {
  const { meta, body } = readPlan(args.root);
  const issues = parseIssues(body);
  const next = issues.find(i => i.status === 'pending');
  if (!next) {
    output(RAW ? { status: 'complete', message: 'No pending issues' } : 'All issues resolved.');
    return;
  }
  meta.current_category = next.category;
  writePlan(meta, body, args.root);
  output(RAW ? { status: 'advanced', next_issue: next } : `Next: ${next.id} [${next.category}] ${next.description}`);
}

/**
 * Full plan state as JSON — everything an agent needs in one call.
 */
function planSnapshot(args = {}) {
  const { meta, body, path: planPath } = readPlan(args.root);
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
function planJson(args = {}) {
  const { meta } = readPlan(args.root);
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

  autoLog('fixer', 'info', `checkpoint create: ${issueId} (${files.length} files: ${files.join(', ')})`);
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

  autoLog('checker', 'warn', `checkpoint revert: ${issueId} (${metadata.files.join(', ')})`);
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
    autoLog('orchestrator', 'info', `gate PASS: ${command}`, args.root);
    output(RAW
      ? { pass: true, exit_code: 0, command, source, package_manager, output: stdout.slice(0, 2000) }
      : `Gate PASS: ${command}`
    );
  } catch (e) {
    autoLog('orchestrator', 'error', `gate FAIL: ${command}`, args.root);
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
  const planPath = path.join(resolveProjectRoot(args.root), '.pixelslop-plan.md');
  if (fs.existsSync(planPath)) {
    const { meta, body } = readPlan(args.root);
    meta.gate_command = command || 'none';
    meta.gate_baseline = pass ? 'pass' : 'fail';
    writePlan(meta, body, args.root);
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
  const configPath = path.join(resolveProjectRoot(args.root), '.pixelslop.md');
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
function configRead(args = {}) {
  const configPath = path.join(resolveProjectRoot(args.root), '.pixelslop.md');
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
function configExists(args = {}) {
  const exists = fs.existsSync(path.join(resolveProjectRoot(args.root), '.pixelslop.md'));
  output(RAW ? { exists } : exists ? 'Config exists' : 'No config');
}

/**
 * Save auto-detected project context to .pixelslop-context.json.
 * The setup agent calls this after exploring the codebase so future
 * runs can skip the discovery phase entirely.
 *
 * @param {object} args - Flags from CLI (--framework, --css-approach, etc.)
 */
function configSaveContext(args) {
  const root = resolveProjectRoot(args.root);
  const contextPath = path.join(root, '.pixelslop-context.json');

  const context = {
    version: 1,
    saved_at: new Date().toISOString(),
    framework: args.framework || null,
    css_approach: args['css-approach'] || null,
    build_tool: args['build-tool'] || null,
    package_manager: args['package-manager'] || null,
    fonts: args.fonts ? args.fonts.split(',').map(f => f.trim()) : [],
    design_tokens: args['design-tokens'] === 'true',
    token_location: args['token-location'] || null,
    component_count: args['component-count'] ? parseInt(args['component-count'], 10) : null,
    component_library: args['component-library'] || null,
    has_dark_mode: args['has-dark-mode'] === 'true',
    description: args.description || null,
  };

  writeStateFile(contextPath, JSON.stringify(context, null, 2) + '\n');
  autoLog('setup', 'info', `config save-context → ${contextPath}`, args.root);
  output(RAW ? { status: 'saved', path: contextPath } : `Context saved: ${contextPath}`);
}

/**
 * Write a project-local state file without following symlink targets.
 * Uses a temp file in the same directory, then atomically renames it
 * into place so we never clobber a symlink target.
 *
 * @param {string} filePath - Final destination path
 * @param {string} content - File content
 */
function writeStateFile(filePath, content) {
  if (fs.existsSync(filePath)) {
    const stat = fs.lstatSync(filePath);
    if (stat.isSymbolicLink()) {
      fail(`Refusing to write state file through symlink: ${filePath}`);
    }
  }

  const dir = path.dirname(filePath);
  const tempPath = path.join(dir, `.${path.basename(filePath)}.tmp-${process.pid}-${Date.now()}`);

  try {
    const fd = fs.openSync(tempPath, 'wx');
    fs.writeFileSync(fd, content, 'utf-8');
    fs.closeSync(fd);
    fs.renameSync(tempPath, filePath);
  } catch (e) {
    if (fs.existsSync(tempPath)) {
      fs.unlinkSync(tempPath);
    }
    fail(`Failed to write state file: ${e.message}`);
  }
}

/**
 * Load cached project context from .pixelslop-context.json.
 * Returns the context object with exists: true, or exists: false
 * if no cached context is found.
 *
 * @param {object} args - Flags from CLI (--root)
 */
/** Expected schema version for .pixelslop-context.json */
const CONTEXT_SCHEMA_VERSION = 1;

/** Context older than 7 days is considered stale */
const CONTEXT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Fields that a valid context file must contain */
const CONTEXT_REQUIRED_FIELDS = ['version', 'saved_at', 'framework'];

function configLoadContext(args = {}) {
  const root = resolveProjectRoot(args.root);
  const contextPath = path.join(root, '.pixelslop-context.json');

  if (!fs.existsSync(contextPath)) {
    output(RAW ? { exists: false } : 'No cached context found');
    return;
  }

  let context;
  try {
    context = JSON.parse(fs.readFileSync(contextPath, 'utf-8'));
  } catch (e) {
    // Malformed JSON — treat as missing, don't crash
    output(RAW ? { exists: false, reason: 'malformed', error: e.message } : 'Cached context is malformed, ignoring');
    return;
  }

  // Schema version guard — reject unknown versions
  if (context.version !== CONTEXT_SCHEMA_VERSION) {
    output(RAW
      ? { exists: false, reason: 'version_mismatch', found: context.version, expected: CONTEXT_SCHEMA_VERSION }
      : `Cached context has version ${context.version}, expected ${CONTEXT_SCHEMA_VERSION} — ignoring`
    );
    return;
  }

  // Structural check — reject if required fields are missing
  const missing = CONTEXT_REQUIRED_FIELDS.filter(f => !(f in context));
  if (missing.length > 0) {
    output(RAW
      ? { exists: false, reason: 'missing_fields', missing }
      : `Cached context missing fields: ${missing.join(', ')} — ignoring`
    );
    return;
  }

  // Staleness check — flag if older than 7 days
  const age = Date.now() - new Date(context.saved_at).getTime();
  const stale = isNaN(age) || age > CONTEXT_MAX_AGE_MS;

  output(RAW ? { exists: true, stale, ...context } : JSON.stringify(context, null, 2));
}

// ─────────────────────────────────────────────
// Discovery Commands
// ─────────────────────────────────────────────

/** Common local dev server ports to probe when no explicit URL is given. */
const DEFAULT_DISCOVERY_PORTS = [3000, 3001, 4173, 4321, 5173, 8000, 8080];

/**
 * Detect the package manager for a directory, walking up to a boundary.
 * @param {string} dir - Directory to inspect
 * @param {string} [boundary=dir] - Highest directory to inspect
 * @returns {string} Package manager command
 */
function detectPackageManagerAt(dir, boundary = dir) {
  let current = path.resolve(dir);
  const limit = path.resolve(boundary);

  while (true) {
    if (fs.existsSync(path.join(current, 'pnpm-workspace.yaml'))) return 'pnpm';
    if (fs.existsSync(path.join(current, 'pnpm-lock.yaml'))) return 'pnpm';
    if (fs.existsSync(path.join(current, 'bun.lock'))) return 'bun';
    if (fs.existsSync(path.join(current, 'yarn.lock'))) return 'yarn';
    if (fs.existsSync(path.join(current, 'package-lock.json'))) return 'npm';
    if (current === limit) break;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return 'npm';
}

/**
 * Parse a comma-separated ports flag or return defaults.
 * @param {string|boolean|undefined} value - Raw --ports flag
 * @returns {number[]} Ports to probe
 */
function parseDiscoveryPorts(value) {
  if (!value || value === true) return DEFAULT_DISCOVERY_PORTS.slice();
  return String(value)
    .split(',')
    .map(v => parseInt(v.trim(), 10))
    .filter(v => Number.isInteger(v) && v > 0 && v <= 65535);
}

/**
 * Normalize a path for cross-platform comparison.
 * @param {string|null|undefined} value - Raw filesystem path
 * @returns {string|null} Normalized path
 */
function normalizeComparePath(value) {
  if (!value) return null;
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

/**
 * Check whether one path is equal to or nested under another.
 * @param {string} candidate - Candidate child path
 * @param {string} base - Base directory path
 * @returns {boolean} True if equal or nested
 */
function isSameOrNestedPath(candidate, base) {
  return candidate === base || candidate.startsWith(`${base}${path.sep}`);
}

/**
 * Safely run a command and return trimmed stdout, or null on failure.
 * @param {string} file - Executable name
 * @param {string[]} args - Argument list
 * @returns {string|null} Trimmed stdout
 */
function tryExecFile(file, args) {
  try {
    return execFileSync(file, args, { cwd: CWD, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch {
    return null;
  }
}

/**
 * Sleep synchronously for a short interval in a cross-platform way.
 * Uses Atomics.wait when available to avoid shelling out to platform-specific tools.
 * @param {number} ms - Milliseconds to block
 */
function sleepSync(ms) {
  const waitMs = Math.max(0, Number(ms) || 0);
  if (waitMs === 0) return;

  try {
    const signal = new Int32Array(new SharedArrayBuffer(4));
    Atomics.wait(signal, 0, 0, waitMs);
  } catch {
    const end = Date.now() + waitMs;
    while (Date.now() < end) {
      // Busy wait only as a last resort.
    }
  }
}

/**
 * Probe a local HTTP endpoint using a short-lived Node subprocess.
 * @param {string} url - URL to probe
 * @param {number} [timeoutMs=1200] - Timeout in milliseconds
 * @returns {{ reachable: boolean, status_code: number|null }}
 */
function probeUrl(url, timeoutMs = 1200) {
  const script = `
    const target = process.argv[1];
    const timeout = Number(process.argv[2] || 1200);
    const lib = target.startsWith('https:') ? require('https') : require('http');
    const req = lib.get(target, (res) => {
      process.stdout.write(JSON.stringify({ reachable: true, status_code: res.statusCode || null }));
      res.destroy();
    });
    req.on('error', () => process.exit(2));
    req.setTimeout(timeout, () => req.destroy(new Error('timeout')));
  `;

  try {
    const stdout = execFileSync(process.execPath, ['-e', script, url, String(timeoutMs)], {
      cwd: CWD,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe']
    }).trim();
    return JSON.parse(stdout);
  } catch {
    return { reachable: false, status_code: null };
  }
}

/**
 * Get a process command line on POSIX systems.
 * @param {number} pid - Process ID
 * @returns {string|null} Command line
 */
function getPosixCommandLine(pid) {
  return tryExecFile('ps', ['-p', String(pid), '-o', 'command=']) || null;
}

/**
 * Get a process working directory on POSIX systems.
 * @param {number} pid - Process ID
 * @returns {string|null} Working directory
 */
function getPosixCwd(pid) {
  if (process.platform === 'linux') {
    try {
      return fs.realpathSync(`/proc/${pid}/cwd`);
    } catch {
      // Fall through to lsof-based lookup.
    }
  }

  const outputText = tryExecFile('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn']);
  if (!outputText) return null;
  const line = outputText.split('\n').find(entry => entry.startsWith('n'));
  return line ? line.slice(1) : null;
}

/**
 * Get process metadata for a listening port on POSIX systems.
 * @param {number} port - Listening port
 * @returns {{ pid:number, process_name:string|null, command:string|null, cwd:string|null }|null}
 */
function getPosixPortProcessInfo(port) {
  const lsofOutput = tryExecFile('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fpnc']);
  if (!lsofOutput) return null;

  let pid = null;
  let processName = null;
  for (const line of lsofOutput.split('\n')) {
    if (line.startsWith('p') && !pid) pid = parseInt(line.slice(1), 10);
    if (line.startsWith('c') && !processName) processName = line.slice(1);
  }
  if (!Number.isInteger(pid)) return null;

  return {
    pid,
    process_name: processName || null,
    command: getPosixCommandLine(pid) || processName || null,
    cwd: getPosixCwd(pid)
  };
}

/**
 * Run a PowerShell script and parse JSON output.
 * @param {string} script - PowerShell script
 * @returns {object|null} Parsed JSON result
 */
function runPowerShellJson(script) {
  for (const shell of ['powershell.exe', 'pwsh']) {
    const stdout = tryExecFile(shell, ['-NoProfile', '-Command', script]);
    if (!stdout) continue;
    try {
      return JSON.parse(stdout);
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Get process metadata for a listening port on Windows.
 * @param {number} port - Listening port
 * @returns {{ pid:number, process_name:string|null, command:string|null, cwd:string|null }|null}
 */
function getWindowsPortProcessInfo(port) {
  const script = `
    $conn = Get-NetTCPConnection -State Listen -LocalPort ${port} -ErrorAction SilentlyContinue | Select-Object -First 1;
    if (-not $conn) { return }
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId = $($conn.OwningProcess)" -ErrorAction SilentlyContinue;
    if (-not $proc) { return }
    [PSCustomObject]@{
      pid = [int]$conn.OwningProcess
      process_name = $proc.Name
      command = $proc.CommandLine
      cwd = $null
    } | ConvertTo-Json -Compress
  `;

  return runPowerShellJson(script);
}

/**
 * Get process metadata for a listening port.
 * @param {number} port - Listening port
 * @returns {{ pid:number, process_name:string|null, command:string|null, cwd:string|null }|null}
 */
function getPortProcessInfo(port) {
  if (process.platform === 'win32') {
    return getWindowsPortProcessInfo(port);
  }
  return getPosixPortProcessInfo(port);
}

/**
 * Assess whether a discovered process belongs to the current repo.
 * @param {{ cwd?:string|null, command?:string|null }} processInfo - Process metadata
 * @param {string} resolvedRoot - Absolute project root
 * @returns {{ repo_match:boolean, match_confidence:string }}
 */
function assessRepoMatch(processInfo, resolvedRoot) {
  const normalizedRoot = normalizeComparePath(resolvedRoot);
  if (!normalizedRoot || !processInfo) {
    return { repo_match: false, match_confidence: 'unknown' };
  }

  const cwd = normalizeComparePath(processInfo.cwd);
  if (cwd) {
    if (cwd === normalizedRoot) return { repo_match: true, match_confidence: 'exact' };
    if (isSameOrNestedPath(cwd, normalizedRoot) || isSameOrNestedPath(normalizedRoot, cwd)) {
      return { repo_match: true, match_confidence: 'ancestor' };
    }
    return { repo_match: false, match_confidence: 'mismatch' };
  }

  const command = processInfo.command ? String(processInfo.command) : '';
  const normalizedCommand = process.platform === 'win32' ? command.toLowerCase() : command;
  if (normalizedCommand && normalizedCommand.includes(normalizedRoot)) {
    return { repo_match: true, match_confidence: 'ancestor' };
  }

  if (normalizedCommand) {
    return { repo_match: false, match_confidence: 'mismatch' };
  }

  return { repo_match: false, match_confidence: 'unknown' };
}

/**
 * Recursively collect package directories up to a small depth.
 * @param {string} rootDir - Repo root
 * @param {number} [maxDepth=3] - Maximum search depth
 * @returns {string[]} Candidate package directories
 */
function collectPackageDirs(rootDir, maxDepth = 3) {
  const found = new Set();

  function walk(dir, depth) {
    const pkgPath = path.join(dir, 'package.json');
    if (fs.existsSync(pkgPath)) found.add(dir);
    if (depth >= maxDepth) return;

    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      walk(path.join(dir, entry.name), depth + 1);
    }
  }

  walk(rootDir, 0);
  return Array.from(found);
}

/**
 * Discover likely dev-server start targets from the repo root.
 * @param {string} resolvedRoot - Absolute project root
 * @returns {Array<object>} Candidate app targets
 */
function discoverStartTargets(resolvedRoot) {
  if (!fs.existsSync(resolvedRoot) || !fs.statSync(resolvedRoot).isDirectory()) return [];

  const targets = [];
  for (const dir of collectPackageDirs(resolvedRoot, 3)) {
    const pkgPath = path.join(dir, 'package.json');
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      if (!pkg.scripts || !pkg.scripts.dev) continue;
      const pm = detectPackageManagerAt(dir, resolvedRoot);
      const relativeDir = path.relative(resolvedRoot, dir) || '.';
      targets.push({
        name: pkg.name || path.basename(dir),
        path: relativeDir,
        cwd: dir,
        package_manager: pm,
        command: `${pm} run dev`,
        dev_script: pkg.scripts.dev
      });
    } catch {
      // Ignore invalid package.json files.
    }
  }

  targets.sort((a, b) => a.path.localeCompare(b.path));
  return targets;
}

/**
 * Resolve the per-project temp-server state file path.
 * @param {string} resolvedRoot - Absolute project root
 * @returns {string} Absolute path to the temp-server state file
 */
function serveStatePath(resolvedRoot) {
  return path.join(resolvedRoot, '.pixelslop', 'temp-server.json');
}

/**
 * Read temp-server state for a project.
 * @param {string} resolvedRoot - Absolute project root
 * @returns {object|null} Parsed state or null
 */
function readServeState(resolvedRoot) {
  const statePath = serveStatePath(resolvedRoot);
  if (!fs.existsSync(statePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(statePath, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Check whether a process is still alive.
 * @param {number} pid - Process identifier
 * @returns {boolean} True when the process can still be signalled
 */
function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Remove temp-server bookkeeping files.
 * @param {string} resolvedRoot - Absolute project root
 * @param {object|null} state - Parsed server state
 */
function cleanupServeState(resolvedRoot, state) {
  const statePath = serveStatePath(resolvedRoot);
  if (state && state.script) {
    try { fs.unlinkSync(state.script); } catch {}
  }
  try { fs.unlinkSync(statePath); } catch {}
}

/**
 * Detect static HTML sites — folders with .html files but no package.json dev script.
 * Returns entry points (index.html preferred) and the folder to serve.
 *
 * This fills the gap where `discover start-target` finds nothing because
 * there's no package.json, but there IS a perfectly scannable HTML page
 * sitting right there.
 *
 * @param {string} resolvedRoot - Absolute project root
 * @returns {{ is_static: boolean, entry_points: string[], serve_dir: string }|null}
 */
function detectStaticSite(resolvedRoot) {
  if (!fs.existsSync(resolvedRoot) || !fs.statSync(resolvedRoot).isDirectory()) return null;

  // If there's a package.json with a dev script, this isn't a "static site" —
  // it's a project with a build pipeline. Let start-target handle it.
  const pkgPath = path.join(resolvedRoot, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      if (pkg.scripts && (pkg.scripts.dev || pkg.scripts.start || pkg.scripts.serve)) {
        return null;
      }
    } catch { /* malformed package.json — treat as static */ }
  }

  // Look for HTML files in the root (don't recurse into node_modules etc.)
  const htmlFiles = [];
  try {
    for (const entry of fs.readdirSync(resolvedRoot)) {
      if (entry.startsWith('.')) continue;
      if (entry.toLowerCase().endsWith('.html')) htmlFiles.push(entry);
    }
  } catch { return null; }

  if (htmlFiles.length === 0) return null;

  // Prefer index.html as the entry point, then sort the rest alphabetically
  const sorted = htmlFiles.sort((a, b) => {
    if (a.toLowerCase() === 'index.html') return -1;
    if (b.toLowerCase() === 'index.html') return 1;
    return a.localeCompare(b);
  });

  return {
    is_static: true,
    entry_points: sorted,
    serve_dir: resolvedRoot
  };
}

/**
 * CLI handler for `discover static-site`.
 * Detects HTML files suitable for temp-server scanning.
 * @param {object} args - CLI flags (--root)
 */
function discoverStaticSite(args) {
  const root = args.root || '.';
  const resolvedRoot = path.resolve(CWD, root);
  const rootValid = fs.existsSync(resolvedRoot) && fs.statSync(resolvedRoot).isDirectory();
  const detection = rootValid ? detectStaticSite(resolvedRoot) : null;

  const result = {
    root,
    root_resolved: resolvedRoot,
    root_valid: rootValid,
    ...(detection || { is_static: false, entry_points: [], serve_dir: null })
  };

  output(RAW
    ? result
    : detection
      ? `Static site: ${detection.entry_points.join(', ')} in ${resolvedRoot}`
      : 'No static HTML site detected.'
  );
}

/**
 * Start a zero-dependency Node HTTP server for static file serving.
 * Picks a free port, writes a PID file so `serve stop` can clean up,
 * and detaches so the agent can keep working.
 *
 * No npm install needed — uses Node's built-in http + fs modules.
 *
 * @param {object} args - CLI flags (--root, --port)
 */
function serveStart(args) {
  const root = args.root || '.';
  const resolvedRoot = path.resolve(CWD, root);
  const port = parseInt(args.port, 10) || 0; // 0 = let OS pick a free port

  if (!fs.existsSync(resolvedRoot) || !fs.statSync(resolvedRoot).isDirectory()) {
    fail(`Not a directory: ${resolvedRoot}`);
  }

  const existingState = readServeState(resolvedRoot);
  if (existingState && isProcessAlive(existingState.pid)) {
    output(RAW
      ? {
          url: `http://localhost:${existingState.port}`,
          port: existingState.port,
          pid: existingState.pid,
          root: resolvedRoot,
          pid_file: serveStatePath(resolvedRoot),
          reused: true
        }
      : `Already serving ${resolvedRoot} at http://localhost:${existingState.port} (pid ${existingState.pid})`
    );
    return;
  }

  if (existingState) cleanupServeState(resolvedRoot, existingState);

  // Inline server script — spawned as a detached child process.
  // Kept minimal: serve files, set Content-Type, handle 404s, log to stderr.
  const serverScript = `
const http = require('http');
const fs = require('fs');
const path = require('path');

const MIME = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.webp': 'image/webp', '.woff': 'font/woff',
  '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.eot': 'application/vnd.ms-fontobject',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.pdf': 'application/pdf'
};

const ROOT = ${JSON.stringify(resolvedRoot)};

const server = http.createServer((req, res) => {
  let filePath = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (filePath.endsWith('/')) filePath = path.join(filePath, 'index.html');

  // Basic security: don't serve outside ROOT
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      // Try index.html for directory requests
      if (err.code === 'EISDIR') {
        filePath = path.join(filePath, 'index.html');
        fs.readFile(filePath, (err2, data2) => {
          if (err2) { res.writeHead(404); res.end('Not found'); return; }
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(data2);
        });
        return;
      }
      res.writeHead(404); res.end('Not found'); return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(${port}, '127.0.0.1', () => {
  const addr = server.address();
  // Write the actual port to stdout so the parent can read it
  process.stdout.write(JSON.stringify({ port: addr.port, pid: process.pid, root: ROOT }));
  process.stderr.write('pixelslop-serve running on port ' + addr.port + '\\n');
});

// Graceful shutdown on SIGTERM
process.on('SIGTERM', () => { server.close(); process.exit(0); });
`;

  // The child writes its port/pid info to a temp "ready" file.
  // We poll for it synchronously — avoids async callbacks that keep
  // the parent process alive.
  const readyFile = path.join(os.tmpdir(), `pixelslop-serve-ready-${Date.now()}.json`);
  const tmpScript = path.join(os.tmpdir(), `pixelslop-serve-${Date.now()}.cjs`);

  // Append the ready-file write to the server script
  const fullScript = serverScript.replace(
    `process.stderr.write('pixelslop-serve running on port ' + addr.port + '\\n');`,
    `require('fs').writeFileSync(${JSON.stringify(readyFile)}, JSON.stringify({ port: addr.port, pid: process.pid, root: ROOT }));`
  );

  fs.writeFileSync(tmpScript, fullScript);

  const { spawn } = require('child_process');
  const child = spawn(process.execPath, [tmpScript], {
    detached: true,
    stdio: 'ignore'
  });
  child.unref();

  // Poll for the ready file (sync, max ~3s)
  let info = null;
  for (let i = 0; i < 30; i++) {
    sleepSync(100);
    if (fs.existsSync(readyFile)) {
      try {
        info = JSON.parse(fs.readFileSync(readyFile, 'utf-8'));
        fs.unlinkSync(readyFile);
        break;
      } catch { /* not fully written yet */ }
    }
  }

  if (!info) {
    try { process.kill(child.pid, 'SIGTERM'); } catch {}
    try { fs.unlinkSync(readyFile); } catch {}
    try { fs.unlinkSync(tmpScript); } catch {}
    fail('Server failed to start within 3 seconds');
  }

  // Save project-scoped state so concurrent sessions do not stomp each other.
  const pidFile = serveStatePath(resolvedRoot);
  fs.mkdirSync(path.dirname(pidFile), { recursive: true });
  fs.writeFileSync(pidFile, JSON.stringify({
    pid: info.pid,
    port: info.port,
    root: resolvedRoot,
    script: tmpScript,
    started_at: new Date().toISOString()
  }));

  const result = {
    url: `http://localhost:${info.port}`,
    port: info.port,
    pid: info.pid,
    root: resolvedRoot,
    pid_file: pidFile
  };

  output(RAW
    ? result
    : `Serving ${resolvedRoot} at http://localhost:${info.port} (pid ${info.pid})`
  );
}

/**
 * Stop a previously started pixelslop temp server.
 * Reads the PID file, kills the process, cleans up.
 */
function serveStop(args = {}) {
  const root = args.root || '.';
  const resolvedRoot = path.resolve(CWD, root);
  const pidFile = serveStatePath(resolvedRoot);
  if (!fs.existsSync(pidFile)) {
    output(RAW ? { stopped: false, reason: 'no_pid_file' } : 'No running server found.');
    return;
  }

  let info;
  try {
    info = JSON.parse(fs.readFileSync(pidFile, 'utf-8'));
  } catch {
    fs.unlinkSync(pidFile);
    fail('Corrupt PID file — removed it');
  }

  // Kill the server process
  try {
    process.kill(info.pid, 'SIGTERM');
  } catch {
    // Already dead? That's fine.
  }

  cleanupServeState(resolvedRoot, info);

  output(RAW
    ? { stopped: true, pid: info.pid, port: info.port, root: resolvedRoot }
    : `Stopped server on port ${info.port} (pid ${info.pid})`
  );
}

/**
 * Discover running local servers on common dev ports.
 * @param {object} args - CLI flags
 */
function discoverServer(args) {
  const root = args.root || '.';
  const resolvedRoot = path.resolve(CWD, root);
  const rootValid = fs.existsSync(resolvedRoot) && fs.statSync(resolvedRoot).isDirectory();
  const ports = parseDiscoveryPorts(args.ports);
  const servers = [];

  for (const port of ports) {
    const url = `http://127.0.0.1:${port}`;
    const probe = probeUrl(url);
    if (!probe.reachable) continue;

    const processInfo = getPortProcessInfo(port);
    const match = rootValid
      ? assessRepoMatch(processInfo, resolvedRoot)
      : { repo_match: false, match_confidence: 'unknown' };

    servers.push({
      url: `http://localhost:${port}`,
      port,
      reachable: true,
      status_code: probe.status_code,
      pid: processInfo?.pid || null,
      process_name: processInfo?.process_name || null,
      command: processInfo?.command || null,
      cwd: processInfo?.cwd || null,
      repo_match: match.repo_match,
      match_confidence: match.match_confidence
    });
  }

  const result = {
    root,
    root_resolved: resolvedRoot,
    root_valid: rootValid,
    ports,
    servers
  };

  output(RAW
    ? result
    : servers.length === 0
      ? 'No running local servers found on common dev ports.'
      : servers.map(server => {
          const owner = server.cwd || server.command || server.process_name || 'unknown process';
          return `${server.url} [${server.match_confidence}] ${owner}`;
        }).join('\n')
  );
}

/**
 * Discover likely start targets for this repo.
 * @param {object} args - CLI flags
 */
function discoverStartTarget(args) {
  const root = args.root || '.';
  const resolvedRoot = path.resolve(CWD, root);
  const rootValid = fs.existsSync(resolvedRoot) && fs.statSync(resolvedRoot).isDirectory();
  const targets = rootValid ? discoverStartTargets(resolvedRoot) : [];

  const result = {
    root,
    root_resolved: resolvedRoot,
    root_valid: rootValid,
    targets
  };

  output(RAW
    ? result
    : targets.length === 0
      ? 'No start targets detected.'
      : targets.map(target => `${target.path} → ${target.command}`).join('\n')
  );
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
  const url = args.url || (args['code-check'] ? null : fail('--url required'));
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

    detectedApps = discoverStartTargets(resolvedRoot).map(target => ({
      name: target.name,
      path: target.path,
      devScript: target.dev_script,
      command: target.command,
      package_manager: target.package_manager
    }));
  }

  // Determine URL type (null when in code-check mode — no URL needed)
  const urlType = url ? (/^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)/i.test(url) ? 'local' : 'remote') : null;

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

  autoLog('orchestrator', 'info', `init scan: url=${url || 'none'} mode=${mode} root=${resolvedRoot}`, root);
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
function verifyPlan(args = {}) {
  const { meta, body } = readPlan(args.root);
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
function verifySession(args = {}) {
  const { body } = readPlan(args.root);
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
function verifyScreenshots(args = {}) {
  const ssDir = path.join(resolveProjectRoot(args.root), '.pixelslop', 'screenshots');
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
function verifyCheckpoints(args = {}) {
  const cpDir = path.join(resolveProjectRoot(args.root), '.pixelslop', 'checkpoints');
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
    } else if (arg === '--debug') {
      DEBUG = true;
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
async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const [group, command] = positional;

  if (!group) {
    console.log('Usage: pixelslop-tools <group> <command> [options]');
    console.log('Groups: plan, checkpoint, gate, config, log, discover, serve, init, verify, browser');
    console.log('Global flags: --raw (JSON output), --cwd <path> (working directory), --debug (enable session logging)');
    console.log('Command flags:');
    console.log('  log write [--root <path>] --agent <name> --level <info|warn|error|debug> --message "..."');
    console.log('  log read [--root <path>] [--tail <n>]');
    console.log('  log clear [--root <path>]');
    console.log('  discover server [--root <path>] [--ports <csv>]');
    console.log('  discover start-target [--root <path>]');
    console.log('  discover static-site [--root <path>]');
    console.log('  serve start [--root <path>] [--port <n>]');
    console.log('  serve stop [--root <path>]');
    console.log('  init scan --url <url> [--root <path>] [--build-cmd <cmd>]');
    console.log('  plan begin --url <url> [--root <path>] [--issues <json>] [--scores <json>]');
    console.log('  plan update <issue-id> <status> [--root <path>]');
    console.log('  plan snapshot [--root <path>]');
    console.log('  browser detect');
    console.log('  browser collect --url <url> [--root <path>] [--personas <ids>] [--out <file>] [--deep] [--headed]');
    console.log('  browser check --url <url> --metric <metric> [--selector <css>] [--viewport <name|WxH>]');
    console.log('  browser styles --url <url> --selector <css>');
    console.log('  browser snapshot --url <url>');
    console.log('  browser screenshot --url <url> [--viewport <name|WxH>] [--out <file>]');
    console.log('  --root identifies the project being analyzed; --cwd only changes where pixelslop-tools runs.');
    process.exit(0);
  }

  switch (group) {
    case 'plan':
      switch (command) {
        case 'begin': return planBegin(flags);
        case 'update': return planUpdate(positional[2], positional[3] || flags.status, flags);
        case 'patch': {
          // Collect --id pairs: remaining flags as id→status map
          const updates = {};
          for (const [k, v] of Object.entries(flags)) {
            if (k !== 'raw' && k !== 'cwd' && k !== 'root') updates[k] = v;
          }
          return planPatch(updates, flags);
        }
        case 'get': return planGet(positional[2] || flags.field, flags);
        case 'advance': return planAdvance(flags);
        case 'snapshot': return planSnapshot(flags);
        case 'json': return planJson(flags);
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
        case 'read': return configRead(flags);
        case 'exists': return configExists(flags);
        case 'save-context': return configSaveContext(flags);
        case 'load-context': return configLoadContext(flags);
        default: fail(`Unknown config command: ${command}. Valid: write, read, exists, save-context, load-context`);
      }
      break;

    case 'log':
      switch (command) {
        case 'write': return logWrite(flags);
        case 'read': return logRead(flags);
        case 'clear': return logClear(flags);
        default: fail(`Unknown log command: ${command}. Valid: write, read, clear`);
      }
      break;

    case 'discover':
      switch (command) {
        case 'server': return discoverServer(flags);
        case 'start-target': return discoverStartTarget(flags);
        case 'static-site': return discoverStaticSite(flags);
        default: fail(`Unknown discover command: ${command}. Valid: server, start-target, static-site`);
      }
      break;

    case 'serve':
      switch (command) {
        case 'start': return serveStart(flags);
        case 'stop': return serveStop(flags);
        default: fail(`Unknown serve command: ${command}. Valid: start, stop`);
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
        case 'plan': return verifyPlan(flags);
        case 'session': return verifySession(flags);
        case 'screenshots': return verifyScreenshots(flags);
        case 'checkpoints': return verifyCheckpoints(flags);
        default: fail(`Unknown verify command: ${command}. Valid: plan, session, screenshots, checkpoints`);
      }
      break;

    case 'browser': {
      const { runBrowserCommand } = require('./pixelslop-browser.cjs');
      const result = await runBrowserCommand(command, { ...flags, cwd: CWD });
      return output(result, true);
    }

    default:
      fail(`Unknown group: ${group}. Valid: plan, checkpoint, gate, config, log, discover, serve, init, verify, browser`);
  }
}

main().catch(error => fail(error.message));
