#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKFLOW="$ROOT_DIR/.github/workflows/npm-cli.yml"
RUNBOOK="$ROOT_DIR/RELEASING.md"
README="$ROOT_DIR/packages/cli/README.md"
PACKAGE="$ROOT_DIR/packages/cli/package.json"

require_text() {
  local file="$1"
  local text="$2"
  grep -Fq -- "$text" "$file" || {
    echo "$file is missing required npm release contract: $text" >&2
    exit 1
  }
}

require_text "$WORKFLOW" 'branches:'
require_text "$WORKFLOW" '- master'
require_text "$WORKFLOW" 'tags:'
require_text "$WORKFLOW" '- "v*"'
require_text "$WORKFLOW" 'id-token: write'
require_text "$WORKFLOW" 'fetch-depth: 0'
require_text "$WORKFLOW" 'git merge-base --is-ancestor'
require_text "$WORKFLOW" 'npm pack'
require_text "$WORKFLOW" 'npm@11.5.2 publish'
require_text "$WORKFLOW" 'working-directory: ${{ env.PACKAGE_DIR }}'
if grep -Fq -- 'publish "${{ steps.package.outputs.tarball }}"' "$WORKFLOW"; then
  echo "npm trusted publishing must publish the package from its working directory" >&2
  exit 1
fi
require_text "$WORKFLOW" '--provenance'
require_text "$WORKFLOW" 'dist.integrity'
require_text "$WORKFLOW" 'refusing to overwrite it'
require_text "$WORKFLOW" 'npm >= 11.5'
require_text "$WORKFLOW" 'npx --yes npm@11.5.2'

if grep -Eq 'NPM_TOKEN|NODE_AUTH_TOKEN|//registry\.npmjs\.org/.*_authToken' "$WORKFLOW"; then
  echo "npm publication must not use a long-lived npm token" >&2
  exit 1
fi

require_text "$RUNBOOK" 'npm trusted publishing'
require_text "$RUNBOOK" 'npm-cli.yml'
require_text "$README" 'npm install -g @upstand/cli'

node - "$PACKAGE" <<'NODE'
const fs = require("node:fs");
const packageJson = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const runtimeDependencies = {
  ...(packageJson.dependencies ?? {}),
  ...(packageJson.optionalDependencies ?? {}),
};
const invalid = Object.entries(runtimeDependencies).filter(([, range]) =>
  /^(catalog:|workspace:|file:|link:)/.test(String(range)),
);
if (invalid.length > 0) {
  console.error(
    `published CLI runtime dependencies must use registry-resolvable semver ranges: ${invalid.map(([name, range]) => `${name}=${range}`).join(", ")}`,
  );
  process.exit(1);
}
NODE
require_text "$PACKAGE" '"zod": "^4.4.3"'

echo "npm CLI release contract passed."
