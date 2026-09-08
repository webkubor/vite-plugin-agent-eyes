/**
 * agent 指令文件同步测试（§agentDocs）
 * 路由：无
 * API：syncAgentInstructions —— 幂等 upsert、只碰已存在的文件、不动标记块以外的内容。
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AGENT_DOC_MARKERS, syncAgentInstructions } from '../src/agent-docs'
import { agentEyes } from '../src/index'

let root: string

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-docs-'))
})
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

describe('syncAgentInstructions', () => {
  it('appends the block to existing instruction files only', () => {
    fs.writeFileSync(path.join(root, 'CLAUDE.md'), '# 项目说明\n\n原有内容。\n')

    const updated = syncAgentInstructions(root)

    expect(updated).toEqual(['CLAUDE.md'])
    const content = fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf8')
    expect(content).toContain('原有内容。')
    expect(content).toContain('api-calls.log')
    // 不存在的文件不创建
    expect(fs.existsSync(path.join(root, 'AGENTS.md'))).toBe(false)
    expect(fs.existsSync(path.join(root, 'GEMINI.md'))).toBe(false)
  })

  it('is idempotent — second run writes nothing', () => {
    fs.writeFileSync(path.join(root, 'AGENTS.md'), '# A\n')

    expect(syncAgentInstructions(root)).toEqual(['AGENTS.md'])
    expect(syncAgentInstructions(root)).toEqual([])
  })

  it('replaces a stale block in place, keeping surrounding text', () => {
    const { BEGIN, END } = AGENT_DOC_MARKERS
    fs.writeFileSync(
      path.join(root, 'CLAUDE.md'),
      `头部\n\n${BEGIN}\n过时内容\n${END}\n\n尾部\n`,
    )

    syncAgentInstructions(root)

    const content = fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf8')
    expect(content).toContain('头部')
    expect(content).toContain('尾部')
    expect(content).not.toContain('过时内容')
    expect(content.match(new RegExp(BEGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))).toHaveLength(1)
  })

  it('honours a custom logDir label', () => {
    fs.writeFileSync(path.join(root, 'GEMINI.md'), '# G\n')

    syncAgentInstructions(root, '.logs')

    const content = fs.readFileSync(path.join(root, 'GEMINI.md'), 'utf8')
    expect(content).toContain('.logs/<port>/api-calls.log')
    expect(content).not.toContain('log/<port>/api-calls.log')
  })
})

describe('agentEyes wiring', () => {
  it('includes the docs plugin by default and drops it when disabled', () => {
    expect(agentEyes().map((p) => p.name)).toContain('vite-plugin-agent-eyes-docs')
    expect(agentEyes({ agentDocs: false }).map((p) => p.name)).not.toContain(
      'vite-plugin-agent-eyes-docs',
    )
  })
})
