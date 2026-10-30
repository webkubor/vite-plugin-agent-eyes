/**
 * Agent 指令文档体检：只读取项目内指令文件的体积与行数，不持久化正文。
 * 路由/API：无；用于项目体检报告与 dev 保存预警。
 */
import fs from 'node:fs'
import path from 'node:path'

/** 指令文档体积检查选项。 */
export interface InstructionCheckOptions {
  /** 行数预警阈值，默认 200。 */
  warnLines?: number
  /** 字节预警阈值，默认 16384。 */
  warnBytes?: number
}

/** 单份指令文档度量。 */
export interface InstructionDocument {
  file: string
  lines: number | null
  bytes: number
  oversized: boolean
}

/** 指令文档体检结果。 */
export interface InstructionInspection {
  documents: InstructionDocument[]
  warnings: string[]
}

const INSTRUCTION_NAME = /^(?:agents?|claude|gemini)\.md$/i
const EXCLUDED = /^(?:\..*|node_modules|dist|build|coverage|log)$/
const MAX_ENTRIES = 10000
const MAX_READ_BYTES = 1024 * 1024

/** 判断是否是需要体检的 agent 指令文件。 */
export function isInstructionDocument(file: string): boolean {
  return INSTRUCTION_NAME.test(path.basename(file))
}

/** 有界扫描项目中的指令文档；不跟随符号链接。 */
export function inspectInstructions(root: string, options: InstructionCheckOptions = {}): InstructionInspection {
  const warnLines = options.warnLines ?? 200
  const warnBytes = options.warnBytes ?? 16 * 1024
  const documents: InstructionDocument[] = []
  const warnings: string[] = []
  let entriesSeen = 0
  let limited = false
  const walk = (dir: string): void => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      warnings.push(`${path.relative(root, dir) || '.'}：无法读取目录，指令文档检查不完整。`)
      return
    }
    for (const entry of entries) {
      if (++entriesSeen > MAX_ENTRIES) { limited = true; return }
      if (EXCLUDED.test(entry.name) || entry.isSymbolicLink()) continue
      const abs = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(abs)
      else if (entry.isFile() && isInstructionDocument(entry.name)) {
        const file = path.relative(root, abs)
        try {
          const bytes = fs.statSync(abs).size
          const lines = bytes <= MAX_READ_BYTES ? fs.readFileSync(abs, 'utf8').split(/\r?\n/).length : null
          const oversized = bytes >= warnBytes || (lines !== null && lines >= warnLines)
          documents.push({ file, lines, bytes, oversized })
          if (oversized) warnings.push(`${file}：指令文档过大（${lines === null ? '未读取行数' : `${lines} 行`}，${bytes} 字节；阈值 ${warnLines} 行 / ${warnBytes} 字节），建议保留入口并拆分专题引用。`)
        } catch {
          warnings.push(`${file}：无法读取指令文档，检查不完整。`)
        }
      }
      if (limited) return
    }
  }
  walk(root)
  if (limited) warnings.push(`指令文档扫描达到 ${MAX_ENTRIES} 个目录项上限，检查不完整。`)
  return { documents, warnings }
}
