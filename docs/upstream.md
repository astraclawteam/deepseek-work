# Upstream provenance

DeepSeek Work develops against a separate DeepSeek Harness checkout and stages built upstream release artifacts into self-contained Windows x64 and macOS Apple Silicon packages.

- Source: <https://github.com/deepseek-ai/deepseek-harness>
- Packaged revision: `47f943859bef60e4160492346772ded9b24f765a`
- Packaged version: `0.1.0-rc.5`
- Upstream package: `@deepseek-ai/dsh-root`
- License: MIT, copyright (c) 2026 DeepSeek

`runtime-lock.json` is the packaging provenance lock. It records official Node.js and Electron archive URLs plus SHA-256 digests for each supported target. The runtime builder refuses a target-host, version, commit, or clean-checkout mismatch; the resulting cache receipt hashes every packaged file. The upstream MIT license is carried as `resources/harness/LICENSE.deepseek-harness`, and `THIRD_PARTY_NOTICES.md` records Harness and Node provenance.

The Windows self-hosted release runner may use the repository variable `WINDOWS_HARNESS_MIRROR` to clone a local, read-only Git mirror when GitHub transport is unavailable. The job verifies that the mirror contains the locked commit, checks out that exact detached revision, and the runtime builder still enforces commit and cleanliness checks. When the variable is absent, Actions checks out the same locked revision directly from GitHub.

The official black whale logo and wordmark are copied from the pinned upstream repository into `assets/brand` and used for the executable icon and desktop shell. Generated shell artwork contains no substitute logo.
