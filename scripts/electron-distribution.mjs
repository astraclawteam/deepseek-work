import { createHash } from 'node:crypto'
import { createReadStream, existsSync, readdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

export async function resolveElectronDistribution({
  repositoryRoot,
  cacheRoot,
  localAppData,
  configuredDistribution,
  lock,
}) {
  const manifest = JSON.parse(await readFile(join(repositoryRoot, 'package.json'), 'utf8'))
  const electron = lock?.electron
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

  if (configuredDistribution) {
    const configuredPath = resolve(configuredDistribution)
    if (existsSync(join(configuredPath, 'electron.exe'))) {
      return { path: configuredPath, source: 'configured Electron distribution' }
    }
    if (existsSync(configuredPath) && await sha256File(configuredPath) === electron.sha256) {
      return { path: configuredPath, source: 'configured verified Electron archive' }
    }
    throw new Error(`Configured Electron distribution is missing or does not match the pinned digest: ${configuredPath}`)
  }

  const installedDistribution = join(repositoryRoot, 'node_modules', 'electron', 'dist')
  if (existsSync(join(installedDistribution, 'electron.exe'))) {
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
