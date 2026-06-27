/**
 * agentGuard Vite 插件安装器（§agentGuard）
 * 路由：无
 * API：无；在 Vite dev 启动时安装 git pre-commit guard 钩子。
 */

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type { Plugin } from 'vite'
import { createGuardHookScript } from './guard-hook'
import type { AgentGuardOptions } from './guard-types'

const MARK_BEGIN = '# >>> agent-eyes managed guard >>>'
const MARK_END = '# <<< agent-eyes managed guard <<<'
const GUARD_FILE_NAME = 'agent-eyes-guard.mjs'

interface GitHooks {
  /** 本仓库默认 hooks 目录。 */
  repoHooks: string
  /** 当前 git 实际读取的 hooks 目录。 */
  effectiveHooks: string
  /** 当前 core.hooksPath 是否遮蔽了本仓库默认 hooks。 */
  shadowed: boolean
}

function gitOutput(root: string, args: string[]): string {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return ''
  }
}

function resolveFromRoot(root: string, value: string): string {
  return path.isAbsolute(value) ? value : path.resolve(root, value)
}

function repoHooksDir(root: string): string | null {
  const commonDir = gitOutput(root, ['rev-parse', '--git-common-dir']) || gitOutput(root, ['rev-parse', '--git-dir'])
  return commonDir ? path.resolve(root, commonDir, 'hooks') : null
}

function resolveHooks(root: string): GitHooks | null {
  if (gitOutput(root, ['rev-parse', '--is-inside-work-tree']) !== 'true') return null

  const repoHooks = repoHooksDir(root)
  if (!repoHooks) return null

  const configuredHooks = gitOutput(root, ['config', '--get', 'core.hooksPath'])
  const effectiveHooks = configuredHooks ? resolveFromRoot(root, configuredHooks) : repoHooks

  return {
    repoHooks,
    effectiveHooks,
    shadowed: effectiveHooks !== repoHooks,
  }
}

function writeIfChanged(file: string, content: string): boolean {
  try {
    if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === content) return false
  } catch {
    return false
  }

  fs.writeFileSync(file, content)
  return true
}

function isManageable(file: string): boolean {
  if (!fs.existsSync(file)) return true

  try {
    return fs.readFileSync(file, 'utf8').includes(MARK_BEGIN)
  } catch {
    return false
  }
}

function preCommitScript(guardFile: string): string {
  return `#!/usr/bin/env sh
${MARK_BEGIN}
# agentGuard: block commits when staged changes violate guard rules.
node "${guardFile}" || exit 1
${MARK_END}
`
}

function loggerPrefix(): string {
  return '\x1b[33m[agent-eyes:guard]\x1b[0m'
}

/** 安装 agentGuard git hooks 的 Vite dev 插件。 */
export function agentGuard(options: AgentGuardOptions = {}): Plugin {
  return {
    name: 'vite-plugin-agent-eyes-guard',
    apply: 'serve',
    configureServer(server) {
      const root = server.config.root || process.cwd()
      const warn = (message: string) => server.config.logger.warn(`${loggerPrefix()} ${message}`)

      const hooks = resolveHooks(root)
      if (!hooks) {
        warn('未检测到 git 仓库，跳过 agentGuard 钩子安装')
        return
      }

      if (hooks.shadowed) {
        warn(
          `检测到 core.hooksPath（${hooks.effectiveHooks}）遮蔽了本仓库 hooks（${hooks.repoHooks}），跳过 agentGuard 钩子安装。\n` +
            '  → 如需自动接管 hooksPath，请在 agentGit({ guard, claimHooksPath: true }) 中配置；或手动 git config --local core.hooksPath .git/hooks。',
        )
        return
      }

      fs.mkdirSync(hooks.repoHooks, { recursive: true })

      const guardFile = path.join(hooks.repoHooks, GUARD_FILE_NAME)
      writeIfChanged(guardFile, createGuardHookScript(options))

      const preCommitFile = path.join(hooks.repoHooks, 'pre-commit')
      if (!isManageable(preCommitFile)) {
        warn('已存在非 agent-eyes 管理的 pre-commit，跳过；请手动合并 agentGuard 钩子。')
        return
      }

      if (writeIfChanged(preCommitFile, preCommitScript(guardFile))) {
        fs.chmodSync(preCommitFile, 0o755)
      }
    },
  }
}
