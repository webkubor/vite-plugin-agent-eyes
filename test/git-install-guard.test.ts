import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { agentGit, findFakeGitShells } from '../src/index'

let createdDirs: string[] = []
const savedGlobalConfig = process.env.GIT_CONFIG_GLOBAL

beforeEach(() => {
  // 隔离本机真实全局 git 配置（如 core.hooksPath），避免环境泄漏进断言
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-eyes-gitcfg-'))
  createdDirs = [...createdDirs, empty]
  const cfg = path.join(empty, 'gitconfig')
  fs.writeFileSync(cfg, '')
  process.env.GIT_CONFIG_GLOBAL = cfg
})

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function makeRepo(): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-eyes-git-')))
  createdDirs = [...createdDirs, dir]
  git(dir, ['init'])
  git(dir, ['config', 'user.email', 'test@example.com'])
  git(dir, ['config', 'user.name', 'Test User'])
  git(dir, ['commit', '--allow-empty', '-m', 'init'])
  return dir
}

/** 以指定 root 跑一次 configureServer，返回捕获的日志 */
function runPlugin(root: string, options: Parameters<typeof agentGit>[0] = {}): { logs: string[]; warns: string[] } {
  const logs: string[] = []
  const warns: string[] = []
  const plugin = agentGit({ precommit: ['true'], ...options })
  const server = {
    config: {
      root,
      logger: {
        info: (m: string) => logs.push(m),
        warn: (m: string) => warns.push(m),
      },
    },
  }
  const hook = plugin.configureServer as (server: unknown) => void
  hook.call(plugin, server)
  return { logs, warns }
}

afterEach(() => {
  for (const dir of createdDirs) fs.rmSync(dir, { recursive: true, force: true })
  createdDirs = []
  if (savedGlobalConfig === undefined) delete process.env.GIT_CONFIG_GLOBAL
  else process.env.GIT_CONFIG_GLOBAL = savedGlobalConfig
})

describe('agentGit 安装目标校验（假 .git 壳事故回归）', () => {
  it('正常仓库：钩子装进 .git/hooks', () => {
    const repo = makeRepo()
    const { warns } = runPlugin(repo)
    expect(warns).toEqual([])
    const hook = path.join(repo, '.git', 'hooks', 'pre-commit')
    expect(fs.existsSync(hook)).toBe(true)
    expect(fs.readFileSync(hook, 'utf8')).toContain('agent-eyes managed')
  })

  it('root 为仓库子目录 + 相对 core.hooksPath：按 toplevel 解析，不在子目录下造假 .git', () => {
    const repo = makeRepo()
    git(repo, ['config', '--local', 'core.hooksPath', '.git/hooks'])
    const sub = path.join(repo, 'website')
    fs.mkdirSync(sub)
    runPlugin(sub)
    // 旧 bug：resolve(root, '.git/hooks') → website/.git 被 mkdir -p 凭空造出
    expect(fs.existsSync(path.join(sub, '.git'))).toBe(false)
    expect(fs.existsSync(path.join(repo, '.git', 'hooks', 'pre-commit'))).toBe(true)
  })

  it('core.hooksPath 解析到仓库之外：拒绝安装，不创建任何目录', () => {
    const repo = makeRepo()
    const outside = path.join(fs.realpathSync(os.tmpdir()), `agent-eyes-outside-${Date.now()}`)
    createdDirs = [...createdDirs, outside]
    git(repo, ['config', '--local', 'core.hooksPath', path.join(outside, '.git', 'hooks')])
    const { warns } = runPlugin(repo)
    expect(warns.some((w) => w.includes('仓库之外'))).toBe(true)
    expect(fs.existsSync(outside)).toBe(false)
  })

  it('core.hooksPath 指向工作树内的另一个 .git 段：拒绝安装（防造假壳）', () => {
    const repo = makeRepo()
    git(repo, ['config', '--local', 'core.hooksPath', 'packages/app/.git/hooks'])
    const { warns } = runPlugin(repo)
    expect(warns.some((w) => w.includes('假 .git 壳'))).toBe(true)
    expect(fs.existsSync(path.join(repo, 'packages'))).toBe(false)
  })

  it('非 git 仓库：跳过并告警，不产生 .git', () => {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-eyes-norepo-')))
    createdDirs = [...createdDirs, dir]
    const { warns } = runPlugin(dir)
    expect(warns.some((w) => w.includes('未检测到 git 仓库'))).toBe(true)
    expect(fs.existsSync(path.join(dir, '.git'))).toBe(false)
  })

  it('claimHooksPath 从子目录 root 写入的是相对 toplevel 的路径', () => {
    const repo = makeRepo()
    // 用临时全局配置制造 shadowed（全局 hooksPath 遮蔽本仓库钩子）
    const globalCfg = path.join(repo, 'fake-global-gitconfig')
    fs.writeFileSync(globalCfg, `[core]\n\thooksPath = ${path.join(repo, 'some-global-hooks')}\n`)
    process.env.GIT_CONFIG_GLOBAL = globalCfg
    const sub = path.join(repo, 'website')
    fs.mkdirSync(sub)
    runPlugin(sub, { claimHooksPath: true })
    expect(git(repo, ['config', '--local', '--get', 'core.hooksPath'])).toBe('.git/hooks')
    expect(fs.existsSync(path.join(repo, '.git', 'hooks', 'pre-commit'))).toBe(true)
    expect(fs.existsSync(path.join(sub, '.git'))).toBe(false)
  })
})

describe('findFakeGitShells（存量残壳检测）', () => {
  it('检测到只有 hooks/ 的假 .git 壳并识别 agent-eyes 痕迹', () => {
    const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-eyes-shell-')))
    createdDirs = [...createdDirs, base]
    const fakeHooks = path.join(base, '.git', 'hooks')
    fs.mkdirSync(fakeHooks, { recursive: true })
    fs.writeFileSync(path.join(fakeHooks, 'agent-eyes-guard.mjs'), '// stub')
    const start = path.join(base, 'a', 'b')
    fs.mkdirSync(start, { recursive: true })
    const shells = findFakeGitShells(start, base)
    expect(shells).toHaveLength(1)
    expect(shells[0].gitDir).toBe(path.join(base, '.git'))
    expect(shells[0].managedByAgentEyes).toBe(true)
  })

  it('真仓库不误报', () => {
    const repo = makeRepo()
    expect(findFakeGitShells(repo, repo)).toEqual([])
  })

  it('无 agent-eyes 痕迹的空壳也检出，但标记为非本插件所致', () => {
    const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-eyes-shell2-')))
    createdDirs = [...createdDirs, base]
    fs.mkdirSync(path.join(base, '.git', 'hooks'), { recursive: true })
    const shells = findFakeGitShells(base, base)
    expect(shells).toHaveLength(1)
    expect(shells[0].managedByAgentEyes).toBe(false)
  })
})
