#!/usr/bin/env bash
set -euo pipefail

# image-size is pulled only by the optional desktop DMG maker through appdmg.
# The two upstream advisories currently have no patched release, so keep the
# high-severity gate active for every other dependency while documenting this
# narrow, build-only exception. Do not use image-size for untrusted runtime
# input.
bun audit --audit-level=high \
  --ignore GHSA-w3rx-r6r6-pgpr \
  --ignore GHSA-5p2g-fcmc-qvqq
