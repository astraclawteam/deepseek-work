import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { request } from 'node:http'
import { isAbsolute, join, resolve, sep } from 'node:path'

const HARNESS_PACKAGE_NAME = '@deepseek-ai/dsh-root'
const DEFAULT_STARTUP_TIMEOUT_MS = 120_000
const HTTP_PROBE_TIMEOUT_MS = 10_000
const OUTPUT_BUFFER_LIMIT = 64 * 1024

export interface HarnessLocatorOptions {
  appPath: string
  explicitRoot?: string
  isPackaged: boolean
  resourcesPath: string
}

export interface HarnessSupervisorOptions {
  dataRoot: string
  entryScript?: string
  harnessRoot: string
  logger?: (source: 'stdout' | 'stderr', text: string) => void
  nodeExecutable: string
  onUnexpectedExit?: (description: string) => void
  platform?: NodeJS.Platform
  sourceLaunch?: boolean
  startupTimeoutMs?: number
}

interface HarnessPackageJson {
  name?: unknown
}

interface DesktopRuntimeManifest {
  entry?: unknown
  schemaVersion?: unknown
  upstreamPackage?: unknown
}

export interface HarnessEntrypoint {
  entryScript: string
  sourceLaunch: boolean
}

/** Parse the Harness URL line even when stdout splits it across chunks. */
export class HarnessReadyParser {
  private output = ''

  push(chunk: string): URL | undefined {
    this.output = `${this.output}${chunk}`.slice(-OUTPUT_BUFFER_LIMIT)
    const match = /dsh web:\s+(http:\/\/127\.0\.0\.1:\d+)/u.exec(this.output)
    if (match?.[1] === undefined) return undefined

    const url = new URL(match[1])
    if (url.hostname !== '127.0.0.1' || url.port === '0') return undefined
    return url
  }
}

/** Locate either an explicitly configured, bundled, or adjacent Harness checkout. */
export function locateHarnessRoot(options: HarnessLocatorOptions): string {
  if (options.explicitRoot !== undefined && options.explicitRoot.trim() !== '') {
    const configuredRoot = resolve(options.explicitRoot)
    assertHarnessRoot(configuredRoot, 'DEEPSEEK_HARNESS_ROOT')
    return configuredRoot
  }

  const candidates = options.isPackaged
    ? [join(options.resourcesPath, 'harness')]
    : [resolve(options.appPath, '..', 'deepseek-harness')]

  for (const candidate of candidates) {
    if (isHarnessRoot(candidate)) return candidate
  }

  throw new Error(
    `DeepSeek Harness was not found. Set DEEPSEEK_HARNESS_ROOT or place its checkout at ${candidates.join(', ')}.`,
  )
}

/** Resolve the source CLI or the prebuilt CLI carried by a desktop package. */
export function resolveHarnessEntrypoint(harnessRoot: string): HarnessEntrypoint {
  const runtimeManifestPath = join(harnessRoot, 'desktop-runtime.json')
  if (!existsSync(runtimeManifestPath)) {
    const sourceEntry = join(harnessRoot, 'apps', 'cli', 'src', 'bin.ts')
    if (!existsSync(sourceEntry)) throw new Error(`Harness source entry is missing: ${sourceEntry}`)
    return { entryScript: sourceEntry, sourceLaunch: true }
  }

  const manifest = readDesktopRuntimeManifest(runtimeManifestPath)
  const entryScript = resolve(harnessRoot, ...manifest.entry.split('/'))
  if (!entryScript.startsWith(`${resolve(harnessRoot)}${sep}`) || !existsSync(entryScript)) {
    throw new Error(`Packaged Harness entry is missing or leaves its runtime root: ${manifest.entry}`)
  }
  return { entryScript, sourceLaunch: false }
}

export function resolveHarnessNode(
  explicitNode: string | undefined,
  isPackaged: boolean,
  resourcesPath: string,
  platform: NodeJS.Platform = process.platform,
): string {
  if (explicitNode !== undefined && explicitNode.trim() !== '') return explicitNode
  if (!isPackaged) return 'node'
  return join(resourcesPath, 'runtime', platform === 'win32' ? 'node.exe' : 'node')
}

export class HarnessSupervisor {
  private child: ChildProcess | undefined
  private stopping = false

  constructor(private readonly options: HarnessSupervisorOptions) {}

  async start(): Promise<URL> {
    if (this.child !== undefined) throw new Error('DeepSeek Harness is already running.')

    mkdirSync(this.options.dataRoot, { recursive: true })
    const platform = this.options.platform ?? process.platform
    const entry = this.options.entryScript ?? join(this.options.harnessRoot, 'apps', 'cli', 'src', 'bin.ts')
    const launchArguments = this.options.sourceLaunch === false
      ? [entry, 'web', '--host', '127.0.0.1', '--port', '0']
      : ['--import', 'tsx/esm', entry, 'web', '--host', '127.0.0.1', '--port', '0']
    const child = spawn(
      this.options.nodeExecutable,
      launchArguments,
      {
        cwd: this.options.harnessRoot,
        detached: platform !== 'win32',
        env: {
          ...process.env,
          DSH_HOME: this.options.dataRoot,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      },
    )
    this.child = child

    try {
      const url = await this.waitForReady(child)
      await probeHttp(url, HTTP_PROBE_TIMEOUT_MS)
      return url
    } catch (error) {
      await this.stop()
      throw error
    }
  }

  async stop(): Promise<void> {
    this.stopping = true
    const child = this.child
    this.child = undefined
    if (child?.pid === undefined || child.exitCode !== null) return

    await terminateProcessTree(child, this.options.platform ?? process.platform)
  }

  private waitForReady(child: ChildProcess): Promise<URL> {
    const parser = new HarnessReadyParser()
    const timeoutMs = this.options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS

    return new Promise<URL>((resolveReady, rejectReady) => {
      let ready = false
      const timeout = setTimeout(() => {
        rejectOnce(new Error(`DeepSeek Harness did not become ready within ${String(timeoutMs)} ms.`))
      }, timeoutMs)

      const rejectOnce = (error: Error): void => {
        if (ready) return
        ready = true
        clearTimeout(timeout)
        rejectReady(error)
      }

      child.stdout?.setEncoding('utf8')
      child.stderr?.setEncoding('utf8')

      child.stdout?.on('data', (chunk: string) => {
        this.options.logger?.('stdout', chunk)
        if (ready) return
        const url = parser.push(chunk)
        if (url === undefined) return
        ready = true
        clearTimeout(timeout)
        resolveReady(url)
      })
      child.stderr?.on('data', (chunk: string) => {
        this.options.logger?.('stderr', chunk)
      })
      child.once('error', (error) => {
        rejectOnce(new Error(`Unable to start DeepSeek Harness: ${error.message}`, { cause: error }))
      })
      child.once('exit', (code, signal) => {
        this.child = undefined
        const description = `DeepSeek Harness exited (code=${String(code)}, signal=${String(signal)}).`
        if (!ready) rejectOnce(new Error(description))
        else if (!this.stopping) this.options.onUnexpectedExit?.(description)
      })
    })
  }
}

function isHarnessRoot(candidate: string): boolean {
  if (!existsSync(join(candidate, 'package.json'))) return false
  try {
    const manifest = JSON.parse(readFileSync(join(candidate, 'package.json'), 'utf8')) as HarnessPackageJson
    if (manifest.name === HARNESS_PACKAGE_NAME) return true
    const runtimeManifest = join(candidate, 'desktop-runtime.json')
    if (!existsSync(runtimeManifest)) return false
    readDesktopRuntimeManifest(runtimeManifest)
    return true
  } catch {
    return false
  }
}

function readDesktopRuntimeManifest(file: string): { entry: string } {
  const manifest = JSON.parse(readFileSync(file, 'utf8')) as DesktopRuntimeManifest
  if (manifest.schemaVersion !== 1 || manifest.upstreamPackage !== '@deepseek-ai/dsh') {
    throw new Error(`Unsupported packaged Harness manifest: ${file}`)
  }
  if (typeof manifest.entry !== 'string' || manifest.entry === '' || isAbsolute(manifest.entry)) {
    throw new Error(`Invalid packaged Harness entry in ${file}`)
  }
  const segments = manifest.entry.split('/')
  if (segments.some(segment => segment === '' || segment === '.' || segment === '..')) {
    throw new Error(`Invalid packaged Harness entry in ${file}`)
  }
  return { entry: manifest.entry }
}

function assertHarnessRoot(candidate: string, source: string): void {
  if (!isHarnessRoot(candidate)) {
    throw new Error(`${source} does not point to a ${HARNESS_PACKAGE_NAME} checkout: ${candidate}`)
  }
}

async function probeHttp(url: URL, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let lastError: Error | undefined

  while (Date.now() < deadline) {
    try {
      await requestOnce(url)
      return
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      await delay(100)
    }
  }

  throw new Error(`DeepSeek Harness announced ${url.href} but its Web UI did not answer.`, { cause: lastError })
}

function requestOnce(url: URL): Promise<void> {
  return new Promise<void>((resolveRequest, rejectRequest) => {
    const outgoing = request(url, { method: 'GET', timeout: 2_000 }, (response) => {
      response.resume()
      const statusCode = response.statusCode ?? 0
      if (statusCode >= 200 && statusCode < 400) resolveRequest()
      else rejectRequest(new Error(`HTTP ${String(statusCode)}`))
    })
    outgoing.once('timeout', () => outgoing.destroy(new Error('HTTP probe timed out.')))
    outgoing.once('error', rejectRequest)
    outgoing.end()
  })
}

async function terminateProcessTree(child: ChildProcess, platform: NodeJS.Platform): Promise<void> {
  const pid = child.pid
  if (pid === undefined || child.exitCode !== null) return

  if (platform === 'win32') {
    await runProcess('taskkill.exe', ['/pid', String(pid), '/t', '/f'])
    await waitForExit(child, 5_000)
    return
  }

  try {
    process.kill(-pid, 'SIGTERM')
  } catch {
    return
  }
  if (await waitForExit(child, 5_000)) return
  try {
    process.kill(-pid, 'SIGKILL')
  } catch {
    return
  }
  await waitForExit(child, 2_000)
}

function runProcess(command: string, args: string[]): Promise<void> {
  return new Promise<void>((resolveProcess) => {
    const child = spawn(command, args, { stdio: 'ignore', windowsHide: true })
    child.once('error', () => resolveProcess())
    child.once('exit', () => resolveProcess())
  })
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null) return Promise.resolve(true)
  return new Promise<boolean>((resolveExit) => {
    const timeout = setTimeout(() => {
      child.removeListener('exit', onExit)
      resolveExit(false)
    }, timeoutMs)
    const onExit = (): void => {
      clearTimeout(timeout)
      resolveExit(true)
    }
    child.once('exit', onExit)
  })
}

function delay(milliseconds: number): Promise<void> {
  return new Promise(resolveDelay => setTimeout(resolveDelay, milliseconds))
}
