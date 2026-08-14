# Repository Agent Rules

These instructions apply to the entire repository.

## Before Making Changes

- Read `CONTRIBUTING.md` and inspect the current repository state.
- Run Git, package-manager, build, test, and generator commands from this repository root.
- Treat dirty and untracked files as user-owned. Do not reset, clean, overwrite, or absorb unrelated work.

## Change Discipline

- Keep each change focused on the requested outcome. Do not add speculative compatibility layers or infrastructure.
- Preserve public contracts unless the change explicitly updates them.
- Treat source, configuration, documentation, tests, and scripts as UTF-8.
- Never commit secrets, credentials, private endpoints, local machine state, generated caches, or dependency directories.
- Prefer deterministic, non-interactive commands and the repository's own tooling once it exists.

## Verification

- Verify changes in proportion to risk, beginning with the smallest relevant check.
- When code is added, document the canonical build, lint, and test commands in `README.md` or `CONTRIBUTING.md`.
- Do not claim completion based only on a plan, README, branch name, or successful command exit; inspect the resulting behavior or artifact.

## Git and Collaboration

- Normal contributor changes use a topic branch and pull request.
- Pull requests require at least one approving review, must resolve review conversations, and must satisfy all configured checks.
- Repository administrators are explicitly allowed to push directly to `main` for bootstrap, release, incident response, or repository maintenance. A direct push must still be scoped, reviewed by the pusher, and verified where relevant.
- Never force-push or delete `main`.
- Do not commit, push, merge, publish, or create releases unless the current user request authorizes that external action.
