/**
 * agentEyes 一站式入口测试（§agentEyes）
 * 路由：无
 * API：验证默认 dev 能力组合与客户端自动埋点注入。
 */

import { describe, expect, it } from 'vitest'
import { createServer, type Plugin } from 'vite'
import { fileURLToPath } from 'node:url'
import { agentEyes } from '../src/index'

function pluginNames(plugins: Plugin[]): string[] {
  return plugins.map((plugin) => plugin.name)
}

describe('agentEyes', () => {
  it('enables the dev defaults in one entrypoint', () => {
    const names = pluginNames(agentEyes())

    expect(names).toContain('vite-plugin-agent-eyes')
    expect(names).toContain('vite-plugin-agent-eyes-client-auto')
    expect(names).toContain('vite-plugin-agent-eyes-size-watch')
    expect(names).toContain('vite-plugin-agent-eyes-project-guide')
    expect(names).toContain('vite-plugin-agent-eyes-git')
    expect(names).toContain('vite-plugin-agent-eyes-version')
    expect(names).toContain('vite-plugin-agent-eyes-banner')
    expect(names).toContain('vite-plugin-agent-eyes-visual')
  })

  it('can disable every default capability explicitly', () => {
    expect(
      agentEyes({
        telemetry: false,
        client: false,
        sizeWatch: false,
        projectGuide: false,
        git: false,
        agentDocs: false,
        version: false,
        banner: false,
        visual: false,
      }),
    ).toEqual([])
  })

  it('injects autoInstrument into dev HTML with the resolved endpoint', () => {
    const plugin = agentEyes({
      telemetry: { endpoint: '/agent-log' },
      sizeWatch: false,
      git: false,
    }).find((item) => item.name === 'vite-plugin-agent-eyes-client-auto')

    const hook = plugin?.transformIndexHtml
    if (!hook || typeof hook === 'function' || hook.order !== 'pre' || !('handler' in hook)) {
      throw new Error('pre-transform client auto plugin not found')
    }

    const tags = hook.handler.call({} as never, '<html><head></head><body></body></html>', {} as never)

    expect(tags).toEqual([
      {
        tag: 'script',
        attrs: {
          type: 'module',
          'data-agent-eyes-auto': 'true',
        },
        children:
          "import { autoInstrument } from 'vite-plugin-agent-eyes/client'\n" +
          'autoInstrument({"endpoint":"/agent-log","logBody":true,"raw":false,"nav":true,"errors":true,"interactions":true})',
        injectTo: 'head-prepend',
      },
    ])
  })

  it('lets Vite rewrite the injected client import for browsers', async () => {
    const client = fileURLToPath(new URL('../src/client.ts', import.meta.url))
    const server = await createServer({
      configFile: false,
      server: { middlewareMode: true },
      resolve: { alias: { 'vite-plugin-agent-eyes/client': client } },
      plugins: agentEyes({
        telemetry: false, sizeWatch: false, git: false, projectGuide: false,
        agentDocs: false, version: false, banner: false, visual: false,
      }),
    })
    try {
      const html = await server.transformIndexHtml('/', '<html><head></head><body></body></html>')
      expect(html).toContain('html-proxy')
      expect(html).not.toContain("from 'vite-plugin-agent-eyes/client'")
    } finally {
      await server.close()
    }
  })

  it('does not inject twice when the HTML already has the marker', () => {
    const plugin = agentEyes({ sizeWatch: false, git: false }).find((item) => item.name === 'vite-plugin-agent-eyes-client-auto')

    const hook = plugin?.transformIndexHtml
    if (!hook || typeof hook === 'function' || hook.order !== 'pre' || !('handler' in hook)) {
      throw new Error('pre-transform client auto plugin not found')
    }

    const tags = hook.handler.call({} as never, '<script data-agent-eyes-auto="true"></script>', {} as never)

    expect(tags).toEqual([])
  })
})
