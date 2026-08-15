#!/usr/bin/env bash
set -euo pipefail

# image-size is pulled only by the optional desktop DMG maker through appdmg.
# The two upstream advisories currently have no patched release, so keep the
# high-severity gate active for every other dependency while documenting this
# narrow, build-only exception. Do not use image-size for untrusted runtime
# input.
# extract-zip is pulled by Electron Forge's trusted desktop packager and has
# no patched upstream release for GHSA-jmr9-qjv8-65gv. It never processes
# untrusted application input in Upstand's runtime.
bun audit --audit-level=high \
  --ignore GHSA-w3rx-r6r6-pgpr \
  --ignore GHSA-5p2g-fcmc-qvqq \
  --ignore GHSA-jmr9-qjv8-65gv
