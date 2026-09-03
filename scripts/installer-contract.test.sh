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
grep -Fq 'UPSTAND_DEPLOYMENT_WORKER_IMAGE="upstand-deployment-worker:source-${revision}"' "$ROOT_DIR/install.sh" || {
  echo "source-build installer must assign a distinct deployment-worker image" >&2
  exit 1
}
grep -Fq 'apps/schedules/Dockerfile.worker' "$ROOT_DIR/install.sh" || {
  echo "source-build installer must build the deployment-worker image from its worker Dockerfile" >&2
  exit 1
}
grep -Fq 'apps/fumadocs/Dockerfile' "$ROOT_DIR/install.sh" || {
  echo "source-build installer must build the Fumadocs image" >&2
  exit 1
}
grep -Fq 'apps/docker-broker/Dockerfile' "$ROOT_DIR/install.sh" || {
  echo "source-build installer must build the Docker broker image" >&2
  exit 1
}
grep -Fq 'ClientAuth: tls.VerifyClientCertIfGiven' "$ROOT_DIR/apps/docker-broker/main.go" || {
  echo "Docker broker must allow its encrypted health probe without weakening protected API authentication" >&2
  exit 1
}
grep -Fq 'docker_broker_server_token' "$ROOT_DIR/install.sh" || {
	echo "installer must provision the server-specific Docker broker authentication secret" >&2
	exit 1
}
grep -Fq 'docker_broker_schedules_token' "$ROOT_DIR/install.sh" || {
	echo "installer must provision the schedules-specific Docker broker authentication secret" >&2
	exit 1
}
grep -Fq 'docker_broker_deployment_worker_token' "$ROOT_DIR/install.sh" || {
	echo "installer must provision the deployment-worker-specific Docker broker authentication secret" >&2
	exit 1
}
grep -Fq 'docker_broker_scope_secret' "$ROOT_DIR/install.sh" || {
  echo "installer must provision the signed Docker deployment scope secret" >&2
  exit 1
}
grep -Fq 'upgal_tool_approval_secret' "$ROOT_DIR/install.sh" || {
	echo "installer must provision the UpGal tool approval secret" >&2
	exit 1
}
grep -Fq 'UPGAL_TOOL_APPROVAL_SECRET_FILE: /run/secrets/upgal_tool_approval_secret' "$ROOT_DIR/docker-compose.prod.yml" || {
	echo "production Compose must inject the UpGal tool approval secret through Docker secrets" >&2
	exit 1
}
grep -Fq 'UPSTAND_DOCKER_BROKER_MAX_INFLIGHT' "$ROOT_DIR/docker-compose.prod.yml" || {
  echo "production Compose must configure a bounded Docker broker concurrency limit" >&2
  exit 1
}
grep -Fq 'UPSTAND_DOCKER_BROKER_SCOPE_SECRET_FILE: /run/secrets/docker_broker_scope_secret' "$ROOT_DIR/docker-compose.prod.yml" || {
  echo "production Compose must load the Docker broker scope signing secret" >&2
  exit 1
}
grep -Fq 'test: ["CMD", "wget", "--no-check-certificate", "--quiet", "--spider", "https://127.0.0.1:2375/health"]' "$ROOT_DIR/docker-compose.prod.yml" || {
  echo "production Compose must configure the Docker broker healthcheck" >&2
  exit 1
}
grep -Fq '  docker_broker_scope_secret:' "$ROOT_DIR/docker-compose.prod.yml" || {
  echo "production Compose must declare the Docker broker scope signing secret" >&2
  exit 1
}
grep -Fq 'ensure_docker_broker_mtls' "$ROOT_DIR/install.sh" || {
  echo "installer must generate and persist the Docker broker mTLS identity" >&2
  exit 1
}
grep -Fq 'timeout 120 docker service create' "$ROOT_DIR/install.sh" || {
  echo "installer must bound the encrypted-network probe Docker client" >&2
  exit 1
}
for required_text in \
  'validate_docker_broker_mtls_files' \
  'openssl verify -purpose sslserver' \
  'openssl verify -purpose sslclient' \
  "CN=upstand-server" \
  "CN=upstand-schedules" \
  "CN=upstand-deployment-worker"; do
  grep -Fq "$required_text" "$ROOT_DIR/install.sh" || {
    echo "installer must validate the Docker broker mTLS identity before reuse: $required_text" >&2
    exit 1
  }
done
for required_text in \
  'UPSTAND_DOCKER_BROKER_TLS_REQUIRED: "true"' \
  'UPSTAND_DOCKER_BROKER_CA_FILE: /run/secrets/ca.pem' \
  'UPSTAND_DOCKER_BROKER_CLIENT_CERT_FILE: /run/secrets/cert.pem' \
  'UPSTAND_DOCKER_BROKER_CLIENT_KEY_FILE: /run/secrets/key.pem' \
  'target: ca.pem' \
  'target: cert.pem' \
  'target: key.pem'; do
  grep -Fq "$required_text" "$ROOT_DIR/docker-compose.prod.yml" || {
    echo "production Compose is missing Docker broker mTLS configuration: $required_text" >&2
    exit 1
  }
done
grep -Fq 'metrics_token' "$ROOT_DIR/install.sh" || {
  echo "installer must provision the protected API metrics token secret" >&2
  exit 1
}
grep -Fq 'write_env_assignment UPSTAND_ALLOW_UNOBSERVED_PRODUCTION' "$ROOT_DIR/install.sh" || {
  echo "installer must persist the explicit unobserved-production acknowledgement" >&2
  exit 1
}
grep -Fq 'validate_disaster_recovery_plan' "$ROOT_DIR/install.sh" || {
  echo "installer must enforce an explicit disaster-recovery readiness attestation" >&2
  exit 1
}
grep -Fq 'verify-installation-recovery-evidence.sh' "$ROOT_DIR/install.sh" || {
  echo "installer must install and verify the installation recovery evidence verifier" >&2
  exit 1
}
grep -Fq 'write_env_assignment UPGAL_DAILY_COST_LIMIT_USD' "$ROOT_DIR/install.sh" || {
  echo "installer must persist the UpGal daily cost limit" >&2
  exit 1
}
grep -Fq 'write_env_assignment UPGAL_MAX_COST_PER_MILLION_TOKENS_USD' "$ROOT_DIR/install.sh" || {
  echo "installer must persist the UpGal conservative cost rate" >&2
  exit 1
}
grep -Fq 'write_env_assignment UPGAL_ALLOWED_MODELS' "$ROOT_DIR/install.sh" || {
  echo "installer must persist the UpGal model allowlist" >&2
  exit 1
}
grep -Fq 'verify_release_deployment_artifacts \' "$ROOT_DIR/install.sh" || {
  echo "installer must verify the downloaded Compose file against the release manifest" >&2
  exit 1
}
for required_text in \
  'DATABASE_URL="postgresql://upstand:${POSTGRES_PASSWORD}@postgres:5432/upstand"' \
  'REDIS_URL="redis://:${REDIS_PASSWORD}@redis:6379"'; do
  grep -Fq "$required_text" "$ROOT_DIR/install.sh" || {
    echo "bundled installs must provision non-empty in-network data URLs: $required_text" >&2
    exit 1
  }
done
for required_text in 'published: 3000' 'published: 3001' 'published: 4000'; do
  grep -Fq "$required_text" "$ROOT_DIR/docker-compose.prod.yml" || {
    echo "production Compose must publish the direct control-plane port: $required_text" >&2
    exit 1
  }
done
for required_text in 'endpoint_mode: vip'; do
  [[ "$(grep -Fc "$required_text" "$ROOT_DIR/docker-compose.prod.yml")" == 3 ]] || {
    echo "public control-plane services must use Swarm VIP routing with ingress ports" >&2
    exit 1
  }
done
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
grep -Fq 'verify_release_artifact_hash "$recovery_file" verifyInstallationRecoveryEvidenceSha256' "$ROOT_DIR/install.sh" || {
  echo "installer must verify the installation recovery evidence verifier against the release manifest" >&2
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
grep -Fq '"$INSTALL_DIR/verify-installation-recovery-evidence.sh"' "$ROOT_DIR/install.sh" || {
  echo "installer must pass the installation recovery evidence verifier to release verification" >&2
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
grep -Fq '  attempts=300' "$ROOT_DIR/apps/server/docker-entrypoint.sh" || {
  echo "server entrypoint must allow a bounded cold-start window for bundled dependencies" >&2
  exit 1
}

unlimited_restart_policies="$(grep -c '^        max_attempts: 0$' "$ROOT_DIR/docker-compose.prod.yml")"
[[ "$unlimited_restart_policies" == 8 ]] || {
  echo "all long-running control-plane services must use unlimited Swarm restart attempts" >&2
  exit 1
}
if grep -Fq '        max_attempts: 3' "$ROOT_DIR/docker-compose.prod.yml"; then
  echo "production control-plane stack must not use finite restart attempts" >&2
  exit 1
fi

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

expect_control_network_rejection() {
  if ( validate_control_network "$@" ); then
    echo "expected Docker control network configuration to be rejected: $*" >&2
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

run_replica_validation false 1 1 1 1 1 1 1
run_replica_validation true 2 1 2 2 1 0 0
expect_replica_rejection false 1 1 1 1 1 1 2
expect_replica_rejection false 0 1 1 1 1 1 1
expect_replica_rejection true 2 1 2 2 1 1 0

(
  UPSTAND_DR_OFFSITE_CONFIRMED=true
  UPSTAND_DR_KEY_ESCROW_CONFIRMED=true
  UPSTAND_DR_IMMUTABLE_RETENTION_CONFIRMED=true
  UPSTAND_DR_RPO_SECONDS=3600
  UPSTAND_DR_RTO_SECONDS=7200
  UPSTAND_DR_EVIDENCE_REFERENCE=change-1234
  validate_disaster_recovery_plan
)
if (
  UPSTAND_DR_OFFSITE_CONFIRMED=true
  UPSTAND_DR_KEY_ESCROW_CONFIRMED=true
  UPSTAND_DR_IMMUTABLE_RETENTION_CONFIRMED=false
  UPSTAND_DR_RPO_SECONDS=3600
  UPSTAND_DR_RTO_SECONDS=7200
  UPSTAND_DR_EVIDENCE_REFERENCE=change-1234
  validate_disaster_recovery_plan
); then
  echo "installer unexpectedly accepted an unconfirmed immutable-retention plan" >&2
  exit 1
fi

validate_swarm_network upstand-network overlay swarm true '{"encrypted":""}'
validate_control_network upstand-docker-control overlay swarm true true '{"encrypted":""}'
expect_control_network_rejection upstand-docker-control overlay swarm true false '{"encrypted":""}'
expect_network_rejection upstand-network overlay swarm true '{"com.docker.network.driver.overlay.vxlanid_list":"4097"}'
expect_network_rejection upstand-network overlay swarm true '{"encrypted":false}'
expect_network_rejection upstand-network overlay swarm true '{"encrypted":"false"}'

(
  docker() {
    case "$1 $2" in
      "network inspect")
        case "$3" in
          --format)
            case "$4" in
              "{{.Driver}}") printf 'bridge\n' ;;
              "{{.Scope}}") printf 'local\n' ;;
              "{{.Attachable}}") printf 'false\n' ;;
              "{{json .Options}}") printf '{}\n' ;;
              "{{len .Containers}}") printf '0\n' ;;
              *) return 1 ;;
            esac
            ;;
          *) return 0 ;;
        esac
        ;;
      "network rm") return 0 ;;
      "network create")
        [[ "$*" == *"--driver overlay"* && "$*" == *"--opt encrypted"* && "$*" == *"--attachable"* ]] || return 1
        return 0
        ;;
      *) return 1 ;;
    esac
  }
  ensure_swarm_network upstand-network false
)

(
  docker() {
    case "$1 $2" in
      "network inspect")
        case "$3" in
          --format)
            case "$4" in
              "{{.Driver}}") printf 'bridge\n' ;;
              "{{.Scope}}") printf 'local\n' ;;
              "{{.Attachable}}") printf 'false\n' ;;
              "{{json .Options}}") printf '{}\n' ;;
              "{{len .Containers}}") printf '1\n' ;;
              *) return 1 ;;
            esac
            ;;
          *) return 0 ;;
        esac
        ;;
      *) return 1 ;;
    esac
  }
  if ( ensure_swarm_network upstand-network false ); then
    echo "invalid attached network unexpectedly passed repair" >&2
    exit 1
  fi
)
valid_digest="$(printf 'a%.0s' {1..64})"

(
  docker() {
    if [[ "$1 $2" == "service create" ]]; then
      [[ "$*" == *"--network upstand-network"* && "$*" == *"--network upstand-docker-control"* && "$*" == *"--cap-drop ALL"* && "$*" == *"--user 10001:10001"* ]] || {
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
    printf '{\n  "schemaVersion": 1,\n  "version": "v1.2.3",\n  "images": [\n    {\n      "name": "server",\n      "image": "ghcr.io/upstandplatform/upstand-server:v1.2.3",\n      "digest": "sha256:%s"\n    },\n    {\n      "name": "schedules",\n      "image": "ghcr.io/upstandplatform/upstand-schedules:v1.2.3",\n      "digest": "sha256:%s"\n    },\n    {\n      "name": "deployment-worker",\n      "image": "ghcr.io/upstandplatform/upstand-deployment-worker:v1.2.3",\n      "digest": "sha256:%s"\n    },\n    {\n      "name": "web",\n      "image": "ghcr.io/upstandplatform/upstand-web:v1.2.3",\n      "digest": "sha256:%s"\n    },\n    {\n      "name": "fumadocs",\n      "image": "ghcr.io/upstandplatform/upstand-fumadocs:v1.2.3",\n      "digest": "sha256:%s"\n    },\n    {\n      "name": "monitoring",\n      "image": "ghcr.io/upstandplatform/upstand-monitoring:v1.2.3",\n      "digest": "sha256:%s"\n    },\n    {\n      "name": "docker-broker",\n      "image": "ghcr.io/upstandplatform/upstand-docker-broker:v1.2.3",\n      "digest": "sha256:%s"\n    }\n  ]\n}\n' "$valid_digest" "$valid_digest" "$valid_digest" "$valid_digest" "$valid_digest" "$valid_digest" "$valid_digest"
  }
  resolve_stable_image server
  for component in schedules deployment-worker web fumadocs monitoring docker-broker; do
    printf '\n%s' "$(resolve_stable_image "$component")"
  done
)"
expected_stable_images="ghcr.io/upstandplatform/upstand-server:v1.2.3@sha256:${valid_digest}
ghcr.io/upstandplatform/upstand-schedules:v1.2.3@sha256:${valid_digest}
ghcr.io/upstandplatform/upstand-deployment-worker:v1.2.3@sha256:${valid_digest}
ghcr.io/upstandplatform/upstand-web:v1.2.3@sha256:${valid_digest}
ghcr.io/upstandplatform/upstand-fumadocs:v1.2.3@sha256:${valid_digest}
ghcr.io/upstandplatform/upstand-monitoring:v1.2.3@sha256:${valid_digest}
ghcr.io/upstandplatform/upstand-docker-broker:v1.2.3@sha256:${valid_digest}"
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
  RELEASE_MANIFEST_CONTENT="$(printf '{\n  "artifacts": {\n    "dockerComposeProdSha256": "%s",\n    "productionAcceptanceSha256": "%s",\n    "productionEvidenceCollectSha256": "%s",\n    "verifyInstallationRecoveryEvidenceSha256": "%s",\n    "productionAcceptanceClusterSha256": "%s"\n  }\n}\n' "$artifact_hash" "$artifact_hash" "$artifact_hash" "$artifact_hash" "$artifact_hash")"
  verify_release_artifact_hash "$artifact_file" dockerComposeProdSha256
  verify_release_artifact_hash "$artifact_file" productionAcceptanceSha256
  RELEASE_MANIFEST_CONTENT="$(printf '{\n  "verifyInstallationRecoveryEvidenceSha256": "%s"\n}\n' "$artifact_hash")"
  verify_release_artifact_hash "$artifact_file" verifyInstallationRecoveryEvidenceSha256
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
RELEASE_MANIFEST_CONTENT="$(printf '{\n  "artifacts": {\n    "dockerComposeProdSha256": "%s",\n    "productionAcceptanceSha256": "%s",\n    "productionEvidenceCollectSha256": "%s",\n    "verifyInstallationRecoveryEvidenceSha256": "%s",\n    "productionAcceptanceClusterSha256": "%s"\n  }\n}\n' "$artifact_hash" "$artifact_hash" "$artifact_hash" "$artifact_hash" "$artifact_hash")"
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
assert_services $'postgres\nredis\ndocker-broker\nserver\nschedules\ndeployment-worker\nweb\nfumadocs' "${bundled_services[@]}"

UPSTAND_BUNDLED_POSTGRES_REPLICAS=0
UPSTAND_BUNDLED_REDIS_REPLICAS=0
mapfile -t external_services < <(required_stack_services)
assert_services $'docker-broker\nserver\nschedules\ndeployment-worker\nweb\nfumadocs' "${external_services[@]}"

echo "installer-contract: passed"
