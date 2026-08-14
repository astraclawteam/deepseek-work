# Desktop architecture

## Current implementation

DeepSeek Work is an Electron main process wrapped around the upstream DeepSeek Harness Web surface. Electron owns the desktop window and the child-process lifecycle; it does not fork or duplicate the Harness agent runtime.

At startup the desktop process:

1. Opens a frameless 1000×625 startup shell with the official black whale identity, local 1600×1000 artwork, progress state, and retry/quit failure controls.
2. Resolves the packaged Harness runtime and pinned Node executable from Electron resources. Development mode instead resolves `DEEPSEEK_HARNESS_ROOT` or the adjacent `../deepseek-harness` checkout.
3. Starts the built Harness CLI on loopback with an OS-assigned port.
4. Waits for the upstream `dsh web:` readiness line, then verifies the Web root over HTTP.
5. Loads that origin into a sandboxed 1440×900 `BrowserWindow` with no Node integration.
6. Terminates the supervised Harness process tree when the desktop application exits.

Harness data is redirected to a `harness` directory beneath Electron's per-user data directory. Credentials remain external runtime inputs and are never copied into this repository.

The packaged application uses only its staged runtime and does not require a system Node installation or an adjacent checkout. `pnpm run build` compiles the desktop main process, while `pnpm run pack:win` and `pnpm run dist:win` produce the unpacked application and NSIS installer respectively.

## Security boundary

The Harness UI is treated as Web content. Its renderer has `sandbox`, `contextIsolation`, and `webSecurity` enabled, with `nodeIntegration` disabled. Same-origin navigation stays in the desktop window; external HTTP(S) navigation is handed to the operating system browser. There is no preload bridge or privileged renderer IPC in this milestone.

## Runtime staging and distribution

`runtime-lock.json` pins the upstream repository, package version, exact commit, Node archive URL, and Node SHA-256. `scripts/prepare-runtime.mjs` requires a clean checkout at that commit, builds and packs upstream release families, computes the production package closure rooted at `@deepseek-ai/dsh`, and installs platform dependencies with the pinned Node at the front of a sanitized PATH.

The installed closure is then passed through the versioned policy in `scripts/runtime-pruning-policy.mjs`. The policy operates only on the staged copy and removes non-runtime declarations, maps, debug symbols, development directories, package documentation/metadata, and non-Windows-x64 native payloads. It explicitly retains licenses and runtime assets. The build validates the pruned CLI version plus Sharp, node-pty, and Koffi native loading before writing `runtime-pruning.json` and the per-file receipt. The pruning policy version participates in the cache input, so a policy change cannot accidentally reuse an older unpruned runtime. The content-addressed cache entry is verified before every reuse and materialized into `build/runtime` without network downloads. It defaults to `.release-cache/runtime-v1`; `DEEPSEEK_WORK_CACHE_ROOT` may place it at a shorter persistent path for Windows runners.

Electron Builder uses the installed, version-pinned `node_modules/electron/dist` rather than downloading Electron a second time. It keeps desktop code in ASAR and copies the staged Harness module tree and Node runtime under resources. The NSIS target is per-user, supports a selectable installation directory, creates desktop and Start Menu shortcuts, and retains application data on uninstall. Packaged smoke tests use isolated user data and verify the complete launch/load/cleanup boundary. Local packages may remain unsigned, while the formal `release:win` path uses SignTool with the AstraClaw Team certificate exposed by SimplySign Desktop in an interactive Windows self-hosted runner and fails closed unless both the application executable and NSIS installer have a valid, timestamped Authenticode signature from the configured publisher.
