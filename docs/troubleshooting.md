# Troubleshooting

## The `--debug` flag

Normal runs don't create log files. When something goes wrong, add `--debug`:

```
/pixelslop --debug
/pixelslop http://localhost:3000 --debug
```

This creates `.pixelslop-session.log` in your project directory. Every step gets a timestamped entry — discovery, server startup, scan scores, each fix attempt, checkpoint ops, gate results.

## Reading the log

```bash
npx pixelslop-tools log read
npx pixelslop-tools log read --tail 20    # last 20 entries
```

Sample output:

```
[09:12:41] ● [skill] Session started, debug=true
[09:12:52] ● [skill] Discovery: static site detected with index.html
[09:13:12] ● [skill] User confirmed: serve and scan
[09:13:20] ● [skill] Temp server started on port 57335
[09:13:31] ● [orchestrator] init scan: url=http://localhost:57335 mode=visual-editable
[09:18:50] ● [orchestrator] plan begin: 5 issues, url=http://localhost:57335
[09:18:51] ● [orchestrator] plan update: contrast-footer -> in-progress
[09:18:52] ● [fixer] checkpoint create: contrast-footer (1 files: index.html)
[09:19:30] ● [orchestrator] plan update: contrast-footer -> fixed
[09:25:01] ● [skill] Fix loop complete: 5/5 fixed, 0 failed
```

Two log sources:
- **`[skill]`** entries come from the parent session (SKILL.md) — these log the high-level flow
- **`[orchestrator]`, `[fixer]`, `[checker]`** entries come from auto-logging inside `pixelslop-tools` commands — these fire automatically when `--debug` is active, no model cooperation needed

## Filing bug reports

Include the session log. It shows exactly what happened inside the orchestrator without exposing your source code. The log contains:
- Which commands ran and in what order
- Plan state transitions (which issues moved to which status)
- Checkpoint create/revert operations
- Gate pass/fail results

It does NOT contain: file contents, CSS values, screenshot data, or anything from your codebase.

## Common issues

### "Plan already exists"

Stale `.pixelslop-plan.md` from a previous session. The skill normally handles this with `--force`, but if you're running commands manually:

```bash
npx pixelslop-tools plan begin --url http://localhost:3000 --force --raw
```

### Scan takes forever (10+ minutes)

The scan involves Playwright opening the page at 3 viewports, running JS evaluation snippets, and capturing screenshots. If your page is heavy (large images, slow API calls, client-side rendering), each viewport takes longer.

Things that help:
- Make sure the page is fully loaded before scanning (no pending API calls)
- If using SSR, ensure the server is warmed up
- Check that Playwright MCP is configured correctly: `npx pixelslop doctor`

### "No servers, start targets, or HTML files found"

Pixelslop couldn't figure out what to scan. This happens when:
- No server is running on common dev ports (3000-3010, 4200, 5173, 5174, 8000, 8080, 8888)
- No `package.json` with a `dev` script exists
- No `.html` files in the project root

Fix: start your dev server manually and pass the URL explicitly.

### Temp server won't stop

If a temp server from a previous session is still running:

```bash
npx pixelslop-tools serve stop --root .
```

If that doesn't work (stale PID), find and kill it:

```bash
lsof -i :PORT_NUMBER | grep node
kill PID
```

### Orchestrator seems stuck

The orchestrator runs as a subagent — it can't pause to ask you questions mid-execution. If a scan or fix loop appears frozen, it's probably still working (Playwright operations can be slow). Check the session log with `--debug` to see where it is.

### Fixes broke something

Every fix gets checkpointed before the edit happens. If a fix made things worse, the checker should have caught it and rolled back automatically. If it didn't:

```bash
# List all checkpoints
npx pixelslop-tools checkpoint list

# Revert a specific fix
npx pixelslop-tools checkpoint revert ISSUE_ID
```

Your git history also has the pre-fix state — `git diff` or `git stash` as needed.
