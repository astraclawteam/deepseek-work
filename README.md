# DeepSeek Work

DeepSeek Work is the AstraClaw Team desktop distribution of [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). It is a supervised Electron shell: it starts the bundled Harness on an isolated loopback port, waits for the Web UI to become healthy, loads it in a sandboxed desktop window, and cleans up the complete child-process tree on exit.

## Development

Requirements:

- Node.js `^22.19.0` or `>=24.0.0`
- pnpm `11.7.0`
- A clean, installed DeepSeek Harness checkout next to this repository at `../deepseek-harness`

Install and start the desktop application from this repository root:

```powershell
pnpm install
pnpm run dev
```

Set `DEEPSEEK_HARNESS_ROOT` when the Harness checkout is elsewhere. Set `DEEPSEEK_HARNESS_NODE` only when its compatible Node executable is not available as `node` on `PATH`.

The desktop process gives Harness a dedicated data directory beneath Electron's per-user application data directory. Model credentials, when needed, remain runtime environment inputs and must not be committed.

## Windows package

The release pipeline pins the exact Harness commit and official Windows x64 Node runtime in `runtime-lock.json`. It builds the upstream release packages, selects the production dependency closure, installs native Windows dependencies, applies a versioned release-only pruning policy, verifies every staged file with SHA-256, and stores the result in `.release-cache`. Unchanged inputs reuse this verified cache instead of rebuilding or downloading the runtime.

Pruning is implemented entirely in DeepSeek Work and never edits the upstream checkout. It removes type declarations, source maps, native debug symbols, development/test documentation, package-manager metadata, and native payloads that cannot run on Windows x64. Runtime JavaScript, configuration, Web assets, licenses, package manifests, prompts, Windows x64 native modules, and worker files are retained. `build/runtime/runtime-pruning.json` records exact before/after counts and removal reasons for each staged runtime.

```powershell
pnpm run prepare:runtime
pnpm run pack:win
pnpm run smoke:packaged
pnpm run dist:win
```

`pnpm run pack:win` creates `release/win-unpacked`; `pnpm run dist:win` creates an unsigned local NSIS installer. Both include Harness and Node, so end users do not need a source checkout, Node, pnpm, or a first-launch runtime download. Official builds use `pnpm run release:win`, which requires the AstraClaw Team EV Sign identity and rejects the release unless the application and installer have the expected Authenticode publisher and timestamp. See [Windows code signing](docs/code-signing.md).

## Verification

```powershell
pnpm run typecheck
pnpm run test
pnpm run smoke
pnpm run smoke:packaged
```

`pnpm run smoke` tests the adjacent development checkout. `pnpm run smoke:packaged` launches `release/win-unpacked/DeepSeek Work.exe` with isolated application data, verifies that the bundled Harness UI loads, exits, and confirms that the assigned loopback port was released.

## Project status

The Windows x64 desktop package is self-contained and uses a custom 16:10 startup shell. Its application and executable icon are rendered from the official black whale asset in the pinned Harness source. See [the architecture notes](docs/architecture.md), [upstream provenance](docs/upstream.md), and [third-party notices](THIRD_PARTY_NOTICES.md) for the distribution boundary.

Before contributing, read [CONTRIBUTING.md](CONTRIBUTING.md). Repository automation and coding agents must also follow [AGENTS.md](AGENTS.md). DeepSeek Work is distributed under the [MIT License](LICENSE).
