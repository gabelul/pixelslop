# Checkpoint Protocol

How the fixer and checker agents coordinate edits without breaking things. Single source of truth for the fix/verify/rollback mechanism. Both agents read this file — if you change the protocol here, it changes everywhere.

---

## 1. Root Validation

Before touching anything, confirm the workspace is sane.

**Required checks (run via Bash):**

```bash
# 1. Path exists and is a directory
test -d "$ROOT_PATH"

# 2. It's a git repo (or at minimum has tracked files)
git -C "$ROOT_PATH" rev-parse --git-dir

# 3. Has a package.json (we need this for build gate resolution)
test -f "$ROOT_PATH/package.json"
```

If any check fails, stop immediately. Return `{ status: "failed", reason: "root validation: <which check>" }`.

Do not create the root path. Do not initialize a git repo. Do not generate a package.json. If the workspace isn't ready, that's the human's problem to solve.

---

## 2. Build Gate Resolution

The build gate is the command that must pass before and after every fix. Determines what "the build still works" means for this project.

**Resolution order (first match wins):**

1. **Explicit flag** — if the invocation includes `--build-cmd "npm run build"`, use that verbatim
2. **Project config** — if `$ROOT_PATH/.pixelslop.md` exists and has a `## Build` section, extract the command from the first code block in that section
3. **Auto-detect from package.json** — read `scripts` from `$ROOT_PATH/package.json`:
   - If `scripts.build` exists → `npm run build`
   - Else if `scripts.dev` exists → skip build gate (dev servers don't have a discrete "build" step)
   - Else → no build gate (warn in output, but don't block)

```bash
# Auto-detect example
BUILD_CMD=$(node -e "
  const pkg = JSON.parse(require('fs').readFileSync('$ROOT_PATH/package.json', 'utf-8'));
  if (pkg.scripts?.build) console.log('npm run build');
  else if (pkg.scripts?.dev) console.log('SKIP');
  else console.log('NONE');
")
```

If resolution yields `SKIP` or `NONE`, the fixer still creates checkpoints and the checker still verifies — you just skip the build-pass/fail step.

---

## 3. Baseline Gate

Before the first fix in a session, run the build command and confirm it passes. If the project is already broken, we don't want to take the blame.

```bash
cd "$ROOT_PATH" && $BUILD_CMD
```

**If baseline fails:** Stop. Return `{ status: "failed", reason: "baseline build already broken" }`. Do not attempt any fixes. The fixer doesn't fix build errors — it fixes design issues.

**If baseline passes:** Proceed. Record the build command in the session metadata so the checker can reuse it.

---

## 4. Checkpoint Directory

All checkpoint artifacts live under `$ROOT_PATH/.pixelslop/checkpoints/`. Create it if it doesn't exist.

```bash
mkdir -p "$ROOT_PATH/.pixelslop/checkpoints"
```

The `.pixelslop/` directory should already be in `.gitignore` (the scanner creates `.pixelslop/screenshots/`). If it's not, add it — checkpoint patches and metadata are operational artifacts, not project code.

---

## 5. Creating a Checkpoint

A checkpoint captures the pre-fix state of every file the fixer is about to touch. Created **before** any edits, not after.

**Always use `pixelslop-tools` to create checkpoints** — don't run these steps manually:

```bash
node bin/pixelslop-tools.cjs checkpoint create "$ISSUE_ID" --files "$FILE1,$FILE2" --cwd "$ROOT_PATH" --raw
```

Here's what the CLI does under the hood:

**Step 1: Validate target files**

All files must be tracked by git and have no uncommitted changes. If the files already have uncommitted changes (someone was in the middle of editing), the command fails. Don't overwrite in-progress work.

**Step 2: Write checkpoint metadata**

Create `$ROOT_PATH/.pixelslop/checkpoints/${ISSUE_ID}.json`:

```json
{
  "id": "<issue_id>-<timestamp>",
  "issue_id": "<from scanner finding>",
  "files": ["src/styles/main.css", "src/components/Hero.tsx"],
  "created": "2026-03-17T22:30:00.000Z",
  "status": "pending"
}
```

The metadata file is keyed by issue ID, not checkpoint ID. A second checkpoint on the same issue overwrites the previous one — only the latest matters.

**Step 3: Save file copies**

Each file listed in `--files` is copied to `.pixelslop/checkpoints/<issue_id>/` with slashes replaced by `__`. These copies are the rollback source — more reliable than git patches.

**Status values:** `pending` (just created), `pass` (checker verified), `fail` (checker rejected, reverted), `reverted` (manually or automatically rolled back).

---

## 6. Rollback Protocol

When a fix needs to be undone — build gate fails, checker rejects, or human requests revert.

**Use `pixelslop-tools` for rollback:**

```bash
node bin/pixelslop-tools.cjs checkpoint revert "$ISSUE_ID" --cwd "$ROOT_PATH" --raw
```

Here's what the CLI does:

**Step 1: Restore files from backup copies.** Each file is copied back from `.pixelslop/checkpoints/<issue_id>/` to its original path. If a backup copy is missing, the CLI falls back to `git checkout --` for that file.

**Step 2: Verify the revert.** Checks `git diff` to confirm the touched files are clean again.

**Step 3: Update checkpoint status.** Sets `status` to `"reverted"` and records `reverted_at` timestamp in the metadata.

**Step 4: Re-run build gate.** After reverting, confirm the build passes again. If it doesn't, something is seriously wrong — the pre-fix state was supposed to be clean.

---

## 7. Post-Fix Flow

After the fixer applies an edit and declares touched files, this sequence determines the outcome.

```
Fixer applies edit
       │
       ▼
  Run build gate
       │
   ┌───┴───┐
   │       │
  PASS    FAIL → rollback → return { status: "failed", reason: "build broke" }
   │
   ▼
  Run checker (re-measure targeted metric)
       │
   ┌───┴───────┐
   │           │
  PASS       FAIL → rollback → return { status: "failed", reason: "metric not improved" }
   │           │
   │        PARTIAL → keep changes, report → return { status: "partial", ... }
   │
   ▼
  Update checkpoint status to "pass"
  Return { status: "fixed", ... }
```

**PASS** — metric meets threshold. Changes stay. Checkpoint marked `pass`.

**FAIL** — metric worse or doesn't meet threshold. Rollback executed. Checkpoint marked `fail`.

**PARTIAL** — metric improved but didn't reach threshold. Changes stay (don't revert progress). Checkpoint marked `pass` with a note. The orchestrator or human decides whether to attempt another fix.

---

## 8. Checkpoint Metadata Schema

Full schema for the `.json` files in `.pixelslop/checkpoints/`. These fields match what `pixelslop-tools checkpoint create` actually writes.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Format: `<issue_id>-<timestamp>` |
| `issue_id` | string | yes | References the scanner finding being fixed |
| `files` | string[] | yes | Paths relative to root, of every file being checkpointed |
| `created` | string | yes | ISO 8601 timestamp of checkpoint creation |
| `status` | enum | yes | One of: `pending`, `pass`, `fail`, `reverted` |

---

## 9. File Naming

```
.pixelslop/checkpoints/
├── contrast-hero-cta.json
├── contrast-hero-cta/
│   ├── src__styles__main.css
│   └── src__components__Hero.tsx
├── spacing-card-grid.json
├── spacing-card-grid/
│   └── src__styles__layout.css
└── ...
```

Metadata file and backup directory share the issue ID as their base name. Each backup file is the original file path with slashes replaced by `__`. A second checkpoint on the same issue overwrites the metadata and backup directory — only the latest matters.

---

## 10. Rules

1. **Never fix without a checkpoint.** No exceptions. Even if the change is "trivial."
2. **Never touch files with uncommitted changes.** Respect in-progress work.
3. **One checkpoint per fix.** Don't batch multiple issues into a single checkpoint — it makes rollback impossible to scope.
4. **Backup before edit, not after.** The backup captures what was there before you touched it.
5. **Build gate is non-negotiable.** If the build breaks, revert. No "but the design fix was correct" excuses.
6. **Checker decides, fixer doesn't argue.** If the metric didn't improve, the fix failed. The fixer can try again with a different approach, but can't override the checker's measurement.
