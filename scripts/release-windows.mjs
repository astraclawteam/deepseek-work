import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'

const repositoryRoot = resolve(import.meta.dirname, '..')
const nodeExecutable = process.execPath
const environment = environmentWithCurrentNode(process.env)

const stages = [
  ['prepare desktop runtime', join(repositoryRoot, 'scripts', 'prepare-runtime.mjs'), []],
  ['generate desktop assets', join(repositoryRoot, 'scripts', 'generate-assets.mjs'), []],
  ['compile desktop TypeScript', join(repositoryRoot, 'node_modules', 'typescript', 'bin', 'tsc'), ['-p', 'tsconfig.json']],
  [
    'build signed NSIS package',
    join(repositoryRoot, 'node_modules', 'electron-builder', 'out', 'cli', 'cli.js'),
    ['--win', 'nsis', '--x64'],
  ],
  ['verify Authenticode signatures', join(repositoryRoot, 'scripts', 'verify-signatures.mjs'), []],
  ['smoke packaged application', join(repositoryRoot, 'scripts', 'smoke-packaged.mjs'), []],
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

function environmentWithCurrentNode(source) {
  const environment = { ...source }
  const pathValues = Object.entries(environment)
    .filter(([key]) => key.toLowerCase() === 'path')
    .flatMap(([, value]) => String(value ?? '').split(';'))
  for (const key of Object.keys(environment)) {
    if (key.toLowerCase() === 'path') delete environment[key]
  }
  environment.Path = deduplicatePaths([dirname(nodeExecutable), ...pathValues])
  return environment
}

function deduplicatePaths(values) {
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
