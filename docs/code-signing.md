# Windows code signing

Official Windows releases use the AstraClaw Team Certum EV cloud code-signing certificate through SimplySign Desktop, with the expected publisher `惠州顺视智能科技有限公司` and pinned certificate thumbprint `EEE5C9B2188F1B62A06B7EEDF2C25AE2C79B1B90`. Private signing material is never stored in Git or GitHub Actions Secrets.

`build/sign.cjs` is the Electron Builder signing hook. It invokes Windows SDK SignTool with the exact certificate exposed by SimplySign Desktop and signs only the public DeepSeek Work application executable, NSIS installer, and generated uninstaller. Bundled Microsoft, Node.js, Electron, and other third-party executables retain their upstream signatures. `scripts/verify-signatures.mjs` rejects a release unless both the application and installer have a valid Authenticode signature from the expected publisher with a timestamp.

The `windows-release` GitHub Actions workflow targets a Windows x64 self-hosted runner carrying the `simplysign` label. The runner must:

- run interactively as the same Windows user that owns the SimplySign session;
- have SimplySign Desktop running and connected to the active cloud certificate;
- expose the pinned, unexpired code-signing certificate for `惠州顺视智能科技有限公司` in `Cert:\\CurrentUser\\My`;
- have Windows SDK SignTool installed.

Do not install the Actions runner as a Windows service: a service account cannot share the interactive user's SimplySign virtual card or PIN window. For cards requiring a PIN, the operator must approve the prompt in the runner session; pinless cards proceed without that prompt.

Run a signed release manually from the Actions page or push a version tag matching `v*`. The workflow checks out the exact Harness revision from `runtime-lock.json`, verifies the live SimplySign certificate, runs all checks, creates and verifies the signed installer, executes the packaged smoke test, and uploads the installer and block map as a workflow artifact.

Local `pnpm run dist:win` remains available for unsigned development packaging. `pnpm run release:win` is the fail-closed signed release entry point and requires `WIN_CSC_SHA1`; `SIGNTOOL_PATH` and `TIMESTAMP_SERVER` may be supplied when the defaults do not apply.
