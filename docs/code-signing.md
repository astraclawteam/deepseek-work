# Release signing

DeepSeek Work uses platform-native signing and fails closed for tagged releases. Private signing material is never committed to Git.

## Windows

Official Windows releases use the AstraClaw Team Certum EV cloud code-signing certificate through SimplySign Desktop, with the expected publisher `惠州顺视智能科技有限公司` and pinned certificate thumbprint `EEE5C9B2188F1B62A06B7EEDF2C25AE2C79B1B90`.

`build/sign.cjs` invokes Windows SDK SignTool with SHA-256 and a trusted timestamp. It signs only the public DeepSeek Work application executable, NSIS installer, and generated uninstaller. Bundled Microsoft, Node.js, Electron, and other third-party executables retain their upstream signatures. `scripts/verify-signatures.mjs` rejects a release unless the application and installer have the expected valid publisher and timestamp.

The Windows job targets an interactive self-hosted runner with the `simplysign` label. It must run as the user who owns the live SimplySign session and have Windows SDK SignTool available. It must not run as a Windows service because a service account cannot share the user's SimplySign virtual card or PIN prompt.

## macOS

macOS release packaging runs natively on GitHub's Apple Silicon runner. A tagged release requires these encrypted repository secrets:

- `MAC_CSC_LINK`: base64-encoded Developer ID Application `.p12` containing the certificate and private key;
- `MAC_CSC_KEY_PASSWORD`: password for that `.p12`;
- `APPLE_ID`, `APPLE_TEAM_ID`, and `APPLE_APP_SPECIFIC_PASSWORD`: Apple notarization credentials.

Electron Builder imports the identity into a temporary CI keychain, signs the complete app bundle with hardened-runtime entitlements, submits it to Apple's notary service, and staples the result. `scripts/verify-macos-release.mjs` verifies the deep code signature, Developer ID authority, Team ID, stapled ticket, Gatekeeper assessment, DMG integrity, and ZIP integrity before the packaged smoke test.

Manual workflow runs may omit `MAC_CSC_LINK`; they then use an explicit ad-hoc signature solely to validate the native packaging and smoke-test chain. Tagged workflows require Developer ID and notarization and cannot silently fall back to ad-hoc signing.

## Automatic GitHub Release

Run the unified `release` workflow manually for pipeline validation, or push a `v*` tag that exactly matches `package.json`. Windows and macOS build independently. The publish job starts only after both platform jobs pass and creates a GitHub Release containing the signed installers. A platform failure prevents publication.
