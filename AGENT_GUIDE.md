# Agent Guide

This file is for AI agents working inside a Vite project that has installed `vite-plugin-agent-eyes`.
For human setup and API docs, read `README.md`.

## When To Use

Use these logs before guessing from source code when the user reports:

- Page crash, blank screen, or frontend runtime error.
- API contract mismatch, failed request, auth failure, CORS, redirect, or cookie issue.
- "It works after login, but the agent cannot restore the UI."
- A commit is blocked or should be checked for risky changes before submit.

## Required Setup Check

1. Confirm the project uses `agentDebugger()` in `vite.config.*`.
2. Confirm the app entry calls `autoInstrument()` from `vite-plugin-agent-eyes/client`.
3. If API/auth/cookie debugging is needed, confirm the Vite proxy uses `agentProxy(target)`.
4. If pre-commit risk checks are needed, confirm `agentGuard()` or `agentGit({ guard })` is configured.

If setup is missing, add the smallest missing integration, restart the dev server, reproduce the issue, then read the logs again.

## Runtime Log Entry

After the dev server starts, read:

1. `log/README.md` for the current generated instructions.
2. `log/instances.json` to identify the active dev port.
3. `log/<port>/README.md` for the port-specific log map.

Do not read stale logs from a different port. Logs are recreated on each dev-server start.

## Debugging Order

1. `log/<port>/errors.log`  
   First look at Top Errors and recent raw entries.
2. `log/<port>/interaction.log`  
   Reconstruct what the human or agent clicked, typed, submitted, and which routes changed. Input values are redacted.
3. `log/<port>/api-calls.log`  
   Check real request/response bodies and call order. Do not infer contracts from TypeScript types when this log exists.
4. `log/<port>/proxy-<host>.log`  
   Use this for cookie, Set-Cookie, redirect, CORS, and upstream status truth. Browser `fetch` cannot show this layer.
5. `log/<port>/auth-state.json`  
   Use this to identify the last successful local login profile. It contains only sanitized account hints, not tokens/cookies.
6. `log/<port>/snapshots/`  
   Use screenshots and DOM snapshots for visual or rendered-structure issues.
7. `log/guard-report.json`  
   Use this when a commit is blocked or the user wants pre-submit risk review.

## Safety Rules

- Never ask the user for token, cookie, Authorization header, or refresh token when `auth-state.json` is enough.
- Treat `input` and `change` values in `interaction.log` as intentionally unavailable; do not try to recover sensitive form values from the app.
- Treat missing logs as a setup or dev-server lifecycle problem before guessing application bugs.
- After changing Vite plugin configuration, restart the dev server. HMR is not enough.
- Verify by reproducing the user action and reading fresh logs, not just by making a code change.

## Fast Commands

```bash
ls log
cat log/instances.json
head -80 log/<port>/errors.log
head -80 log/<port>/interaction.log
head -120 log/<port>/api-calls.log
head -80 log/<port>/proxy-<host>.log
cat log/<port>/auth-state.json
cat log/guard-report.json
```
