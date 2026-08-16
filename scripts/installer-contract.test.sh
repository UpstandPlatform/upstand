#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Sourcing the installer loads its validation functions without running main.
# This contract test intentionally never invokes Docker, Swarm, or writes files.
# shellcheck disable=SC1091
source "$ROOT_DIR/install.sh"

grep -Fq 'UPSTAND_DOCS_IMAGE="upstand-fumadocs:source-${revision}"' "$ROOT_DIR/install.sh" || {
  echo "source-build installer must assign a Fumadocs image" >&2
  exit 1
}
grep -Fq 'apps/fumadocs/Dockerfile' "$ROOT_DIR/install.sh" || {
  echo "source-build installer must build the Fumadocs image" >&2
  exit 1
}
grep -Fq 'write_env_assignment UPSTAND_ALLOW_UNOBSERVED_PRODUCTION' "$ROOT_DIR/install.sh" || {
  echo "installer must persist the explicit unobserved-production acknowledgement" >&2
  exit 1
}
grep -Fq 'verify_release_deployment_artifacts \' "$ROOT_DIR/install.sh" || {
  echo "installer must verify the downloaded Compose file against the release manifest" >&2
  exit 1
}
grep -Fq 'verify_release_artifact_hash "$stack_file" dockerComposeProdSha256' "$ROOT_DIR/install.sh" || {
  echo "installer must verify the downloaded acceptance script against the release manifest" >&2
  exit 1
}
grep -Fq 'verify_release_artifact_hash "$acceptance_file" productionAcceptanceSha256' "$ROOT_DIR/install.sh" || {
  echo "installer must verify the downloaded acceptance script against the release manifest" >&2
  exit 1
}
grep -Fq 'production-evidence-collect.sh' "$ROOT_DIR/install.sh" || {
  echo "installer must download the production evidence collector" >&2
  exit 1
}
grep -Fq 'verify_release_artifact_hash "$evidence_file" productionEvidenceCollectSha256' "$ROOT_DIR/install.sh" || {
  echo "installer must verify the production evidence collector against the release manifest" >&2
  exit 1
}
grep -Fq 'production-acceptance-cluster.sh' "$ROOT_DIR/install.sh" || {
  echo "installer must download the cluster acceptance aggregator" >&2
  exit 1
}
grep -Fq 'verify_release_artifact_hash "$cluster_file" productionAcceptanceClusterSha256' "$ROOT_DIR/install.sh" || {
  echo "installer must verify the cluster acceptance aggregator against the release manifest" >&2
  exit 1
}
grep -Fq '"$INSTALL_DIR/production-evidence-collect.sh"' "$ROOT_DIR/install.sh" || {
  echo "installer must pass the production evidence collector to release verification" >&2
  exit 1
}
grep -Fq '"$INSTALL_DIR/production-acceptance-cluster.sh"' "$ROOT_DIR/install.sh" || {
  echo "installer must pass the cluster acceptance aggregator to release verification" >&2
  exit 1
}
grep -Fq 'release_manifest_has_artifact_hashes' "$ROOT_DIR/install.sh" || {
  echo "installer must require release artifact hashes" >&2
  exit 1
}
grep -Fq 'verify_release_deployment_artifacts' "$ROOT_DIR/install.sh" || {
  echo "installer must centralize release deployment-artifact verification" >&2
  exit 1
}

run_replica_validation() {
  (
    validate_replica_configuration "$@"
  )
}

expect_replica_rejection() {
  if run_replica_validation "$@"; then
    echo "expected replica configuration to be rejected: $*" >&2
    exit 1
  fi
}

run_digest_validation() {
  (
    local image="$1"
    UPSTAND_SERVER_IMAGE="$image" require_digest_image UPSTAND_SERVER_IMAGE
  )
}

expect_digest_rejection() {
  if run_digest_validation "$1"; then
    echo "expected image digest to be rejected: $1" >&2
    exit 1
  fi
}

run_network_validation() {
  (
    validate_swarm_network "$@"
  )
}

expect_network_rejection() {
  if run_network_validation "$@"; then
    echo "expected Swarm network configuration to be rejected: $*" >&2
    exit 1
  fi
}

assert_services() {
  local expected actual
  expected="$1"
  shift
  actual="$(printf '%s\n' "$@")"
  [[ "$actual" == "$expected" ]] || {
    echo "unexpected required service list: $actual" >&2
    exit 1
  }
}

run_replica_validation false 1 1 1 1 1 1
run_replica_validation true 2 1 2 1 0 0
expect_replica_rejection false 1 1 1 1 1 2
expect_replica_rejection false 0 1 1 1 1 1
expect_replica_rejection true 2 1 2 1 1 0

validate_swarm_network upstand-network overlay swarm true '{"encrypted":""}'
expect_network_rejection upstand-network overlay swarm true '{"com.docker.network.driver.overlay.vxlanid_list":"4097"}'
expect_network_rejection upstand-network overlay swarm true '{"encrypted":false}'
expect_network_rejection upstand-network overlay swarm true '{"encrypted":"false"}'
valid_digest="$(printf 'a%.0s' {1..64})"

(
  docker() {
    if [[ "$1 $2" == "service create" ]]; then
      [[ "$*" == *"--network upstand-network"* && "$*" == *"--cap-drop ALL"* && "$*" == *"--user 10001:123"* ]] || {
        echo "network runtime probe omitted required hardening" >&2
        return 1
      }
      return 0
    fi
    if [[ "$1 $2" == "service ps" ]]; then
      printf 'Complete 1 second ago\n'
      return 0
    fi
    if [[ "$1 $2" == "service rm" ]]; then
      return 0
    fi
    return 1
  }
  UPSTAND_SERVER_IMAGE="ghcr.io/example/server@sha256:${valid_digest}"
  UPSTAND_DOCKER_GID=123
  validate_swarm_network_runtime
)

run_digest_validation "ghcr.io/example/server@sha256:${valid_digest}"
expect_digest_rejection "ghcr.io/example/server@sha256:abc"
expect_digest_rejection "ghcr.io/example/server@sha256:${valid_digest}z"

resolve_stable_image_output="$(
  UPSTAND_VERSION=v1.2.3
  curl() {
    [[ "$*" == *"https://github.com/upstandplatform/upstand/releases/download/v1.2.3/upstand-release-manifest.json"* ]] || {
      echo "unexpected release manifest lookup: $*" >&2
      return 1
    }
    printf '{\n  "schemaVersion": 1,\n  "version": "v1.2.3",\n  "images": [\n    {\n      "name": "server",\n      "image": "ghcr.io/upstandplatform/upstand-server:v1.2.3",\n      "digest": "sha256:%s"\n    },\n    {\n      "name": "schedules",\n      "image": "ghcr.io/upstandplatform/upstand-schedules:v1.2.3",\n      "digest": "sha256:%s"\n    },\n    {\n      "name": "web",\n      "image": "ghcr.io/upstandplatform/upstand-web:v1.2.3",\n      "digest": "sha256:%s"\n    },\n    {\n      "name": "fumadocs",\n      "image": "ghcr.io/upstandplatform/upstand-fumadocs:v1.2.3",\n      "digest": "sha256:%s"\n    },\n    {\n      "name": "monitoring",\n      "image": "ghcr.io/upstandplatform/upstand-monitoring:v1.2.3",\n      "digest": "sha256:%s"\n    }\n  ]\n}\n' "$valid_digest" "$valid_digest" "$valid_digest" "$valid_digest" "$valid_digest"
  }
  resolve_stable_image server
  for component in schedules web fumadocs monitoring; do
    printf '\n%s' "$(resolve_stable_image "$component")"
  done
)"
expected_stable_images="ghcr.io/upstandplatform/upstand-server:v1.2.3@sha256:${valid_digest}
ghcr.io/upstandplatform/upstand-schedules:v1.2.3@sha256:${valid_digest}
ghcr.io/upstandplatform/upstand-web:v1.2.3@sha256:${valid_digest}
ghcr.io/upstandplatform/upstand-fumadocs:v1.2.3@sha256:${valid_digest}
ghcr.io/upstandplatform/upstand-monitoring:v1.2.3@sha256:${valid_digest}"
[[ "$resolve_stable_image_output" == "$expected_stable_images" ]] || {
  echo "stable image lookup did not use the immutable release manifest" >&2
  exit 1
}

if (
  UPSTAND_VERSION=v1.2.3
  curl() {
    printf '{\n  "schemaVersion": 1,\n  "version": "v1.2.3",\n  "images": [\n    {\n      "name": "server",\n      "image": "ghcr.io/upstandplatform/upstand-server:v1.2.3",\n      "digest": "sha256:abc"\n    }\n  ]\n}\n'
  }
  resolve_stable_image server
); then
  echo "stable image lookup unexpectedly accepted a non-immutable manifest digest" >&2
  exit 1
fi

if (
  unset UPSTAND_VERSION
  resolve_stable_image server
); then
  echo "stable image lookup unexpectedly accepted a missing release tag" >&2
  exit 1
fi

if (
  UPSTAND_VERSION=v1.2.3
  curl() {
    printf '{\n  "schemaVersion": 1,\n  "version": "v1.2.3",\n  "images": [\n    {\n      "name": "server",\n      "image": "ghcr.io/example-attacker/upstand-server:v1.2.3",\n      "digest": "sha256:%s"\n    }\n  ]\n}\n' "$valid_digest"
  }
  resolve_stable_image server
); then
  echo "stable image lookup unexpectedly accepted an image from the wrong repository" >&2
  exit 1
fi

serialized_assignment="$(write_env_assignment TEST_VALUE "https://example.test/path?a=1&b=2; echo unsafe")"
unset TEST_VALUE
eval "$serialized_assignment"
[[ "$TEST_VALUE" == "https://example.test/path?a=1&b=2; echo unsafe" ]] || {
  echo "environment assignment serialization did not round-trip safely" >&2
  exit 1
}

(
  artifact_file="$(mktemp)"
  trap 'rm -f "$artifact_file"' EXIT
  printf 'acceptance-artifact' > "$artifact_file"
  artifact_hash="$(sha256sum "$artifact_file" | awk '{print $1}')"
  RELEASE_MANIFEST_CONTENT="$(printf '{\n  "artifacts": {\n    "dockerComposeProdSha256": "%s",\n    "productionAcceptanceSha256": "%s",\n    "productionEvidenceCollectSha256": "%s",\n    "productionAcceptanceClusterSha256": "%s"\n  }\n}\n' "$artifact_hash" "$artifact_hash" "$artifact_hash" "$artifact_hash")"
  verify_release_artifact_hash "$artifact_file" dockerComposeProdSha256
  verify_release_artifact_hash "$artifact_file" productionAcceptanceSha256
  RELEASE_MANIFEST_CONTENT="$(printf '{\n  "productionAcceptanceClusterSha256": "%s"\n}\n' "$artifact_hash")"
  verify_release_artifact_hash "$artifact_file" productionAcceptanceClusterSha256
)

RELEASE_MANIFEST_CONTENT='{"schemaVersion":1,"version":"v0.1.8","images":[]}'
if release_manifest_has_artifact_hashes; then
  echo "release manifest without artifact hashes unexpectedly passed" >&2
  exit 1
fi
if (
  RELEASE_MANIFEST_CONTENT='{"schemaVersion":1,"version":"v0.1.8","images":[]}'
  UPSTAND_VERSION=v0.1.8
  verify_release_deployment_artifacts /missing/compose.yml /missing/acceptance.sh
); then
  echo "release deployment artifacts without hashes unexpectedly bypassed verification" >&2
  exit 1
fi
artifact_hash="$(printf 'a%.0s' {1..64})"
RELEASE_MANIFEST_CONTENT="$(printf '{\n  "artifacts": {\n    "dockerComposeProdSha256": "%s",\n    "productionAcceptanceSha256": "%s",\n    "productionEvidenceCollectSha256": "%s",\n    "productionAcceptanceClusterSha256": "%s"\n  }\n}\n' "$artifact_hash" "$artifact_hash" "$artifact_hash" "$artifact_hash")"
release_manifest_has_artifact_hashes || {
  echo "release manifest with artifact hashes was not recognized" >&2
  exit 1
}

if (
  artifact_file="$(mktemp)"
  trap 'rm -f "$artifact_file"' EXIT
  printf 'acceptance-artifact' > "$artifact_file"
  RELEASE_MANIFEST_CONTENT="$(printf '{\n  "dockerComposeProdSha256": "%s"\n}\n' "$(printf 'a%.0s' {1..64})")"
  verify_release_artifact_hash "$artifact_file" dockerComposeProdSha256
); then
  echo "release artifact hash verification unexpectedly accepted a mismatch" >&2
  exit 1
fi

UPSTAND_BUNDLED_POSTGRES_REPLICAS=1
UPSTAND_BUNDLED_REDIS_REPLICAS=1
mapfile -t bundled_services < <(required_stack_services)
assert_services $'postgres\nredis\nserver\nschedules\nweb\nfumadocs' "${bundled_services[@]}"

UPSTAND_BUNDLED_POSTGRES_REPLICAS=0
UPSTAND_BUNDLED_REDIS_REPLICAS=0
mapfile -t external_services < <(required_stack_services)
assert_services $'server\nschedules\nweb\nfumadocs' "${external_services[@]}"

echo "installer-contract: passed"
