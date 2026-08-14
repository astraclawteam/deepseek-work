import { createRequire } from 'node:module'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { prepareMacOSSigningEnvironment } from '../scripts/macos-signing-environment.mjs'

const require = createRequire(import.meta.url)
const {
  authenticodeMetadataScript,
  default: sign,
  isSignTarget,
  parseAuthenticodeMetadata,
} = require('../build/sign.cjs')

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

  it('builds a syntactically separated PowerShell metadata object', () => {
    const script = authenticodeMetadataScript("C:\\release\\DeepSeek Work's.exe")
    expect(script).toContain("-LiteralPath 'C:\\release\\DeepSeek Work''s.exe'")
    expect(script).toContain('[pscustomobject]@{\n  Status')
    expect(script).toContain('ToBase64String([Text.Encoding]::UTF8.GetBytes($json))')
    expect(script).not.toContain('@{;')
  })

  it('preserves Unicode publisher names across the PowerShell boundary', () => {
    const metadata = { Status: 'Valid', SignerSubject: 'CN=惠州顺视智能科技有限公司' }
    const encoded = Buffer.from(JSON.stringify(metadata), 'utf8').toString('base64')
    expect(parseAuthenticodeMetadata(encoded)).toEqual(metadata)
  })

  it('fails closed when a formal release has no signing credential', async () => {
    const previousRequired = process.env.REQUIRE_CODE_SIGNING
    const previousThumbprint = process.env.WIN_CSC_SHA1
    process.env.REQUIRE_CODE_SIGNING = '1'
    delete process.env.WIN_CSC_SHA1
    try {
      await expect(sign({ path: join(import.meta.dirname, 'DeepSeek Work.exe') }))
        .rejects.toThrow('Code signing is required')
    } finally {
      if (previousRequired === undefined) delete process.env.REQUIRE_CODE_SIGNING
      else process.env.REQUIRE_CODE_SIGNING = previousRequired
      if (previousThumbprint === undefined) delete process.env.WIN_CSC_SHA1
      else process.env.WIN_CSC_SHA1 = previousThumbprint
    }
  })
})

describe('macOS code signing environment', () => {
  it('removes empty certificate variables before an ad-hoc build', () => {
    const source = { CSC_KEY_PASSWORD: 'unused', CSC_LINK: '', PATH: '/usr/bin' }
    const result = prepareMacOSSigningEnvironment(source)

    expect(result).toEqual({ environment: { PATH: '/usr/bin' }, hasDeveloperId: false })
    expect(source).toHaveProperty('CSC_LINK', '')
  })

  it('retains a configured Developer ID identity', () => {
    const result = prepareMacOSSigningEnvironment({ CSC_KEY_PASSWORD: 'secret', CSC_LINK: 'certificate.p12' })

    expect(result.hasDeveloperId).toBe(true)
    expect(result.environment.CSC_LINK).toBe('certificate.p12')
    expect(result.environment.CSC_KEY_PASSWORD).toBe('secret')
  })
})
