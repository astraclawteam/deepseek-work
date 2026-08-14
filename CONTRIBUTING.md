# Contributing to deepseek-work

Thank you for contributing. The repository uses a lightweight review workflow intended to keep `main` stable without blocking maintainers during bootstrap or urgent maintenance.

## Branches

- `main` is the stable default branch.
- Contributors should work in short-lived branches such as `feature/<topic>`, `fix/<topic>`, `docs/<topic>`, or `chore/<topic>`.
- Keep branches focused and rebase or update them before merge when conflicts exist.
- Force-pushing or deleting `main` is prohibited.

## Pull Requests

Every normal contributor change should be submitted as a pull request. A pull request must:

1. Explain the problem and the chosen solution.
2. Describe the verification performed and any checks not run.
3. Identify compatibility, security, migration, or rollback concerns.
4. Receive at least one approving review.
5. Resolve all review conversations before merge.
6. Receive a fresh approval after material new commits invalidate an earlier review.

Authors cannot approve their own pull requests. Reviewers should focus on correctness, security boundaries, public contracts, failure behavior, maintainability, tests, and documentation.

## Merge Policy

- Squash merge is the default so each pull request becomes one coherent commit on `main`.
- Topic branches should be deleted after merge.
- Merge commits and rebase merges are disabled in the hosted repository settings.

## Administrator Direct Pushes

Repository administrators may push directly to `main`. This exception is intentional and applies to bootstrap work, releases, incident response, and repository maintenance.

An administrator direct push does not waive engineering quality requirements: keep the commit focused, run relevant checks, avoid unrelated changes, and add a corrective follow-up immediately if a problem is discovered. Force pushes and deletion of `main` remain prohibited.

## Commit Messages

Use a concise imperative subject. Conventional prefixes such as `feat:`, `fix:`, `docs:`, `test:`, `refactor:`, and `chore:` are encouraged but not mandatory.

## Security and Privacy

- Do not include credentials, tokens, private keys, customer data, or sensitive operational details in issues, pull requests, commits, fixtures, or logs.
- Report a suspected vulnerability privately to a repository administrator instead of opening a public issue.
