import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

if (process.platform !== 'darwin') throw new Error('macOS release verification must run on macOS')

const repositoryRoot = resolve(import.meta.dirname, '..')
const manifest = JSON.parse(readFileSync(join(repositoryRoot, 'package.json'), 'utf8'))
const releaseRoot = join(repositoryRoot, 'release')
const appBundle = join(releaseRoot, 'mac-arm64', 'DeepSeek Work.app')
const artifactBase = `DeepSeek-Work-${manifest.version}-macOS-arm64`
const dmg = join(releaseRoot, `${artifactBase}.dmg`)
const zip = join(releaseRoot, `${artifactBase}.zip`)
for (const target of [appBundle, dmg, zip]) {
  if (!existsSync(target)) throw new Error(`macOS release target is missing: ${target}`)
}

run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appBundle])
const signature = capture('codesign', ['--display', '--verbose=4', appBundle])
const requiresDeveloperId = process.env.REQUIRE_MACOS_DEVELOPER_ID === '1'
if (requiresDeveloperId) {
  if (!signature.includes('Authority=Developer ID Application:')) {
    throw new Error('macOS release is not signed with a Developer ID Application identity')
  }
  const teamId = process.env.APPLE_TEAM_ID?.trim()
  if (!teamId || !signature.includes(`TeamIdentifier=${teamId}`)) {
    throw new Error('macOS release TeamIdentifier does not match APPLE_TEAM_ID')
  }
  run('xcrun', ['stapler', 'validate', appBundle])
  run('spctl', ['--assess', '--type', 'execute', '--verbose=2', appBundle])
} else if (!signature.includes('Signature=adhoc')) {
  throw new Error('macOS preview must carry an explicit ad-hoc signature')
}
run('hdiutil', ['verify', dmg])
run('unzip', ['-t', zip])
console.log(`${requiresDeveloperId ? 'Developer ID' : 'Ad-hoc'} macOS signature and release archives verified.`)

function run(command, args) {
  execFileSync(command, args, { cwd: repositoryRoot, stdio: 'inherit' })
}

function capture(command, args) {
  const result = spawnSync(command, args, { cwd: repositoryRoot, encoding: 'utf8' })
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
  if (result.status !== 0) throw new Error(`Unable to inspect macOS signature: ${output}`)
  return output
}
