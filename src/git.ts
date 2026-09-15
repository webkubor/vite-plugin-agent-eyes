import type { Plugin } from 'vite'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, execSync } from 'node:child_process'
import { createGuardHookScript, type AgentGuardOptions } from './guard'

/**
 * agentGit —— 让任意 Vite 项目零配置获得「提交前检查 + 提交后 webhook 推送」。
 *
 * 机制：dev 启动时（configureServer）幂等地把 git 钩子写进项目的 hooks 目录。
 * 装上插件、跑一次 `vite dev`，钩子即就位，无需各项目再配 husky/.git/hooks。
 *
 * 安全取向：
 *  - 仅在传了 guard / precommit / webhook 时才安装（否则 no-op）。
 *  - 只接管带 `agent-eyes managed` 标记的钩子；遇到用户已有的、非本插件写的钩子默认不覆盖（force 可强制）。
 *  - 钩子内容自包含（不依赖运行中的 dev server），git commit 时独立执行。
 */

/** 提交信息——传给自定义 webhook format 函数 */
export interface CommitInfo {
  /** 项目标签（projectLabel 或仓库名） */
  project: string
  /** 仓库名（remote origin basename，回退到目录名） */
  repo: string
  /** 作者 */
  author: string
  /** 当前分支 */
  branch: string
  /** 提交信息正文（已剔除 Co-Authored-By / Signed-off-by / 机器人行） */
  message: string
  /** 短 hash */
  hash: string
  /** 提交时间（UTC 格式） */
  timestamp: string
}

export interface AgentGitWebhook {
  /** 接收 POST 的 webhook 地址 */
  url: string
  /**
   * 载荷格式：
   *  - 'feishu'（默认）：飞书群机器人 text 消息
   *  - 自定义函数：(info) => 任意 JSON 载荷（必须是纯函数，会被序列化进钩子脚本，勿引用闭包/外部变量）
   */
  format?: 'feishu' | ((info: CommitInfo) => unknown)
}

export interface AgentGitOptions {
  /** 提交前依次执行的命令；任一非零退出即阻断提交。例：['pnpm typecheck', 'pnpm lint'] */
  precommit?: string[]
  /** 提交前运行 agentGuard；传 false 可显式关闭。 */
  guard?: AgentGuardOptions | false
  /** 提交成功后推送通知，支持单个或多个 webhook */
  webhook?: AgentGitWebhook | AgentGitWebhook[]
  /** 通知里显示的项目名，默认取仓库名 */
  projectLabel?: string
  /** 总开关，默认 true */
  enabled?: boolean
  /** 覆盖用户已有的、非本插件管理的钩子，默认 false（保护已有钩子） */
  force?: boolean
  /**
   * 当检测到全局 core.hooksPath（如 lefthook）遮蔽本仓库钩子时，
   * 自动为本仓库设 `git config --local core.hooksPath .git/hooks`，让本插件钩子生效。默认 false（仅告警，不改 git 配置）。
   */
  claimHooksPath?: boolean
}

const MARK_BEGIN = '# >>> agent-eyes managed (勿手改此块) >>>'
const MARK_END = '# <<< agent-eyes managed <<<'

function sh(cmd: string, cwd: string): string {
  try {
    return execSync(cmd, { cwd, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    return ''
  }
}

function setLocalHooksPath(cwd: string, hooksPath: string): boolean {
  try {
    execFileSync('git', ['config', '--local', 'core.hooksPath', hooksPath], { cwd, stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

interface GitHooks {
  /** 本插件要写入的目录：本地 core.hooksPath 或本仓库 <gitCommonDir>/hooks（绝不用全局，避免污染所有仓库） */
  repoHooks: string
  /** git 实际会调用的钩子目录（含全局 hooksPath） */
  effDir: string
  /** 真实 git dir（绝对路径，已验证含 HEAD） */
  gitCommonDir: string
  /** 工作树顶层（绝对路径）——相对 core.hooksPath 的解析基准 */
  toplevel: string
  /** 全局 hooksPath 正遮蔽本仓库钩子（写进去也不会被调用） */
  shadowed: boolean
}

/**
 * 解析 hooks 目录。非 git 仓库返回 null；解析出的 git dir 不是真仓库（缺 HEAD）返回错误说明。
 *
 * 事故背景（2026-09-15 t_2026091503454080959a）：旧实现把 `--git-common-dir` 的相对输出和
 * 相对 core.hooksPath 都拿 vite root 当基准 resolve —— 但 git 对相对 core.hooksPath 的语义
 * 是相对 toplevel（实测基准）。root ≠ toplevel（子目录 root / monorepo / cwd 漂移）时解析
 * 错位到不存在的路径，后续 mkdir -p 会凭空造出只有 hooks/ 的假 .git（曾出现在 ~/dev 和 ~），
 * 下游 cs repo scan 命中假 .git 即 SkipDir，整个 ~/dev 被当成一个仓库、台账静默清零。
 */
function resolveHooks(root: string): GitHooks | { error: string } | null {
  const inside = sh('git rev-parse --is-inside-work-tree', root)
  if (inside !== 'true') return null
  // 一律要绝对路径（--path-format 需 git ≥2.31）；老 git 回退相对解析，靠下面的 HEAD 校验兜底
  let common = sh('git rev-parse --path-format=absolute --git-common-dir', root)
  if (!common) {
    const rel = sh('git rev-parse --git-common-dir', root) || sh('git rev-parse --git-dir', root)
    if (!rel) return null
    common = path.resolve(root, rel)
  }
  // 真仓库硬校验：git dir 必须有 HEAD。缺 HEAD = 解析错位或假 .git 壳，装进去只会污染
  if (!fs.existsSync(path.join(common, 'HEAD'))) {
    return { error: `解析到的 git dir 不是有效仓库（缺 HEAD）：${common}` }
  }
  const toplevel = sh('git rev-parse --show-toplevel', root) || root
  const gitHooks = path.join(common, 'hooks')
  const localPath = sh('git config --local --get core.hooksPath', root)
  const effPath = sh('git config --get core.hooksPath', root) // 本地或全局
  // 相对 core.hooksPath 按 git 语义相对 toplevel 解析，不能相对 vite root
  const repoHooks = localPath ? path.resolve(toplevel, localPath) : gitHooks
  const effDir = effPath ? path.resolve(toplevel, effPath) : gitHooks
  return { repoHooks, effDir, gitCommonDir: common, toplevel, shadowed: effDir !== repoHooks }
}

/** 安装目标必须落在本仓库内（真实 git dir 或工作树），且不得经过任何「不是本仓库 git dir」的 .git 段。 */
function validateHooksDir(hooksDir: string, gitCommonDir: string, toplevel: string): string | null {
  const within = (dir: string, parent: string) => dir === parent || dir.startsWith(parent + path.sep)
  if (within(hooksDir, gitCommonDir)) return null
  if (!within(hooksDir, toplevel)) {
    return `hooks 目录解析到仓库之外，拒绝安装：${hooksDir}（仓库：${toplevel}）`
  }
  // 在工作树内但路径中出现 .git 段（且不是真实 git dir）——mkdir 会造出假 .git 壳
  if (path.relative(toplevel, hooksDir).split(path.sep).includes('.git')) {
    return `hooks 目录指向了非本仓库的 .git，拒绝安装（会造出假 .git 壳）：${hooksDir}`
  }
  return null
}

export interface FakeGitShell {
  /** 假壳所在目录（含 .git 的那个父目录） */
  dir: string
  /** 假 .git 的完整路径 */
  gitDir: string
  /** hooks 里是否有 agent-eyes 的痕迹（本插件旧版造成的壳） */
  managedByAgentEyes: boolean
}

/**
 * 从 startDir 向上（含自身，默认走到 $HOME 为止）检测「假 .git 壳」：
 * 是目录、但没有 HEAD 也没有 objects —— 真 git dir 必有 HEAD，这种壳通常是旧版 agentGit
 * mkdir -p 造出来的，会让 cs repo scan 等「见 .git 即仓库」的工具静默出错。
 */
export function findFakeGitShells(startDir: string, stopDir: string = os.homedir()): FakeGitShell[] {
  const shells: FakeGitShell[] = []
  let dir = path.resolve(startDir)
  const stop = path.resolve(stopDir)
  for (;;) {
    const gitDir = path.join(dir, '.git')
    try {
      if (fs.statSync(gitDir).isDirectory() && !fs.existsSync(path.join(gitDir, 'HEAD')) && !fs.existsSync(path.join(gitDir, 'objects'))) {
        const hooks = path.join(gitDir, 'hooks')
        let managed = false
        try {
          managed =
            fs.existsSync(path.join(hooks, 'agent-eyes-guard.mjs')) ||
            fs.existsSync(path.join(hooks, 'agent-eyes-notify.mjs')) ||
            (fs.existsSync(path.join(hooks, 'pre-commit')) && fs.readFileSync(path.join(hooks, 'pre-commit'), 'utf8').includes(MARK_BEGIN))
        } catch {
          /* ignore */
        }
        shells.push({ dir, gitDir, managedByAgentEyes: managed })
      }
    } catch {
      /* .git 不存在或不可读，继续向上 */
    }
    const parent = path.dirname(dir)
    if (dir === stop || parent === dir) break
    dir = parent
  }
  return shells
}

/** 写文件：内容不变则跳过（避免无谓 churn），返回是否实际写入。 */
function writeIfChanged(file: string, content: string): boolean {
  try {
    if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === content) return false
  } catch {
    /* ignore */
  }
  fs.writeFileSync(file, content)
  return true
}

/** 该钩子文件是否由本插件管理（或不存在，可安全创建）。 */
function isManageable(file: string): boolean {
  if (!fs.existsSync(file)) return true
  try {
    return fs.readFileSync(file, 'utf8').includes(MARK_BEGIN)
  } catch {
    return false
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`
}

function preCommitScript(commands: string[], guardFile?: string): string {
  const body = [
    ...(guardFile ? [`node ${shellQuote(guardFile)} || exit 1`] : []),
    ...commands.map((c) => `${c} || exit 1`),
  ].join('\n')
  return `#!/usr/bin/env sh
${MARK_BEGIN}
# 提交前检查——任一命令非零退出即阻断提交（git commit --no-verify 可临时跳过）
${body}
${MARK_END}
`
}

function postCommitScript(notifyFile: string): string {
  return `#!/usr/bin/env sh
${MARK_BEGIN}
# 提交成功后后台静默推送 webhook（绝不阻断提交）
node ${shellQuote(notifyFile)} >/dev/null 2>&1 &
${MARK_END}
`
}

/** 生成自包含的通知脚本（webhook 地址与格式烘焙进去，git commit 时独立运行）。 */
function notifyScript(webhooks: AgentGitWebhook | AgentGitWebhook[], projectLabel?: string): string {
  const webhookList = Array.isArray(webhooks) ? webhooks : [webhooks]
  const label = projectLabel ? JSON.stringify(projectLabel) : 'null'
  
  // 为每个webhook生成配置
  const webhookConfigs = webhookList.map((webhook, index) => {
    const isFn = typeof webhook.format === 'function'
    const fnSrc = isFn ? (webhook.format as (i: CommitInfo) => unknown).toString() : 'null'
    return {
      url: JSON.stringify(webhook.url),
      format: fnSrc,
      key: `webhook_${index}`
    }
  })

  return `// 由 vite-plugin-agent-eyes (agentGit) 生成，请勿手改——改 vite.config 后重启 dev 会重写。
import { execSync } from 'node:child_process'
import { basename, join } from 'node:path'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const g = (a) => { try { return execSync('git ' + a, { stdio: ['ignore','pipe','ignore'] }).toString().trim() } catch { return '' } }

// 幂等 + 重放守卫：避免 rebase/merge/cherry-pick 重放、快速连提、多 dev 导致同一提交重复推送
const gitDir = g('rev-parse --git-dir')
if (gitDir) {
  for (const f of ['rebase-merge', 'rebase-apply', 'CHERRY_PICK_HEAD', 'MERGE_HEAD', 'REVERT_HEAD']) {
    if (existsSync(join(gitDir, f))) process.exit(0)  // 重放/合并进行中，不推
  }
  const head = g('rev-parse HEAD')
  const marker = join(gitDir, 'agent-eyes-last-notify')
  try { if (head && existsSync(marker) && readFileSync(marker, 'utf8').trim() === head) process.exit(0) } catch {}
  try { if (head) writeFileSync(marker, head) } catch {}
}

const repo = basename((g('config --get remote.origin.url') || '').replace(/\\.git$/, '')) || basename(g('rev-parse --show-toplevel'))
const now = new Date()
const timestamp = now.toISOString().replace('T', ' ').replace(/\\.\\d+Z$/, ' UTC')
const info = {
  project: ${label} || repo,
  repo,
  author: g('log -1 --pretty=%an'),
  branch: g('rev-parse --abbrev-ref HEAD'),
  hash: g('rev-parse --short HEAD'),
  timestamp,
  message: g('log -1 --pretty=%B')
    .split('\\n')
    .filter((l) => !/^\\s*(co-authored-by|signed-off-by)\\s*:/i.test(l) && !/🤖\\s*Generated with/i.test(l))
    .join('\\n')
    .trim(),
}

// 支持多个 webhook 推送
const webhooks = [
  ${webhookConfigs.map(config => `{
    url: ${config.url},
    format: ${config.format}
  }`).join(',\n  ')}
]

// 逐个推送，失败不影响其他
for (const webhook of webhooks) {
  if (!webhook.url) continue
  
  let payload
  if (typeof webhook.format === 'function') {
    payload = webhook.format(info)
  } else {
    // 飞书群机器人 text 消息
    payload = { 
      msg_type: 'text', 
      content: { 
        text: \`📝 [\${info.project}] \${info.author} 提交（\${info.branch}）\\n\` +
              \`🕐 \${info.timestamp}\\n\` +
              \`📝 \${info.message}\`
      } 
    }
  }

  try {
    await fetch(webhook.url, { 
      method: 'POST', 
      headers: { 'Content-Type': 'application/json' }, 
      body: JSON.stringify(payload) 
    })
  } catch {
    /* 静默：单个 webhook 通知失败不影响其他 */
  }
}
`
}

export function agentGit(options: AgentGitOptions = {}): Plugin {
  const enabled = options.enabled ?? true
  const precommit = options.precommit ?? []
  const { guard, webhook, projectLabel, force = false } = options
  const hasGuard = guard !== undefined && guard !== false

  return {
    name: 'vite-plugin-agent-eyes-git',
    apply: 'serve',
    configureServer(server) {
      if (!enabled) return
      if (precommit.length === 0 && !webhook && !hasGuard) return

      const root = server.config.root || process.cwd()
      const log = (msg: string) => server.config.logger.info(`\x1b[36m[agent-eyes:git]\x1b[0m ${msg}`)
      const warn = (msg: string) => server.config.logger.warn(`\x1b[33m[agent-eyes:git]\x1b[0m ${msg}`)

      const hooks = resolveHooks(root)
      if (!hooks) {
        warn('未检测到 git 仓库，跳过钩子安装')
        return
      }
      if ('error' in hooks) {
        warn(`${hooks.error}，拒绝安装钩子`)
        return
      }

      // 旧版事故遗留检测：向上找假 .git 壳（只报告，不自动删——误删真仓库的风险不可接受）
      const shells = findFakeGitShells(path.dirname(hooks.toplevel))
      for (const shell of shells) {
        warn(
          `检测到假 .git 壳（无 HEAD/objects${shell.managedByAgentEyes ? '，含 agent-eyes 钩子，系旧版 agentGit 误装' : ''}）：${shell.gitDir}\n` +
            `  → 它会让 cs repo scan 等工具把 ${shell.dir} 误判为仓库。确认非真仓库后清理：mv '${shell.gitDir}' '${shell.gitDir}.fake-shell-bak'`,
        )
      }

      // 全局 hooksPath（如 lefthook）遮蔽本仓库钩子：写进去也不会被 git 调用
      if (hooks.shadowed) {
        if (options.claimHooksPath) {
          // 相对 core.hooksPath 由 git 相对 toplevel 解析，基准必须是 toplevel 而非 vite root
          const relativeHooksPath = path.relative(hooks.toplevel, hooks.repoHooks)
          if (!setLocalHooksPath(root, relativeHooksPath)) {
            warn(`无法设置本仓库 core.hooksPath：${relativeHooksPath}`)
            return
          }
          log(`已为本仓库设 local core.hooksPath → ${relativeHooksPath}（覆盖全局 ${hooks.effDir}）`)
        } else {
          warn(
            `检测到全局 core.hooksPath（${hooks.effDir}）正在生效，本仓库钩子不会被 git 调用。\n` +
              `  → 设 agentGit({ claimHooksPath: true }) 自动为本项目覆盖，或手动 git config --local core.hooksPath .git/hooks`,
          )
          return
        }
      }
      const hooksDir = hooks.repoHooks
      const dirError = validateHooksDir(hooksDir, hooks.gitCommonDir, hooks.toplevel)
      if (dirError) {
        warn(dirError)
        return
      }
      try {
        fs.mkdirSync(hooksDir, { recursive: true })
      } catch {
        warn(`无法创建 hooks 目录：${hooksDir}`)
        return
      }

      const installed: string[] = []

      // pre-commit + guard 脚本
      if (precommit.length > 0 || hasGuard) {
        const file = path.join(hooksDir, 'pre-commit')
        if (!force && !isManageable(file)) {
          warn(`已存在非本插件管理的 pre-commit，跳过（如需接管请设 force:true 或手动合并）`)
        } else {
          const guardFile = hasGuard ? path.join(hooksDir, 'agent-eyes-guard.mjs') : undefined
          // agentGit 自己配置的 webhook URL 不是泄漏的 secret，注入 guard 白名单避免自伤
          const ownWebhookUrls = (Array.isArray(webhook) ? webhook : webhook ? [webhook] : [])
            .map((w) => w?.url)
            .filter((url): url is string => Boolean(url))
          const guardOptions: AgentGuardOptions = {
            ...(guard || {}),
            allowSecrets: [...((guard || {}).allowSecrets ?? []), ...ownWebhookUrls],
          }
          const wroteGuard = guardFile ? writeIfChanged(guardFile, createGuardHookScript(guardOptions)) : false
          if (writeIfChanged(file, preCommitScript(precommit, guardFile))) {
            fs.chmodSync(file, 0o755)
            installed.push('pre-commit')
          } else if (wroteGuard) {
            installed.push('pre-commit')
          }
        }
      }

      // post-commit + 通知脚本
      const hasWebhook = Array.isArray(webhook) 
        ? webhook.some(w => w?.url) 
        : webhook?.url
      if (hasWebhook) {
        const notifyFile = path.join(hooksDir, 'agent-eyes-notify.mjs')
        const file = path.join(hooksDir, 'post-commit')
        if (!force && !isManageable(file)) {
          warn(`已存在非本插件管理的 post-commit，跳过（如需接管请设 force:true 或手动合并）`)
        } else {
          const wroteNotify = writeIfChanged(notifyFile, notifyScript(webhook!, projectLabel))
          const wroteHook = writeIfChanged(file, postCommitScript(notifyFile))
          if (wroteHook) fs.chmodSync(file, 0o755)
          if (wroteHook || wroteNotify) installed.push('post-commit(webhook)')
        }
      }

      if (installed.length) log(`已安装/更新 git 钩子：${installed.join('、')} → ${hooksDir}`)
    },
  }
}
