# Agent Auth Recorder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dev-only auth recorder that stores sanitized login profile state for agent UI restoration without saving credentials.

**Architecture:** Add a shared auth sanitizer module used by client and server. Client APIs set `window.__AGENT_EYES_AUTH__` and post sanitized auth state to `/dev/log`; `agentDebugger` writes that state to `log/<port>/auth-state.json`. Docs and `.gitignore` are updated for the new generated artifacts.

**Tech Stack:** TypeScript strict mode, Vite plugin middleware, Vitest, tsup.

---

## File Structure

- Create `src/auth-state.ts`: shared auth profile types, sanitizer, email masking, state factory.
- Modify `src/client.ts`: export `recordLoginSuccess()` and `installAgentAuthRecorder()`.
- Modify `src/index.ts`: accept `kind: 'auth'` payloads and write `auth-state.json`.
- Create `test/auth-state.test.ts`: sanitizer and BOM/client behavior tests.
- Create `test/auth-middleware.test.ts`: Vite middleware auth-state write tests.
- Modify `.gitignore`: add generated artifact paths.
- Modify `README.md`, `SKILL.md`, `CHANGELOG.md`, `package.json`: document and release `0.9.0`.

## Task 1: Shared Sanitizer

- [ ] Add failing tests in `test/auth-state.test.ts` for masking email, dropping sensitive keys, normalizing roles, and creating a login state.
- [ ] Create `src/auth-state.ts` with exported types and pure functions.
- [ ] Run `pnpm vitest run test/auth-state.test.ts` and confirm pass.
- [ ] Commit `feat: 增加登录态脱敏工具`.

## Task 2: Client API

- [ ] Add failing tests for `recordLoginSuccess()` setting `window.__AGENT_EYES_AUTH__` and returning sanitized state.
- [ ] Update `src/client.ts` with `recordLoginSuccess()` and `installAgentAuthRecorder()`.
- [ ] Run `pnpm vitest run test/auth-state.test.ts` and confirm pass.
- [ ] Commit `feat: 增加本地登录态记录 API`.

## Task 3: Server Write Path

- [ ] Add failing middleware test that posts `kind: auth` and expects `log/<port>/auth-state.json`.
- [ ] Update `src/index.ts` to write sanitized auth state on auth payloads.
- [ ] Run `pnpm vitest run test/auth-middleware.test.ts` and confirm pass.
- [ ] Commit `feat: 写入 agent auth state 报告`.

## Task 4: Generated Artifact Ignore

- [ ] Update `.gitignore` with `log/`, `.agent-eyes/`, `.tmp/`, `*.local.json`, without duplicating existing `.tmp/`.
- [ ] Add a test or shell check showing `git check-ignore log/auth-state.json .agent-eyes/state.json .tmp/build foo.local.json`.
- [ ] Commit `chore: 忽略 agent eyes 本地产物`.

## Task 5: Docs and Release Metadata

- [ ] Update README usage and API tables with auth recorder.
- [ ] Update SKILL quick read paths with `auth-state.json`.
- [ ] Add CHANGELOG `0.9.0`.
- [ ] Bump package version to `0.9.0`.
- [ ] Run `pnpm test`, `pnpm typecheck`, `pnpm build`, `npm pack --dry-run --json`.
- [ ] Commit `docs: 发布 agent auth recorder`.

## Task 6: Publish

- [ ] Run final `pnpm test`, `pnpm typecheck`, `pnpm build`.
- [ ] Run `npm publish`.
- [ ] Tag `v0.9.0`, push `master` and tag.
- [ ] Verify `npm view vite-plugin-agent-eyes version dist-tags.latest`.
