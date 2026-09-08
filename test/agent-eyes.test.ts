/**
 * agentEyes 一站式入口测试（§agentEyes）
 * 路由：无
 * API：验证默认 dev 能力组合与客户端自动埋点注入。
 */

import { describe, expect, it } from 'vitest'
import type { Plugin } from 'vite'
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
      }),
    ).toEqual([])
  })

  it('injects autoInstrument into dev HTML with the resolved endpoint', () => {
    const plugin = agentEyes({
      telemetry: { endpoint: '/agent-log' },
      sizeWatch: false,
      git: false,
    }).find((item) => item.name === 'vite-plugin-agent-eyes-client-auto')

    if (!plugin || typeof plugin.transformIndexHtml !== 'function') {
      throw new Error('client auto plugin not found')
    }

    const transform = plugin.transformIndexHtml as (this: unknown, html: string, ctx: unknown) => unknown
    const tags = transform.call({}, '<html><head></head><body></body></html>', {})

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

  it('does not inject twice when the HTML already has the marker', () => {
    const plugin = agentEyes({ sizeWatch: false, git: false }).find((item) => item.name === 'vite-plugin-agent-eyes-client-auto')

    if (!plugin || typeof plugin.transformIndexHtml !== 'function') {
      throw new Error('client auto plugin not found')
    }

    const transform = plugin.transformIndexHtml as (this: unknown, html: string, ctx: unknown) => unknown
    const tags = transform.call({}, '<script data-agent-eyes-auto="true"></script>', {})

    expect(tags).toEqual([])
  })
})
