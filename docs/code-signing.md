# Windows code signing

Official Windows releases use the AstraClaw Team EV Sign identity with the expected publisher `RushRush Network Technology Ltd`. Private signing material is never stored in Git.

`build/sign.cjs` is the Electron Builder signing hook. It signs only the public DeepSeek Work application executable, NSIS installer, and generated uninstaller. Bundled Microsoft, Node.js, Electron, and other third-party executables retain their upstream signatures. `scripts/verify-signatures.mjs` rejects a release unless both the application and installer have a valid Authenticode signature from the expected publisher with a timestamp.

The `windows-release` GitHub Actions workflow downloads the EV Sign CLI from its official Windows endpoint and verifies the pinned SHA-256 plus the CLI's Authenticode publisher before execution. The repository must provide one Actions Secret:

- `EVSIGN_KEY`: the EV Sign license UUID authorized for the DeepSeek Work application and installer feature codes.

Run a signed release manually from the Actions page or push a version tag matching `v*`. The workflow checks out the exact Harness revision from `runtime-lock.json`, runs all checks, creates and verifies the signed installer, executes the packaged smoke test, and uploads the installer and block map as a workflow artifact.

Local `pnpm run dist:win` remains available for unsigned development packaging. `pnpm run release:win` is the fail-closed signed release entry point and requires `EVSIGN_CLI` plus `EVSIGN_KEY`.
