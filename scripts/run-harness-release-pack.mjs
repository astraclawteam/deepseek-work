import childProcess from 'node:child_process'
import { syncBuiltinESMExports } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const packScript = process.argv[2]
if (packScript === undefined) throw new Error('Harness release pack script path is required')

if (process.platform === 'win32') {
  const spawnSync = childProcess.spawnSync
  childProcess.spawnSync = (command, args = [], options = {}) => {
    if (command === 'pnpm') {
      const commandLine = ['pnpm.cmd', ...args.map(quoteCommandToken)].join(' ')
      return spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', commandLine], options)
    }
    if (command === 'tar') {
      return spawnSync(join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe'), args, options)
    }
    return spawnSync(command, args, options)
  }
  syncBuiltinESMExports()
}

process.argv = [process.argv[0], packScript, ...process.argv.slice(3)]
await import(pathToFileURL(packScript).href)

function quoteCommandToken(value) {
  const token = String(value)
  if (/^[A-Za-z0-9_./:@=+\\-]+$/u.test(token)) return token
  return `"${token.replaceAll('"', '""')}"`
}
