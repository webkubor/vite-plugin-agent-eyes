/** 配置体检回归：环境模式、运行时真值、静态引用与受限扫描。 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { inspectConfiguration } from '../src/project-diagnostics'

const roots: string[] = []
function fixture(files: Record<string, string> = {}): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-diagnostics-'))
  roots.push(root)
  for (const [rel, text] of Object.entries(files)) {
    const file = path.join(root, rel)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, text)
  }
  return root
}
afterEach(() => {
  // 仅清理本测试创建且已验证前缀的临时目录。
  for (const root of roots.splice(0)) {
    if (root.startsWith(path.join(os.tmpdir(), 'agent-diagnostics-'))) fs.rmSync(root, { recursive: true, force: true })
  }
})
const codes = (root: string, options: Parameters<typeof inspectConfiguration>[1] = {}) => inspectConfiguration(root, options).issues.map((i) => i.code)

describe('inspectConfiguration', () => {
  it('uses mode, envDir and multiple prefixes with static and bracket references', () => {
    const root = fixture({
      'settings/.env': 'PUBLIC_COMMON=ok\n',
      'settings/.env.staging': 'PUBLIC_API=secret-value\nAPP_FLAG=on',
      '.env': 'VITE_OTHER=wrong-dir',
      'app/main.ts': `import.meta.env.PUBLIC_API; import.meta.env['APP_FLAG'];
import.meta.env.PUBLIC_COMMON; import.meta.env.PUBLIC_ABSENT; import.meta.env.VITE_OTHER;
import.meta.env.MODE; import.meta.env.DEV; import.meta.env.PROD; import.meta.env.SSR; import.meta.env.BASE_URL`,
    })
    const report = inspectConfiguration(root, { mode: 'staging', envDir: 'settings', envPrefix: ['PUBLIC_', 'APP_'] })
    expect(report.issues.map((i) => i.code)).toEqual(['ENV_MISSING', 'ENV_PREFIX'])
    expect(report.issues[0]).toMatchObject({ file: 'app/main.ts', line: 2 })
    expect(report.mode).toBe('staging')
    expect(report.envDir).toBe('settings')
    expect(JSON.stringify(report)).not.toContain('secret-value')
    expect(codes(root, { mode: 'production', envDir: 'settings', envPrefix: ['PUBLIC_', 'APP_'] })).toContain('ENV_MISSING')
  })

  it('prefers runtime settings, env and define over inferred file settings', () => {
    const root = fixture({
      'src/main.ts': `import.meta.env.PUBLIC_RUNTIME; import.meta.env.VITE_FILE;
import.meta.env.SECRET_DEFINED; import.meta.env['PUBLIC_DEFINED']; process.env.TOKEN;
process.env['OBJECT_KEY']; import.meta.env.PUBLIC_JSON`,
      '.env': 'VITE_FILE=yes',
    })
    const report = inspectConfiguration(root, {
      mode: 'ignored', envPrefix: 'IGNORED_',
      resolvedConfig: {
        mode: 'custom', envDir: root, envPrefix: 'PUBLIC_', env: { PUBLIC_RUNTIME: 'runtime-value' },
        define: {
          'import.meta.env.SECRET_DEFINED': '"private-value"',
          'import.meta.env.PUBLIC_DEFINED': '"injected"', 'process.env.TOKEN': '"secret"',
          'process.env': { OBJECT_KEY: 'never-report' }, 'import.meta.env': '{"PUBLIC_JSON":"private"}',
        },
      },
    })
    expect(report.issues.map((i) => i.code)).toEqual(['ENV_PREFIX'])
    expect(report.mode).toBe('custom')
    expect(report.envPrefix).toEqual(['PUBLIC_'])
    expect(JSON.stringify(report)).not.toContain('runtime-value')
    expect(JSON.stringify(report)).not.toContain('private-value')
  })

  it('respects disabled env loading and the Vite NODE_ENV replacement', () => {
    const root = fixture({ '.env': 'VITE_DISABLED=secret', '.env.unused': 'VITE_OTHER=unused', 'src/main.ts': 'import.meta.env.VITE_DISABLED; process.env.NODE_ENV' })
    const report = inspectConfiguration(root, { resolvedConfig: { envDir: false, env: {} } })
    expect(report.issues.map((issue) => issue.code)).toEqual(['ENV_MISSING'])
  })

  it('honors shell env priority and does not mutate ordinary environment keys', () => {
    const key = 'VITE_DIAGNOSTIC_TEST_SHELL'
    const previous = process.env[key]
    process.env[key] = 'shell-value'
    try {
      const root = fixture({ '.env': `${key}=file-value`, 'src/main.ts': `import.meta.env.${key}` })
      expect(codes(root)).toEqual([])
      expect(process.env[key]).toBe('shell-value')
    } finally {
      if (previous === undefined) delete process.env[key]
      else process.env[key] = previous
    }
  })

  it('restores loadEnv special process keys and skips linked environment files', () => {
    const keys = ['VITE_USER_NODE_ENV', 'BROWSER', 'BROWSER_ARGS']
    const before = keys.map((key) => process.env[key])
    const root = fixture({ '.env': 'NODE_ENV=production\nBROWSER=test-browser\nBROWSER_ARGS=test-args', 'src/main.ts': '' })
    inspectConfiguration(root)
    expect(keys.map((key) => process.env[key])).toEqual(before)
    const external = fixture({ 'env': 'VITE_LINKED=secret' })
    fs.symlinkSync(path.join(external, 'env'), path.join(root, '.env.development'))
    expect(inspectConfiguration(root).truncated).toBe(true)
  })

  it('distinguishes client process.env and config env not explicitly loaded', () => {
    const root = fixture({
      '.env': 'DIAGNOSTICS_CONFIG_ONLY=secret',
      'src/main.ts': `process.env.DIAGNOSTICS_CONFIG_ONLY; process.env['OTHER'];`,
      'custom/config.mts': `export default { value: process.env.DIAGNOSTICS_CONFIG_ONLY }`,
    })
    const options = { resolvedConfig: { configFile: path.join(root, 'custom/config.mts') } }
    expect(codes(root, options)).toEqual(['CONFIG_ENV_NOT_LOADED', 'CLIENT_PROCESS_ENV', 'CLIENT_PROCESS_ENV'])
    fs.writeFileSync(path.join(root, 'custom/config.mts'), `import { loadEnv } from 'vite'; const env = loadEnv(mode, root); process.env.DIAGNOSTICS_CONFIG_ONLY`)
    expect(codes(root, options)).toEqual(['CLIENT_PROCESS_ENV', 'CLIENT_PROCESS_ENV'])
    process.env.DIAGNOSTICS_CONFIG_ONLY = 'provided-by-shell'
    try {
      fs.writeFileSync(path.join(root, 'custom/config.mts'), 'process.env.DIAGNOSTICS_CONFIG_ONLY')
      expect(codes(root, options)).not.toContain('CONFIG_ENV_NOT_LOADED')
    } finally { delete process.env.DIAGNOSTICS_CONFIG_ONLY }
  })

  it('warns only for likely endpoint bindings and never includes URL or source text', () => {
    const url = 'https://user:password@example.invalid/private?token=never-print'
    const root = fixture({
      'src/main.ts': `fetch('${url}'); axios.create({ baseURL: '${url}' });
const API_URL = '${url}'; const API_BASE_URL = '${url}';
const docs = '${url}'; import x from 'https://example.invalid/module';
const text = "import.meta.env.VITE_FAKE";
// fetch('${url}'); import.meta.env.VITE_COMMENT
/* process.env.COMMENT; const API_URL = '${url}' */`,
      'vite.config.ts': `export default { server: { proxy: { '/api': { target: '${url}' } } }, documentation: '${url}' }`,
    })
    const report = inspectConfiguration(root)
    expect(report.issues).toHaveLength(5)
    expect(report.issues.every((i) => i.code === 'HARDCODED_ENDPOINT' && i.message.includes('疑似'))).toBe(true)
    const serialized = JSON.stringify(report)
    for (const secret of [url, 'password', 'never-print', 'VITE_FAKE', 'VITE_COMMENT', 'COMMENT']) expect(serialized).not.toContain(secret)
  })

  it('recognizes direct Vite script modes without treating roots or config names as modes', () => {
    const root = fixture({
      'package.json': JSON.stringify({ scripts: {
        dev: 'vite serve app --config custom.config.ts --mode "staging"',
        build: 'vite build output --config build.config.ts', preview: 'vite preview --mode=\'review\'',
        chained: 'echo ready && vite dev --mode qa', custom: 'node tooling.js --mode ignored',
        bad: 'vite --mode', reserved: 'vite --mode=local', empty: 'vite --mode=""',
      } }),
      '.env.staging': '', '.env.production': '', '.env.review': '', '.env.qa': '', '.env.ignored': '',
      '.env.orphan': '', '.env.local': '', '.env.staging.local': '', '.env.example': '', '.env.sample.example': '',
    })
    const report = inspectConfiguration(root)
    expect(report.issues.filter((i) => i.code === 'SCRIPT_MODE_MISSING')).toHaveLength(2)
    expect(report.issues.filter((i) => i.code === 'SCRIPT_MODE_INVALID')).toHaveLength(1)
    expect(report.issues.filter((i) => i.code === 'ENV_ORPHAN_MODE').map((i) => i.file)).toEqual(['.env.ignored', '.env.orphan'])
  })

  it('scans only supported production files and never follows symlinks', () => {
    const root = fixture({
      'client/view.vue': '<script>import.meta.env.VITE_REAL</script>',
      'client/page.svelte': '<!-- import.meta.env.VITE_COMMENT --><script>process.env.BAD</script>',
      'client/page.astro': '---\nimport.meta.env.VITE_ASTRO\n---',
      'client/main.test.ts': 'process.env.IGNORED', 'client/main.spec.tsx': 'process.env.IGNORED',
      'client/types.d.ts': 'process.env.IGNORED', 'client/types.d.mts': 'process.env.IGNORED',
      'client/test/file.ts': 'process.env.IGNORED', 'client/node_modules/file.js': 'process.env.IGNORED',
      'client/.git/file.ts': 'process.env.IGNORED', 'client/dist/file.js': 'process.env.IGNORED',
      'client/build/file.ts': 'process.env.IGNORED', 'client/log/file.ts': 'process.env.IGNORED',
      'client/docs.md': 'process.env.IGNORED', 'elsewhere.ts': 'process.env.IGNORED',
    })
    fs.symlinkSync(path.join(root, 'elsewhere.ts'), path.join(root, 'client/link.ts'))
    fs.symlinkSync(path.join(root, 'client'), path.join(root, 'linked'))
    const report = inspectConfiguration(root, { sourceDir: 'client' })
    expect(report.scannedFiles).toBe(3)
    expect(report.issues).toHaveLength(3)
    expect(inspectConfiguration(root, { sourceDir: 'linked' }).scannedFiles).toBe(0)
  })

  it('reports incomplete scans for file and size limits', () => {
    const root = fixture({ 'src/a.ts': 'process.env.A', 'src/b.ts': 'process.env.B', 'src/c.ts': ' '.repeat(100) })
    const limited = inspectConfiguration(root, { maxFiles: 1 })
    expect(limited.scannedFiles).toBe(1)
    expect(limited.truncated).toBe(true)
    expect(limited.issues.some((i) => i.code === 'SCAN_INCOMPLETE')).toBe(true)
    const oversized = inspectConfiguration(root, { maxFileSize: 30 })
    expect(oversized.scannedFiles).toBe(2)
    expect(oversized.truncated).toBe(true)
    expect(oversized.issues.find((i) => i.code === 'SCAN_INCOMPLETE')?.file).toBe('src/c.ts')
  })
})
