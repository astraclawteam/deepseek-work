import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'

const repositoryRoot = resolve(import.meta.dirname, '..')
const expectedPublisher = process.env.EXPECTED_WINDOWS_PUBLISHER ?? 'RushRush Network Technology Ltd'
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
  const escapedPath = filePath.replaceAll("'", "''")
  const script = [
    `$signature = Get-AuthenticodeSignature -LiteralPath '${escapedPath}'`,
    '[pscustomobject]@{',
    '  Status = [string]$signature.Status',
    '  SignerSubject = [string]$signature.SignerCertificate.Subject',
    '  TimestampSubject = [string]$signature.TimeStamperCertificate.Subject',
    '} | ConvertTo-Json -Compress',
  ].join('; ')
  const powershell = process.env.SystemRoot
    ? join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    : 'powershell.exe'
  return JSON.parse(execFileSync(powershell, [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    script,
  ], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 30_000,
    windowsHide: true,
  }).trim())
}
