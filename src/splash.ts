import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'

export type StartupPhase = 'verify' | 'prepare' | 'launch' | 'connect' | 'error'
export type StartupAction = 'retry' | 'quit'

export interface StartupState {
  detail: string
  error?: string
  phase: StartupPhase
  progress: number
}

export class StartupShell {
  private actionHandler: ((action: StartupAction) => void) | undefined
  private window: BrowserWindow | undefined

  constructor(private readonly showWindow: boolean) {}

  async open(version: string): Promise<void> {
    if (this.window !== undefined) return
    const window = new BrowserWindow({
      width: 1000,
      height: 625,
      frame: false,
      resizable: false,
      maximizable: false,
      fullscreenable: false,
      show: false,
      center: true,
      title: 'DeepSeek Work',
      backgroundColor: '#eef2ff',
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
      },
    })
    this.window = window
    window.webContents.on('console-message', (_event, _level, message) => {
      if (message === '__DEEPSEEK_WORK__:retry') this.actionHandler?.('retry')
      if (message === '__DEEPSEEK_WORK__:quit') this.actionHandler?.('quit')
    })
    window.on('closed', () => {
      if (this.window === window) this.window = undefined
    })
    await window.loadFile(join(app.getAppPath(), 'src', 'renderer', 'splash.html'))
    await window.webContents.executeJavaScript(`window.setDesktopVersion(${JSON.stringify(version)})`)
    if (this.showWindow) window.show()
  }

  onAction(handler: (action: StartupAction) => void): void {
    this.actionHandler = handler
  }

  async update(state: StartupState): Promise<void> {
    const window = this.window
    if (window === undefined || window.isDestroyed()) return
    await window.webContents.executeJavaScript(`window.setStartupState(${JSON.stringify(state)})`)
  }

  close(): void {
    const window = this.window
    this.window = undefined
    if (window !== undefined && !window.isDestroyed()) window.close()
  }
}
