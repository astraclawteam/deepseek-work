import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

export async function resolveElectronDistribution({
  repositoryRoot,
  cacheRoot,
  localAppData,
  configuredDistribution,
  electron,
  targetName,
  downloadMissing = false,
  fetchImplementation = fetch,
}) {
  const manifest = JSON.parse(await readFile(join(repositoryRoot, 'package.json'), 'utf8'))
  if (!/^\d+\.\d+\.\d+$/u.test(electron?.version ?? '')) {
    throw new Error('Invalid Electron version in runtime-lock.json')
  }
  if (!/^[0-9a-f]{64}$/u.test(electron?.sha256 ?? '')) {
    throw new Error('Invalid Electron digest in runtime-lock.json')
  }
  if (manifest.devDependencies?.electron !== electron.version) {
    throw new Error(
      `Electron ${String(manifest.devDependencies?.electron)} does not match runtime-lock.json ${electron.version}`,
    )
  }
  const executableMarker = targetName === 'win32-x64'
    ? 'electron.exe'
    : targetName === 'darwin-arm64'
      ? join('Electron.app', 'Contents', 'MacOS', 'Electron')
      : undefined
  if (executableMarker === undefined) throw new Error(`Unsupported Electron release target: ${String(targetName)}`)

  if (configuredDistribution) {
    const configuredPath = resolve(configuredDistribution)
    if (existsSync(join(configuredPath, executableMarker))) {
      return { path: configuredPath, source: 'configured Electron distribution' }
    }
    if (existsSync(configuredPath) && await sha256File(configuredPath) === electron.sha256) {
      return { path: configuredPath, source: 'configured verified Electron archive' }
    }
    throw new Error(`Configured Electron distribution is missing or does not match the pinned digest: ${configuredPath}`)
  }

  const installedDistribution = join(repositoryRoot, 'node_modules', 'electron', 'dist')
  if (existsSync(join(installedDistribution, executableMarker))) {
    return { path: installedDistribution, source: 'installed Electron package' }
  }

  const candidates = [join(cacheRoot, 'downloads', electron.archive)]
  if (localAppData) {
    candidates.push(...findNamedFiles(join(localAppData, 'electron', 'Cache'), electron.archive))
  }
  for (const candidate of deduplicatePaths(candidates)) {
    if (!existsSync(candidate)) continue
    if (await sha256File(candidate) === electron.sha256) {
      return { path: candidate, source: 'verified Electron archive' }
    }
  }

  if (downloadMissing) {
    const destination = join(cacheRoot, 'downloads', electron.archive)
    await downloadPinnedElectron(electron, destination, fetchImplementation)
    return { path: destination, source: 'downloaded verified Electron archive' }
  }

  throw new Error(
    `Pinned Electron archive ${electron.archive} is missing. Place the SHA-256 verified archive in ${join(cacheRoot, 'downloads')}.`,
  )
}

export function releaseCacheRoot(repositoryRoot, environment = process.env) {
  const configured = environment.DEEPSEEK_WORK_CACHE_ROOT?.trim()
  return configured ? resolve(configured) : join(repositoryRoot, '.release-cache')
}

function findNamedFiles(root, filename) {
  if (!existsSync(root)) return []
  const matches = []
  const pending = [root]
  while (pending.length > 0) {
    const directory = pending.pop()
    let entries
    try {
      entries = readdirSync(directory, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const entryPath = join(directory, entry.name)
      if (entry.isDirectory()) pending.push(entryPath)
      else if (entry.isFile() && entry.name === filename) matches.push(entryPath)
    }
  }
  return matches
}

function deduplicatePaths(paths) {
  const seen = new Set()
  return paths.filter(filePath => {
    const identity = resolve(filePath).toLowerCase()
    if (seen.has(identity)) return false
    seen.add(identity)
    return true
  })
}

function sha256File(filePath) {
  return new Promise((resolveDigest, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(filePath)
    stream.on('data', chunk => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolveDigest(hash.digest('hex')))
  })
}

async function downloadPinnedElectron(electron, destination, fetchImplementation) {
  const officialOrigin = `https://github.com/electron/electron/releases/download/v${electron.version}/`
  if (typeof electron.url !== 'string' || !electron.url.startsWith(officialOrigin) || !electron.url.endsWith(`/${electron.archive}`)) {
    throw new Error('Electron archive must come from the pinned official GitHub release')
  }
  mkdirSync(dirname(destination), { recursive: true })
  const temporary = `${destination}.${randomUUID()}.part`
  try {
    const response = await fetchImplementation(electron.url)
    if (!response.ok || response.body === null) throw new Error(`Electron download failed with HTTP ${response.status}`)
    await pipeline(Readable.fromWeb(response.body), createWriteStream(temporary, { flags: 'wx' }))
    const digest = await sha256File(temporary)
    if (digest !== electron.sha256) {
      throw new Error(`Electron SHA-256 mismatch for ${electron.archive}: ${digest}`)
    }
    renameSync(temporary, destination)
  } finally {
    rmSync(temporary, { force: true })
  }
}
