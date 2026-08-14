import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { releaseCacheRoot, resolveElectronDistribution } from '../scripts/electron-distribution.mjs'

const temporaryRoots = []

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { force: true, recursive: true })
})

describe('Electron release distribution', () => {
  it('prefers an installed Electron distribution', async () => {
    const repositoryRoot = createRepository()
    const installed = join(repositoryRoot, 'node_modules', 'electron', 'dist')
    mkdirSync(installed, { recursive: true })
    writeFileSync(join(installed, 'electron.exe'), '')

    await expect(resolveElectronDistribution({
      repositoryRoot,
      cacheRoot: join(repositoryRoot, 'cache'),
      lock: lockFor('unused'),
    })).resolves.toEqual({ path: installed, source: 'installed Electron package' })
  })

  it('accepts only the pinned archive from the persistent cache', async () => {
    const repositoryRoot = createRepository()
    const cacheRoot = join(repositoryRoot, 'cache')
    const archive = join(cacheRoot, 'downloads', 'electron-v43.4.0-win32-x64.zip')
    mkdirSync(join(cacheRoot, 'downloads'), { recursive: true })
    writeFileSync(archive, 'verified electron archive')

    await expect(resolveElectronDistribution({
      repositoryRoot,
      cacheRoot,
      lock: lockFor('verified electron archive'),
    })).resolves.toEqual({ path: archive, source: 'verified Electron archive' })
  })

  it('honors an explicitly configured verified archive', async () => {
    const repositoryRoot = createRepository()
    const archive = join(repositoryRoot, 'electron.zip')
    writeFileSync(archive, 'configured archive')

    await expect(resolveElectronDistribution({
      repositoryRoot,
      cacheRoot: join(repositoryRoot, 'unused-cache'),
      configuredDistribution: archive,
      lock: lockFor('configured archive'),
    })).resolves.toEqual({ path: archive, source: 'configured verified Electron archive' })
  })

  it('rejects an archive with the wrong digest', async () => {
    const repositoryRoot = createRepository()
    const cacheRoot = join(repositoryRoot, 'cache')
    const archive = join(cacheRoot, 'downloads', 'electron-v43.4.0-win32-x64.zip')
    mkdirSync(join(cacheRoot, 'downloads'), { recursive: true })
    writeFileSync(archive, 'tampered')

    await expect(resolveElectronDistribution({
      repositoryRoot,
      cacheRoot,
      lock: lockFor('expected'),
    })).rejects.toThrow('Pinned Electron archive')
  })

  it('supports an external short cache root', () => {
    expect(releaseCacheRoot('C:\\repo', { DEEPSEEK_WORK_CACHE_ROOT: 'F:\\dw-cache' }))
      .toBe(resolve('F:\\dw-cache'))
  })
})

function createRepository() {
  const root = mkdtempSync(join(tmpdir(), 'deepseek-work-electron-'))
  temporaryRoots.push(root)
  writeFileSync(join(root, 'package.json'), JSON.stringify({ devDependencies: { electron: '43.4.0' } }))
  return root
}

function lockFor(content) {
  return {
    electron: {
      version: '43.4.0',
      archive: 'electron-v43.4.0-win32-x64.zip',
      sha256: createHash('sha256').update(content).digest('hex'),
    },
  }
}
