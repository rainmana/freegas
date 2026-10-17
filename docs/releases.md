# Fuel deliveries

Freegas uses Release Please to propose version/changelog PRs from Conventional Commits. `feat:` proposes a feature version, `fix:` a patch, and breaking-change markers affect the version according to the pre-1.0 policy. Maintainers review the version and changelog before merging. No agent independently chooses or publishes a release.

## The route

1. A push to `main` runs the Windows/Linux/macOS Node 22/24 matrix, package extraction/smoke checks, and the pinned real-Hub integration job.
2. If they pass, Release Please opens or updates a version PR. Its commit contains `package.json`, the version manifest, and changelog changes.
3. The workflow explicitly dispatches both test workflows on the version branch. GitHub's default token does not trigger normal PR workflows for bot-created PRs; dispatch is the intentional exception. No PAT is needed.
4. A maintainer merges the version PR. The full checks run again on the merged commit.
5. A guard requires that exact commit to be a merged Release Please PR with the expected label and matching package/manifest versions. Unrelated commits cannot create releases.
6. Release Please creates `v<version>` at that tested commit and a draft GitHub Release. The finalizer verifies the tag target and package checksum, attaches the already-tested tarball plus `SHA256SUMS`, then publishes the draft.

The single `.tgz` contains portable JavaScript, the starter Pre-roll, and documentation. It requires Node.js 22.16+ on Windows, Linux, or macOS; it is not a precompiled native binary. Download it from GitHub Releases, verify its checksum, then run `npm install --global ./freegas-VERSION.tgz`. No npm registry publication is configured; `private: true` prevents accidental publication there.

Package contents use an allowlist. The extracted artifact's CLI setup is exercised on each matrix platform. Local `.freegas` credentials, `.integration` data, development tools, and test files are excluded.

## Repository setup

- Actions must be enabled and allowed to create PRs. The repository setting is named “Allow GitHub Actions to create and approve pull requests”; GitHub combines the permissions, but this workflow never approves PRs.
- Normal tests use read-only repository permissions. The trusted-main release job requests contents/issues/PR writes plus workflow dispatch permission.
- Keep Conventional Commit titles when squash-merging implementation PRs.
- Review checks on version PRs and configure branch protection according to your maintainer policy. The workflow enforces checks before tags/releases even if a version PR was merged early.
- Live inference credentials are not needed in CI and are not uploaded as repository secrets by this setup.

The version manifest begins at the current 0.1.0 development baseline. The next version is proposed from subsequent changes; there is no claim that 0.1.0 was already published.

## Recovery

If tests fail, no release step runs. Fix the failure before releasing. If upload/publishing fails after a draft/tag exists, rerun the original workflow on the same commit. The finalizer can finish the draft and verifies existing published assets rather than replacing them. A workflow dispatched on a later unrelated commit will not finish an earlier release; rerun that earlier run instead.

Native executables and a Rust migration are tracked in [issue #4](https://github.com/rainmana/freegas/issues/4) and [the future target](future-rust.md).

References: [Release Please Action](https://github.com/googleapis/release-please-action), [GitHub workflow triggers](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow).
