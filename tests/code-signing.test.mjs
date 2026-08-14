import { createRequire } from 'node:module'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { default: sign, isSignTarget } = require('../build/sign.cjs')

describe('Windows code signing scope', () => {
  it('includes the public application and installer executables', () => {
    expect(isSignTarget('DeepSeek Work.exe')).toBe(true)
    expect(isSignTarget('DeepSeek-Work-Setup-0.2.1-x64.exe')).toBe(true)
    expect(isSignTarget('DeepSeek-Work-Setup-0.2.1-x64.__uninstaller.exe')).toBe(true)
  })

  it('does not replace signatures on bundled third-party executables', () => {
    expect(isSignTarget('node.exe')).toBe(false)
    expect(isSignTarget('rg.exe')).toBe(false)
    expect(isSignTarget('OpenConsole.exe')).toBe(false)
    expect(isSignTarget('elevate.exe')).toBe(false)
  })

  it('fails closed when a formal release has no signing credential', async () => {
    const previousRequired = process.env.REQUIRE_CODE_SIGNING
    const previousCli = process.env.EVSIGN_CLI
    const previousKey = process.env.EVSIGN_KEY
    process.env.REQUIRE_CODE_SIGNING = '1'
    delete process.env.EVSIGN_CLI
    delete process.env.EVSIGN_KEY
    try {
      await expect(sign({ path: join(import.meta.dirname, 'DeepSeek Work.exe') }))
        .rejects.toThrow('Code signing is required')
    } finally {
      if (previousRequired === undefined) delete process.env.REQUIRE_CODE_SIGNING
      else process.env.REQUIRE_CODE_SIGNING = previousRequired
      if (previousCli === undefined) delete process.env.EVSIGN_CLI
      else process.env.EVSIGN_CLI = previousCli
      if (previousKey === undefined) delete process.env.EVSIGN_KEY
      else process.env.EVSIGN_KEY = previousKey
    }
  })
})
