import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { basename, join, resolve } from 'node:path'

const repositoryRoot = resolve(import.meta.dirname, '..')
const require = createRequire(import.meta.url)
const { authenticodeMetadataScript, parseAuthenticodeMetadata } = require('../build/sign.cjs')
const expectedPublisher = process.env.EXPECTED_WINDOWS_PUBLISHER ?? '惠州顺视智能科技有限公司'
const packageVersion = JSON.parse(await readFile(join(repositoryRoot, 'package.json'), 'utf8')).version
const targets = [
  join(repositoryRoot, 'release', 'win-unpacked', 'DeepSeek Work.exe'),
  join(repositoryRoot, 'release', `DeepSeek-Work-Setup-${packageVersion}-x64.exe`),
]

for (const target of targets) {
  if (!existsSync(target)) throw new Error(`Signed release target is missing: ${target}`)
  const metadata = signatureMetadata(target)
  if (metadata.Status !== 'Valid') {
    throw new Error(`Authenticode status is ${metadata.Status}: ${target}`)
  }
  if (!metadata.SignerSubject.includes(expectedPublisher)) {
    throw new Error(`Unexpected Authenticode publisher for ${target}: ${metadata.SignerSubject}`)
  }
  if (!metadata.TimestampSubject) {
    throw new Error(`Authenticode timestamp is missing: ${target}`)
  }
  console.log(`Verified signed release target ${basename(target)} (${expectedPublisher}).`)
}

function signatureMetadata(filePath) {
  const powershell = process.env.SystemRoot
    ? join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    : 'powershell.exe'
  const encodedMetadata = execFileSync(powershell, [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    authenticodeMetadataScript(filePath),
  ], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 30_000,
    windowsHide: true,
  })
  return parseAuthenticodeMetadata(encodedMetadata)
}
