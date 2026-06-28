# Agent Bootstrap

Use this file to make specific coding agents discover and use `vite-plugin-agent-eyes` automatically.

The plugin itself is agent-agnostic: it writes plain files under `log/`, so Codex, Claude, Gemini, Hermes, and other local agents can all use it. Automatic usage still requires an instruction entry that the agent actually reads.

## Compatibility Matrix

| Agent | Can use logs | Recommended discovery entry | Notes |
|------|--------------|-----------------------------|-------|
| Codex | Yes | `AGENTS.md` | Codex reliably reads `AGENTS.md` in the workspace hierarchy. |
| Claude Code | Yes | `CLAUDE.md`; optional `.claude/skills/agent-eyes/SKILL.md` | Use both when you want a global project rule plus a reusable skill. |
| Gemini CLI | Yes | `GEMINI.md` | Gemini needs a concise project instruction because it may not inspect package docs unless told. |
| Hermes agent | Yes | Hermes task prompt or `.agents/skills/agent-eyes/SKILL.md` | In CortexOS projects, register the skill or include the snippet in the Hermes task template. |
| Generic agent | Yes | `AGENT_GUIDE.md` or task prompt | The logs are plain text/JSON/HTML/PNG files. |

## Shared Rule

Paste this rule into the agent's project instruction file:

```md
## vite-plugin-agent-eyes

This Vite project may use `vite-plugin-agent-eyes`.

Before guessing from source code on frontend, API, auth, cookie, CORS, routing, visual, or commit-guard issues:

1. Read `node_modules/vite-plugin-agent-eyes/AGENT_GUIDE.md` if it exists.
2. Read `log/README.md`, then `log/instances.json`, then the active `log/<port>/README.md`.
3. Use logs in this order: `errors.log`, `interaction.log`, `api-calls.log`, `proxy-<host>.log`, `auth-state.json`, `snapshots/`, `guard-report.json`.
4. If logs are missing, check whether `agentDebugger()`, `autoInstrument()`, and relevant `agentProxy()` / `agentGuard()` setup exists before diagnosing the app.
5. After changing Vite plugin config, restart the dev server and verify by reproducing the user action and rereading fresh logs.

Never ask for or save tokens, cookies, Authorization headers, or refresh tokens. `auth-state.json` is only a sanitized account hint.
```

## Codex

Add the shared rule to the nearest `AGENTS.md` that governs the Vite app.

Recommended location:

```text
<repo>/AGENTS.md
```

If a monorepo has several Vite apps, put the rule in the app-level `AGENTS.md` so Codex reads the correct local `log/` directory.

## Claude Code

Add the shared rule to:

```text
<repo>/CLAUDE.md
```

For reusable skill-style discovery, copy `SKILL.md` into a Claude skill folder when your Claude environment supports project skills:

```text
<repo>/.claude/skills/agent-eyes/SKILL.md
```

The skill should point Claude to `node_modules/vite-plugin-agent-eyes/AGENT_GUIDE.md` and the generated `log/README.md`.

## Gemini CLI

Add the shared rule to:

```text
<repo>/GEMINI.md
```

Keep the rule short. Gemini should first identify the active log port from `log/instances.json` before reading large logs.

## Hermes Agent

Use one of these entries, depending on your Hermes setup:

```text
<repo>/.agents/skills/agent-eyes/SKILL.md
```

or include the shared rule in the Hermes task template/prompt.

For CortexOS/Hermes flows, the practical rule is:

```text
When assigned a Vite debugging task, first read node_modules/vite-plugin-agent-eyes/AGENT_GUIDE.md and the generated log/README.md if present.
```

## Verification

After adding a bootstrap entry, test it with a short agent prompt:

```text
This Vite app has a frontend bug. Before reading source code, tell me which agent-eyes files you will inspect first.
```

Expected answer: the agent should mention `AGENT_GUIDE.md`, `log/README.md`, `log/instances.json`, and active `log/<port>/` files.
