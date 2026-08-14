import { execFileSync } from 'node:child_process'
import { delimiter, dirname, join, resolve } from 'node:path'
import { releaseCacheRoot, resolveElectronDistribution } from './electron-distribution.mjs'
import { assertHostMatchesTarget, readRuntimeConfiguration } from './runtime-target.mjs'

const repositoryRoot = resolve(import.meta.dirname, '..')
const requestedTarget = readTargetArgument(process.argv.slice(2))
const runtime = readRuntimeConfiguration(repositoryRoot, requestedTarget)
assertHostMatchesTarget(runtime.targetName)

const nodeExecutable = process.execPath
const environment = environmentWithCurrentNode(process.env)
environment.DEEPSEEK_WORK_TARGET = runtime.targetName
const electronDistribution = await resolveElectronDistribution({
  repositoryRoot,
  cacheRoot: releaseCacheRoot(repositoryRoot, environment),
  configuredDistribution: environment.DEEPSEEK_WORK_ELECTRON_DIST?.trim(),
  downloadMissing: true,
  electron: runtime.target.electron,
  localAppData: environment.LOCALAPPDATA,
  targetName: runtime.targetName,
})
console.log(`Using ${electronDistribution.source}: ${electronDistribution.path}`)

const platformStages = runtime.targetName === 'win32-x64'
  ? windowsStages(electronDistribution.path)
  : macOSStages(electronDistribution.path, environment)
const stages = [
  ['prepare desktop runtime', join(repositoryRoot, 'scripts', 'prepare-runtime.mjs'), []],
  ['generate desktop assets', join(repositoryRoot, 'scripts', 'generate-assets.mjs'), []],
  ['compile desktop TypeScript', join(repositoryRoot, 'node_modules', 'typescript', 'bin', 'tsc'), ['-p', 'tsconfig.json']],
  ...platformStages,
]

for (const [label, script, args] of stages) {
  console.log(`Release stage: ${label}.`)
  execFileSync(nodeExecutable, [script, ...args], {
    cwd: repositoryRoot,
    env: environment,
    stdio: 'inherit',
    windowsHide: true,
  })
}

function windowsStages(electronDistribution) {
  return [
    [
      'build signed NSIS package',
      join(repositoryRoot, 'node_modules', 'electron-builder', 'out', 'cli', 'cli.js'),
      ['--win', 'nsis', '--x64', '--publish', 'never', `--config.electronDist=${electronDistribution}`],
    ],
    ['verify Authenticode signatures', join(repositoryRoot, 'scripts', 'verify-signatures.mjs'), []],
    ['smoke packaged application', join(repositoryRoot, 'scripts', 'smoke-packaged.mjs'), []],
  ]
}

function macOSStages(electronDistribution, releaseEnvironment) {
  const hasDeveloperId = Boolean(releaseEnvironment.CSC_LINK?.trim())
  const signingArguments = hasDeveloperId
    ? ['--config.forceCodeSigning=true', '--config.mac.notarize=true']
    : ['--config.mac.identity=-', '--config.mac.notarize=false']
  console.log(hasDeveloperId
    ? 'macOS release requires Developer ID signing and notarization.'
    : 'macOS release uses an explicit ad-hoc signature because CSC_LINK is not configured.')
  return [
    [
      'build macOS Apple Silicon DMG and ZIP',
      join(repositoryRoot, 'node_modules', 'electron-builder', 'out', 'cli', 'cli.js'),
      [
        '--mac',
        'dmg',
        'zip',
        '--arm64',
        '--publish',
        'never',
        `--config.electronDist=${electronDistribution}`,
        ...signingArguments,
      ],
    ],
    ['verify macOS signature and archives', join(repositoryRoot, 'scripts', 'verify-macos-release.mjs'), []],
    ['smoke packaged application', join(repositoryRoot, 'scripts', 'smoke-packaged.mjs'), []],
  ]
}

function readTargetArgument(arguments_) {
  const index = arguments_.indexOf('--target')
  if (index === -1 || typeof arguments_[index + 1] !== 'string') throw new Error('release-desktop requires --target <target>')
  return arguments_[index + 1]
}

function environmentWithCurrentNode(source) {
  const environment = { ...source }
  const pathKey = Object.keys(environment).find(key => key.toLowerCase() === 'path')
    ?? (process.platform === 'win32' ? 'Path' : 'PATH')
  const pathValues = Object.entries(environment)
    .filter(([key]) => key.toLowerCase() === 'path')
    .flatMap(([, value]) => String(value ?? '').split(delimiter))
  for (const key of Object.keys(environment)) {
    if (key.toLowerCase() === 'path') delete environment[key]
  }
  environment[pathKey] = deduplicatePaths([dirname(nodeExecutable), ...pathValues])
  return environment
}

function deduplicatePaths(values) {
  const seen = new Set()
  return values
    .map(value => value.trim())
    .filter(Boolean)
    .filter(value => {
      const identity = process.platform === 'win32' ? value.toLowerCase() : value
      if (seen.has(identity)) return false
      seen.add(identity)
      return true
    })
    .join(delimiter)
}
