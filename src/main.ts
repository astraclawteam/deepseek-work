import { app, BrowserWindow, shell } from 'electron'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  HarnessSupervisor,
  locateHarnessRoot,
  resolveHarnessEntrypoint,
  resolveHarnessNode,
} from './harness.js'
import { StartupShell } from './splash.js'

const isSmokeRun = process.argv.includes('--smoke')
const smokeUserData = process.env.DEEPSEEK_WORK_SMOKE_USER_DATA
if (isSmokeRun && smokeUserData !== undefined) app.setPath('userData', smokeUserData)

const startupShell = new StartupShell(!isSmokeRun)
let harness: HarnessSupervisor | undefined
let harnessUrl: URL | undefined
let mainWindow: BrowserWindow | undefined
let startupInFlight = false
let shutdownComplete = false
let shutdownPromise: Promise<void> | undefined

app.setName('DeepSeek Work')

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow === undefined) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })

  app.on('before-quit', (event) => {
    if (shutdownComplete) return
    event.preventDefault()
    shutdownPromise ??= shutdownHarness().then(() => {
      startupShell.close()
      shutdownComplete = true
      app.quit()
    })
  })

  app.on('window-all-closed', () => app.quit())

  void app.whenReady().then(async () => {
    await startupShell.open(app.getVersion())
    startupShell.onAction((action) => {
      if (action === 'quit') app.quit()
      else if (!startupInFlight) void launchDesktop().catch(handleStartupFailure)
    })
    await launchDesktop()
  }).catch(handleStartupFailure)
}

async function launchDesktop(): Promise<void> {
  if (startupInFlight) return
  startupInFlight = true
  try {
    await startupShell.update({
      phase: 'verify',
      progress: 12,
      detail: '正在验证 DeepSeek Harness 和内置 Node.js 运行时。',
    })
    await shutdownHarness()

    const harnessRoot = locateHarnessRoot({
      appPath: app.getAppPath(),
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      ...(process.env.DEEPSEEK_HARNESS_ROOT === undefined
        ? {}
        : { explicitRoot: process.env.DEEPSEEK_HARNESS_ROOT }),
    })
    const entrypoint = resolveHarnessEntrypoint(harnessRoot)
    const nodeExecutable = resolveHarnessNode(
      process.env.DEEPSEEK_HARNESS_NODE,
      app.isPackaged,
      process.resourcesPath,
    )
    if (app.isPackaged && !existsSync(nodeExecutable)) {
      throw new Error('The packaged Node.js runtime is missing or incomplete.')
    }

    await startupShell.update({
      phase: 'prepare',
      progress: 34,
      detail: '正在准备本地工作目录，用户数据不会写入程序安装目录。',
    })
    await startupShell.update({
      phase: 'launch',
      progress: 56,
      detail: '正在启动 DeepSeek Harness，本地端口由系统安全分配。',
    })

    harness = new HarnessSupervisor({
      dataRoot: join(app.getPath('userData'), 'harness'),
      entryScript: entrypoint.entryScript,
      harnessRoot,
      logger: (source, text) => {
        const stream = source === 'stderr' ? process.stderr : process.stdout
        stream.write(`[harness] ${text}`)
      },
      nodeExecutable,
      sourceLaunch: entrypoint.sourceLaunch,
      onUnexpectedExit: (description) => {
        void handleRuntimeExit(description)
      },
    })

    harnessUrl = await harness.start()
    await startupShell.update({
      phase: 'connect',
      progress: 84,
      detail: 'Harness 已就绪，正在连接桌面工作台。',
    })

    mainWindow?.destroy()
    mainWindow = createWindow(harnessUrl)
    await mainWindow.loadURL(harnessUrl.href)
    await startupShell.update({
      phase: 'connect',
      progress: 100,
      detail: '工作台已就绪。',
    })

    writeSmokeReceipt({ loaded: true, url: harnessUrl.href })
    if (isSmokeRun) app.quit()
    else {
      mainWindow.show()
      startupShell.close()
    }
  } finally {
    startupInFlight = false
  }
}

function createWindow(url: URL): BrowserWindow {
  const allowedOrigin = url.origin
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: 'DeepSeek Work',
    icon: iconPath(),
    autoHideMenuBar: true,
    backgroundColor: '#f6f7fb',
    webPreferences: {
      allowRunningInsecureContent: false,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  })

  window.on('closed', () => {
    if (mainWindow === window) mainWindow = undefined
  })
  window.webContents.on('will-navigate', (event, targetUrl) => {
    if (!hasOrigin(targetUrl, allowedOrigin)) event.preventDefault()
  })
  window.webContents.on('will-redirect', (event, targetUrl) => {
    if (!hasOrigin(targetUrl, allowedOrigin)) event.preventDefault()
  })
  window.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    if (!hasOrigin(targetUrl, allowedOrigin)) void openExternal(targetUrl)
    return { action: 'deny' }
  })

  return window
}

function iconPath(): string {
  if (app.isPackaged) return join(process.resourcesPath, 'icons', process.platform === 'win32' ? 'icon.ico' : 'icon.png')
  return join(app.getAppPath(), 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png')
}

function hasOrigin(targetUrl: string, allowedOrigin: string): boolean {
  try {
    return new URL(targetUrl).origin === allowedOrigin
  } catch {
    return false
  }
}

async function openExternal(targetUrl: string): Promise<void> {
  try {
    const parsed = new URL(targetUrl)
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') await shell.openExternal(parsed.href)
  } catch {
    // Ignore malformed and non-Web targets from untrusted renderer content.
  }
}

async function handleRuntimeExit(description: string): Promise<void> {
  console.error(description)
  mainWindow?.destroy()
  mainWindow = undefined
  await startupShell.open(app.getVersion())
  await startupShell.update({
    phase: 'error',
    progress: 100,
    detail: 'DeepSeek Harness 已意外停止。',
    error: description,
  })
}

async function shutdownHarness(): Promise<void> {
  const runningHarness = harness
  harness = undefined
  harnessUrl = undefined
  await runningHarness?.stop()
}

async function handleStartupFailure(error: unknown): Promise<void> {
  const message = sanitizeError(error instanceof Error ? error.message : String(error))
  console.error(error)
  await shutdownHarness()
  writeSmokeReceipt({ loaded: false, error: message })
  if (isSmokeRun) {
    shutdownComplete = true
    app.exit(1)
    return
  }
  await startupShell.open(app.getVersion())
  await startupShell.update({
    phase: 'error',
    progress: 100,
    detail: '桌面工作台未能完成启动，可以重试或退出。',
    error: message,
  })
}

function sanitizeError(message: string): string {
  return message.replace(/[A-Za-z]:\\[^\s]+/gu, '…').slice(0, 240)
}

function writeSmokeReceipt(receipt: { error?: string; loaded: boolean; url?: string }): void {
  const output = process.env.DEEPSEEK_WORK_SMOKE_RECEIPT
  if (!isSmokeRun || output === undefined) return
  writeFileSync(output, `${JSON.stringify(receipt)}\n`, 'utf8')
}
