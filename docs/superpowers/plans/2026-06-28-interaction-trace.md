# Interaction Trace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a lightweight interaction trace that logs recent route/click/input/submit events for local agent debugging.

**Architecture:** Add a shared `interaction` module for sanitizing targets and formatting log lines. Client APIs record interaction entries and install event listeners. `agentDebugger` accepts `interaction_batch` payloads and writes `log/<port>/interaction.log`.

**Tech Stack:** TypeScript strict mode, Vite middleware, Vitest, tsup.

---

## File Structure

- Create `src/interaction.ts`: interaction types, target summarizer, entry factory, log formatter.
- Modify `src/client.ts`: export `recordInteraction()` and `installAgentInteractionTracer()`, add `autoInstrument({ interactions })`.
- Modify `src/index.ts`: accept `interaction_batch` and write `interaction.log`.
- Create `test/interaction.test.ts`: sanitizer and formatter tests.
- Create `test/interaction-middleware.test.ts`: middleware write tests.
- Modify `README.md`, `SKILL.md`, `CHANGELOG.md`, `package.json`: document and release `0.10.0`.

## Tasks

- [ ] Write failing tests for target summarization and redacted input/change entries.
- [ ] Implement `src/interaction.ts`.
- [ ] Write failing tests for client `recordInteraction()`.
- [ ] Implement client APIs and wire `autoInstrument()` default.
- [ ] Write failing middleware test for `interaction.log`.
- [ ] Implement server writer and manifest docs.
- [ ] Update docs/version to `0.10.0`.
- [ ] Run `pnpm test`, `pnpm typecheck`, `pnpm build`, `npm pack --dry-run --json`.
- [ ] Commit, publish, tag, and push.
