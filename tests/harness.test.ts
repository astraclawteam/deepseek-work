import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  HarnessReadyParser,
  locateHarnessRoot,
  resolveHarnessNode,
} from '../src/harness.js'

const temporaryRoots: string[] = []

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { force: true, recursive: true })
})

describe('HarnessReadyParser', () => {
  it('recognizes a readiness URL split across stdout chunks', () => {
    const parser = new HarnessReadyParser()

    expect(parser.push('booting\ndsh we')).toBeUndefined()
    expect(parser.push('b: http://127.0.0.1:43127\n')).toEqual(new URL('http://127.0.0.1:43127'))
  })

  it('does not accept port zero as ready', () => {
    const parser = new HarnessReadyParser()
    expect(parser.push('dsh web: http://127.0.0.1:0\n')).toBeUndefined()
  })
})

describe('locateHarnessRoot', () => {
  it('prefers an explicitly configured Harness checkout', () => {
    const root = createHarnessRoot()
    expect(locateHarnessRoot({
      appPath: 'C:\\unused\\deepseek-work',
      explicitRoot: root,
      isPackaged: false,
      resourcesPath: 'C:\\unused\\resources',
    })).toBe(root)
  })

  it('rejects a configured directory that is not the Harness root package', () => {
    const root = createHarnessRoot('not-harness')
    expect(() => locateHarnessRoot({
      appPath: 'C:\\unused\\deepseek-work',
      explicitRoot: root,
      isPackaged: false,
      resourcesPath: 'C:\\unused\\resources',
    })).toThrow('@deepseek-ai/dsh-root')
  })

  it('finds a bundled Harness root for a packaged application', () => {
    const resources = createTemporaryRoot()
    const harnessRoot = join(resources, 'harness')
    mkdirSync(harnessRoot)
    writeManifest(harnessRoot, '@deepseek-ai/dsh-root')

    expect(locateHarnessRoot({
      appPath: 'C:\\unused\\app.asar',
      isPackaged: true,
      resourcesPath: resources,
    })).toBe(harnessRoot)
  })
})

describe('resolveHarnessNode', () => {
  it('uses PATH during development and a bundled executable in production', () => {
    expect(resolveHarnessNode(undefined, false, '/resources', 'linux')).toBe('node')
    expect(resolveHarnessNode(undefined, true, '/resources', 'linux')).toBe(join('/resources', 'runtime', 'node'))
    expect(resolveHarnessNode(undefined, true, 'C:\\resources', 'win32')).toBe(join('C:\\resources', 'runtime', 'node.exe'))
  })

  it('honors an explicit Node executable', () => {
    expect(resolveHarnessNode('/custom/node', true, '/resources', 'linux')).toBe('/custom/node')
  })
})

function createHarnessRoot(name = '@deepseek-ai/dsh-root'): string {
  const root = createTemporaryRoot()
  writeManifest(root, name)
  return root
}

function createTemporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'deepseek-work-'))
  temporaryRoots.push(root)
  return root
}

function writeManifest(root: string, name: string): void {
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name }), 'utf8')
}
