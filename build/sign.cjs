const { execFileSync } = require('node:child_process')
const { existsSync } = require('node:fs')
const { basename, resolve } = require('node:path')

const EXPECTED_PUBLISHER = '惠州顺视智能科技有限公司'
const MAX_ATTEMPTS = 8
const RETRY_DELAY_MS = 4_000

let signChain = Promise.resolve()
const signTasks = new Map()

function isSignTarget(filename) {
  const normalized = filename.toLowerCase()
  return normalized === 'deepseek work.exe'
    || /^deepseek-work-setup-.+\.exe$/u.test(normalized)
}

function findSignTool() {
  const candidates = [
    process.env.SIGNTOOL_PATH,
    'C:\\Program Files (x86)\\Windows Kits\\10\\App Certification Kit\\signtool.exe',
  ].filter(Boolean)
  return candidates.find(candidate => existsSync(candidate))
}

function signingConfiguration() {
  const signTool = findSignTool()
  const thumbprint = process.env.WIN_CSC_SHA1?.replaceAll(/\s/gu, '')
  if (signTool && thumbprint) return { signTool, thumbprint }

  if (process.env.REQUIRE_CODE_SIGNING === '1') {
    throw new Error(
      `Code signing is required but SimplySign is incomplete (SignTool=${signTool ? 'ok' : 'missing'}, certificate=${thumbprint ? 'ok' : 'missing'}).`,
    )
  }
  return undefined
}

function signatureMetadata(filePath) {
  const powershell = process.env.SystemRoot
    ? `${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
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

function authenticodeMetadataScript(filePath) {
  const escapedPath = filePath.replaceAll("'", "''")
  return [
    `$signature = Get-AuthenticodeSignature -LiteralPath '${escapedPath}'`,
    '$metadata = [pscustomobject]@{',
    '  Status = [string]$signature.Status',
    '  SignerSubject = [string]$signature.SignerCertificate.Subject',
    '  TimestampSubject = [string]$signature.TimeStamperCertificate.Subject',
    '}',
    '$json = $metadata | ConvertTo-Json -Compress',
    '[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json))',
  ].join('\n')
}

function parseAuthenticodeMetadata(encodedMetadata) {
  const json = Buffer.from(encodedMetadata.trim(), 'base64').toString('utf8')
  return JSON.parse(json)
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

  const timestampServer = process.env.TIMESTAMP_SERVER?.trim() || 'http://time.certum.pl'
  let lastFailure = ''
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    console.log(`  SimplySign/SignTool: ${filename}${attempt > 1 ? ` (attempt ${attempt}/${MAX_ATTEMPTS})` : ''}`)
    try {
      execFileSync(configuration.signTool, [
        'sign',
        '/sha1',
        configuration.thumbprint,
        '/fd',
        'SHA256',
        '/tr',
        timestampServer,
        '/td',
        'SHA256',
        '/v',
        filePath,
      ], {
        stdio: 'inherit',
        timeout: 600_000,
        windowsHide: true,
      })
      verifySignedFile(filePath)
      console.log(`  signed and verified: ${filename}`)
      return
    } catch (error) {
      lastFailure = String(error.message ?? error).slice(-300).replace(/\s+/gu, ' ').trim()
    }
    if (attempt < MAX_ATTEMPTS) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, RETRY_DELAY_MS)
    }
  }
  throw new Error(`SimplySign/SignTool failed for ${filename} after ${MAX_ATTEMPTS} attempts: ${lastFailure}`)
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
exports.authenticodeMetadataScript = authenticodeMetadataScript
exports.parseAuthenticodeMetadata = parseAuthenticodeMetadata
