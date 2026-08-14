import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { assertHostMatchesTarget, hostRuntimeTarget, readRuntimeConfiguration } from '../scripts/runtime-target.mjs'

const temporaryRoots = []

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { force: true, recursive: true })
})

describe('desktop runtime targets', () => {
  it('selects the requested platform configuration from one provenance lock', () => {
    const root = createRepository()
    const macOS = readRuntimeConfiguration(root, 'darwin-arm64')

    expect(macOS.targetName).toBe('darwin-arm64')
    expect(macOS.target.node.archive).toContain('darwin-arm64')
    expect(macOS.target.electron.archive).toContain('darwin-arm64')
  })

  it('requires native host and target architecture to match', () => {
    expect(hostRuntimeTarget('darwin', 'arm64')).toBe('darwin-arm64')
    expect(() => assertHostMatchesTarget('darwin-arm64', 'win32', 'x64')).toThrow('matching darwin-arm64 host')
  })

  it('rejects unsupported release targets', () => {
    const root = createRepository()
    expect(() => readRuntimeConfiguration(root, 'linux-x64')).toThrow('Unsupported desktop runtime target')
  })
})

function createRepository() {
  const root = mkdtempSync(join(tmpdir(), 'deepseek-work-target-'))
  temporaryRoots.push(root)
  mkdirSync(root, { recursive: true })
  writeFileSync(join(root, 'runtime-lock.json'), JSON.stringify({
    schemaVersion: 2,
    harness: { commit: 'a'.repeat(40) },
    targets: {
      'win32-x64': target('win32-x64', 'zip'),
      'darwin-arm64': target('darwin-arm64', 'tar.gz'),
    },
  }))
  return root
}

function target(name, nodeExtension) {
  const nodeArchive = `node-v24.19.0-${name}.${nodeExtension}`
  const electronArchive = `electron-v43.4.0-${name}.zip`
  return {
    node: {
      version: '24.19.0',
      archive: nodeArchive,
      url: `https://nodejs.org/dist/v24.19.0/${nodeArchive}`,
      sha256: 'b'.repeat(64),
    },
    electron: {
      version: '43.4.0',
      archive: electronArchive,
      url: `https://github.com/electron/electron/releases/download/v43.4.0/${electronArchive}`,
      sha256: 'c'.repeat(64),
    },
  }
}
