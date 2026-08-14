import { app, BrowserWindow, dialog, shell } from 'electron'
import { join } from 'node:path'
import {
  HarnessSupervisor,
  locateHarnessRoot,
  resolveHarnessNode,
} from './harness.js'

const isSmokeRun = process.argv.includes('--smoke')

let harness: HarnessSupervisor | undefined
let harnessUrl: URL | undefined
let mainWindow: BrowserWindow | undefined
let shutdownComplete = false
let shutdownPromise: Promise<void> | undefined

app.setName('DeepSeek Work')

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow === undefined) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  app.on('before-quit', (event) => {
    if (shutdownComplete) return
    event.preventDefault()
    shutdownPromise ??= shutdownHarness().then(() => {
      shutdownComplete = true
      app.quit()
    })
  })

  app.on('window-all-closed', () => app.quit())

  void app.whenReady().then(startDesktop).catch(handleStartupFailure)
}

async function startDesktop(): Promise<void> {
  const harnessRoot = locateHarnessRoot({
    appPath: app.getAppPath(),
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    ...(process.env.DEEPSEEK_HARNESS_ROOT === undefined
      ? {}
      : { explicitRoot: process.env.DEEPSEEK_HARNESS_ROOT }),
  })
  const nodeExecutable = resolveHarnessNode(
    process.env.DEEPSEEK_HARNESS_NODE,
    app.isPackaged,
    process.resourcesPath,
  )

  harness = new HarnessSupervisor({
    dataRoot: join(app.getPath('userData'), 'harness'),
    harnessRoot,
    logger: (source, text) => {
      const stream = source === 'stderr' ? process.stderr : process.stdout
      stream.write(`[harness] ${text}`)
    },
    nodeExecutable,
    onUnexpectedExit: (description) => {
      console.error(description)
      if (!isSmokeRun && app.isReady()) dialog.showErrorBox('DeepSeek Work', description)
      app.quit()
    },
  })

  harnessUrl = await harness.start()
  mainWindow = createWindow(harnessUrl)
  await mainWindow.loadURL(harnessUrl.href)

  if (isSmokeRun) {
    console.log(`deepseek-work smoke: loaded ${harnessUrl.href}`)
    app.quit()
  }
}

function createWindow(url: URL): BrowserWindow {
  const allowedOrigin = url.origin
  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: 'DeepSeek Work',
    backgroundColor: '#0b0d10',
    webPreferences: {
      allowRunningInsecureContent: false,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  })

  window.once('ready-to-show', () => {
    if (!isSmokeRun) window.show()
  })
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = undefined
  })

  window.webContents.on('will-navigate', (event, targetUrl) => {
    if (hasOrigin(targetUrl, allowedOrigin)) return
    event.preventDefault()
    void openExternal(targetUrl)
  })
  window.webContents.on('will-redirect', (event, targetUrl) => {
    if (hasOrigin(targetUrl, allowedOrigin)) return
    event.preventDefault()
  })
  window.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    if (hasOrigin(targetUrl, allowedOrigin)) return { action: 'allow' }
    void openExternal(targetUrl)
    return { action: 'deny' }
  })

  return window
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

async function shutdownHarness(): Promise<void> {
  const runningHarness = harness
  harness = undefined
  harnessUrl = undefined
  await runningHarness?.stop()
}

async function handleStartupFailure(error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error)
  console.error(error)
  if (!isSmokeRun && app.isReady()) dialog.showErrorBox('DeepSeek Work failed to start', message)
  await shutdownHarness()
  shutdownComplete = true
  app.exit(1)
}
