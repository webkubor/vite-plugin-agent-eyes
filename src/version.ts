import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Plugin } from 'vite'

function gitOut(args: string, cwd: string): string {
  try {
    return execSync('git ' + args, { cwd, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    return ''
  }
}

/**
 * agentVersion —— 构建期版本 / tag 戳记（只读，不造 tag、不改 `make tag` 规范）。
 *
 * 注入全局常量（构建期固化，应用里可直接用）：
 *   __APP_VERSION__   package.json 的 version
 *   __BUILD_TAG__     git describe --tags --abbrev=0（最新 tag，如 make tag 的 202606291430）
 *   __BUILD_COMMIT__  当前短 commit
 *   __BUILD_TIME__    构建时间 ISO
 *
 * 并在 dev 暴露 GET /__version 返回同样信息（运维 / agent 直接 curl 核对线上版本）。
 *
 * 用法：plugins: [agentVersion()]
 * 在 *.d.ts 里声明 `declare const __APP_VERSION__: string` 等以获得类型。
 */
export function agentVersion(): Plugin {
  const cwd = process.cwd()
  let pkgVersion = ''
  try {
    pkgVersion = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8')).version || ''
  } catch {
    /* 无 package.json 也不致命 */
  }
  const tag = gitOut('describe --tags --abbrev=0', cwd)
  const commit = gitOut('rev-parse --short HEAD', cwd)
  const buildTime = new Date().toISOString()
  const info = { version: pkgVersion, tag, commit, buildTime }

  return {
    name: 'vite-plugin-agent-eyes-version',
    config() {
      return {
        define: {
          __APP_VERSION__: JSON.stringify(pkgVersion),
          __BUILD_TAG__: JSON.stringify(tag),
          __BUILD_COMMIT__: JSON.stringify(commit),
          __BUILD_TIME__: JSON.stringify(buildTime),
        },
      }
    },
    configureServer(server) {
      server.middlewares.use('/__version', (_req, res) => {
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify(info))
      })
    },
  }
}
