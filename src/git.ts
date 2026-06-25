import type { Plugin } from 'vite'
import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'

/**
 * agentGit —— 让任意 Vite 项目零配置获得「提交前检查 + 提交后 webhook 推送」。
 *
 * 机制：dev 启动时（configureServer）幂等地把 git 钩子写进项目的 hooks 目录。
 * 装上插件、跑一次 `vite dev`，钩子即就位，无需各项目再配 husky/.git/hooks。
 *
 * 安全取向：
 *  - 仅在传了 precommit / webhook 时才安装（否则 no-op）。
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

interface GitHooks {
  /** 本插件要写入的目录：本地 core.hooksPath 或本仓库 <gitCommonDir>/hooks（绝不用全局，避免污染所有仓库） */
  repoHooks: string
  /** git 实际会调用的钩子目录（含全局 hooksPath） */
  effDir: string
  /** 全局 hooksPath 正遮蔽本仓库钩子（写进去也不会被调用） */
  shadowed: boolean
}

/** 解析 hooks 目录。非 git 仓库返回 null。 */
function resolveHooks(root: string): GitHooks | null {
  const inside = sh('git rev-parse --is-inside-work-tree', root)
  if (inside !== 'true') return null
  const common = sh('git rev-parse --git-common-dir', root) || sh('git rev-parse --git-dir', root)
  if (!common) return null
  const gitHooks = path.resolve(root, common, 'hooks')
  const localPath = sh('git config --local --get core.hooksPath', root)
  const effPath = sh('git config --get core.hooksPath', root) // 本地或全局
  const repoHooks = localPath ? path.resolve(root, localPath) : gitHooks
  const effDir = effPath ? path.resolve(root, effPath) : gitHooks
  return { repoHooks, effDir, shadowed: effDir !== repoHooks }
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

function preCommitScript(commands: string[]): string {
  const body = commands.map((c) => `${c} || exit 1`).join('\n')
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
node "${notifyFile}" >/dev/null 2>&1 &
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
import { basename } from 'node:path'

const g = (a) => { try { return execSync('git ' + a, { stdio: ['ignore','pipe','ignore'] }).toString().trim() } catch { return '' } }

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
  const { webhook, projectLabel, force = false } = options

  return {
    name: 'vite-plugin-agent-eyes-git',
    apply: 'serve',
    configureServer(server) {
      if (!enabled) return
      if (precommit.length === 0 && !webhook) return

      const root = server.config.root || process.cwd()
      const log = (msg: string) => server.config.logger.info(`\x1b[36m[agent-eyes:git]\x1b[0m ${msg}`)
      const warn = (msg: string) => server.config.logger.warn(`\x1b[33m[agent-eyes:git]\x1b[0m ${msg}`)

      const hooks = resolveHooks(root)
      if (!hooks) {
        warn('未检测到 git 仓库，跳过钩子安装')
        return
      }
      // 全局 hooksPath（如 lefthook）遮蔽本仓库钩子：写进去也不会被 git 调用
      if (hooks.shadowed) {
        if (options.claimHooksPath) {
          sh(`git config --local core.hooksPath ${JSON.stringify(path.relative(root, hooks.repoHooks))}`, root)
          log(`已为本仓库设 local core.hooksPath → ${path.relative(root, hooks.repoHooks)}（覆盖全局 ${hooks.effDir}）`)
        } else {
          warn(
            `检测到全局 core.hooksPath（${hooks.effDir}）正在生效，本仓库钩子不会被 git 调用。\n` +
              `  → 设 agentGit({ claimHooksPath: true }) 自动为本项目覆盖，或手动 git config --local core.hooksPath .git/hooks`,
          )
          return
        }
      }
      const hooksDir = hooks.repoHooks
      try {
        fs.mkdirSync(hooksDir, { recursive: true })
      } catch {
        warn(`无法创建 hooks 目录：${hooksDir}`)
        return
      }

      const installed: string[] = []

      // pre-commit
      if (precommit.length > 0) {
        const file = path.join(hooksDir, 'pre-commit')
        if (!force && !isManageable(file)) {
          warn(`已存在非本插件管理的 pre-commit，跳过（如需接管请设 force:true 或手动合并）`)
        } else {
          if (writeIfChanged(file, preCommitScript(precommit))) {
            fs.chmodSync(file, 0o755)
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
        const wroteNotify = writeIfChanged(notifyFile, notifyScript(webhook!, projectLabel))
        if (!force && !isManageable(file)) {
          warn(`已存在非本插件管理的 post-commit，跳过（如需接管请设 force:true 或手动合并）`)
        } else {
          const wroteHook = writeIfChanged(file, postCommitScript(notifyFile))
          if (wroteHook) fs.chmodSync(file, 0o755)
          if (wroteHook || wroteNotify) installed.push('post-commit(webhook)')
        }
      }

      if (installed.length) log(`已安装/更新 git 钩子：${installed.join('、')} → ${hooksDir}`)
    },
  }
}
