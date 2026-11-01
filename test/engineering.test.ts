/**
 * 工程完备度体检测试（§engineering）
 * 路由：无
 * API：验证环境文件覆盖、状态管理与统一请求层的识别与建议。
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { inspectEngineering } from '../src/engineering'

function fixture(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-engineering-'))
  for (const [rel, content] of Object.entries(files)) {
    const file = path.join(root, rel)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, content)
  }
  return root
}

const vuePkg = JSON.stringify({
  dependencies: { vue: '^3.5.0', pinia: '^3.0.0', axios: '^1.7.0' },
  devDependencies: { typescript: '^5.9.0' },
})

describe('inspectEngineering', () => {
  it('reports configured and missing environment modes', () => {
    const root = fixture({
      'package.json': vuePkg,
      '.env.development': 'VITE_API=/dev',
      '.env.production': 'VITE_API=/prod',
      '.env.example': 'VITE_API=',
      'src/main.ts': '',
    })
    const result = inspectEngineering(root, { mode: 'development' })
    expect(result.environments.files).toEqual(['.env.development', '.env.production'])
    expect(result.environments.missing).toEqual(['test'])
    expect(result.suggestions.join('\n')).toContain('.env.test')
  })

  it('detects pinia initialization and unified axios request layer reading env baseURL', () => {
    const root = fixture({
      'package.json': vuePkg,
      'src/main.ts': "import { createPinia } from 'pinia'\ncreateApp(App).use(createPinia())",
      'src/api/request.ts': "import axios from 'axios'\nexport const http = axios.create({ baseURL: import.meta.env.VITE_API_URL })",
      'src/stores/user.ts': 'export const useUserStore = defineStore()',
    })
    const result = inspectEngineering(root, { mode: 'development' })
    expect(result.state).toMatchObject({ package: 'pinia', installed: true, configured: true, evidence: 'src/main.ts' })
    expect(result.request).toMatchObject({ package: 'axios', installed: true, unifiedFile: 'src/api/request.ts', envBase: true })
    expect(result.suggestions).toEqual([])
  })

  it('flags installed but unconfigured state and missing request wrapper', () => {
    const root = fixture({
      'package.json': vuePkg,
      'src/main.ts': 'createApp(App).mount()',
    })
    const result = inspectEngineering(root, { mode: 'development' })
    expect(result.state).toMatchObject({ package: 'pinia', installed: true, configured: false, evidence: null })
    expect(result.request.unifiedFile).toBeNull()
    expect(result.suggestions.join('\n')).toContain('未发现初始化配置')
    expect(result.suggestions.join('\n')).toContain('统一请求封装')
  })

  it('stays quiet for projects without env files or a state library', () => {
    const root = fixture({
      'package.json': JSON.stringify({ dependencies: { react: '^19.0.0' } }),
      'src/main.tsx': 'ReactDOM.createRoot(root)',
    })
    const result = inspectEngineering(root, { mode: 'development' })
    expect(result.state.package).toBeNull()
    expect(result.request.package).toBeNull()
    expect(result.environments.missing).toEqual(['development', 'test', 'production'])
    expect(result.suggestions).toEqual([])
  })

  it('reports axios without env-driven baseURL', () => {
    const root = fixture({
      'package.json': vuePkg,
      'src/api/request.ts': "import axios from 'axios'\nexport default axios.create({ baseURL: '/api' })",
      'src/main.ts': '',
    })
    const result = inspectEngineering(root)
    expect(result.request.unifiedFile).toBe('src/api/request.ts')
    expect(result.request.envBase).toBe(false)
    expect(result.suggestions.join('\n')).toContain('baseURL 未读取环境变量')
  })
})
