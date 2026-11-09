/**
 * llms.txt 与指南入口测试
 * 路由：无
 * API：无 —— 只校验仓库内文档的可发现性，避免入口再次丢失。
 */

import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = path.resolve(import.meta.dirname, '..')
const llms = fs.readFileSync(path.join(root, 'llms.txt'), 'utf8')
const skill = fs.readFileSync(path.join(root, 'SKILL.md'), 'utf8')

describe('llms.txt 保留使用入口', () => {
  it('列出安装方式', () => {
    expect(llms).toContain('npm install vite-plugin-agent-eyes')
  })

  it('按问题索引在线指南', () => {
    expect(llms).toContain('## 按问题找答案（在线指南）')
    for (const page of [
      'case-401',
      'snapshots',
      'logs',
      'visual',
      'interactions',
      'auth-profile',
      'guard',
      'quickstart',
      'install',
    ]) {
      expect(llms).toContain(`https://webkubor.github.io/vite-plugin-agent-eyes/guide/${page}`)
    }
  })

  it('指向的指南页面在仓库里都有对应源文件', () => {
    for (const page of ['case-401', 'snapshots', 'logs', 'visual', 'guard']) {
      expect(fs.existsSync(path.join(root, 'website', 'guide', `${page}.md`))).toBe(true)
    }
  })

  it('SKILL.md 也给出在线指南入口', () => {
    expect(skill).toContain('https://webkubor.github.io/vite-plugin-agent-eyes/')
  })
})
