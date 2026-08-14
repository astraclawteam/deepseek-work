import { lstatSync, readdirSync, rmdirSync, rmSync } from 'node:fs'
import { relative, resolve, sep } from 'node:path'

export const RUNTIME_PRUNING_POLICY_VERSION = 3

const NODE_PTY_PREBUILD_TARGETS = new Map([
  ['darwin-arm64', 'darwin-arm64'],
  ['win32-x64', 'win32-x64'],
])

const DEVELOPMENT_DIRECTORIES = new Set([
  '.circleci',
  '.github',
  '.yarn',
  '__tests__',
  'benchmark',
  'benchmarks',
  'coverage',
  'test',
  'tests',
])

const PACKAGE_ROOT_DEVELOPMENT_DIRECTORIES = new Set([
  '.circleci',
  '.github',
  '.yarn',
  'doc',
  'docs',
  'example',
  'examples',
])

/** Classify a staged npm file for safe, release-only removal. */
export function runtimePruningReason(relativePath, target = 'win32-x64') {
  const nodePtyTarget = NODE_PTY_PREBUILD_TARGETS.get(target)
  if (nodePtyTarget === undefined) throw new Error(`Unsupported runtime pruning target: ${target}`)

  const normalized = relativePath.replaceAll('\\', '/').replace(/^\.\//u, '')
  const lower = normalized.toLowerCase()
  if (!lower.startsWith('node_modules/')) return undefined

  const segments = lower.split('/')
  const filename = segments.at(-1) ?? ''

  if (lower.startsWith('node_modules/@types/') || lower.includes('/node_modules/@types/')) {
    return 'type-only-package'
  }
  if (/\.d\.(?:ts|mts|cts)$/u.test(filename)) return 'type-declaration'
  if (/\.map$/u.test(filename)) return 'source-map'
  if (/\.pdb$/u.test(filename)) return 'native-debug-symbol'

  if (hasDevelopmentDirectory(segments)) return 'development-directory'

  if (/^(?:readme|changelog|history|contributing|security)(?:\..*)?$/u.test(filename)) {
    return 'package-documentation'
  }
  if (/^(?:package-lock\.json|pnpm-lock\.yaml|yarn\.lock|\.npmignore|\.yarnignore|\.gitignore)$/u.test(filename)) {
    return 'package-manager-metadata'
  }
  if (/^(?:tsconfig(?:\..+)?\.json|jsconfig\.json|binding\.gyp)$/u.test(filename) || filename.endsWith('.tsbuildinfo')) {
    return 'build-metadata'
  }

  if (lower.startsWith('node_modules/@img/sharp-wasm32/')) return 'non-target-native-payload'
  if (lower.startsWith('node_modules/node-pty/prebuilds/') && !lower.startsWith(`node_modules/node-pty/prebuilds/${nodePtyTarget}/`)) {
    return 'non-target-native-payload'
  }
  if (target === 'darwin-arm64' && (
    lower.includes('node_modules/node-pty/third_party/conpty/')
    || lower.includes('node_modules/node-pty/build/release/conpty/')
  )) {
    return 'non-target-native-payload'
  }
  if (target === 'win32-x64' && lower.includes('node_modules/node-pty/third_party/conpty/') && lower.includes('/win10-arm64/')) {
    return 'non-target-native-payload'
  }

  return undefined
}

/** Remove classified files from a staged runtime and return an auditable summary. */
export function pruneRuntimeTree(root, target = 'win32-x64') {
  const resolvedRoot = resolve(root)
  const before = measureTree(resolvedRoot)
  const removedByReason = new Map()
  let removedFiles = 0
  let removedBytes = 0

  const visit = current => {
    const entries = readdirSync(current, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name))
    for (const entry of entries) {
      const absolutePath = resolve(current, entry.name)
      assertOwnedPath(absolutePath, resolvedRoot)
      const stat = lstatSync(absolutePath)
      if (stat.isSymbolicLink()) throw new Error(`Runtime pruning refuses a symbolic link: ${absolutePath}`)
      if (stat.isDirectory()) {
        visit(absolutePath)
        if (readdirSync(absolutePath).length === 0) rmdirSync(absolutePath)
        continue
      }
      if (!stat.isFile()) throw new Error(`Runtime pruning found an unsupported entry: ${absolutePath}`)

      const relativePath = relative(resolvedRoot, absolutePath).split(sep).join('/')
      const reason = runtimePruningReason(relativePath, target)
      if (reason === undefined) continue

      rmSync(absolutePath, { force: true })
      removedFiles += 1
      removedBytes += stat.size
      const summary = removedByReason.get(reason) ?? { bytes: 0, files: 0 }
      summary.bytes += stat.size
      summary.files += 1
      removedByReason.set(reason, summary)
    }
  }

  visit(resolvedRoot)
  const after = measureTree(resolvedRoot)
  return {
    schemaVersion: 1,
    policyVersion: RUNTIME_PRUNING_POLICY_VERSION,
    target,
    before,
    after,
    removed: { bytes: removedBytes, files: removedFiles },
    removedByReason: Object.fromEntries([...removedByReason.entries()].sort(([left], [right]) => left.localeCompare(right))),
  }
}

function measureTree(root) {
  let bytes = 0
  let files = 0
  const visit = current => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const absolutePath = resolve(current, entry.name)
      assertOwnedPath(absolutePath, root)
      const stat = lstatSync(absolutePath)
      if (stat.isSymbolicLink()) throw new Error(`Runtime inventory refuses a symbolic link: ${absolutePath}`)
      if (stat.isDirectory()) visit(absolutePath)
      else if (stat.isFile()) {
        bytes += stat.size
        files += 1
      } else throw new Error(`Runtime inventory found an unsupported entry: ${absolutePath}`)
    }
  }
  visit(root)
  return { bytes, files }
}

function hasDevelopmentDirectory(segments) {
  const packageNamePositions = new Set()
  const packageRootChildPositions = new Set()
  for (let index = 0; index < segments.length - 1; index += 1) {
    if (segments[index] !== 'node_modules') continue
    const firstPackageSegment = index + 1
    packageNamePositions.add(firstPackageSegment)
    const packageRoot = segments[firstPackageSegment]?.startsWith('@') ? firstPackageSegment + 1 : firstPackageSegment
    if (packageRoot !== firstPackageSegment) packageNamePositions.add(packageRoot)
    packageRootChildPositions.add(packageRoot + 1)
  }
  return segments.some((segment, index) => (
    (DEVELOPMENT_DIRECTORIES.has(segment) && !packageNamePositions.has(index))
    || (PACKAGE_ROOT_DEVELOPMENT_DIRECTORIES.has(segment) && packageRootChildPositions.has(index))
  ))
}

function assertOwnedPath(target, root) {
  if (target === root || !target.startsWith(`${root}${sep}`)) {
    throw new Error(`Runtime pruning path leaves its owned root: ${target}`)
  }
}
