/**
 * Checkpoint Protocol Validation Tests
 *
 * Validates the checkpoint metadata schema, status enum, and file
 * naming conventions defined in checkpoint-protocol.md. These tests
 * ensure the protocol contract is well-defined so fixer and checker
 * agents produce consistent checkpoint artifacts.
 *
 * Run: node --test tests/checkpoint.test.js
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = join(__dirname, '..', 'dist');

/**
 * Read a resource file from dist/
 * @param {string} relativePath - Path relative to dist/
 * @returns {string} File contents
 */
function readDist(relativePath) {
  const fullPath = join(DIST, relativePath);
  assert.ok(existsSync(fullPath), `Missing file: dist/${relativePath}`);
  return readFileSync(fullPath, 'utf-8');
}

// ─────────────────────────────────────────────
// Tests: Checkpoint protocol file exists and has structure
// ─────────────────────────────────────────────

describe('Checkpoint protocol structure', () => {
  let content;

  it('checkpoint-protocol.md exists', () => {
    content = readDist('skill/resources/checkpoint-protocol.md');
    assert.ok(content.length > 200, 'file seems too short');
  });

  it('has root validation section', () => {
    assert.ok(content.includes('Root Validation'), 'missing root validation section');
  });

  it('has build gate resolution section', () => {
    assert.ok(content.includes('Build Gate Resolution'), 'missing build gate resolution section');
  });

  it('has baseline gate section', () => {
    assert.ok(content.includes('Baseline Gate'), 'missing baseline gate section');
  });

  it('has checkpoint creation section', () => {
    assert.ok(content.includes('Creating a Checkpoint'), 'missing checkpoint creation section');
  });

  it('has rollback protocol section', () => {
    assert.ok(content.includes('Rollback Protocol'), 'missing rollback protocol section');
  });

  it('has post-fix flow section', () => {
    assert.ok(content.includes('Post-Fix Flow'), 'missing post-fix flow section');
  });

  it('has metadata schema section', () => {
    assert.ok(content.includes('Metadata Schema'), 'missing metadata schema section');
  });
});


// ─────────────────────────────────────────────
// Tests: Checkpoint metadata schema validation
// ─────────────────────────────────────────────

describe('Checkpoint metadata schema', () => {
  /**
   * Validate a checkpoint metadata JSON object against the protocol schema.
   * Matches the actual fields written by pixelslop-tools checkpoint create:
   * id, issue_id, files, created, status
   * @param {object} meta - Checkpoint metadata object
   * @returns {{ valid: boolean, errors: string[] }}
   */
  function validateCheckpointMeta(meta) {
    const errors = [];
    const requiredFields = ['id', 'issue_id', 'files', 'created', 'status'];

    // Check required fields
    for (const field of requiredFields) {
      if (meta[field] === undefined || meta[field] === null) {
        errors.push(`missing required field: ${field}`);
      }
    }

    // Validate status enum
    const validStatuses = ['pending', 'pass', 'fail', 'reverted'];
    if (meta.status && !validStatuses.includes(meta.status)) {
      errors.push(`invalid status: ${meta.status} (expected one of: ${validStatuses.join(', ')})`);
    }

    // Validate files is a non-empty array of strings
    if (meta.files) {
      if (!Array.isArray(meta.files)) {
        errors.push('files must be an array');
      } else if (meta.files.length === 0) {
        errors.push('files must not be empty');
      } else if (!meta.files.every(f => typeof f === 'string')) {
        errors.push('files must contain only strings');
      }
    }

    // Validate created format (ISO 8601)
    if (meta.created && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(meta.created)) {
      errors.push(`created not ISO 8601 format: ${meta.created}`);
    }

    // Validate id format (issue_id-timestamp)
    if (meta.id && meta.issue_id && !meta.id.startsWith(meta.issue_id)) {
      errors.push(`id should start with issue_id: ${meta.id}`);
    }

    return { valid: errors.length === 0, errors };
  }

  // Valid checkpoint metadata sample — matches pixelslop-tools CLI output
  const validCheckpoint = {
    id: 'contrast-hero-cta-2026-03-17T22-30-00-000Z',
    issue_id: 'contrast-hero-cta',
    files: ['src/styles/main.css'],
    created: '2026-03-17T22:30:00.000Z',
    status: 'pending'
  };

  it('accepts a valid checkpoint metadata', () => {
    const result = validateCheckpointMeta(validCheckpoint);
    assert.ok(result.valid, `validation errors: ${result.errors.join(', ')}`);
  });

  it('rejects missing required fields', () => {
    const incomplete = { id: 'test-123', status: 'pending' };
    const result = validateCheckpointMeta(incomplete);
    assert.ok(!result.valid, 'should reject incomplete metadata');
    assert.ok(result.errors.length > 0, 'should have error messages');
  });

  it('rejects invalid status values', () => {
    const badStatus = { ...validCheckpoint, status: 'maybe' };
    const result = validateCheckpointMeta(badStatus);
    assert.ok(!result.valid, 'should reject invalid status');
    assert.ok(result.errors.some(e => e.includes('invalid status')));
  });

  it('accepts all valid status values', () => {
    for (const status of ['pending', 'pass', 'fail', 'reverted']) {
      const meta = { ...validCheckpoint, status };
      const result = validateCheckpointMeta(meta);
      assert.ok(result.valid, `status "${status}" should be valid: ${result.errors.join(', ')}`);
    }
  });

  it('rejects empty files array', () => {
    const emptyFiles = { ...validCheckpoint, files: [] };
    const result = validateCheckpointMeta(emptyFiles);
    assert.ok(!result.valid, 'should reject empty files');
  });

  it('rejects non-array files', () => {
    const stringFiles = { ...validCheckpoint, files: 'src/main.css' };
    const result = validateCheckpointMeta(stringFiles);
    assert.ok(!result.valid, 'should reject non-array files');
  });

  it('rejects non-ISO created timestamp', () => {
    const badCreated = { ...validCheckpoint, created: 'March 17, 2026' };
    const result = validateCheckpointMeta(badCreated);
    assert.ok(!result.valid, 'should reject non-ISO created');
  });

  it('validates id starts with issue_id', () => {
    const mismatch = { ...validCheckpoint, id: 'wrong-prefix-123' };
    const result = validateCheckpointMeta(mismatch);
    assert.ok(!result.valid, 'should reject id that does not start with issue_id');
  });

  // Export for reuse
  it('validateCheckpointMeta is a function', () => {
    assert.equal(typeof validateCheckpointMeta, 'function');
  });
});


// ─────────────────────────────────────────────
// Tests: Checkpoint file naming convention
// ─────────────────────────────────────────────

describe('Checkpoint file naming', () => {
  /**
   * Validate a checkpoint metadata filename follows the expected pattern.
   * The CLI writes <issue_id>.json — no timestamp in the filename.
   * @param {string} filename - Just the filename, no directory
   * @returns {boolean}
   */
  function isValidCheckpointMetaFilename(filename) {
    // Format: <issue_id>.json (issue IDs are kebab-case)
    return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?\.json$/.test(filename);
  }

  /**
   * Validate a backup filename follows the expected pattern.
   * Backup files use __ as path separator (slashes replaced).
   * @param {string} filename - Just the filename, no directory
   * @returns {boolean}
   */
  function isValidBackupFilename(filename) {
    // Format: path__segments__file.ext (slashes replaced with __)
    return /^[a-zA-Z0-9_.-]+(__[a-zA-Z0-9_.-]+)*$/.test(filename) && filename.includes('__');
  }

  it('accepts valid metadata filename', () => {
    assert.ok(isValidCheckpointMetaFilename('contrast-hero-cta.json'));
  });

  it('accepts multi-word issue IDs', () => {
    assert.ok(isValidCheckpointMetaFilename('spacing-card-grid-monotony.json'));
  });

  it('rejects wrong extension', () => {
    assert.ok(!isValidCheckpointMetaFilename('contrast-hero-cta.txt'));
  });

  it('rejects missing extension', () => {
    assert.ok(!isValidCheckpointMetaFilename('contrast-hero-cta'));
  });

  it('accepts valid backup filenames with __ separators', () => {
    assert.ok(isValidBackupFilename('src__styles__main.css'));
    assert.ok(isValidBackupFilename('src__components__Hero.tsx'));
  });

  it('metadata file and backup directory share issue ID as base name', () => {
    const metaFile = 'contrast-hero-cta.json';
    const backupDir = 'contrast-hero-cta';
    const metaBase = metaFile.replace(/\.json$/, '');
    assert.equal(metaBase, backupDir, 'metadata file base should match backup directory name');
  });
});
