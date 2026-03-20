/**
 * Persona Schema Validation Tests
 *
 * Validates the JSON schema and content of persona files. Ensures
 * all built-in personas are structurally valid, have correct field
 * types, and reference valid evaluation check IDs.
 *
 * Run: node --test tests/persona.test.js
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PERSONAS_DIR = join(__dirname, '..', 'dist', 'skill', 'resources', 'personas');

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

/** Valid persona categories */
const VALID_CATEGORIES = ['accessibility', 'context', 'international', 'professional'];

/** Valid pillar names for designPriorities */
const VALID_PILLARS = ['accessibility', 'hierarchy', 'typography', 'color', 'responsiveness'];

/** Valid viewport values */
const VALID_VIEWPORTS = ['desktop', 'tablet', 'mobile'];

/**
 * Load and parse a persona JSON file.
 * @param {string} filename - JSON filename
 * @returns {object} Parsed persona
 */
function loadPersona(filename) {
  const filePath = join(PERSONAS_DIR, filename);
  assert.ok(existsSync(filePath), `Persona file missing: ${filename}`);
  const raw = readFileSync(filePath, 'utf-8');
  try {
    return JSON.parse(raw);
  } catch (e) {
    assert.fail(`Invalid JSON in ${filename}: ${e.message}`);
  }
}

/**
 * Get all persona JSON files from the personas directory.
 * @returns {string[]} Array of filenames
 */
function getPersonaFiles() {
  return readdirSync(PERSONAS_DIR).filter(f => f.endsWith('.json'));
}

// ─────────────────────────────────────────────
// Tests: Directory and file structure
// ─────────────────────────────────────────────

describe('persona directory structure', () => {
  it('personas directory exists', () => {
    assert.ok(existsSync(PERSONAS_DIR), 'dist/skill/resources/personas/ must exist');
  });

  it('schema.md documentation exists', () => {
    assert.ok(
      existsSync(join(PERSONAS_DIR, 'schema.md')),
      'personas/schema.md must exist'
    );
  });

  it('has exactly 8 built-in persona JSON files', () => {
    const files = getPersonaFiles();
    assert.equal(files.length, 8, `Expected 8 persona files, found ${files.length}: ${files.join(', ')}`);
  });

  it('all expected persona files exist', () => {
    const expected = [
      'screen-reader-user.json',
      'low-vision-user.json',
      'keyboard-user.json',
      'rushed-mobile-user.json',
      'slow-connection-user.json',
      'non-native-english.json',
      'design-critic.json',
      'first-time-visitor.json',
    ];
    for (const file of expected) {
      assert.ok(existsSync(join(PERSONAS_DIR, file)), `Missing persona: ${file}`);
    }
  });
});

// ─────────────────────────────────────────────
// Tests: Schema validation for each persona
// ─────────────────────────────────────────────

describe('persona JSON schema validation', () => {
  const personaFiles = existsSync(PERSONAS_DIR)
    ? readdirSync(PERSONAS_DIR).filter(f => f.endsWith('.json'))
    : [];

  for (const file of personaFiles) {
    describe(`${file}`, () => {
      let persona;

      it('parses as valid JSON', () => {
        persona = loadPersona(file);
        assert.ok(persona, 'Should parse without error');
      });

      it('has all required top-level fields', () => {
        persona = loadPersona(file);
        const required = [
          'id', 'name', 'category', 'description',
          'designPriorities', 'evaluationChecks', 'frustrationTriggers',
          'positiveSignals', 'cognitiveLoadFactors', 'narrationStyle',
          'browserChecks',
        ];
        for (const field of required) {
          assert.ok(field in persona, `${file} missing required field: ${field}`);
        }
      });

      it('id matches filename (without .json)', () => {
        persona = loadPersona(file);
        const expectedId = file.replace('.json', '');
        assert.equal(persona.id, expectedId, `id "${persona.id}" should match filename "${expectedId}"`);
      });

      it('category is valid', () => {
        persona = loadPersona(file);
        assert.ok(
          VALID_CATEGORIES.includes(persona.category),
          `Invalid category "${persona.category}". Valid: ${VALID_CATEGORIES.join(', ')}`
        );
      });

      it('description is non-empty string', () => {
        persona = loadPersona(file);
        assert.equal(typeof persona.description, 'string');
        assert.ok(persona.description.length > 20, 'Description too short');
      });

      it('designPriorities has all 5 pillars with values 1-4', () => {
        persona = loadPersona(file);
        assert.ok(typeof persona.designPriorities === 'object');
        for (const pillar of VALID_PILLARS) {
          assert.ok(pillar in persona.designPriorities, `Missing pillar: ${pillar}`);
          const val = persona.designPriorities[pillar];
          assert.ok(val >= 1 && val <= 4, `${pillar} priority must be 1-4, got ${val}`);
        }
      });

      it('evaluationChecks is a non-empty array of strings', () => {
        persona = loadPersona(file);
        assert.ok(Array.isArray(persona.evaluationChecks), 'Must be an array');
        assert.ok(persona.evaluationChecks.length > 0, 'Must have at least one check');
        for (const check of persona.evaluationChecks) {
          assert.equal(typeof check, 'string', `Check must be string, got ${typeof check}`);
          assert.ok(check.includes('-'), `Check ID should be kebab-case: ${check}`);
        }
      });

      it('frustrationTriggers is a non-empty array', () => {
        persona = loadPersona(file);
        assert.ok(Array.isArray(persona.frustrationTriggers));
        assert.ok(persona.frustrationTriggers.length >= 3, 'Should have at least 3 triggers');
      });

      it('positiveSignals is a non-empty array', () => {
        persona = loadPersona(file);
        assert.ok(Array.isArray(persona.positiveSignals));
        assert.ok(persona.positiveSignals.length >= 3, 'Should have at least 3 signals');
      });

      it('cognitiveLoadFactors is an array (may be empty)', () => {
        persona = loadPersona(file);
        assert.ok(Array.isArray(persona.cognitiveLoadFactors));
      });

      it('narrationStyle has voice and sampleReactions', () => {
        persona = loadPersona(file);
        assert.ok(typeof persona.narrationStyle === 'object');
        assert.ok(typeof persona.narrationStyle.voice === 'string', 'voice must be a string');
        assert.ok(Array.isArray(persona.narrationStyle.sampleReactions), 'sampleReactions must be array');
        assert.ok(persona.narrationStyle.sampleReactions.length >= 3, 'Need at least 3 reactions');
      });

      it('browserChecks has viewports and extraEvaluations', () => {
        persona = loadPersona(file);
        assert.ok(typeof persona.browserChecks === 'object');
        assert.ok(Array.isArray(persona.browserChecks.viewports), 'viewports must be array');
        assert.ok(persona.browserChecks.viewports.length > 0, 'Must have at least one viewport');
        for (const vp of persona.browserChecks.viewports) {
          assert.ok(VALID_VIEWPORTS.includes(vp), `Invalid viewport: ${vp}`);
        }
        assert.ok(Array.isArray(persona.browserChecks.extraEvaluations), 'extraEvaluations must be array');
      });
    });
  }
});

// ─────────────────────────────────────────────
// Tests: Category coverage
// ─────────────────────────────────────────────

describe('persona category coverage', () => {
  const personaFiles = existsSync(PERSONAS_DIR)
    ? readdirSync(PERSONAS_DIR).filter(f => f.endsWith('.json'))
    : [];

  it('has personas in the accessibility category', () => {
    const a11y = personaFiles.filter(f => {
      const p = loadPersona(f);
      return p.category === 'accessibility';
    });
    assert.ok(a11y.length >= 2, `Expected 2+ accessibility personas, found ${a11y.length}`);
  });

  it('has personas in the context category', () => {
    const context = personaFiles.filter(f => {
      const p = loadPersona(f);
      return p.category === 'context';
    });
    assert.ok(context.length >= 2, `Expected 2+ context personas, found ${context.length}`);
  });

  it('has at least one persona per valid category', () => {
    const categories = new Set(personaFiles.map(f => loadPersona(f).category));
    for (const cat of VALID_CATEGORIES) {
      assert.ok(categories.has(cat), `No persona in category: ${cat}`);
    }
  });
});

// ─────────────────────────────────────────────
// Tests: Cross-file consistency
// ─────────────────────────────────────────────

describe('persona cross-file consistency', () => {
  it('all persona IDs are unique', () => {
    const files = existsSync(PERSONAS_DIR) ? getPersonaFiles() : [];
    const ids = files.map(f => loadPersona(f).id);
    const unique = new Set(ids);
    assert.equal(ids.length, unique.size, `Duplicate persona IDs: ${ids.join(', ')}`);
  });

  it('scanner references persona evaluation pass', () => {
    const scanner = readFileSync(
      join(__dirname, '..', 'dist', 'agents', 'pixelslop-scanner.md'), 'utf-8'
    );
    assert.ok(scanner.includes('Persona'), 'Scanner should reference persona evaluation');
    assert.ok(scanner.includes('personas'), 'Scanner should reference personas');
  });

  it('scoring.md documents persona report format', () => {
    const scoring = readFileSync(
      join(__dirname, '..', 'dist', 'skill', 'resources', 'scoring.md'), 'utf-8'
    );
    assert.ok(scoring.includes('Persona'), 'scoring.md should document persona format');
    assert.ok(scoring.includes('Persona Insights') || scoring.includes('Persona Report'),
      'scoring.md should have persona report section');
  });

  it('orchestrator documents --personas flag', () => {
    const orch = readFileSync(
      join(__dirname, '..', 'dist', 'agents', 'pixelslop.md'), 'utf-8'
    );
    assert.ok(orch.includes('--personas') || orch.includes('Personas'),
      'Orchestrator should document personas flag');
  });

  it('orchestrator documents --thorough flag', () => {
    const orch = readFileSync(
      join(__dirname, '..', 'dist', 'agents', 'pixelslop.md'), 'utf-8'
    );
    assert.ok(orch.includes('--thorough') || orch.includes('Thorough') || orch.includes('thorough'),
      'Orchestrator should document thorough flag');
  });

  it('SKILL.md lists personas argument', () => {
    const skill = readFileSync(
      join(__dirname, '..', 'dist', 'skill', 'SKILL.md'), 'utf-8'
    );
    assert.ok(skill.includes('personas'), 'SKILL.md should list personas argument');
  });

  it('SKILL.md lists thorough argument', () => {
    const skill = readFileSync(
      join(__dirname, '..', 'dist', 'skill', 'SKILL.md'), 'utf-8'
    );
    assert.ok(skill.includes('thorough'), 'SKILL.md should list thorough argument');
  });
});
