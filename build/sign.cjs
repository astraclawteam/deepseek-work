const { execFileSync } = require('node:child_process')
const { existsSync } = require('node:fs')
const { basename, resolve } = require('node:path')

const EXPECTED_PUBLISHER = 'RushRush Network Technology Ltd'
const MAX_ATTEMPTS = 8
const RETRY_DELAY_MS = 4_000

let signChain = Promise.resolve()
const signTasks = new Map()

function isSignTarget(filename) {
  const normalized = filename.toLowerCase()
  return normalized === 'deepseek work.exe'
    || /^deepseek-work-setup-.+\.exe$/u.test(normalized)
}

function signingConfiguration() {
  const cli = process.env.EVSIGN_CLI?.trim()
  const key = process.env.EVSIGN_KEY?.trim()
  if (cli && key && existsSync(cli)) return { cli, key }

  if (process.env.REQUIRE_CODE_SIGNING === '1') {
    throw new Error(
      `Code signing is required but EV Sign is incomplete (CLI=${cli && existsSync(cli) ? 'ok' : 'missing'}, key=${key ? 'ok' : 'missing'}).`,
    )
  }
  return undefined
}

function signatureMetadata(filePath) {
  const escapedPath = filePath.replaceAll("'", "''")
  const powershell = process.env.SystemRoot
    ? `${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
    : 'powershell.exe'
  const script = [
    `$signature = Get-AuthenticodeSignature -LiteralPath '${escapedPath}'`,
    '[pscustomobject]@{',
    '  Status = [string]$signature.Status',
    '  SignerSubject = [string]$signature.SignerCertificate.Subject',
    '  TimestampSubject = [string]$signature.TimeStamperCertificate.Subject',
    '} | ConvertTo-Json -Compress',
  ].join('; ')
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

function verifySignedFile(filePath) {
  const metadata = signatureMetadata(filePath)
  if (metadata.Status !== 'Valid') {
    throw new Error(`Authenticode status is ${metadata.Status}: ${filePath}`)
  }
  if (!metadata.SignerSubject.includes(EXPECTED_PUBLISHER)) {
    throw new Error(`Unexpected Authenticode publisher for ${filePath}: ${metadata.SignerSubject}`)
  }
  if (!metadata.TimestampSubject) {
    throw new Error(`Authenticode timestamp is missing: ${filePath}`)
  }
}

function signFile({ filePath, filename }) {
  const configuration = signingConfiguration()
  if (!configuration) {
    console.warn(`  unsigned local package: ${filename} (use pnpm run release:win for a required signed release)`)
    return
  }

  let lastFailure = ''
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    console.log(`  EV Sign: ${filename}${attempt > 1 ? ` (attempt ${attempt}/${MAX_ATTEMPTS})` : ''}`)
    let output = ''
    try {
      output = execFileSync(configuration.cli, [filePath, '-key', configuration.key], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 600_000,
        windowsHide: true,
      })
      if (/签名完成/u.test(output) && !/签名失败/u.test(output)) {
        verifySignedFile(filePath)
        console.log(`  signed and verified: ${filename}`)
        return
      }
    } catch (error) {
      output = `${error.stdout ?? ''}${error.stderr ?? ''}${error.message ?? ''}`
    }

    lastFailure = output.slice(-300).replace(/\s+/gu, ' ').trim()
    if (attempt < MAX_ATTEMPTS) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, RETRY_DELAY_MS)
    }
  }
  throw new Error(`EV Sign failed for ${filename} after ${MAX_ATTEMPTS} attempts: ${lastFailure}`)
}

exports.default = async function sign(configuration) {
  const filePath = resolve(configuration.path)
  const filename = basename(filePath)
  if (!isSignTarget(filename)) return

  const taskKey = process.platform === 'win32' ? filePath.toLowerCase() : filePath
  const existing = signTasks.get(taskKey)
  if (existing) return existing

  const task = signChain.then(() => signFile({ filePath, filename }))
  signTasks.set(taskKey, task)
  signChain = task.catch(() => {})
  return task
}

exports.isSignTarget = isSignTarget
