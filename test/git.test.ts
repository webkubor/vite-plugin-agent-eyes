/**
 * agentGit 与 agentGuard 集成测试（§agentGit）
 * 路由：无
 * API：无；验证公开入口导出与 Git hook 安装行为。
 */

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ViteDevServer } from 'vite'
import { afterEach, describe, expect, it } from 'vitest'
import * as entry from '../src/index'
import { agentGit } from '../src/git'

let tempDirs: string[] = []

function makeRepo(prefix = 'agent-eyes-git-'): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  tempDirs = [...tempDirs, root]
  execFileSync('git', ['init'], { cwd: root, stdio: 'ignore' })
  execFileSync('git', ['config', '--local', 'core.hooksPath', '.git/hooks'], { cwd: root, stdio: 'ignore' })
  return root
}

function fakeServer(root: string): ViteDevServer {
  return {
    config: {
      root,
      logger: {
        info() {},
        warn() {},
      },
    },
  } as unknown as ViteDevServer
}

function configureGit(root: string, options: Parameters<typeof agentGit>[0]): void {
  const plugin = agentGit(options)
  if (typeof plugin.configureServer !== 'function') throw new Error('configureServer is not a function')
  plugin.configureServer(fakeServer(root))
}

afterEach(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
  tempDirs = []
})

describe('public package entry', () => {
  it('exports agentGit and public agentGuard APIs together', () => {
    expect(typeof entry.agentGit).toBe('function')
    expect(typeof entry.agentGuard).toBe('function')
    expect(typeof entry.createGuardHookScript).toBe('function')
    expect(typeof entry.normalizeGuardConfig).toBe('function')
    expect(typeof entry.renderGuardReport).toBe('function')
    expect(typeof entry.runGuard).toBe('function')
  })
})

describe('agentGit guard integration', () => {
  it('installs guard script and pre-commit hook when only guard is configured', () => {
    const root = makeRepo()

    configureGit(root, { guard: { level: 'warn' } })

    const hooksDir = path.join(root, '.git', 'hooks')
    const guardFile = path.join(hooksDir, 'agent-eyes-guard.mjs')
    const preCommit = fs.readFileSync(path.join(hooksDir, 'pre-commit'), 'utf8')

    expect(fs.existsSync(guardFile)).toBe(true)
    expect(preCommit).toContain(`node '${guardFile}' || exit 1`)
    expect(preCommit).toContain('# >>> agent-eyes managed (勿手改此块) >>>')
  })

  it('runs guard before custom precommit commands', () => {
    const root = makeRepo()

    configureGit(root, { guard: { checks: ['noAny'] }, precommit: ['pnpm test'] })

    const guardFile = path.join(root, '.git', 'hooks', 'agent-eyes-guard.mjs')
    const preCommit = fs.readFileSync(path.join(root, '.git', 'hooks', 'pre-commit'), 'utf8')
    const guardIndex = preCommit.indexOf(`node '${guardFile}' || exit 1`)
    const customIndex = preCommit.indexOf('pnpm test || exit 1')

    expect(guardIndex).toBeGreaterThanOrEqual(0)
    expect(customIndex).toBeGreaterThanOrEqual(0)
    expect(guardIndex).toBeLessThan(customIndex)
  })

  it('preserves user-owned pre-commit and does not write guard script', () => {
    const root = makeRepo()
    const hooksDir = path.join(root, '.git', 'hooks')
    const preCommitFile = path.join(hooksDir, 'pre-commit')
    const guardFile = path.join(hooksDir, 'agent-eyes-guard.mjs')
    const userHook = '#!/usr/bin/env sh\necho user hook\n'
    fs.writeFileSync(preCommitFile, userHook)

    configureGit(root, { guard: { level: 'warn' } })

    expect(fs.readFileSync(preCommitFile, 'utf8')).toBe(userHook)
    expect(fs.existsSync(guardFile)).toBe(false)
  })

  it('claimHooksPath installs guard into repo hooks path when effective hooks path would shadow it', () => {
    const previousGlobalConfig = process.env.GIT_CONFIG_GLOBAL
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-eyes-git-shadow-'))
    tempDirs = [...tempDirs, root]
    const globalConfig = path.join(root, 'global-gitconfig')
    fs.writeFileSync(globalConfig, '[core]\n\thooksPath = global-hooks\n')

    try {
      process.env.GIT_CONFIG_GLOBAL = globalConfig
      execFileSync('git', ['init'], { cwd: root, stdio: 'ignore' })

      configureGit(root, { guard: { level: 'warn' }, claimHooksPath: true })

      const localHooksPath = execFileSync('git', ['config', '--local', '--get', 'core.hooksPath'], {
        cwd: root,
        encoding: 'utf8',
      }).trim()
      expect(localHooksPath).toBe('.git/hooks')
      expect(fs.existsSync(path.join(root, '.git', 'hooks', 'agent-eyes-guard.mjs'))).toBe(true)
      expect(fs.existsSync(path.join(root, '.git', 'hooks', 'pre-commit'))).toBe(true)
    } finally {
      if (previousGlobalConfig === undefined) {
        delete process.env.GIT_CONFIG_GLOBAL
      } else {
        process.env.GIT_CONFIG_GLOBAL = previousGlobalConfig
      }
    }
  })
})
