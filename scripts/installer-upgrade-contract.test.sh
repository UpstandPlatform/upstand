#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ "${1:-}" == --write ]]; then
  # Redirect only the installation directory into this disposable fixture.
  # Exercise the real environment writer, manifest parser, validation, secret
  # persistence and certificate generation without accessing Docker or a host.
  source <(sed 's|readonly INSTALL_DIR="/etc/upstand"|readonly INSTALL_DIR="$TEST_INSTALL_DIR"|' "$ROOT_DIR/install.sh")
  export MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*'
  UPSTAND_VERSION="$2"
  parse_args "$3"
  SWARM_ADVERTISE_ADDR=192.0.2.10
  BETTER_AUTH_URL=https://api.example.test
  CORS_ORIGIN=https://app.example.test
  NEXT_PUBLIC_SERVER_URL=https://api.example.test
  TRUSTED_PROXY_CIDRS=10.0.0.0/24
  UPSTAND_DOCKER_GID=1000
  UPSTAND_DR_OFFSITE_CONFIRMED=true
  UPSTAND_DR_KEY_ESCROW_CONFIRMED=true
  UPSTAND_DR_IMMUTABLE_RETENTION_CONFIRMED=true
  UPSTAND_DR_RPO_SECONDS=3600
  UPSTAND_DR_RTO_SECONDS=3600
  UPSTAND_DR_EVIDENCE_REFERENCE=disposable-installer-test
  OTLP_ENDPOINT=https://telemetry.example.test
  digest="$(printf 'a%.0s' {1..64})"
  case "${4:-}" in
    external)
      DATABASE_URL=postgresql://test:test@db.example.test:5432/upstand
      REDIS_URL=rediss://test:test@cache.example.test:6379
      ;;
    mixed) DATABASE_URL=postgresql://test:test@db.example.test:5432/upstand ;;
    override) UPSTAND_SERVER_IMAGE="ghcr.io/example/custom-server@sha256:$digest" ;;
  esac
  docker() { echo 'unexpected Docker access in environment fixture' >&2; return 1; }
  curl() {
    [[ "$*" == *"/releases/download/${UPSTAND_VERSION}/upstand-release-manifest.json"* ]] || return 1
    printf '{\n  "schemaVersion": 1,\n  "version": "%s",\n  "images": [\n' "$UPSTAND_VERSION"
    local component separator=''
    for component in server schedules deployment-worker web fumadocs monitoring docker-broker; do
      printf '%s    {\n      "name": "%s",\n      "image": "ghcr.io/upstandplatform/upstand-%s:%s",\n      "digest": "sha256:%s"\n    }' "$separator" "$component" "$component" "$UPSTAND_VERSION" "$digest"
      separator=$',\n'
    done
    printf '\n  ]\n}\n'
  }
  write_environment "$SWARM_ADVERTISE_ADDR"
  exit
fi

fixture_dir="$(mktemp -d)"
trap 'rm -rf -- "$fixture_dir"' EXIT
installer_test="$ROOT_DIR/scripts/installer-upgrade-contract.test.sh"

run_install() {
  # A new process matches a real installer rerun: only persisted state and
  # explicitly supplied deployment options survive between invocations.
  env -i PATH="$PATH" SYSTEMROOT="${SYSTEMROOT:-}" TEMP="${TEMP:-/tmp}" \
    TEST_INSTALL_DIR="$fixture_dir" bash "$installer_test" --write "$@"
}

assert_install() (
  source "$fixture_dir/.env"
  [[ "$UPSTAND_VERSION" == "$1" ]] || { echo 'selected release was overwritten by saved environment' >&2; exit 1; }
  [[ "$IS_CLOUD" == "$2" ]] || { echo 'explicit installation mode was not persisted' >&2; exit 1; }
  [[ "$UPSTAND_BUNDLED_POSTGRES_REPLICAS" == "$3" && "$UPSTAND_BUNDLED_REDIS_REPLICAS" == "$3" ]] \
    || { echo 'installer changed the persisted data-service topology' >&2; exit 1; }
  for key in UPSTAND_SERVER_IMAGE UPSTAND_SCHEDULES_IMAGE UPSTAND_DEPLOYMENT_WORKER_IMAGE UPSTAND_WEB_IMAGE UPSTAND_DOCS_IMAGE UPSTAND_MONITORING_IMAGE UPSTAND_DOCKER_BROKER_IMAGE; do
    [[ "${!key}" == *":${1}@sha256:"* ]] || { echo "$key does not belong to the selected release" >&2; exit 1; }
  done
)

run_install v1.2.3 --self-hosted
assert_install v1.2.3 false 1
initial_secrets="$(find "$fixture_dir/secrets" -type f -exec sha256sum {} \; | sort)"

# Same-release repair must keep bundled databases running and credentials stable.
run_install v1.2.3 --self-hosted
assert_install v1.2.3 false 1
[[ "$(find "$fixture_dir/secrets" -type f -exec sha256sum {} \; | sort)" == "$initial_secrets" ]] \
  || { echo 'installer rerun rotated persisted secrets' >&2; exit 1; }

# Upgrading and changing tenancy mode must preserve the bundled data topology.
# Include the zero-replica state left behind by the old rerun bug.
sed -i \
  -e 's/UPSTAND_BUNDLED_POSTGRES_REPLICAS=1/UPSTAND_BUNDLED_POSTGRES_REPLICAS=0/' \
  -e 's/UPSTAND_BUNDLED_REDIS_REPLICAS=1/UPSTAND_BUNDLED_REDIS_REPLICAS=0/' \
  "$fixture_dir/.env"
run_install v1.3.0 --cloud
assert_install v1.3.0 true 1
[[ "$(find "$fixture_dir/secrets" -type f -exec sha256sum {} \; | sort)" == "$initial_secrets" ]] \
  || { echo 'upgrade changed persisted secrets' >&2; exit 1; }

# A partial move to external services must fail without changing durable state.
environment_before="$(sha256sum "$fixture_dir/.env")"
if run_install v1.3.0 --cloud mixed; then
  echo 'installer accepted mixed bundled and external services' >&2
  exit 1
fi
[[ "$(sha256sum "$fixture_dir/.env")" == "$environment_before" ]]
[[ "$(find "$fixture_dir/secrets" -type f -exec sha256sum {} \; | sort)" == "$initial_secrets" ]]

# Explicit external endpoints disable bundled replicas and survive later reruns.
run_install v1.3.0 --cloud external
assert_install v1.3.0 true 0
run_install v1.4.0 --cloud
assert_install v1.4.0 true 0
[[ "$(<"$fixture_dir/secrets/database_url")" == postgresql://test:test@db.example.test:5432/upstand ]]
[[ "$(<"$fixture_dir/secrets/redis_url")" == rediss://test:test@cache.example.test:6379 ]]

# An explicit image override remains supported, including on an upgrade.
run_install v1.5.0 --self-hosted override
(
  source "$fixture_dir/.env"
  [[ "$UPSTAND_SERVER_IMAGE" == ghcr.io/example/custom-server@sha256:* ]]
  [[ "$UPSTAND_WEB_IMAGE" == *:v1.5.0@sha256:* ]]
)
run_install v1.6.0 --self-hosted
assert_install v1.6.0 false 0

echo 'installer-upgrade-contract: passed'
