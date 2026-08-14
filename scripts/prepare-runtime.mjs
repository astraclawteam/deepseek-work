import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import extractZip from 'extract-zip'
import * as tar from 'tar'
import { pruneRuntimeTree, RUNTIME_PRUNING_POLICY_VERSION } from './runtime-pruning-policy.mjs'

const repositoryRoot = resolve(import.meta.dirname, '..')
const lock = readJson(join(repositoryRoot, 'runtime-lock.json'))
const cacheRoot = join(repositoryRoot, '.release-cache')
const runtimeCacheRoot = join(cacheRoot, 'runtime-v1')
const downloadRoot = join(cacheRoot, 'downloads')
const npmCacheRoot = join(cacheRoot, 'npm')
const destinationRoot = join(repositoryRoot, 'build', 'runtime')
const harnessRoot = resolve(process.env.DEEPSEEK_HARNESS_ROOT || join(repositoryRoot, '..', 'deepseek-harness'))

assertRuntimeLock(lock)
const harnessManifest = readJson(join(harnessRoot, 'package.json'))
if (harnessManifest.name !== lock.harness.packageName) {
  throw new Error(`Harness package mismatch at ${harnessRoot}`)
}
if (harnessManifest.version !== lock.harness.packageVersion) {
  throw new Error(`Harness version ${String(harnessManifest.version)} does not match runtime-lock.json ${lock.harness.packageVersion}`)
}

const harnessCommit = capture('git', ['rev-parse', 'HEAD'], harnessRoot)
if (harnessCommit !== lock.harness.commit) {
  throw new Error(`Harness HEAD ${harnessCommit} does not match runtime-lock.json ${lock.harness.commit}`)
}
const harnessStatus = capture('git', ['status', '--porcelain'], harnessRoot)
if (harnessStatus !== '') {
  throw new Error('Refusing to package a dirty DeepSeek Harness checkout. Preserve or commit its changes first.')
}

const input = {
  schemaVersion: 1,
  target: lock.target,
  harness: {
    commit: lock.harness.commit,
    packageVersion: lock.harness.packageVersion,
  },
  node: {
    version: lock.node.version,
    archive: lock.node.archive,
    sha256: lock.node.sha256,
  },
  pruning: {
    policyVersion: RUNTIME_PRUNING_POLICY_VERSION,
    target: lock.target,
  },
}
const cacheKey = sha256(Buffer.from(JSON.stringify(input)))
const cacheEntry = join(runtimeCacheRoot, cacheKey)

mkdirSync(runtimeCacheRoot, { recursive: true })
mkdirSync(downloadRoot, { recursive: true })
mkdirSync(npmCacheRoot, { recursive: true })

if (existsSync(cacheEntry)) {
  verifyCacheEntry(cacheEntry, input)
  materialize(join(cacheEntry, 'payload'))
  console.log(`Reused verified desktop runtime cache ${cacheKey.slice(0, 12)}.`)
} else {
  const workRoot = join(cacheRoot, `work-${randomUUID()}`)
  const candidateRoot = join(runtimeCacheRoot, `.candidate-${randomUUID()}`)
  try {
    await buildCandidate(workRoot, candidateRoot, input)
    renameSync(candidateRoot, cacheEntry)
  } finally {
    removeOwnedDirectory(workRoot, cacheRoot)
    removeOwnedDirectory(candidateRoot, runtimeCacheRoot)
  }
  verifyCacheEntry(cacheEntry, input)
  materialize(join(cacheEntry, 'payload'))
  console.log(`Built and cached desktop runtime ${cacheKey.slice(0, 12)}.`)
}

async function buildCandidate(workRoot, candidateRoot, cacheInput) {
  const vendorTarballs = join(workRoot, 'vendor')
  const dshTarballs = join(workRoot, 'dsh')
  const payloadRoot = join(candidateRoot, 'payload')
  const installedHarness = join(payloadRoot, 'harness')
  const installedNode = join(payloadRoot, 'node')
  mkdirSync(vendorTarballs, { recursive: true })
  mkdirSync(dshTarballs, { recursive: true })
  mkdirSync(installedHarness, { recursive: true })
  mkdirSync(installedNode, { recursive: true })

  console.log(`Building DeepSeek Harness ${lock.harness.packageVersion} at ${lock.harness.commit.slice(0, 12)}.`)
  runCommand('pnpm', ['run', 'build'], harnessRoot)
  const packRunner = join(repositoryRoot, 'scripts', 'run-harness-release-pack.mjs')
  const packScript = join(harnessRoot, 'scripts', 'release', 'pack.ts')
  runCommand('pnpm', ['exec', 'tsx', packRunner, packScript, '--family', 'vendor', '--out', vendorTarballs], harnessRoot)
  runCommand('pnpm', ['exec', 'tsx', packRunner, packScript, '--family', 'dsh', '--out', dshTarballs], harnessRoot)

  const tarballs = [vendorTarballs, dshTarballs]
    .flatMap(directory => readdirSync(directory)
      .filter(filename => filename.endsWith('.tgz'))
      .map(filename => join(directory, filename)))
    .sort()
  if (tarballs.length === 0) throw new Error('DeepSeek Harness release packing produced no tarballs.')

  const packed = await Promise.all(tarballs.map(async file => ({ file, manifest: await packedManifest(file) })))
  const packageByName = new Map()
  for (const item of packed) {
    if (packageByName.has(item.manifest.name)) {
      throw new Error(`Duplicate packed package ${item.manifest.name}`)
    }
    packageByName.set(item.manifest.name, item)
  }
  const runtimePackageNames = collectRuntimePackageNames(packageByName, '@deepseek-ai/dsh')
  const dependencies = {}
  for (const packageName of runtimePackageNames) {
    dependencies[packageName] = pathToFileURL(packageByName.get(packageName).file).href
  }
  console.log(`Installing ${String(runtimePackageNames.length)} runtime packages from ${String(packed.length)} release tarballs.`)

  await stageNode(installedNode, workRoot)
  const stagedVersion = capture(join(installedNode, 'node.exe'), ['--version'], installedNode)
  if (stagedVersion !== `v${lock.node.version}`) {
    throw new Error(`Staged Node reported ${stagedVersion}, expected v${lock.node.version}`)
  }

  writeJson(join(installedHarness, 'package.json'), {
    name: 'deepseek-work-harness-runtime-install',
    version: lock.harness.packageVersion,
    private: true,
    dependencies,
  })
  runCommand('npm', [
    'install',
    '--no-audit',
    '--no-fund',
    '--package-lock=false',
    '--omit=dev',
    '--prefer-offline',
  ], installedHarness, {
    npm_config_cache: npmCacheRoot,
    [environmentPathKey()]: sanitizedBuildPath(installedNode),
  })

  const pruningReport = pruneRuntimeTree(installedHarness, lock.target)
  console.log(
    `Pruned ${String(pruningReport.removed.files)} files (${formatBytes(pruningReport.removed.bytes)}); `
    + `${String(pruningReport.after.files)} runtime files remain.`,
  )

  const entry = 'node_modules/@deepseek-ai/dsh/lib/bin.js'
  if (!existsSync(join(installedHarness, ...entry.split('/')))) {
    throw new Error(`Packed Harness entry is missing: ${entry}`)
  }
  writeJson(join(installedHarness, 'package.json'), {
    name: 'deepseek-work-harness-runtime',
    version: lock.harness.packageVersion,
    private: true,
    type: 'module',
  })
  writeJson(join(installedHarness, 'desktop-runtime.json'), {
    schemaVersion: 1,
    upstreamPackage: '@deepseek-ai/dsh',
    upstreamVersion: lock.harness.packageVersion,
    upstreamCommit: lock.harness.commit,
    entry,
  })
  cpSync(join(harnessRoot, 'LICENSE'), join(installedHarness, 'LICENSE.deepseek-harness'))
  validateStagedHarness(installedHarness, installedNode, entry)

  writeJson(join(payloadRoot, 'runtime-manifest.json'), {
    ...cacheInput,
    harnessEntry: `harness/${entry}`,
  })
  writeJson(join(payloadRoot, 'runtime-pruning.json'), pruningReport)
  const files = collectFiles(payloadRoot).map(file => ({
    path: file.relativePath,
    size: file.size,
    sha256: hashFile(file.absolutePath),
  }))
  writeJson(join(candidateRoot, 'receipt.json'), { input: cacheInput, files })
}

async function stageNode(installedNode, workRoot) {
  const archivePath = join(downloadRoot, lock.node.archive)
  if (existsSync(archivePath)) {
    assertDigest(archivePath, lock.node.sha256)
  } else {
    console.log(`Downloading pinned Node.js ${lock.node.version} runtime.`)
    const response = await fetch(lock.node.url)
    if (!response.ok) throw new Error(`Node.js download failed with HTTP ${response.status}`)
    writeFileSync(archivePath, Buffer.from(await response.arrayBuffer()))
    assertDigest(archivePath, lock.node.sha256)
  }

  const extractionRoot = join(workRoot, 'node-extracted')
  mkdirSync(extractionRoot, { recursive: true })
  await extractZip(archivePath, { dir: extractionRoot })
  const archiveDirectory = lock.node.archive.replace(/\.zip$/u, '')
  const extracted = join(extractionRoot, archiveDirectory)
  for (const filename of ['node.exe', 'LICENSE']) {
    const source = join(extracted, filename)
    if (!existsSync(source)) throw new Error(`Node.js archive is missing ${filename}`)
    cpSync(source, join(installedNode, filename))
  }
}

function verifyCacheEntry(entryRoot, expectedInput) {
  const payloadRoot = join(entryRoot, 'payload')
  const receipt = readJson(join(entryRoot, 'receipt.json'))
  if (JSON.stringify(receipt.input) !== JSON.stringify(expectedInput)) {
    throw new Error(`Desktop runtime cache input mismatch at ${entryRoot}`)
  }
  const actualFiles = collectFiles(payloadRoot)
  if (!Array.isArray(receipt.files) || receipt.files.length !== actualFiles.length) {
    throw new Error(`Desktop runtime cache inventory mismatch at ${entryRoot}`)
  }
  const expectedFiles = new Map(receipt.files.map(file => [file.path, file]))
  for (const file of actualFiles) {
    const expected = expectedFiles.get(file.relativePath)
    if (expected === undefined || expected.size !== file.size || expected.sha256 !== hashFile(file.absolutePath)) {
      throw new Error(`Desktop runtime cache verification failed for ${file.relativePath}`)
    }
  }
}

function materialize(sourceRoot) {
  const buildRoot = dirname(destinationRoot)
  const nextRoot = join(buildRoot, `.runtime-${randomUUID()}`)
  mkdirSync(buildRoot, { recursive: true })
  cpSync(sourceRoot, nextRoot, { recursive: true })

  if (existsSync(destinationRoot)) {
    const marker = join(destinationRoot, 'runtime-manifest.json')
    if (!existsSync(marker)) {
      throw new Error(`Refusing to replace an unrecognized directory: ${destinationRoot}`)
    }
    removeOwnedDirectory(destinationRoot, buildRoot)
  }
  renameSync(nextRoot, destinationRoot)
}

function collectFiles(root) {
  if (!existsSync(root)) throw new Error(`Runtime tree is missing: ${root}`)
  const files = []
  const visit = current => {
    const entries = readdirSync(current, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name))
    for (const entry of entries) {
      const absolutePath = join(current, entry.name)
      const stat = lstatSync(absolutePath)
      if (stat.isSymbolicLink()) throw new Error(`Runtime tree contains a symbolic link: ${absolutePath}`)
      if (stat.isDirectory()) visit(absolutePath)
      else if (stat.isFile()) {
        files.push({
          absolutePath,
          relativePath: relative(root, absolutePath).split(sep).join('/'),
          size: stat.size,
        })
      } else throw new Error(`Runtime tree contains an unsupported entry: ${absolutePath}`)
    }
  }
  visit(root)
  return files
}

async function packedManifest(tarball) {
  let manifest = ''
  await tar.t({
    file: tarball,
    onentry(entry) {
      if (entry.path === 'package/package.json') {
        const chunks = []
        entry.on('data', chunk => { chunks.push(Buffer.from(chunk)) })
        entry.on('end', () => { manifest = Buffer.concat(chunks).toString('utf8') })
      } else entry.resume()
    },
  })
  const parsed = JSON.parse(manifest)
  if (typeof parsed.name !== 'string' || typeof parsed.version !== 'string') {
    throw new Error(`Packed package identity is invalid: ${tarball}`)
  }
  return parsed
}

function collectRuntimePackageNames(packageByName, rootPackageName) {
  const included = new Set()
  const pending = [rootPackageName]
  while (pending.length > 0) {
    const packageName = pending.pop()
    if (included.has(packageName)) continue
    const item = packageByName.get(packageName)
    if (item === undefined) throw new Error(`Packed runtime root is missing: ${packageName}`)
    included.add(packageName)

    const manifest = item.manifest
    const dependencyNames = [
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.peerDependencies ?? {})
        .filter(name => manifest.peerDependenciesMeta?.[name]?.optional !== true),
    ]
    for (const dependencyName of dependencyNames) {
      if (packageByName.has(dependencyName) && !included.has(dependencyName)) pending.push(dependencyName)
    }
  }
  return [...included].sort()
}

function validateStagedHarness(installedHarness, installedNode, entry) {
  const nodeExecutable = join(installedNode, 'node.exe')
  const reportedVersion = capture(nodeExecutable, [join(installedHarness, ...entry.split('/')), '--version'], installedHarness)
  if (reportedVersion !== lock.harness.packageVersion) {
    throw new Error(`Pruned Harness reported ${reportedVersion}, expected ${lock.harness.packageVersion}`)
  }

  const nativeProbe = [
    "const sharp = require('sharp')",
    "const pty = require('node-pty')",
    "const koffi = require('koffi')",
    "if (!sharp.versions?.vips || typeof pty.spawn !== 'function' || typeof koffi.load !== 'function') process.exit(4)",
    "const child = pty.spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'exit 0'], { name: 'xterm-color', cols: 80, rows: 24, cwd: process.cwd(), env: process.env, useConpty: true })",
    "const timer = setTimeout(() => { child.kill(); process.exit(2) }, 10000)",
    "child.onExit(event => { clearTimeout(timer); process.exit(event.exitCode === 0 ? 0 : 3) })",
  ].join('; ')
  runCommand(nodeExecutable, ['-e', nativeProbe], installedHarness)
}

function assertRuntimeLock(value) {
  if (value?.schemaVersion !== 1 || value.target !== 'win32-x64') throw new Error('Unsupported runtime-lock.json')
  if (!/^[0-9a-f]{40}$/u.test(value.harness?.commit ?? '')) throw new Error('Invalid Harness commit in runtime-lock.json')
  if (!/^[0-9a-f]{64}$/u.test(value.node?.sha256 ?? '')) throw new Error('Invalid Node.js digest in runtime-lock.json')
  if (typeof value.node?.url !== 'string' || !value.node.url.startsWith('https://nodejs.org/dist/')) {
    throw new Error('Node.js runtime must come from the official HTTPS distribution origin')
  }
}

function assertDigest(file, expected) {
  const actual = hashFile(file)
  if (actual !== expected) throw new Error(`SHA-256 mismatch for ${basename(file)}: ${actual}`)
}

function hashFile(file) {
  return sha256(readFileSync(file))
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function formatBytes(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`
}

function capture(command, args, cwd) {
  return execFileSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    windowsHide: true,
  }).trim()
}

function runCommand(command, args, cwd, extraEnvironment = {}) {
  const environment = childEnvironment(extraEnvironment)
  if (process.platform === 'win32' && (command === 'pnpm' || command === 'npm')) {
    const commandLine = [`${command}.cmd`, ...args.map(quoteCommandToken)].join(' ')
    execFileSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', commandLine], {
      cwd,
      env: environment,
      stdio: 'inherit',
      windowsHide: true,
    })
    return
  }
  execFileSync(command, args, { cwd, env: environment, stdio: 'inherit', windowsHide: true })
}

function childEnvironment(extraEnvironment) {
  const environment = { ...process.env, ...extraEnvironment }
  const configuredPathValues = Object.entries(extraEnvironment)
    .filter(([key]) => key.toLowerCase() === 'path')
    .flatMap(([, value]) => String(value ?? '').split(';'))
  const inheritedPathValues = Object.entries(process.env)
    .filter(([key]) => key.toLowerCase() === 'path')
    .flatMap(([, value]) => String(value ?? '').split(';'))
  for (const key of Object.keys(environment)) {
    if (key.toLowerCase() === 'path') delete environment[key]
  }
  environment.Path = deduplicatePathValues([
    ...configuredPathValues,
    dirname(process.execPath),
    ...inheritedPathValues,
  ])
  return environment
}

function deduplicatePathValues(values) {
  const seen = new Set()
  return values
    .map(value => value.trim())
    .filter(Boolean)
    .filter(value => {
      const identity = value.toLowerCase()
      if (seen.has(identity)) return false
      seen.add(identity)
      return true
    })
    .join(';')
}

function quoteCommandToken(value) {
  const token = String(value)
  if (/^[A-Za-z0-9_./:@=+\\-]+$/u.test(token)) return token
  return `"${token.replaceAll('"', '""')}"`
}

function environmentPathKey() {
  return Object.keys(process.env).find(key => key.toLowerCase() === 'path') ?? 'Path'
}

function sanitizedBuildPath(stagedNode) {
  const pathValue = process.env[environmentPathKey()] ?? ''
  const candidates = [
    stagedNode,
    dirname(process.execPath),
    join(process.env.SystemRoot || 'C:\\Windows', 'System32'),
    ...pathValue.split(';'),
  ]
  const seen = new Set()
  return candidates
    .map(value => value.trim())
    .filter(value => value !== '' && value.toUpperCase() !== '%PATH%')
    .filter(value => {
      const identity = value.toLowerCase()
      if (seen.has(identity)) return false
      seen.add(identity)
      return true
    })
    .join(';')
}

function removeOwnedDirectory(target, ownerRoot) {
  if (!existsSync(target)) return
  const resolvedTarget = resolve(target)
  const resolvedOwner = resolve(ownerRoot)
  if (resolvedTarget === resolvedOwner || !resolvedTarget.startsWith(`${resolvedOwner}${sep}`)) {
    throw new Error(`Refusing to remove a path outside ${resolvedOwner}: ${resolvedTarget}`)
  }
  rmSync(resolvedTarget, { recursive: true, force: true })
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'))
}

function writeJson(file, value) {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}
