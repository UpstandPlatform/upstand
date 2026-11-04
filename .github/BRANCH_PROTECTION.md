# Branch protection checklist

Configure these as active GitHub rulesets after validating them in Evaluate
mode. GitHub settings are repository-level policy and are intentionally not
stored as application code.

## `canary-integration`

Target `canary` and require:

- Pull requests before merging
- One approval and CODEOWNERS review
- Approval of the latest reviewable push
- Resolved conversations
- The `Merge gate` status check
- Linear history
- No force pushes or deletions

The active `canary-integration` ruleset grants Organization Admins a
pull-request-only bypass for owner-authored changes. Keep the required status
check active; use the bypass only after CI passes and review conversations are
resolved. GitHub does not allow the pull request author to approve their own
pull request.

## `master-release`

Target `master` and require the same controls. Use strict status checks and
two approvals when the maintainer group supports it. Require a successful
deployment only after a real staging environment is configured.
The active `master-release` ruleset also grants Organization Admins a
pull-request-only bypass for owner-authored changes; retain all required status
checks when using it.

## `release-tags`

Target `v*` tags. Restrict creation, updates, and deletions, and block force
pushes. Allow only the release automation to create tags.

Avoid requiring checks that are intentionally skipped for fork pull requests.
The always-running `Merge gate` job is the stable check to select in the
ruleset UI.
