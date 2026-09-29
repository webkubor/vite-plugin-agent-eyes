<h1 align="center">👀 vite-plugin-agent-eyes</h1>

<p align="center">
  <strong>A self-healing telemetry layer for AI agents — plus a pre-commit risk gate for humans.</strong><br>
  Runtime logs let an agent read, diagnose, fix, and verify without reading your code; a redacted auth profile tells it whose browser it is driving; a pre-commit guard shows obvious errors, secrets, and code smells before you ever commit.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/vite-plugin-agent-eyes"><img src="https://img.shields.io/npm/v/vite-plugin-agent-eyes?style=for-the-badge&color=3fb950&logo=npm&label=npm" alt="npm" /></a>
  <a href="https://www.npmjs.com/package/vite-plugin-agent-eyes"><img src="https://img.shields.io/npm/dm/vite-plugin-agent-eyes?style=for-the-badge&color=6d7f9c&label=downloads" alt="downloads" /></a>
  <a href="https://github.com/webkubor/vite-plugin-agent-eyes/releases"><img src="https://img.shields.io/github/v/release/webkubor/vite-plugin-agent-eyes?style=for-the-badge&color=181717&label=release" alt="release" /></a>
  <img src="https://img.shields.io/badge/runtime_deps-0-5A9E6F?style=for-the-badge" alt="deps" />
  <img src="https://img.shields.io/badge/license-MIT-777?style=for-the-badge" alt="MIT" />
</p>

<p align="center">
  <a href="https://vitejs.dev"><img src="https://img.shields.io/badge/Vite-%E2%9A%A1%EF%B8%8F-646cff?style=for-the-badge&logo=vite&logoColor=white" alt="vite" /></a>
  <a href="https://www.typescriptlang.org"><img src="https://img.shields.io/badge/TypeScript-ready-3178c6?style=for-the-badge&logo=typescript&logoColor=white" alt="typescript" /></a>
</p>

<p align="center">
  <a href="README.md">中文</a> · <a href="CHANGELOG.md">Changelog</a>
</p>

---

## 🎯 Why This

| Scenario | Screenshot it to the agent | Hand-rolled Vite config | vite-plugin-agent-eyes |
|---|:---:|:---:|:---:|
| Agent can see runtime errors | ❌ Relies on a human relaying | ❌ Console only | ✅ Structured API / error / proxy-header logs |
| Frontend errors become self-diagnosable | ❌ | ❌ | ✅ Structured telemetry + screen reading |
| Lost login state auto-repaired | ❌ | ❌ | ✅ Local cookie self-healing |
| Code smells caught before commit | ❌ | ❌ | ✅ Pre-commit guard |
| Setup cost | — | Medium | Low: one plugin + one import |

## Why

Most code will be written by AI, but the second round of debugging and bug verification is often done by nobody reading the code. What the agent lacks is **runtime visibility**:

- `fetch` cannot see `Set-Cookie` / `Cookie` / redirects / CORS — a **blind spot at the network layer**.
- Console errors vanish instantly and are mixed with extension noise — **no traceable, classifiable error stream**.
- The fields an API actually returns often disagree with the type definitions — so you can only **guess**.

This plugin turns all of that into **structured, parseable runtime logs** — cleared on every start, newest first — plus a redacted auth profile and an interaction trace, so an agent can reconstruct the UI, drive the browser, and reproduce a path.

## Install

```bash
pnpm add -D vite-plugin-agent-eyes
```

`peerDependencies` supports `vite >=4 <9`; CI verifies across the 4 / 5 / 6 / 7 / 8 major matrix.

## Capabilities

| Capability | One line | Docs |
|---|---|---|
| **Runtime logs** | API / errors / console / interaction traces as structured logs the agent reads directly | [Logs](https://webkubor.github.io/vite-plugin-agent-eyes/guide/logs) |
| **Proxy-layer logs** | `Cookie` / `Set-Cookie` / status — the layer `fetch` cannot see | [agentProxy](https://webkubor.github.io/vite-plugin-agent-eyes/api/agent-proxy) |
| **Error screenshot + DOM snapshot** | Automatic screenshot on error (CDP auto-detects the port) + DOM dump | [Snapshots](https://webkubor.github.io/vite-plugin-agent-eyes/guide/snapshots) |
| **Auth profile** | Redacted account profile; the agent instantly knows whose browser it is | [Auth profile](https://webkubor.github.io/vite-plugin-agent-eyes/guide/auth-profile) |
| **Pre-commit guard** | secrets / large files / overlong files / `any` / `console.log` / `cssVars` | [Guard](https://webkubor.github.io/vite-plugin-agent-eyes/guide/guard) |
| **Git workflow** | Zero-config pre-commit / post-commit hooks, multi-platform webhooks | [Git workflow](https://webkubor.github.io/vite-plugin-agent-eyes/guide/git-workflow) |
| **Size Watch** | Real-time warnings for oversized files during dev — the cure for AI-generated bloat | [Size Watch](https://webkubor.github.io/vite-plugin-agent-eyes/guide/size-watch) |
| **Agent bootstrap** | On dev start, writes how to read the logs into your existing `CLAUDE.md` / `AGENTS.md` / `GEMINI.md` | [Agent Bootstrap](https://github.com/webkubor/vite-plugin-agent-eyes/blob/main/AGENT_BOOTSTRAP.md) |

## License

MIT
