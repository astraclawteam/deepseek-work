import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { pruneRuntimeTree, runtimePruningReason } from '../scripts/runtime-pruning-policy.mjs'

const ownedRoots = []

afterEach(() => {
  for (const root of ownedRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('runtime pruning policy', () => {
  it('removes development artifacts and non-target native payloads', () => {
    expect(runtimePruningReason('node_modules/pkg/lib/index.js.map')).toBe('source-map')
    expect(runtimePruningReason('node_modules/pkg/index.d.ts')).toBe('type-declaration')
    expect(runtimePruningReason('node_modules/node-pty/prebuilds/win32-arm64/pty.node')).toBe('non-target-native-payload')
    expect(runtimePruningReason('node_modules/@img/sharp-wasm32/lib/sharp.node.wasm')).toBe('non-target-native-payload')
    expect(runtimePruningReason('node_modules/pkg/tests/fixture.js')).toBe('development-directory')
    expect(runtimePruningReason('node_modules/pkg/docs/guide.md')).toBe('development-directory')
    expect(runtimePruningReason('node_modules/test/index.js')).toBeUndefined()
    expect(runtimePruningReason('node_modules/yaml/dist/doc/directives.js')).toBeUndefined()
  })

  it('retains executable code, runtime assets, licenses, and target native modules', () => {
    expect(runtimePruningReason('node_modules/pkg/lib/index.js')).toBeUndefined()
    expect(runtimePruningReason('node_modules/pkg/prompts/system.md')).toBeUndefined()
    expect(runtimePruningReason('node_modules/pkg/LICENSE')).toBeUndefined()
    expect(runtimePruningReason('node_modules/pkg/package.json')).toBeUndefined()
    expect(runtimePruningReason('node_modules/node-pty/prebuilds/win32-x64/pty.node')).toBeUndefined()
    expect(runtimePruningReason('desktop-runtime.json')).toBeUndefined()
  })

  it('keeps Apple Silicon native modules and removes Windows-only terminal payloads for macOS', () => {
    expect(runtimePruningReason('node_modules/node-pty/prebuilds/darwin-arm64/pty.node', 'darwin-arm64')).toBeUndefined()
    expect(runtimePruningReason('node_modules/node-pty/prebuilds/win32-x64/pty.node', 'darwin-arm64'))
      .toBe('non-target-native-payload')
    expect(runtimePruningReason('node_modules/node-pty/third_party/conpty/1.0/win10-x64/conpty.dll', 'darwin-arm64'))
      .toBe('non-target-native-payload')
  })

  it('rejects targets without an audited native pruning policy', () => {
    expect(() => runtimePruningReason('node_modules/pkg/index.js', 'linux-x64'))
      .toThrow('Unsupported runtime pruning target')
  })

  it('prunes only classified files and reports exact counts', () => {
    const root = mkdtempSync(join(tmpdir(), 'deepseek-work-pruning-'))
    ownedRoots.push(root)
    write(root, 'node_modules/pkg/lib/index.js', 'runtime')
    write(root, 'node_modules/pkg/lib/index.js.map', 'map')
    write(root, 'node_modules/pkg/index.d.ts', 'types')
    write(root, 'node_modules/pkg/README.md', 'docs')
    write(root, 'node_modules/pkg/LICENSE', 'license')

    const report = pruneRuntimeTree(root)

    expect(report.before.files).toBe(5)
    expect(report.after.files).toBe(2)
    expect(report.removed.files).toBe(3)
    expect(readFileSync(join(root, 'node_modules/pkg/lib/index.js'), 'utf8')).toBe('runtime')
    expect(readFileSync(join(root, 'node_modules/pkg/LICENSE'), 'utf8')).toBe('license')
  })
})

function write(root, relativePath, contents) {
  const destination = join(root, ...relativePath.split('/'))
  mkdirSync(dirname(destination), { recursive: true })
  writeFileSync(destination, contents, 'utf8')
}
