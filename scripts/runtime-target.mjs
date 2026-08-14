import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export const SUPPORTED_RUNTIME_TARGETS = new Set(['win32-x64', 'darwin-arm64'])

export function hostRuntimeTarget(platform = process.platform, arch = process.arch) {
  return `${platform}-${arch}`
}

export function readRuntimeConfiguration(repositoryRoot, requestedTarget = undefined) {
  const lock = JSON.parse(readFileSync(join(repositoryRoot, 'runtime-lock.json'), 'utf8'))
  assertRuntimeLock(lock)
  const targetName = requestedTarget?.trim() || process.env.DEEPSEEK_WORK_TARGET?.trim() || hostRuntimeTarget()
  if (!SUPPORTED_RUNTIME_TARGETS.has(targetName)) {
    throw new Error(`Unsupported desktop runtime target: ${targetName}`)
  }
  const target = lock.targets[targetName]
  if (target === undefined) throw new Error(`runtime-lock.json has no configuration for ${targetName}`)
  return { harness: lock.harness, schemaVersion: lock.schemaVersion, target, targetName }
}

export function assertHostMatchesTarget(targetName, platform = process.platform, arch = process.arch) {
  const hostTarget = hostRuntimeTarget(platform, arch)
  if (targetName !== hostTarget) {
    throw new Error(`Desktop target ${targetName} must be built on a matching ${targetName} host; current host is ${hostTarget}`)
  }
}

function assertRuntimeLock(value) {
  if (value?.schemaVersion !== 2 || typeof value.targets !== 'object' || value.targets === null) {
    throw new Error('Unsupported runtime-lock.json')
  }
  if (!/^[0-9a-f]{40}$/u.test(value.harness?.commit ?? '')) {
    throw new Error('Invalid Harness commit in runtime-lock.json')
  }
  for (const targetName of SUPPORTED_RUNTIME_TARGETS) {
    const target = value.targets[targetName]
    if (target === undefined) throw new Error(`runtime-lock.json is missing ${targetName}`)
    assertOfficialArchive(target.node, 'Node.js', 'https://nodejs.org/dist/')
    assertOfficialArchive(target.electron, 'Electron', 'https://github.com/electron/electron/releases/download/')
  }
}

function assertOfficialArchive(value, label, origin) {
  if (!/^\d+\.\d+\.\d+$/u.test(value?.version ?? '')) {
    throw new Error(`Invalid ${label} version in runtime-lock.json`)
  }
  if (typeof value.archive !== 'string' || value.archive === '') {
    throw new Error(`Invalid ${label} archive in runtime-lock.json`)
  }
  if (!/^[0-9a-f]{64}$/u.test(value.sha256 ?? '')) {
    throw new Error(`Invalid ${label} digest in runtime-lock.json`)
  }
  if (typeof value.url !== 'string' || !value.url.startsWith(origin) || !value.url.endsWith(`/${value.archive}`)) {
    throw new Error(`${label} runtime must come from its official HTTPS distribution origin`)
  }
}
