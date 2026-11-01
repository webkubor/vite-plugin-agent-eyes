import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { Plugin } from 'vite'

/** agentVersion 配置。 */
export interface AgentVersionOptions {
  /** 项目根；默认取 Vite 解析后的 root，避免在子目录启动时读错 package.json。 */
  root?: string
  /** 覆盖项目里已有的同名 define，默认 false（保护用户自己的定义）。 */
  override?: boolean
}

function gitOut(args: string, cwd: string): string {
  try {
    return execSync('git ' + args, { cwd, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    return ''
  }
}

interface VersionInfo {
  version: string
  tag: string
  commit: string
  buildTime: string
}

function collect(root: string): VersionInfo {
  let version = ''
  try {
    version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version || ''
  } catch {
    /* 无 package.json 也不致命 */
  }
  return {
    version,
    tag: gitOut('describe --tags --abbrev=0', root),
    commit: gitOut('rev-parse --short HEAD', root),
    buildTime: new Date().toISOString(),
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
 * `agentEyes()` 默认已包含它；单独使用时 `plugins: [agentVersion()]`。
 * 项目已自行定义同名常量时默认不覆盖，传 `override: true` 才接管。
 * 在 *.d.ts 里声明 `declare const __APP_VERSION__: string` 等以获得类型。
 */
export function agentVersion(options: AgentVersionOptions = {}): Plugin {
  let info: VersionInfo = { version: '', tag: '', commit: '', buildTime: '' }
  return {
    name: 'vite-plugin-agent-eyes-version',
    config(config) {
      const root = resolve(process.cwd(), options.root ?? config.root ?? '.')
      info = collect(root)
      const existing = (config.define ?? {}) as Record<string, unknown>
      const values: Record<string, string> = {
        __APP_VERSION__: JSON.stringify(info.version),
        __BUILD_TAG__: JSON.stringify(info.tag),
        __BUILD_COMMIT__: JSON.stringify(info.commit),
        __BUILD_TIME__: JSON.stringify(info.buildTime),
      }
      const define: Record<string, string> = {}
      for (const [key, value] of Object.entries(values)) {
        if (options.override || !(key in existing)) define[key] = value
      }
      return { define }
    },
    configureServer(server) {
      if (!info.buildTime) info = collect(server.config.root)
      server.middlewares.use('/__version', (_req, res) => {
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify(info))
      })
    },
  }
}
