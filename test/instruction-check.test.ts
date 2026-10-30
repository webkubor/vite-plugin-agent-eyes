import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { inspectInstructions, isInstructionDocument } from '../src/instruction-check'

function root(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agent-instructions-'))
}
function put(base: string, rel: string, content: string): void {
  const file = path.join(base, rel)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content)
}

describe('agent instruction documents', () => {
  it('finds nested AGENTS.md, AGENT.md and agent specific names without scanning build or dot directories', () => {
    const dir = root()
    put(dir, 'AGENTS.md', 'short')
    put(dir, 'src/AGENT.md', 'a\nb\nc')
    put(dir, 'src/CLAUDE.md', 'abcdef')
    put(dir, '.claude/AGENTS.md', 'hidden')
    put(dir, 'node_modules/pkg/AGENTS.md', 'hidden')
    put(dir, 'notes.md', 'short')
    const result = inspectInstructions(dir, { warnLines: 3, warnBytes: 6 })
    expect(result.documents.map((item) => item.file).sort()).toEqual(['AGENTS.md', 'src/AGENT.md', 'src/CLAUDE.md'])
    expect(result.warnings).toHaveLength(2)
    expect(result.documents.find((item) => item.file === 'src/AGENT.md')?.lines).toBe(3)
    expect(isInstructionDocument('AGENTS.md')).toBe(true)
    expect(isInstructionDocument('notes.md')).toBe(false)
  })

  it('checks byte size without reading oversized documents', () => {
    const dir = root()
    put(dir, 'AGENTS.md', 'x'.repeat(1024 * 1024 + 1))
    const result = inspectInstructions(dir)
    expect(result.documents[0]).toMatchObject({ lines: null, oversized: true })
    expect(result.warnings[0]).toContain('AGENTS.md')
  })
})
