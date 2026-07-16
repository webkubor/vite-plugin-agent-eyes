![logo](https://cdn.jsdelivr.net/gh/webkubor/picx-images-hosting@master/blog/projects/vite-plugin-agent-eyes/cs-token4ai-1784193576898095000.png)

<div align="center">

<img src="https://vitejs.dev/logo.svg" alt="Vite" width="64" height="64" />

# vite-plugin-agent-eyes

English | **[简体中文](./README.zh-CN.md)**

**Runtime eyes for AI agents. A pre-commit risk gate for humans.**

Structured runtime logs let an AI agent read, locate, fix and verify bugs without reading your code first. A sanitized auth profile tells the agent who is logged in. A pre-commit guard catches obvious errors, leaked secrets and code-smell signals before `git commit` lands.

[![npm version](https://img.shields.io/npm/v/vite-plugin-agent-eyes.svg?color=cb3837&label=npm)](https://www.npmjs.com/package/vite-plugin-agent-eyes)
[![npm downloads](https://img.shields.io/npm/dm/vite-plugin-agent-eyes.svg?color=cb3837)](https://www.npmjs.com/package/vite-plugin-agent-eyes)
[![release](https://img.shields.io/github/v/release/webkubor/vite-plugin-agent-eyes?color=181717&label=release)](https://github.com/webkubor/vite-plugin-agent-eyes/releases)
[![vite](https://img.shields.io/badge/Vite-%E2%9A%A1%EF%B8%8F-646cff?logo=vite&logoColor=white)](https://vitejs.dev)
[![typescript](https://img.shields.io/badge/TypeScript-ready-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![license](https://img.shields.io/npm/l/vite-plugin-agent-eyes?color=42b883)](./LICENSE)

</div>

> **Framework-agnostic**: a pure Vite plugin built on browser-native APIs (`fetch` / `XMLHttpRequest` / `history`). Works with React, Vue, Svelte, Solid and vanilla JS — no framework dependency.

## Why

More and more code is written by AI — but when something breaks at runtime, the agent debugging it is blind:

- `fetch` cannot see `Set-Cookie` / `Cookie` / redirects / CORS — a **network-layer blind spot**.
- Console errors vanish instantly and drown in extension noise — **no traceable, deduplicated error stream**.
- API responses rarely match the type definitions — the agent can only **guess**.

This plugin turns all of that into **structured, parseable logs** (cleared on every dev-server start, newest entries first). Since 0.9.0 it also records a sanitized login profile, and since 0.10.0 a redacted interaction trace — so an agent can reconstruct the UI state, drive the browser, and replay the path that triggered a bug.

## Documentation

- **📖 Docs site**: [webkubor.github.io/vite-plugin-agent-eyes](https://webkubor.github.io/vite-plugin-agent-eyes/) — guides + API reference.
- **For humans**: keep reading this README — install, features, API, options.
- **For agents**: [AGENT_GUIDE.md](./AGENT_GUIDE.md) is a publishable agent operations manual. At runtime the plugin also generates `log/README.md` and `log/<port>/README.md` telling the agent which logs to read for the current port.
- **Agent bootstrap**: [AGENT_BOOTSTRAP.md](./AGENT_BOOTSTRAP.md) has entry files and copy-paste snippets for Codex, Claude Code, Gemini CLI and Hermes agents.
- **Codex/Claude skill**: [SKILL.md](./SKILL.md) is a compact entry point for skill-based agents.

## Install

```bash
pnpm add -D vite-plugin-agent-eyes
# or
npm i -D vite-plugin-agent-eyes
```

## Usage

### 1. Server side (`vite.config.ts`)

```ts
import { defineConfig } from 'vite'
import { agentDebugger, agentProxy } from 'vite-plugin-agent-eyes'

export default defineConfig({
  plugins: [agentDebugger()],
  server: {
    proxy: {
      '/api': agentProxy('https://your-api.example.com'),  // log/<port>/proxy-<host>.log + localhost cookie fix
    },
  },
})
```

### 1.5 Git workflow: pre-commit commands + post-commit webhooks (0.4.0+, optional)

Give **any Vite project zero-config** pre-commit checks and post-commit notifications — install the plugin, run `vite dev` once, and the git hooks are in place. No husky, no per-project `.git/hooks` setup.

```ts
import { agentDebugger, agentGit } from 'vite-plugin-agent-eyes'

export default defineConfig({
  plugins: [
    agentDebugger(),
    agentGit({
      precommit: ['pnpm typecheck', 'pnpm lint'],        // any non-zero exit blocks the commit
      webhook: {
        url: 'https://open.feishu.cn/open-apis/bot/v2/hook/xxxx',
        format: 'feishu',                                 // built-in Feishu; or (info) => custom payload
      },
      guard: { level: 'block' },                          // 0.8.0+: staged-files risk check before commit
      // claimHooksPath: true,  // if a global core.hooksPath (lefthook etc.) shadows this repo's hooks
    }),
  ],
})
```

**Multiple webhooks** (0.7.0+) — push to several platforms at once (Feishu + DingTalk + WeCom, or anything via a custom `format` function). Each `CommitInfo` includes `project / repo / author / branch / message / hash / timestamp`.

- Hooks are **self-contained**: they run on `git commit` without the dev server running.
- Only hooks carrying the `agent-eyes managed` marker are touched; existing hooks written by other tools are **never overwritten** by default (`force: true` to override).
- Hooks install during dev only (`apply: 'serve'`); with no `guard` / `precommit` / `webhook` configured the plugin is a no-op.

### 1.6 Human Guard: a pre-commit risk gate (0.8.0+, optional)

`agentGuard()` is the last line of defense before a commit leaves your terminal: it checks **staged files only** for obvious mistakes, leaked secrets, oversized files and code-smell signals, and writes an agent-readable report.

```ts
import { agentGuard } from 'vite-plugin-agent-eyes'

export default defineConfig({
  plugins: [
    agentGuard({
      level: 'block',
      checks: {
        secrets: true,
        largeFiles: true,
        fileLength: { warn: 400, block: 800 },
        todo: 'warn',
        noAny: 'warn',
        noConsoleLog: 'warn',
      },
    }),
  ],
})
```

Already using `agentGit()`? Pass `guard` into `agentGit({ guard })` instead of mounting both plugins — they would compete for `pre-commit`.

| level | Behavior | When to use |
|------|----------|----------|
| `warn` | Report everything, block nothing | Legacy projects, observing noise first |
| `block` | Red lines (secrets / largeFiles) block, quality signals warn | Recommended default |
| `strict` | Currently equals `block`; reserved for stricter team gates | New projects, core repos |

Built-in checks:

| Check | Default | What it catches |
|--------|----------|------|
| `secrets` | block | Token / secret / private key / webhook URL patterns in the staged diff |
| `largeFiles` | block | Staged files over 1 MB |
| `fileLength` | warn | Files over 400 lines warn, over 800 block |
| `todo` | warn | Newly added TODO / FIXME / HACK |
| `noAny` | warn | Newly added explicit TypeScript `any` |
| `noConsoleLog` | warn | Newly added `console.log` in frontend sources |

Every commit prints a console report and writes `log/guard-report.json` for agents to inspect later.

### 1.7 Size Watch: live file-length warnings during dev (0.12.0+, optional)

`agentGuard()` blocks oversized files **at commit time**; `agentSizeWatch()` warns **while you type** — a full scan on dev start, then incremental checks on every save. Yellow `[agent-eyes:size]` warnings in the Vite console; never blocks, never affects builds. Built to catch AI assistants quietly piling up 1000-line CSS files.

```ts
import { agentSizeWatch } from 'vite-plugin-agent-eyes'

export default defineConfig({
  plugins: [
    agentSizeWatch(), // defaults: 400 lines for source, 300 for CSS/SCSS/Less
    // or: agentSizeWatch({ warn: 400, cssWarn: 300, exclude: /vendor/ })
  ],
})
```

### 2. Client side (your app entry)

**Recommended: one-line auto-instrumentation** (0.2.0+) — wraps `fetch` / `XMLHttpRequest` / route navigation / global errors / all console levels / DOM snapshots; since 0.10.0 also records a redacted click/input/change/submit/route interaction trace:

```ts
import { autoInstrument } from 'vite-plugin-agent-eyes/client'
autoInstrument()
```

**Or manual instrumentation** when you need fine-grained control:

```ts
import { installAgentErrorReporter, logApiCall, logConsoleEntry, snapshotDom } from 'vite-plugin-agent-eyes/client'

installAgentErrorReporter()  // window errors / unhandledrejection / console / DOM snapshots

// in your fetch / ky / axios interceptor, after each request:
logApiCall({ method, path, url, ok, duration_ms, code, status, request: reqBody, response: resBody })

logConsoleEntry('warn', ['deprecated API called'])
snapshotDom()
```

**Record a sanitized login profile** (0.9.0+):

```ts
import { recordLoginSuccess } from 'vite-plugin-agent-eyes/client'

recordLoginSuccess({
  userId: currentUser.id,
  email: currentUser.email,        // stored as a***@example.com
  name: currentUser.name,
  roles: currentUser.roles,
  tenantId: currentUser.tenantId,
})
```

Only a sanitized profile and a login-success signal are stored — never tokens, cookies, `Authorization` headers or refresh tokens. The browser gets a read-only `window.__AGENT_EYES_AUTH__`; the dev server writes `log/<port>/auth-state.json`.

**Interaction trace** (0.10.0+): installed by `autoInstrument()` by default; `input` / `change` values are stored as `<redacted>` only.

## Logs & reports

Runtime logs live in `log/<port>/` (gitignored), cleared on every start, **newest entries first** — `head` shows the current session. `log/instances.json` tracks the active ports, branches and processes.

| File | Contents | When to read |
|------|------|--------|
| **log/\<port\>/api-calls.log** | Every API call (success + failure) + route changes, with request/response bodies | Contract checks, field discovery, call ordering |
| **log/\<port\>/errors.log** | API failures + runtime errors, **deduplicated with frequency counts** | "What's broken and what's loudest" |
| **log/\<port\>/console.log** | All console output (log/warn/error/info/debug) | Framework warnings, deprecations |
| **log/\<port\>/interaction.log** | Redacted click/input/change/submit/route trace | Replaying the path that triggered a bug |
| **log/\<port\>/proxy-\<host\>.log** | Proxy-level `Cookie` / `Set-Cookie` attributes / status | The network/auth layer `fetch` can't see |
| **log/\<port\>/snapshots/** | Error screenshots (PNG) + DOM snapshots (HTML) | Visual + structural crime scene |
| **log/\<port\>/auth-state.json** | Latest sanitized login profile | "Who is logged in right now?" |
| **log/guard-report.json** | Latest pre-commit guard report | Why a commit was blocked |

`log/README.md` is a self-describing entry point generated for agents. `errors.log` starts with a frequency-sorted `Top Errors` section.

## Error screenshots + DOM snapshots (0.3.0+)

When enabled, every frontend error or failed API call captures the current page via CDP into `log/<port>/snapshots/err-{timestamp}.png`, alongside an automatic DOM dump (no CDP required for the latter).

```ts
agentDebugger({ screenshots: true })
```

Chrome must run with remote debugging for screenshots (`open -a "Google Chrome" --args --remote-debugging-port=9222`). The plugin auto-detects CDP on ports 9222–9232 and silently skips if absent.

## Signature case: login succeeds, everything else is 401

```
log/<port>/api-calls.log:          POST .../auth/login  code=0          ← login OK
log/<port>/api-calls.log:          GET  .../auth/session code=40101     ← yet not logged in
log/<port>/proxy-api.example.com.log: GET .../auth/session → 200 | Cookie(req): none   ← browser sent no cookie
```

On `http://localhost`, `agentProxy` rewrites upstream `Set-Cookie` by default — **drops `Domain` (host-only), strips `Secure`, `SameSite=None → Lax`** — fixing the classic dev trap where a parent-domain + Secure + SameSite=None cookie is rejected by the browser on plain http, so login "succeeds" but the next request carries no cookie. Https/production behavior is untouched. Opt out with `agentProxy(target, { rewriteCookiesForLocalhost: false })`.

## API

### `agentDebugger(options?): Plugin`

| Option | Default | Description |
|------|------|------|
| `logDir` | `'log'` | Log directory (relative to project root) |
| `endpoint` | `'/dev/log'` | Endpoint receiving client reports |
| `flushMs` | `200` | Write throttle (ms) |
| `maxBytes` | `524288` | Per-file size cap; oldest records truncated |
| `screenshots` | `false` | Auto-screenshot on errors (via CDP) |

### `agentProxy(target, options?): ProxyOptions`

| Option | Default | Description |
|------|------|------|
| `rewriteCookiesForLocalhost` | `true` | Make upstream cookies storable on local http |
| `logDir` | `'log'` | Log directory |
| `flushMs` | `200` | Write throttle (ms) |
| `maxBytes` | `524288` | Per-file size cap |
| `extra` | — | Extra fields passed through to Vite `ProxyOptions` |

> Multiple proxies log to separate per-host files (`proxy-api.example.com.log`, `proxy-admin.example.com.log`).

### `agentGit(options?): Plugin`

| Option | Default | Description |
|------|------|------|
| `guard` | — | `AgentGuardOptions` or `false`; runs the staged-risk check before custom `precommit` commands |
| `precommit` | `[]` | Commands run before commit; any non-zero exit blocks |
| `webhook` | — | `{ url, format }` or an array; `format` is `'feishu'` or `(info: CommitInfo) => payload` |
| `projectLabel` | repo name | Project name shown in notifications |
| `enabled` | `true` | Master switch |
| `force` | `false` | Overwrite existing hooks not managed by this plugin |
| `claimHooksPath` | `false` | Locally override a global `core.hooksPath` that shadows this repo's hooks |

### `agentGuard(options?): Plugin`

| Option | Default | Description |
|------|------|------|
| `level` | `'block'` | `warn` reports only; `block` stops red lines; `strict` reserved |
| `checks` | all built-ins | Array to select checks, or object to tune severity/thresholds |
| `reportFile` | `'log/guard-report.json'` | Path of the latest guard report |

### `agentSizeWatch(options?): Plugin`

| Option | Default | Description |
|------|------|------|
| `enabled` | `true` | Toggle the dev-time watchdog |
| `warn` | `400` | Line-count warning threshold for source files |
| `cssWarn` | `300` | Stricter threshold for CSS/SCSS/Sass/Less |
| `include` | common source + style extensions | Files to scan |
| `exclude` | `node_modules`/`dist`/`build`/… | Paths to skip |

### Client (`vite-plugin-agent-eyes/client`)

| Function | Description |
|------|------|
| `autoInstrument(opts?)` | **One-line instrumentation**: fetch + XHR + navigation + errors + console + DOM snapshots + redacted interaction trace. Idempotent (StrictMode/HMR-safe); returns an uninstaller |
| `installAgentErrorReporter()` | Global error capture + console interception + DOM snapshots |
| `installAgentInteractionTracer(opts?)` | Auto-captures click/input/change/submit/route into `interaction.log` |
| `recordInteraction(kind, target?, opts?)` | Record one interaction manually; input/change values stored as `<redacted>` |
| `logApiCall(entry)` | Record an API call from your HTTP interceptor (sensitive fields redacted by default; `entry.raw=true` to bypass) |
| `logConsoleEntry(level, args)` | Record one console line |
| `recordLoginSuccess(profile, opts?)` | Record a sanitized login profile |
| `installAgentAuthRecorder({ getProfile })` | Pull the current user profile from your app and record it once |
| `snapshotDom()` | Capture the current DOM structure |
| `logNav(from, to)` | Record a route navigation |
| `logError(line)` | Record a custom error line |

`autoInstrument` options: `logBody` (default true) / `raw` (default false) / `nav` (true) / `errors` (true) / `interactions` (true) / `endpoint`.

## Changelog

- **[CHANGELOG.md](./CHANGELOG.md)** — full version history
- **[GitHub Releases](https://github.com/webkubor/vite-plugin-agent-eyes/releases)** — readable notes per version

## Known limitations & roadmap

- **🟡 Redaction list is extensible, not exhaustive**: camelCase variants like `csrfToken` are covered, but PII patterns (`ssn` / `credit_card` / `cvv`) are not built-in — extend `redact` per your needs.
- **🟡 `maxBytes` truncation is per-character**: may cut a line in half; moving to line-accurate truncation.
- **🟡 No flush on dev-server exit**: the last throttle window of buffered entries may not hit disk; a `close` hook is planned.
- **🟡 Correlation is grep-based**: console/DOM/screenshot entries share a correlation ID, but agents must grep to join them; an index file `log/correlations.json` is planned.
- **🟡 DOM snapshots capture `body.innerHTML` only**: no computed styles/pseudo elements; visual issues still rely on CDP screenshots.

> Feedback welcome in [Issues](https://github.com/webkubor/vite-plugin-agent-eyes/issues) — or send a PR.

## License

[MIT](./LICENSE)
