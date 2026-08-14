# Desktop architecture

## Current MVP

DeepSeek Work is an Electron main process wrapped around the upstream DeepSeek Harness Web surface. Electron owns the desktop window and the child-process lifecycle; it does not fork or duplicate the Harness agent runtime.

At startup the desktop process:

1. Finds an upstream Harness checkout from `DEEPSEEK_HARNESS_ROOT` or the adjacent `../deepseek-harness` directory.
2. Starts the Harness CLI on loopback with an OS-assigned port.
3. Waits for the upstream `dsh web:` readiness line, then verifies the Web root over HTTP.
4. Loads that origin into a sandboxed `BrowserWindow` with no Node integration.
5. Terminates the supervised Harness process tree when the desktop application exits.

Harness data is redirected to a `harness` directory beneath Electron's per-user data directory. Credentials remain external runtime inputs and are never copied into this repository.

This MVP depends on a development checkout with installed Harness dependencies and a compatible Node executable. `pnpm run build` compiles the desktop main process; it does not yet produce a self-contained installer.

## Security boundary

The Harness UI is treated as Web content. Its renderer has `sandbox`, `contextIsolation`, and `webSecurity` enabled, with `nodeIntegration` disabled. Same-origin navigation stays in the desktop window; external HTTP(S) navigation is handed to the operating system browser. There is no preload bridge or privileged renderer IPC in this milestone.

## Distribution target

A distributable release must stage a pinned, built Harness runtime and a compatible Node runtime beneath Electron resources, generate third-party notices, verify the staged runtime closure, and run packaged smoke tests. Until that work exists, a compiled desktop build must not be described as a self-contained release.
