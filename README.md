# DeepSeek Work

DeepSeek Work is the AstraClaw Team desktop project for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). The current MVP is a supervised Electron shell: it starts Harness on an isolated loopback port, waits for the Web UI to become healthy, loads it in a sandboxed window, and cleans up the complete child-process tree on exit.

## Development

Requirements:

- Node.js `^22.19.0` or `>=24.0.0`
- pnpm `11.7.0`
- A built and installed DeepSeek Harness checkout next to this repository at `../deepseek-harness`

Install and start the desktop application from this repository root:

```powershell
pnpm install
pnpm run dev
```

Set `DEEPSEEK_HARNESS_ROOT` when the Harness checkout is elsewhere. Set `DEEPSEEK_HARNESS_NODE` only when its compatible Node executable is not available as `node` on `PATH`.

The desktop process gives Harness a dedicated data directory beneath Electron's per-user application data directory. Model credentials, when needed, remain runtime environment inputs and must not be committed.

## Verification

```powershell
pnpm run typecheck
pnpm run test
pnpm run smoke
```

`pnpm run smoke` starts the real adjacent Harness, loads its UI in a hidden Electron window, prints a readiness marker, and exits after process-tree cleanup.

## Project status

This milestone supports development from a source checkout. It does not yet package the Harness runtime, Node runtime, or a production installer. See [the architecture notes](docs/architecture.md) and [upstream provenance](docs/upstream.md) for the current boundary and distribution requirements.

Before contributing, read [CONTRIBUTING.md](CONTRIBUTING.md). Repository automation and coding agents must also follow [AGENTS.md](AGENTS.md). DeepSeek Work is distributed under the [MIT License](LICENSE).
