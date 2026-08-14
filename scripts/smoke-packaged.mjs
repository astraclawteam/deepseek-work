import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createConnection } from 'node:net'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'

const repositoryRoot = resolve(import.meta.dirname, '..')
const executable = join(repositoryRoot, 'release', 'win-unpacked', 'DeepSeek Work.exe')
if (!existsSync(executable)) throw new Error(`Packaged executable is missing: ${executable}`)

const smokeRoot = mkdtempSync(join(tmpdir(), 'deepseek-work-smoke-'))
const receiptPath = join(smokeRoot, 'receipt.json')
try {
  const result = await runPackagedSmoke(executable, smokeRoot, receiptPath)
  if (result.code !== 0) {
    throw new Error(`Packaged smoke exited with ${String(result.code)}.\n${result.stderr}`)
  }
  if (!existsSync(receiptPath)) throw new Error('Packaged smoke produced no receipt.')
  const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'))
  if (receipt.loaded !== true || typeof receipt.url !== 'string') {
    throw new Error(`Packaged smoke did not load the Harness UI: ${JSON.stringify(receipt)}`)
  }
  const url = new URL(receipt.url)
  if (await canConnect(url.hostname, Number(url.port))) {
    throw new Error(`Harness port remained reachable after packaged exit: ${url.origin}`)
  }
  console.log(`Packaged DeepSeek Work loaded ${url.origin} and released its Harness port on exit.`)
} finally {
  if (!basename(smokeRoot).startsWith('deepseek-work-smoke-')) throw new Error(`Unexpected smoke directory: ${smokeRoot}`)
  rmSync(smokeRoot, { force: true, recursive: true })
}

function runPackagedSmoke(command, userData, receipt) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, ['--smoke'], {
      env: {
        ...process.env,
        DEEPSEEK_WORK_SMOKE_RECEIPT: receipt,
        DEEPSEEK_WORK_SMOKE_USER_DATA: userData,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    let stderr = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', chunk => { stderr = `${stderr}${chunk}`.slice(-16_384) })
    const timeout = setTimeout(() => {
      if (child.pid !== undefined) spawnSync('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' })
      rejectRun(new Error('Packaged smoke exceeded 180 seconds.'))
    }, 180_000)
    child.once('error', error => {
      clearTimeout(timeout)
      rejectRun(error)
    })
    child.once('exit', code => {
      clearTimeout(timeout)
      resolveRun({ code, stderr })
    })
  })
}

function canConnect(host, port) {
  return new Promise(resolveConnect => {
    const socket = createConnection({ host, port })
    const finish = value => {
      socket.destroy()
      resolveConnect(value)
    }
    socket.setTimeout(1_000)
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
    socket.once('timeout', () => finish(false))
  })
}
