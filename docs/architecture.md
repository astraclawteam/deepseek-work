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

The packaged application uses only its staged runtime and does not require a system Node installation or an adjacent checkout. `pnpm run build` compiles the desktop main process. The platform entry points produce Windows x64 NSIS and macOS Apple Silicon DMG/ZIP artifacts from the same supervised desktop implementation.

## Security boundary

The Harness UI is treated as Web content. Its renderer has `sandbox`, `contextIsolation`, and `webSecurity` enabled, with `nodeIntegration` disabled. Same-origin navigation stays in the desktop window; external HTTP(S) navigation is handed to the operating system browser. There is no preload bridge or privileged renderer IPC in this milestone.

## Runtime staging and distribution

`runtime-lock.json` pins the upstream repository, package version, exact commit, and separate official Node.js and Electron archives for `win32-x64` and `darwin-arm64`. `scripts/prepare-runtime.mjs` requires a matching native build host and a clean Harness checkout at that commit, builds and packs upstream release families, computes the production package closure rooted at `@deepseek-ai/dsh`, and installs native platform dependencies with the pinned Node at the front of a sanitized PATH.

The installed closure is then passed through the versioned policy in `scripts/runtime-pruning-policy.mjs`. The policy operates only on the staged copy and removes non-runtime declarations, maps, debug symbols, development directories, package documentation/metadata, and native payloads for other targets. It explicitly retains licenses and runtime assets. The build validates the pruned CLI version plus Sharp, node-pty, and Koffi native loading on the target host before writing `runtime-pruning.json` and the per-file receipt. The pruning policy version and target participate in the cache input, so a policy or platform change cannot reuse the wrong runtime. The content-addressed cache entry is verified before every reuse and materialized into `build/runtime`. It defaults to `.release-cache/runtime-v2`; `DEEPSEEK_WORK_CACHE_ROOT` may place it at a shorter persistent path for Windows runners.

The release entry point accepts only the installed target Electron distribution or the exact SHA-256-pinned archive from the persistent cache, downloading that archive from its locked official URL only when it is absent. It keeps desktop code in ASAR and copies the staged Harness module tree and Node runtime under resources. The NSIS target is per-user, supports a selectable installation directory, creates desktop and Start Menu shortcuts, and retains application data on uninstall. The macOS target produces an Apple Silicon DMG and ZIP with hardened-runtime entitlements. Packaged smoke tests on both native hosts use isolated user data and verify the complete launch/load/cleanup boundary. Formal Windows releases fail closed on the expected timestamped Authenticode publisher. Tagged macOS releases fail closed unless a Developer ID Application identity, matching Team ID, notarization, stapling, archive verification, and packaged smoke all succeed; manual workflow runs may use an explicitly verified ad-hoc signature for pipeline testing but cannot publish a GitHub Release.
