# Releasing Upstand

This is the maintainer release runbook. Releases are immutable and are
published only from the stable branch.

## Normal patch release

1. Merge contributor pull requests and their Changesets into `canary`.
2. Review the automated Changesets release pull request.
3. Merge the release pull request into `canary`.
4. Open and merge the promotion pull request from `canary` to `master`.
5. Confirm the stable-tag workflow created a new `vMAJOR.MINOR.PATCH` tag.
6. Confirm the reusable release workflow builds, verifies, and publishes all
   server, schedules, web, Fumadocs, and monitoring images.
7. Confirm the CLI publication workflow publishes `@upstand/cli` with npm
   provenance, or verifies that the immutable version is already published
   with identical contents. Product releases publish from the stable tag;
   CLI-only Changesets publish from the version-bump commit on `master`.
8. Confirm the GitHub Release contains the release manifest and immutable image
   digests.

## Retry and rollback

The release workflow is safe to retry for an existing tag. Use the
`Dispatch Release and Publish Docker Images` workflow with the exact tag as
`release_ref`; never delete or move the tag.

If the release is defective, publish a corrective patch release. Roll back the
Swarm stack to a previously verified image digest rather than retagging an
existing version.

## Pre-release checks

```bash
git fetch origin --prune
git switch master
git pull --ff-only origin master
gh run list --repo UpstandPlatform/upstand --limit 20
gh release list --repo UpstandPlatform/upstand --limit 10
```

Do not announce a release until CI, image publication, CLI publication, manifest
verification, and the GitHub Release have all passed.

The CLI publication workflow uses npm trusted publishing and never stores an
npm token in GitHub. Configure the `UpstandPlatform/upstand` repository as the
trusted publisher for `@upstand/cli` with workflow `npm-cli.yml` and no npm
environment before promoting the first CLI release. The package must be
public, and the workflow must retain `id-token: write`; do not add
`NPM_TOKEN` or `NODE_AUTH_TOKEN` secrets. Retries verify the published npm
integrity before skipping an immutable version.

## Changesets token configuration

The Changesets workflow needs permission to create and update pull requests.
The preferred setup is enabling **Allow GitHub Actions to create and approve
pull requests** in the organization Actions policy. If organization policy
cannot be changed, configure a repository secret named `RELEASE_TOKEN` using a
short-lived or fine-grained GitHub App/PAT credential with only Contents and
Pull requests write access. Do not use a broad personal token as a permanent
release credential.
