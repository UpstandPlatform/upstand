#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

# Production Docker Swarm installer. Stable installs resolve the selected
# published release images to immutable digests before deploying.

readonly INSTALL_DIR="/etc/upstand"
readonly ENV_FILE="$INSTALL_DIR/.env"
readonly SOURCE_DIR="$INSTALL_DIR/source"
readonly NETWORK_NAME="${DOCKER_NETWORK:-upstand-network}"
readonly CONTROL_NETWORK_NAME="${UPSTAND_DOCKER_CONTROL_NETWORK:-upstand-docker-control}"
readonly RECOMMENDED_CPU_CORES=2
readonly RECOMMENDED_MEMORY_BYTES=$((4 * 1024 * 1024 * 1024))
readonly RECOMMENDED_DISK_BYTES=$((30 * 1024 * 1024 * 1024))
readonly POSTGRES_VOLUME="upstand_postgres_data_v18"
readonly STABLE_IMAGE_REPOSITORY="${UPSTAND_IMAGE_REPOSITORY:-ghcr.io/upstandplatform/upstand}"
# BASH_SOURCE is an array only when Bash executes a file. A curl | bash install
# has no array element, so use the scalar expansion with a safe $0 fallback.
readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE:-$0}")" && pwd)"
STACK_FILE="$INSTALL_DIR/docker-compose.prod.yml"
INTERACTIVE=false
IS_CLOUD="${IS_CLOUD:-false}"
MODE_OVERRIDE=""
REGISTRY_LOGIN_PERFORMED=false
RELEASE_MANIFEST_CONTENT=""
RELEASE_MANIFEST_VERSION=""

usage() {
  cat <<'EOF'
Usage: install.sh [--interactive] [--cloud|--self-hosted]

The installer is non-interactive by default. Set deployment variables in the
environment before running it. Use --interactive to prompt for the Swarm
advertise address when installing from a terminal.

For private application images, set UPSTAND_REGISTRY, UPSTAND_REGISTRY_USERNAME,
and UPSTAND_REGISTRY_PASSWORD. The password is read from the environment only,
forwarded to the Swarm service specification, and removed from the local Docker
credential store after deployment.

Production installs use a constrained, mutually authenticated TLS Docker broker
for the control-plane Docker API and require an explicit acknowledgement for single-replica services:
UPSTAND_ALLOW_SINGLE_REPLICA=true. Configure
OTLP_ENDPOINT, or set UPSTAND_ALLOW_UNOBSERVED_PRODUCTION=true only when an
approved external telemetry path is unavailable.
For a durable HA data plane, provide DATABASE_URL and REDIS_URL (or the
UPSTAND_DATABASE_URL and UPSTAND_REDIS_URL aliases). The URLs are stored as
Docker secrets and the bundled PostgreSQL and Redis services are disabled.
Before installing, also record the recovery plan with
UPSTAND_DR_OFFSITE_CONFIRMED=true, UPSTAND_DR_KEY_ESCROW_CONFIRMED=true,
UPSTAND_DR_IMMUTABLE_RETENTION_CONFIRMED=true, positive
UPSTAND_DR_RPO_SECONDS and UPSTAND_DR_RTO_SECONDS, and a non-secret
UPSTAND_DR_EVIDENCE_REFERENCE. These values are an operator attestation and
traceability gate. Production acceptance additionally requires the signed
installation recovery evidence files documented in the production runbook.

Options:
  --interactive         prompt for the Swarm advertise address
  --cloud               install in multi-tenant Cloud mode (open sign-ups enabled)
  --self-hosted         install in single-tenant Self-Hosted mode (default, single owner account)
  --help                show this help
EOF
}

validate_production_operating_model() {
  [[ "${UPSTAND_ALLOW_SINGLE_REPLICA:-false}" == true ]] \
    || fail "the bundled PostgreSQL, Redis, and control-plane services are single-replica; set UPSTAND_ALLOW_SINGLE_REPLICA=true only after approving the external HA/PITR plan"

  local otlp_endpoint="${OTLP_ENDPOINT:-${OTEL_EXPORTER_OTLP_ENDPOINT:-}}"
  if [[ -z "$otlp_endpoint" ]]; then
    [[ "${UPSTAND_ALLOW_UNOBSERVED_PRODUCTION:-false}" == true ]] \
      || fail "configure OTLP_ENDPOINT or explicitly acknowledge missing telemetry with UPSTAND_ALLOW_UNOBSERVED_PRODUCTION=true"
  else
    [[ "$otlp_endpoint" == http://* || "$otlp_endpoint" == https://* ]] \
      || fail "OTLP_ENDPOINT must use HTTP or HTTPS"
  fi
}

validate_disaster_recovery_plan() {
  for confirmation in \
    "${UPSTAND_DR_OFFSITE_CONFIRMED:-false}" \
    "${UPSTAND_DR_KEY_ESCROW_CONFIRMED:-false}" \
    "${UPSTAND_DR_IMMUTABLE_RETENTION_CONFIRMED:-false}"; do
    [[ "$confirmation" == true ]] \
      || fail "the production recovery plan must confirm off-site storage, key escrow, and immutable retention"
  done

  [[ "${UPSTAND_DR_RPO_SECONDS:-}" =~ ^[1-9][0-9]*$ ]] \
    || fail "UPSTAND_DR_RPO_SECONDS must be a positive integer"
  [[ "${UPSTAND_DR_RTO_SECONDS:-}" =~ ^[1-9][0-9]*$ ]] \
    || fail "UPSTAND_DR_RTO_SECONDS must be a positive integer"
  (( UPSTAND_DR_RPO_SECONDS <= 31 * 24 * 60 * 60 )) \
    || fail "UPSTAND_DR_RPO_SECONDS must be at most 31 days"
  (( UPSTAND_DR_RTO_SECONDS <= 31 * 24 * 60 * 60 )) \
    || fail "UPSTAND_DR_RTO_SECONDS must be at most 31 days"

  [[ -n "${UPSTAND_DR_EVIDENCE_REFERENCE:-}" ]] \
    || fail "UPSTAND_DR_EVIDENCE_REFERENCE is required"
  [[ "${UPSTAND_DR_EVIDENCE_REFERENCE}" != *$'\r'* && "${UPSTAND_DR_EVIDENCE_REFERENCE}" != *$'\n'* ]] \
    || fail "UPSTAND_DR_EVIDENCE_REFERENCE must not contain newlines"
  [[ "${#UPSTAND_DR_EVIDENCE_REFERENCE}" -le 256 ]] \
    || fail "UPSTAND_DR_EVIDENCE_REFERENCE must be at most 256 characters"
}

parse_args() {
  while (($# > 0)); do
    case "$1" in
      --interactive) INTERACTIVE=true ;;
      --cloud) IS_CLOUD=true; MODE_OVERRIDE=true ;;
      --self-hosted) IS_CLOUD=false; MODE_OVERRIDE=false ;;
      --help|-h) usage; exit 0 ;;
      *) fail "unknown option '$1' (use --help for usage)" ;;
    esac
    shift
  done
}

fail() {
  echo "error: $*" >&2
  exit 1
}

write_env_assignment() {
  local key="$1"
  local value="$2"
  printf '%s=%q\n' "$key" "$value"
}

validate_replica_configuration() {
  local external_data="$1"
  local server_replicas="$2"
  local schedules_replicas="$3"
  local deployment_worker_replicas="$4"
  local web_replicas="$5"
  local fumadocs_replicas="$6"
  local postgres_replicas="$7"
  local redis_replicas="$8"
  local service_name replica_count

  for replica_count in \
    "$server_replicas" \
    "$schedules_replicas" \
    "$deployment_worker_replicas" \
    "$web_replicas" \
    "$fumadocs_replicas" \
    "$postgres_replicas" \
    "$redis_replicas"; do
    [[ "$replica_count" =~ ^[0-9]+$ ]] || fail "service replica counts must be non-negative integers"
  done
  for service_name in server schedules deployment-worker web fumadocs; do
    case "$service_name" in
      server) replica_count="$server_replicas" ;;
      schedules) replica_count="$schedules_replicas" ;;
      deployment-worker) replica_count="$deployment_worker_replicas" ;;
      web) replica_count="$web_replicas" ;;
      fumadocs) replica_count="$fumadocs_replicas" ;;
    esac
    [[ "$replica_count" =~ ^[1-9][0-9]*$ ]] \
      || fail "$service_name must have at least one replica"
  done
  if [[ "$external_data" == true ]]; then
    [[ "$postgres_replicas" == 0 && "$redis_replicas" == 0 ]] \
      || fail "external DATABASE_URL/REDIS_URL mode must disable bundled PostgreSQL and Redis"
  else
    [[ "$postgres_replicas" == 1 && "$redis_replicas" == 1 ]] \
      || fail "bundled PostgreSQL and Redis must each use exactly one replica; configure external DATABASE_URL and REDIS_URL for HA"
  fi
}

validate_swarm_network() {
  local network_name="$1"
  local driver="$2"
  local scope="$3"
  local attachable="$4"
  local options="$5"
  [[ "$driver" == "overlay" && "$scope" == "swarm" && "$attachable" == "true" \
    && "$options" == *'"encrypted"'* \
    && "$options" != *'"encrypted":false'* \
    && "$options" != *'"encrypted":"false"'* ]] \
    || fail "existing network '$network_name' must be an encrypted, attachable Swarm overlay network"
}

validate_control_network() {
  local network_name="$1"
  local driver="$2"
  local scope="$3"
  local attachable="$4"
  local internal="$5"
  local options="$6"
  validate_swarm_network "$network_name" "$driver" "$scope" "$attachable" "$options"
  [[ "$internal" == "true" ]] \
    || fail "Docker control network '$network_name' must be internal to prevent ingress from outside the Swarm overlay"
}

required_stack_services() {
  local services=(docker-broker server schedules deployment-worker web fumadocs)
  if [[ "${UPSTAND_BUNDLED_REDIS_REPLICAS:-1}" != 0 ]]; then
    services=(redis "${services[@]}")
  fi
  if [[ "${UPSTAND_BUNDLED_POSTGRES_REPLICAS:-1}" != 0 ]]; then
    services=(postgres "${services[@]}")
  fi
  printf '%s\n' "${services[@]}"
}

warn() {
  echo "warning: $*" >&2
}

require_root() {
  [[ "${EUID}" -eq 0 ]] || fail "run this installer as root"
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "required command '$1' is not available"
}

require_digest_image() {
  local name="$1"
  local image="${!name:-}"
  [[ "$image" =~ @sha256:[0-9a-fA-F]{64}$ ]] \
    || fail "$name must be set to an immutable 64-character SHA-256 image digest (for example ghcr.io/acme/image@sha256:...)"
}

ensure_host_dependencies() {
  local required_commands=(awk curl df git grep ip openssl)
  local missing=false
  local command_name

  for command_name in "${required_commands[@]}"; do
    if ! command -v "$command_name" >/dev/null 2>&1; then
      missing=true
      break
    fi
  done

  if [[ "$missing" == true ]]; then
    if command -v apt-get >/dev/null 2>&1; then
      apt-get update
      DEBIAN_FRONTEND=noninteractive apt-get install -y \
        ca-certificates coreutils curl gawk git grep iproute2 openssl
    elif command -v dnf >/dev/null 2>&1; then
      dnf install -y ca-certificates coreutils curl gawk git grep iproute openssl
    elif command -v yum >/dev/null 2>&1; then
      yum install -y ca-certificates coreutils curl gawk git grep iproute openssl
    else
      fail "missing required host utilities and no supported package manager was found"
    fi
  fi

  for command_name in "${required_commands[@]}"; do
    require_command "$command_name"
  done
}

check_host_resources() {
  local cpu_cores memory_bytes docker_root_dir disk_available_kib
  cpu_cores="$(nproc 2>/dev/null || true)"
  if [[ ! "$cpu_cores" =~ ^[0-9]+$ ]]; then
    cpu_cores=""
  fi

  if [[ -z "$cpu_cores" ]]; then
    warn "could not determine CPU count; recommended minimum is ${RECOMMENDED_CPU_CORES} vCPUs"
  elif ((cpu_cores < RECOMMENDED_CPU_CORES)); then
    warn "host has ${cpu_cores} vCPU(s); Upstand recommends at least ${RECOMMENDED_CPU_CORES}"
  fi

  memory_bytes="$(awk '/^MemTotal:/ { print $2 * 1024; exit }' /proc/meminfo 2>/dev/null || true)"
  if [[ ! "$memory_bytes" =~ ^[0-9]+$ ]]; then
    warn "could not determine host memory; Upstand recommends at least 4 GiB of RAM"
  elif ((memory_bytes < RECOMMENDED_MEMORY_BYTES)); then
    warn "host has less than the recommended 4 GiB of RAM; source builds or service startup may be slow"
  fi

  docker_root_dir="$(docker info --format '{{.DockerRootDir}}' 2>/dev/null || true)"
  docker_root_dir="${docker_root_dir:-/var/lib/docker}"
  disk_available_kib="$(df -Pk "$docker_root_dir" 2>/dev/null | awk 'NR == 2 { print $4 }')"
  if [[ ! "$disk_available_kib" =~ ^[0-9]+$ ]]; then
    warn "could not determine free disk space for Docker data at ${docker_root_dir}; Upstand recommends at least 30 GiB free"
  elif ((disk_available_kib * 1024 < RECOMMENDED_DISK_BYTES)); then
    warn "Docker data path ${docker_root_dir} has less than the recommended 30 GiB free"
  fi

  echo "Host resource check complete (recommendation: ${RECOMMENDED_CPU_CORES} vCPUs, 4 GiB RAM, 30 GiB free Docker disk)." >&2
}

ensure_git() {
  if command -v git >/dev/null 2>&1; then
    return
  fi
  command -v apt-get >/dev/null 2>&1 || fail "git is required to build from GitHub source; install git or provide immutable image digests"
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y git
}

build_source_images() {
  local repository="${UPSTAND_REPOSITORY:-https://github.com/upstandplatform/upstand.git}"
  local ref="${UPSTAND_REF:-master}"
  [[ "$repository" == https://github.com/*/*.git ]] || fail "UPSTAND_REPOSITORY must be a public HTTPS GitHub repository URL"
  [[ "$ref" =~ ^[A-Za-z0-9._/-]+$ ]] || fail "UPSTAND_REF contains unsupported characters"

  ensure_git
  rm -rf "$SOURCE_DIR"
  git clone --depth 1 --branch "$ref" "$repository" "$SOURCE_DIR"
  local revision
  revision="$(git -C "$SOURCE_DIR" rev-parse --verify HEAD)"

  UPSTAND_SERVER_IMAGE="upstand-server:source-${revision}"
  UPSTAND_SCHEDULES_IMAGE="upstand-schedules:source-${revision}"
  UPSTAND_DEPLOYMENT_WORKER_IMAGE="upstand-deployment-worker:source-${revision}"
  UPSTAND_WEB_IMAGE="upstand-web:source-${revision}"
  UPSTAND_DOCS_IMAGE="upstand-fumadocs:source-${revision}"
  UPSTAND_MONITORING_IMAGE="upstand-monitoring:source-${revision}"
  UPSTAND_DOCKER_BROKER_IMAGE="upstand-docker-broker:source-${revision}"

  docker build --file "$SOURCE_DIR/apps/server/Dockerfile" --tag "$UPSTAND_SERVER_IMAGE" "$SOURCE_DIR"
  docker build --file "$SOURCE_DIR/apps/schedules/Dockerfile" --tag "$UPSTAND_SCHEDULES_IMAGE" "$SOURCE_DIR"
  docker build --file "$SOURCE_DIR/apps/schedules/Dockerfile.worker" --tag "$UPSTAND_DEPLOYMENT_WORKER_IMAGE" "$SOURCE_DIR"
  docker build --file "$SOURCE_DIR/apps/web/Dockerfile" --build-arg "NEXT_PUBLIC_SERVER_URL=$NEXT_PUBLIC_SERVER_URL" --tag "$UPSTAND_WEB_IMAGE" "$SOURCE_DIR"
  docker build --file "$SOURCE_DIR/apps/fumadocs/Dockerfile" --tag "$UPSTAND_DOCS_IMAGE" "$SOURCE_DIR"
  docker build --file "$SOURCE_DIR/apps/monitoring/Dockerfile" \
    --build-arg "GOPROXY=${GOPROXY:-https://proxy.golang.org|direct}" \
    --tag "$UPSTAND_MONITORING_IMAGE" "$SOURCE_DIR/apps/monitoring"
  docker build --file "$SOURCE_DIR/apps/docker-broker/Dockerfile" \
    --tag "$UPSTAND_DOCKER_BROKER_IMAGE" "$SOURCE_DIR/apps/docker-broker"
  SOURCE_BUILD=true
}

load_release_manifest() {
  local release_ref="${UPSTAND_VERSION:-}"
  [[ "$release_ref" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] \
    || fail "UPSTAND_VERSION must be a stable semver release tag before resolving published images"
  if [[ "$RELEASE_MANIFEST_VERSION" == "$release_ref" ]]; then
    return
  fi

  local repository="${UPSTAND_REPOSITORY:-https://github.com/upstandplatform/upstand.git}"
  local raw_repository="${repository%.git}"
  [[ "$raw_repository" == https://github.com/*/* ]] \
    || fail "UPSTAND_REPOSITORY must be a public HTTPS GitHub repository URL"
  raw_repository="${raw_repository#https://github.com/}"

  RELEASE_MANIFEST_CONTENT="$(curl --fail --show-error --silent --location \
    --connect-timeout 10 --max-time 60 --retry 3 --retry-all-errors \
    "https://github.com/${raw_repository}/releases/download/${release_ref}/upstand-release-manifest.json")" \
    || fail "could not download the immutable release manifest for $release_ref; check GitHub connectivity"

  local schema_version manifest_version
  schema_version="$(sed -nE 's/^[[:space:]]*"schemaVersion"[[:space:]]*:[[:space:]]*([0-9]+).*/\1/p' <<<"$RELEASE_MANIFEST_CONTENT" | sed -n '1p')"
  [[ "$schema_version" == 1 ]] \
    || fail "release manifest for $release_ref has an unsupported schema version"
  manifest_version="$(sed -nE 's/^[[:space:]]*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p' <<<"$RELEASE_MANIFEST_CONTENT" | sed -n '1p')"
  [[ "$manifest_version" == "$release_ref" ]] \
    || fail "release manifest version does not match the selected release $release_ref"
  RELEASE_MANIFEST_VERSION="$release_ref"
}

resolve_stable_image() {
  local component="$1"
  case "$component" in
    server|schedules|deployment-worker|web|fumadocs|monitoring|docker-broker) ;;
    *) fail "unsupported published image component '$component'" ;;
  esac

  local release_ref="${UPSTAND_VERSION:-}"
  [[ "$release_ref" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] \
    || fail "UPSTAND_VERSION must be a stable semver release tag before resolving published images"
  load_release_manifest

  local name_pattern="^[[:space:]]*\"name\"[[:space:]]*:[[:space:]]*\"${component}\""
  local image digest expected_image
  image="$(sed -nE "/${name_pattern}/,/^[[:space:]]*}[,]?[[:space:]]*$/ { s/^[[:space:]]*\"image\"[[:space:]]*:[[:space:]]*\"([^\"]+)\"[,]?[[:space:]]*$/\1/p; }" <<<"$RELEASE_MANIFEST_CONTENT" | sed -n '1p')"
  digest="$(sed -nE "/${name_pattern}/,/^[[:space:]]*}[,]?[[:space:]]*$/ { s/^[[:space:]]*\"digest\"[[:space:]]*:[[:space:]]*\"([^\"]+)\"[,]?[[:space:]]*$/\1/p; }" <<<"$RELEASE_MANIFEST_CONTENT" | sed -n '1p')"
  expected_image="${STABLE_IMAGE_REPOSITORY}-${component}:${release_ref}"
  [[ "$image" == "$expected_image" ]] \
    || fail "release manifest image for $component does not match the selected repository and release"
  [[ "$digest" =~ ^sha256:[a-f0-9]{64}$ ]] \
    || fail "release manifest image for $component did not provide an immutable digest"
  printf '%s@%s' "$image" "$digest"
}

resolve_stable_release_ref() {
  local repository="${UPSTAND_REPOSITORY:-https://github.com/upstandplatform/upstand.git}"
  local raw_repository="${repository%.git}"
  local release_json release_ref

  [[ "$raw_repository" == https://github.com/*/* ]] \
    || fail "UPSTAND_REPOSITORY must be a public HTTPS GitHub repository URL"
  raw_repository="${raw_repository#https://github.com/}"

  release_json="$(curl --fail --show-error --silent --location \
    --connect-timeout 10 --max-time 60 --retry 3 --retry-all-errors \
    -H 'Accept: application/vnd.github+json' \
    -H 'X-GitHub-Api-Version: 2022-11-28' \
    "https://api.github.com/repos/${raw_repository}/releases/latest")" \
    || fail "could not resolve the latest stable release; check GitHub connectivity"
  release_ref="$(sed -nE 's/.*"tag_name"[[:space:]]*:[[:space:]]*"(v[0-9]+\.[0-9]+\.[0-9]+)".*/\1/p' <<<"$release_json" | head -n1)"
  [[ "$release_ref" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] \
    || fail "GitHub latest release did not provide a stable semver tag"
  printf '%s' "$release_ref"
}

verify_release_artifact_hash() {
  local path="$1"
  local field="$2"
  local expected actual

  case "$field" in
    dockerComposeProdSha256)
      expected="$(sed -nE 's/^[[:space:]]*"dockerComposeProdSha256"[[:space:]]*:[[:space:]]*"([a-f0-9]{64})"[,]?[[:space:]]*$/\1/p' <<<"$RELEASE_MANIFEST_CONTENT" | sed -n '1p')"
      ;;
    productionAcceptanceSha256)
      expected="$(sed -nE 's/^[[:space:]]*"productionAcceptanceSha256"[[:space:]]*:[[:space:]]*"([a-f0-9]{64})"[,]?[[:space:]]*$/\1/p' <<<"$RELEASE_MANIFEST_CONTENT" | sed -n '1p')"
      ;;
    productionEvidenceCollectSha256)
      expected="$(sed -nE 's/^[[:space:]]*"productionEvidenceCollectSha256"[[:space:]]*:[[:space:]]*"([a-f0-9]{64})"[,]?[[:space:]]*$/\1/p' <<<"$RELEASE_MANIFEST_CONTENT" | sed -n '1p')"
      ;;
    verifyInstallationRecoveryEvidenceSha256)
      expected="$(sed -nE 's/^[[:space:]]*"verifyInstallationRecoveryEvidenceSha256"[[:space:]]*:[[:space:]]*"([a-f0-9]{64})"[,]?[[:space:]]*$/\1/p' <<<"$RELEASE_MANIFEST_CONTENT" | sed -n '1p')"
      ;;
    productionAcceptanceClusterSha256)
      expected="$(sed -nE 's/^[[:space:]]*"productionAcceptanceClusterSha256"[[:space:]]*:[[:space:]]*"([a-f0-9]{64})"[,]?[[:space:]]*$/\1/p' <<<"$RELEASE_MANIFEST_CONTENT" | sed -n '1p')"
      ;;
    *)
      fail "unsupported release artifact manifest field '$field'"
      ;;
  esac
  [[ "$expected" =~ ^[a-f0-9]{64}$ ]] \
    || fail "release manifest did not provide a valid $field hash"
  require_command sha256sum
  actual="$(sha256sum -- "$path" | awk '{print $1}')"
  [[ "$actual" == "$expected" ]] \
    || fail "downloaded release artifact '$path' does not match the manifest $field hash"
}

release_manifest_has_artifact_hashes() {
  local compose_hash acceptance_hash evidence_hash recovery_hash cluster_hash
  compose_hash="$(sed -nE 's/^[[:space:]]*"dockerComposeProdSha256"[[:space:]]*:[[:space:]]*"([a-f0-9]{64})"[,]?[[:space:]]*$/\1/p' <<<"$RELEASE_MANIFEST_CONTENT" | sed -n '1p')"
  acceptance_hash="$(sed -nE 's/^[[:space:]]*"productionAcceptanceSha256"[[:space:]]*:[[:space:]]*"([a-f0-9]{64})"[,]?[[:space:]]*$/\1/p' <<<"$RELEASE_MANIFEST_CONTENT" | sed -n '1p')"
  evidence_hash="$(sed -nE 's/^[[:space:]]*"productionEvidenceCollectSha256"[[:space:]]*:[[:space:]]*"([a-f0-9]{64})"[,]?[[:space:]]*$/\1/p' <<<"$RELEASE_MANIFEST_CONTENT" | sed -n '1p')"
  recovery_hash="$(sed -nE 's/^[[:space:]]*"verifyInstallationRecoveryEvidenceSha256"[[:space:]]*:[[:space:]]*"([a-f0-9]{64})"[,]?[[:space:]]*$/\1/p' <<<"$RELEASE_MANIFEST_CONTENT" | sed -n '1p')"
  cluster_hash="$(sed -nE 's/^[[:space:]]*\"productionAcceptanceClusterSha256\"[[:space:]]*:[[:space:]]*\"([a-f0-9]{64})\"[,]?[[:space:]]*$/\1/p' <<<"$RELEASE_MANIFEST_CONTENT" | sed -n '1p')"
  [[ "$compose_hash" =~ ^[a-f0-9]{64}$ && "$acceptance_hash" =~ ^[a-f0-9]{64}$ && "$evidence_hash" =~ ^[a-f0-9]{64}$ && "$recovery_hash" =~ ^[a-f0-9]{64}$ && "$cluster_hash" =~ ^[a-f0-9]{64}$ ]]
}

verify_release_deployment_artifacts() {
  local stack_file="$1"
  local acceptance_file="$2"
  local evidence_file="${3:-}"
  local recovery_file="${4:-}"
  local cluster_file="${5:-}"

  if release_manifest_has_artifact_hashes; then
    verify_release_artifact_hash "$stack_file" dockerComposeProdSha256
    verify_release_artifact_hash "$acceptance_file" productionAcceptanceSha256
    verify_release_artifact_hash "$evidence_file" productionEvidenceCollectSha256
    verify_release_artifact_hash "$recovery_file" verifyInstallationRecoveryEvidenceSha256
    verify_release_artifact_hash "$cluster_file" productionAcceptanceClusterSha256
  else
    fail "release $UPSTAND_VERSION is missing required deployment-artifact hashes"
  fi
}

ensure_stack_file() {
  install -d -m 0700 "$INSTALL_DIR"
  local repository="${UPSTAND_REPOSITORY:-https://github.com/upstandplatform/upstand.git}"
  local ref="${UPSTAND_REF:-${UPSTAND_VERSION:-}}"
  if [[ -z "$ref" ]]; then
    if [[ "${UPSTAND_BUILD_FROM_SOURCE:-false}" == true ]]; then
      ref="master"
    else
      ref="$(resolve_stable_release_ref)"
    fi
  fi
  # The stack file and every published application image must come from the
  # same immutable release tag. A mutable channel tag would allow a mixed
  # release or fail because the release workflow publishes versioned tags.
  UPSTAND_VERSION="${UPSTAND_VERSION:-$ref}"
  local raw_repository="${repository%.git}"
  raw_repository="${raw_repository#https://github.com/}"
  curl --fail --show-error --silent --location \
    --connect-timeout 10 --max-time 60 --retry 3 --retry-all-errors \
    "https://raw.githubusercontent.com/${raw_repository}/${ref}/docker-compose.prod.yml" \
    --output "$STACK_FILE"
  chmod 0600 "$STACK_FILE"
  curl --fail --show-error --silent --location \
    --connect-timeout 10 --max-time 60 --retry 3 --retry-all-errors \
    "https://raw.githubusercontent.com/${raw_repository}/${ref}/scripts/production-acceptance.sh" \
    --output "$INSTALL_DIR/production-acceptance.sh"
  chmod 0755 "$INSTALL_DIR/production-acceptance.sh"
  curl --fail --show-error --silent --location \
    --connect-timeout 10 --max-time 60 --retry 3 --retry-all-errors \
    "https://raw.githubusercontent.com/${raw_repository}/${ref}/scripts/production-evidence-collect.sh" \
    --output "$INSTALL_DIR/production-evidence-collect.sh"
  chmod 0755 "$INSTALL_DIR/production-evidence-collect.sh"
  curl --fail --show-error --silent --location \
    --connect-timeout 10 --max-time 60 --retry 3 --retry-all-errors \
    "https://raw.githubusercontent.com/${raw_repository}/${ref}/scripts/verify-installation-recovery-evidence.sh" \
    --output "$INSTALL_DIR/verify-installation-recovery-evidence.sh"
  chmod 0755 "$INSTALL_DIR/verify-installation-recovery-evidence.sh"
  curl --fail --show-error --silent --location \
    --connect-timeout 10 --max-time 60 --retry 3 --retry-all-errors \
    "https://raw.githubusercontent.com/${raw_repository}/${ref}/scripts/production-acceptance-cluster.sh" \
    --output "$INSTALL_DIR/production-acceptance-cluster.sh"
  chmod 0755 "$INSTALL_DIR/production-acceptance-cluster.sh"
  if [[ "${UPSTAND_BUILD_FROM_SOURCE:-false}" != true ]]; then
    load_release_manifest
    verify_release_deployment_artifacts \
      "$STACK_FILE" \
      "$INSTALL_DIR/production-acceptance.sh" \
      "$INSTALL_DIR/production-evidence-collect.sh" \
      "$INSTALL_DIR/verify-installation-recovery-evidence.sh" \
      "$INSTALL_DIR/production-acceptance-cluster.sh"
  fi
}

detect_advertise_address() {
  local address="${SWARM_ADVERTISE_ADDR:-}"
  if [[ -z "$address" ]]; then
    local detected
    detected="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i = 1; i <= NF; i++) if ($i == "src") { print $(i + 1); exit }}' || true)"
    if [[ -z "$detected" ]]; then
      detected="$(ip -4 -o addr show scope global 2>/dev/null | awk '{split($4, address, "/"); print address[1]; exit}' || true)"
    fi
    if [[ "$INTERACTIVE" == true ]]; then
      read -r -p "Swarm Advertise IP Address [${detected}]: " input_address
      address="${input_address:-$detected}"
    else
      address="$detected"
    fi
  fi
  [[ -n "$address" ]] || fail "set SWARM_ADVERTISE_ADDR to a routable private or public IPv4/IPv6 address"
  [[ "$address" != 127.* && "$address" != "0.0.0.0" && "$address" != "::1" && "$address" != "::" ]] || fail "SWARM_ADVERTISE_ADDR must not be loopback or unspecified"
  printf '%s' "$address"
}

ensure_docker() {
  if command -v docker >/dev/null 2>&1; then
    return
  fi

  if [[ "${UPSTAND_ALLOW_DOCKER_INSTALL:-false}" != "true" ]]; then
    fail "Docker is not installed. Install Docker Engine from your operating system's signed package repository, or set UPSTAND_ALLOW_DOCKER_INSTALL=true to explicitly permit the upstream installer script."
  fi

  require_command curl
  log "Docker not found; installing Docker Engine because UPSTAND_ALLOW_DOCKER_INSTALL=true..."
  curl --fail --show-error --silent --location \
    --connect-timeout 10 --max-time 120 --retry 3 --retry-all-errors \
    https://get.docker.com | sh

  if command -v systemctl >/dev/null 2>&1; then
    systemctl enable --now docker
  elif ! docker info >/dev/null 2>&1; then
    fail "Docker is installed but its daemon is not running and systemctl is unavailable"
  fi
  docker version >/dev/null
}

ensure_swarm() {
  local advertise_address="$1"
  local status
  status="$(docker info --format '{{.Swarm.LocalNodeState}}' 2>/dev/null || true)"

  if [[ "$status" != "active" ]]; then
    docker swarm init --advertise-addr "$advertise_address" --data-path-port 4789
  fi

  docker swarm update --task-history-limit 1

  [[ "$(docker info --format '{{.Swarm.ControlAvailable}}')" == "true" ]] || fail "this host is a Swarm worker; run the installer on a reachable manager"

  local node_id
  node_id="$(docker info --format '{{.Swarm.NodeID}}')"
  docker node update --label-add upstand.control-plane=true "$node_id" >/dev/null

  if ! docker network inspect "$NETWORK_NAME" >/dev/null 2>&1; then
    docker network create --driver overlay --opt encrypted --attachable --label com.upstand.managed=true "$NETWORK_NAME" >/dev/null
  fi

  local driver scope attachable internal options
  driver="$(docker network inspect --format '{{.Driver}}' "$NETWORK_NAME")"
  scope="$(docker network inspect --format '{{.Scope}}' "$NETWORK_NAME")"
  attachable="$(docker network inspect --format '{{.Attachable}}' "$NETWORK_NAME")"
  options="$(docker network inspect --format '{{json .Options}}' "$NETWORK_NAME")"
  validate_swarm_network "$NETWORK_NAME" "$driver" "$scope" "$attachable" "$options"

  [[ "$CONTROL_NETWORK_NAME" != "$NETWORK_NAME" ]] \
    || fail "UPSTAND_DOCKER_CONTROL_NETWORK must be distinct from DOCKER_NETWORK"
  if ! docker network inspect "$CONTROL_NETWORK_NAME" >/dev/null 2>&1; then
    docker network create --driver overlay --opt encrypted --attachable --internal --label com.upstand.managed=true "$CONTROL_NETWORK_NAME" >/dev/null
  fi
  driver="$(docker network inspect --format '{{.Driver}}' "$CONTROL_NETWORK_NAME")"
  scope="$(docker network inspect --format '{{.Scope}}' "$CONTROL_NETWORK_NAME")"
  attachable="$(docker network inspect --format '{{.Attachable}}' "$CONTROL_NETWORK_NAME")"
  internal="$(docker network inspect --format '{{.Internal}}' "$CONTROL_NETWORK_NAME")"
  options="$(docker network inspect --format '{{json .Options}}' "$CONTROL_NETWORK_NAME")"
  validate_control_network "$CONTROL_NETWORK_NAME" "$driver" "$scope" "$attachable" "$internal" "$options"
}

validate_swarm_network_runtime() {
  local probe_name="upstand-network-probe-${RANDOM}-${RANDOM}"
  local probe_image="${UPSTAND_SERVER_IMAGE:-}"
  [[ -n "$probe_image" ]] || fail "cannot validate the encrypted network before resolving the server image"

  docker service create \
    --name "$probe_name" \
    --network "$NETWORK_NAME" \
    --network "$CONTROL_NETWORK_NAME" \
    --cap-drop ALL \
    --user "10001:10001" \
    --entrypoint /bin/true \
    --restart-condition none \
    --with-registry-auth \
    "$probe_image" >/dev/null \
    || fail "Docker could not create the encrypted-network runtime probe"

  local state
  for _ in {1..120}; do
    state="$(docker service ps "$probe_name" --no-trunc --format '{{.CurrentState}}' 2>/dev/null | head -n1 || true)"
    if [[ "$state" == Complete* ]]; then
      docker service rm "$probe_name" >/dev/null 2>&1 || true
      return 0
    fi
    if [[ "$state" == Rejected* || "$state" == Failed* ]]; then
      docker service ps "$probe_name" --no-trunc >&2 || true
      docker service rm "$probe_name" >/dev/null 2>&1 || true
      fail "Docker cannot attach service tasks to encrypted network '$NETWORK_NAME': $state"
    fi
    sleep 1
  done

  docker service ps "$probe_name" --no-trunc >&2 || true
  docker service rm "$probe_name" >/dev/null 2>&1 || true
  fail "timed out validating encrypted network '$NETWORK_NAME' runtime support"
}

ensure_docker_broker_mtls() {
  local secrets_dir="${1:-$INSTALL_DIR/secrets}"
  local required_file
  local regenerate=false
  for required_file in \
    docker_broker_ca \
    docker_broker_ca_key \
    docker_broker_server_cert \
    docker_broker_server_key \
    docker_broker_server_client_cert \
    docker_broker_server_client_key \
    docker_broker_schedules_client_cert \
    docker_broker_schedules_client_key \
    docker_broker_deployment_worker_client_cert \
    docker_broker_deployment_worker_client_key; do
    if [[ ! -s "$secrets_dir/$required_file" ]]; then
      regenerate=true
      break
    fi
  done
  if [[ "$regenerate" == false ]]; then
    if ! validate_docker_broker_mtls_files "$secrets_dir"; then
      regenerate=true
    fi
  fi
  [[ "$regenerate" == true ]] || return 0

  local temporary_dir
  temporary_dir="$(mktemp -d "$secrets_dir/.docker-broker-mtls.XXXXXX")"
  local cleanup_status=0
  (
    set -euo pipefail
    umask 077
    openssl genrsa -out "$temporary_dir/docker_broker_ca_key" 4096 >/dev/null 2>&1
    openssl req -x509 -new -sha256 \
      -key "$temporary_dir/docker_broker_ca_key" \
      -out "$temporary_dir/docker_broker_ca" \
      -days 3650 \
      -subj "/CN=Upstand Docker Broker CA" >/dev/null 2>&1

    issue_certificate() {
      local name="$1"
      local common_name="$2"
      local usage="$3"
      local san="$4"
      openssl genrsa -out "$temporary_dir/${name}_key" 3072 >/dev/null 2>&1
      openssl req -new -sha256 \
        -key "$temporary_dir/${name}_key" \
        -out "$temporary_dir/${name}.csr" \
        -subj "/CN=$common_name" >/dev/null 2>&1
      cat >"$temporary_dir/${name}.ext" <<EOF
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=critical,$usage
subjectAltName=$san
EOF
      openssl x509 -req -sha256 \
        -in "$temporary_dir/${name}.csr" \
        -CA "$temporary_dir/docker_broker_ca" \
        -CAkey "$temporary_dir/docker_broker_ca_key" \
        -CAcreateserial \
        -out "$temporary_dir/${name}_cert" \
        -days 825 \
        -extfile "$temporary_dir/${name}.ext" >/dev/null 2>&1
    }

    issue_certificate server upstand-docker-broker serverAuth "DNS:docker-broker,DNS:localhost"
    issue_certificate server_client upstand-server clientAuth "DNS:upstand-server"
    issue_certificate schedules_client upstand-schedules clientAuth "DNS:upstand-schedules"
    issue_certificate deployment_worker_client upstand-deployment-worker clientAuth "DNS:upstand-deployment-worker"

    install -m 0600 "$temporary_dir/docker_broker_ca" "$secrets_dir/docker_broker_ca"
    install -m 0600 "$temporary_dir/docker_broker_ca_key" "$secrets_dir/docker_broker_ca_key"
    install -m 0600 "$temporary_dir/server_cert" "$secrets_dir/docker_broker_server_cert"
    install -m 0600 "$temporary_dir/server_key" "$secrets_dir/docker_broker_server_key"
    install -m 0600 "$temporary_dir/server_client_cert" "$secrets_dir/docker_broker_server_client_cert"
    install -m 0600 "$temporary_dir/server_client_key" "$secrets_dir/docker_broker_server_client_key"
    install -m 0600 "$temporary_dir/schedules_client_cert" "$secrets_dir/docker_broker_schedules_client_cert"
    install -m 0600 "$temporary_dir/schedules_client_key" "$secrets_dir/docker_broker_schedules_client_key"
    install -m 0600 "$temporary_dir/deployment_worker_client_cert" "$secrets_dir/docker_broker_deployment_worker_client_cert"
    install -m 0600 "$temporary_dir/deployment_worker_client_key" "$secrets_dir/docker_broker_deployment_worker_client_key"
  ) || cleanup_status=$?
  rm -r -- "$temporary_dir"
  rm -f -- "$secrets_dir/.docker-broker-mtls.srl" "$secrets_dir/docker_broker_ca.srl"
  ((cleanup_status == 0)) || fail "could not generate the Docker broker mTLS identity"
}

validate_docker_broker_mtls_files() {
  local secrets_dir="$1"
  local server_cert="$secrets_dir/docker_broker_server_cert"
  local server_key="$secrets_dir/docker_broker_server_key"
  local server_client_cert="$secrets_dir/docker_broker_server_client_cert"
  local server_client_key="$secrets_dir/docker_broker_server_client_key"
  local schedules_client_cert="$secrets_dir/docker_broker_schedules_client_cert"
  local schedules_client_key="$secrets_dir/docker_broker_schedules_client_key"
  local deployment_worker_client_cert="$secrets_dir/docker_broker_deployment_worker_client_cert"
  local deployment_worker_client_key="$secrets_dir/docker_broker_deployment_worker_client_key"
  local ca="$secrets_dir/docker_broker_ca"

  openssl x509 -checkend $((30 * 86400)) -noout -in "$ca" >/dev/null 2>&1 \
    && openssl x509 -checkend $((30 * 86400)) -noout -in "$server_cert" >/dev/null 2>&1 \
    && openssl x509 -checkend $((30 * 86400)) -noout -in "$server_client_cert" >/dev/null 2>&1 \
    && openssl x509 -checkend $((30 * 86400)) -noout -in "$schedules_client_cert" >/dev/null 2>&1 \
    && openssl x509 -checkend $((30 * 86400)) -noout -in "$deployment_worker_client_cert" >/dev/null 2>&1 \
    && openssl verify -purpose sslserver -CAfile "$ca" "$server_cert" >/dev/null 2>&1 \
    && openssl verify -purpose sslclient -CAfile "$ca" "$server_client_cert" >/dev/null 2>&1 \
    && openssl verify -purpose sslclient -CAfile "$ca" "$schedules_client_cert" >/dev/null 2>&1 \
    && openssl verify -purpose sslclient -CAfile "$ca" "$deployment_worker_client_cert" >/dev/null 2>&1 \
    && [[ "$(openssl x509 -in "$server_cert" -noout -subject -nameopt RFC2253)" == "subject=CN=upstand-docker-broker" ]] \
    && [[ "$(openssl x509 -in "$server_client_cert" -noout -subject -nameopt RFC2253)" == "subject=CN=upstand-server" ]] \
    && [[ "$(openssl x509 -in "$schedules_client_cert" -noout -subject -nameopt RFC2253)" == "subject=CN=upstand-schedules" ]] \
    && [[ "$(openssl x509 -in "$deployment_worker_client_cert" -noout -subject -nameopt RFC2253)" == "subject=CN=upstand-deployment-worker" ]] \
    && openssl x509 -in "$server_cert" -noout -ext subjectAltName 2>/dev/null | grep -Fq 'DNS:docker-broker' \
    && [[ "$(openssl x509 -in "$server_cert" -noout -modulus | openssl dgst -sha256)" == "$(openssl rsa -in "$server_key" -noout -modulus 2>/dev/null | openssl dgst -sha256)" ]] \
    && [[ "$(openssl x509 -in "$server_client_cert" -noout -modulus | openssl dgst -sha256)" == "$(openssl rsa -in "$server_client_key" -noout -modulus 2>/dev/null | openssl dgst -sha256)" ]] \
    && [[ "$(openssl x509 -in "$schedules_client_cert" -noout -modulus | openssl dgst -sha256)" == "$(openssl rsa -in "$schedules_client_key" -noout -modulus 2>/dev/null | openssl dgst -sha256)" ]] \
    && [[ "$(openssl x509 -in "$deployment_worker_client_cert" -noout -modulus | openssl dgst -sha256)" == "$(openssl rsa -in "$deployment_worker_client_key" -noout -modulus 2>/dev/null | openssl dgst -sha256)" ]]
}

write_environment() {
  install -d -m 0700 "$INSTALL_DIR"
  install -d -m 0700 "$INSTALL_DIR/secrets"

  local advertise_address="${1:-}"

  local requested_better_auth_url="${BETTER_AUTH_URL:-}"
  local requested_cors_origin="${CORS_ORIGIN:-}"
  local requested_server_url="${NEXT_PUBLIC_SERVER_URL:-}"
  local requested_trusted_proxy_cidrs="${TRUSTED_PROXY_CIDRS:-}"
  local requested_server_image="${UPSTAND_SERVER_IMAGE:-}"
  local requested_schedules_image="${UPSTAND_SCHEDULES_IMAGE:-}"
  local requested_deployment_worker_image="${UPSTAND_DEPLOYMENT_WORKER_IMAGE:-}"
  local requested_web_image="${UPSTAND_WEB_IMAGE:-}"
  local requested_docs_image="${UPSTAND_DOCS_IMAGE:-}"
  local requested_monitoring_image="${UPSTAND_MONITORING_IMAGE:-}"
  local requested_docker_broker_image="${UPSTAND_DOCKER_BROKER_IMAGE:-}"
  local requested_auto_update="${UPSTAND_AUTO_UPDATE:-}"
  local requested_allow_unobserved_production="${UPSTAND_ALLOW_UNOBSERVED_PRODUCTION:-}"
  local requested_audit_log_retention_days="${UPSTAND_AUDIT_LOG_RETENTION_DAYS:-}"
  local requested_otlp_endpoint="${OTLP_ENDPOINT:-${OTEL_EXPORTER_OTLP_ENDPOINT:-}}"
  local requested_allow_insecure_bootstrap="${UPSTAND_ALLOW_INSECURE_BOOTSTRAP:-}"
  local requested_migration_id="${UPSTAND_MIGRATION_ID:-}"
  local requested_version="${UPSTAND_VERSION:-}"
  local requested_database_url="${DATABASE_URL:-${UPSTAND_DATABASE_URL:-}}"
  local requested_redis_url="${REDIS_URL:-${UPSTAND_REDIS_URL:-}}"
  local requested_auth_cookie_domain="${AUTH_COOKIE_DOMAIN:-}"
  local requested_trusted_proxy_headers="${TRUSTED_PROXY_HEADERS:-}"
  local requested_instance_owner_user_id="${UPSTAND_INSTANCE_OWNER_USER_ID:-}"
  local requested_instance_owner_email="${UPSTAND_INSTANCE_OWNER_EMAIL:-}"
  local requested_control_plane_fingerprint="${UPSTAND_CONTROL_PLANE_SSH_HOST_KEY_FINGERPRINT:-}"
  local requested_docker_version="${UPSTAND_DOCKER_VERSION:-}"
  local requested_outbound_allowed_hosts="${UPSTAND_OUTBOUND_ALLOWED_HOSTS:-}"
  local requested_secret_provider_allowed_hosts="${UPSTAND_SECRET_PROVIDER_ALLOWED_HOSTS:-}"
  local requested_git_provider_allowed_hosts="${UPSTAND_GIT_PROVIDER_ALLOWED_HOSTS:-}"
  local requested_backup_command_timeout_ms="${UPSTAND_BACKUP_COMMAND_TIMEOUT_MS:-}"
  local requested_dr_offsite_confirmed="${UPSTAND_DR_OFFSITE_CONFIRMED:-}"
  local requested_dr_key_escrow_confirmed="${UPSTAND_DR_KEY_ESCROW_CONFIRMED:-}"
  local requested_dr_immutable_retention_confirmed="${UPSTAND_DR_IMMUTABLE_RETENTION_CONFIRMED:-}"
  local requested_dr_rpo_seconds="${UPSTAND_DR_RPO_SECONDS:-}"
  local requested_dr_rto_seconds="${UPSTAND_DR_RTO_SECONDS:-}"
  local requested_dr_evidence_reference="${UPSTAND_DR_EVIDENCE_REFERENCE:-}"
  local requested_upgal_daily_cost_limit_usd="${UPGAL_DAILY_COST_LIMIT_USD:-}"
  local requested_upgal_max_cost_per_million_tokens_usd="${UPGAL_MAX_COST_PER_MILLION_TOKENS_USD:-}"
  local requested_upgal_allowed_models="${UPGAL_ALLOWED_MODELS:-}"
  local requested_database_pool_max="${UPSTAND_DATABASE_POOL_MAX:-}"
  local requested_database_pool_idle_timeout_ms="${UPSTAND_DATABASE_POOL_IDLE_TIMEOUT_MS:-}"
  local requested_database_pool_connection_timeout_ms="${UPSTAND_DATABASE_POOL_CONNECTION_TIMEOUT_MS:-}"
  local requested_bundled_postgres_replicas="${UPSTAND_BUNDLED_POSTGRES_REPLICAS:-}"
  local requested_bundled_redis_replicas="${UPSTAND_BUNDLED_REDIS_REPLICAS:-}"
  local requested_server_replicas="${UPSTAND_SERVER_REPLICAS:-}"
  local requested_schedules_replicas="${UPSTAND_SCHEDULES_REPLICAS:-}"
  local requested_deployment_worker_replicas="${UPSTAND_DEPLOYMENT_WORKER_REPLICAS:-}"
  local requested_web_replicas="${UPSTAND_WEB_REPLICAS:-}"
  local requested_fumadocs_replicas="${UPSTAND_FUMADOCS_REPLICAS:-}"
  local requested_docker_gid="${UPSTAND_DOCKER_GID:-}"
  local direct_origins="${UPSTAND_DIRECT_ORIGINS:-false}"

  if [[ -f "$ENV_FILE" ]]; then
    # shellcheck disable=SC1090
    source "$ENV_FILE"
  fi
  if [[ -n "$requested_allow_insecure_bootstrap" ]]; then
    UPSTAND_ALLOW_INSECURE_BOOTSTRAP="$requested_allow_insecure_bootstrap"
  fi
  UPSTAND_ALLOW_INSECURE_BOOTSTRAP="${UPSTAND_ALLOW_INSECURE_BOOTSTRAP:-false}"
  [[ "$UPSTAND_ALLOW_INSECURE_BOOTSTRAP" == true || "$UPSTAND_ALLOW_INSECURE_BOOTSTRAP" == false ]] \
    || fail "UPSTAND_ALLOW_INSECURE_BOOTSTRAP must be true or false"
  UPSTAND_ALLOW_UNOBSERVED_PRODUCTION="${requested_allow_unobserved_production:-${UPSTAND_ALLOW_UNOBSERVED_PRODUCTION:-false}}"
  [[ "$UPSTAND_ALLOW_UNOBSERVED_PRODUCTION" == true || "$UPSTAND_ALLOW_UNOBSERVED_PRODUCTION" == false ]] \
    || fail "UPSTAND_ALLOW_UNOBSERVED_PRODUCTION must be true or false"
  AUTH_COOKIE_DOMAIN="${requested_auth_cookie_domain:-${AUTH_COOKIE_DOMAIN:-}}"
  TRUSTED_PROXY_HEADERS="${requested_trusted_proxy_headers:-${TRUSTED_PROXY_HEADERS:-false}}"
  [[ "$TRUSTED_PROXY_HEADERS" == true || "$TRUSTED_PROXY_HEADERS" == false ]] \
    || fail "TRUSTED_PROXY_HEADERS must be true or false"
  UPSTAND_INSTANCE_OWNER_USER_ID="${requested_instance_owner_user_id:-${UPSTAND_INSTANCE_OWNER_USER_ID:-}}"
  UPSTAND_INSTANCE_OWNER_EMAIL="${requested_instance_owner_email:-${UPSTAND_INSTANCE_OWNER_EMAIL:-}}"
  UPSTAND_CONTROL_PLANE_SSH_HOST_KEY_FINGERPRINT="${requested_control_plane_fingerprint:-${UPSTAND_CONTROL_PLANE_SSH_HOST_KEY_FINGERPRINT:-}}"
  UPSTAND_DOCKER_VERSION="${requested_docker_version:-${UPSTAND_DOCKER_VERSION:-}}"
  UPSTAND_OUTBOUND_ALLOWED_HOSTS="${requested_outbound_allowed_hosts:-${UPSTAND_OUTBOUND_ALLOWED_HOSTS:-}}"
  UPSTAND_SECRET_PROVIDER_ALLOWED_HOSTS="${requested_secret_provider_allowed_hosts:-${UPSTAND_SECRET_PROVIDER_ALLOWED_HOSTS:-}}"
  UPSTAND_GIT_PROVIDER_ALLOWED_HOSTS="${requested_git_provider_allowed_hosts:-${UPSTAND_GIT_PROVIDER_ALLOWED_HOSTS:-}}"
  UPSTAND_BACKUP_COMMAND_TIMEOUT_MS="${requested_backup_command_timeout_ms:-${UPSTAND_BACKUP_COMMAND_TIMEOUT_MS:-1800000}}"
  UPSTAND_DR_OFFSITE_CONFIRMED="${requested_dr_offsite_confirmed:-${UPSTAND_DR_OFFSITE_CONFIRMED:-false}}"
  UPSTAND_DR_KEY_ESCROW_CONFIRMED="${requested_dr_key_escrow_confirmed:-${UPSTAND_DR_KEY_ESCROW_CONFIRMED:-false}}"
  UPSTAND_DR_IMMUTABLE_RETENTION_CONFIRMED="${requested_dr_immutable_retention_confirmed:-${UPSTAND_DR_IMMUTABLE_RETENTION_CONFIRMED:-false}}"
  UPSTAND_DR_RPO_SECONDS="${requested_dr_rpo_seconds:-${UPSTAND_DR_RPO_SECONDS:-}}"
  UPSTAND_DR_RTO_SECONDS="${requested_dr_rto_seconds:-${UPSTAND_DR_RTO_SECONDS:-}}"
  UPSTAND_DR_EVIDENCE_REFERENCE="${requested_dr_evidence_reference:-${UPSTAND_DR_EVIDENCE_REFERENCE:-}}"
  UPGAL_DAILY_COST_LIMIT_USD="${requested_upgal_daily_cost_limit_usd:-${UPGAL_DAILY_COST_LIMIT_USD:-100}}"
  UPGAL_MAX_COST_PER_MILLION_TOKENS_USD="${requested_upgal_max_cost_per_million_tokens_usd:-${UPGAL_MAX_COST_PER_MILLION_TOKENS_USD:-100}}"
  UPGAL_ALLOWED_MODELS="${requested_upgal_allowed_models:-${UPGAL_ALLOWED_MODELS:-}}"
  UPSTAND_DR_READINESS_GATE=true
  UPSTAND_DATABASE_POOL_MAX="${requested_database_pool_max:-${UPSTAND_DATABASE_POOL_MAX:-20}}"
  UPSTAND_DATABASE_POOL_IDLE_TIMEOUT_MS="${requested_database_pool_idle_timeout_ms:-${UPSTAND_DATABASE_POOL_IDLE_TIMEOUT_MS:-30000}}"
  UPSTAND_DATABASE_POOL_CONNECTION_TIMEOUT_MS="${requested_database_pool_connection_timeout_ms:-${UPSTAND_DATABASE_POOL_CONNECTION_TIMEOUT_MS:-5000}}"
  [[ "$UPSTAND_BACKUP_COMMAND_TIMEOUT_MS" =~ ^[1-9][0-9]*$ ]] \
    && ((UPSTAND_BACKUP_COMMAND_TIMEOUT_MS >= 1000 && UPSTAND_BACKUP_COMMAND_TIMEOUT_MS <= 86400000)) \
    || fail "UPSTAND_BACKUP_COMMAND_TIMEOUT_MS must be an integer from 1000 to 86400000"
  [[ "$UPSTAND_DATABASE_POOL_MAX" =~ ^[1-9][0-9]*$ ]] \
    && ((UPSTAND_DATABASE_POOL_MAX <= 100)) \
    || fail "UPSTAND_DATABASE_POOL_MAX must be an integer from 1 to 100"
  [[ "$UPSTAND_DATABASE_POOL_IDLE_TIMEOUT_MS" =~ ^[0-9]+$ ]] \
    && ((UPSTAND_DATABASE_POOL_IDLE_TIMEOUT_MS <= 600000)) \
    || fail "UPSTAND_DATABASE_POOL_IDLE_TIMEOUT_MS must be an integer from 0 to 600000"
  [[ "$UPSTAND_DATABASE_POOL_CONNECTION_TIMEOUT_MS" =~ ^[1-9][0-9]*$ ]] \
    && ((UPSTAND_DATABASE_POOL_CONNECTION_TIMEOUT_MS >= 100 && UPSTAND_DATABASE_POOL_CONNECTION_TIMEOUT_MS <= 120000)) \
    || fail "UPSTAND_DATABASE_POOL_CONNECTION_TIMEOUT_MS must be an integer from 100 to 120000"
  [[ "$UPGAL_DAILY_COST_LIMIT_USD" =~ ^[0-9]+([.][0-9]+)?$ ]] \
    && awk "BEGIN { exit !($UPGAL_DAILY_COST_LIMIT_USD > 0 && $UPGAL_DAILY_COST_LIMIT_USD <= 1000000) }" \
    || fail "UPGAL_DAILY_COST_LIMIT_USD must be a positive number no greater than 1000000"
  [[ "$UPGAL_MAX_COST_PER_MILLION_TOKENS_USD" =~ ^[0-9]+([.][0-9]+)?$ ]] \
    && awk "BEGIN { exit !($UPGAL_MAX_COST_PER_MILLION_TOKENS_USD > 0 && $UPGAL_MAX_COST_PER_MILLION_TOKENS_USD <= 1000000) }" \
    || fail "UPGAL_MAX_COST_PER_MILLION_TOKENS_USD must be a positive number no greater than 1000000"
  [[ "${UPGAL_ALLOWED_MODELS:-}" != *$'\n'* && "${UPGAL_ALLOWED_MODELS:-}" != *$'\r'* ]] \
    || fail "UPGAL_ALLOWED_MODELS must be a single comma-separated line"
  [[ "${#UPGAL_ALLOWED_MODELS}" -le 4096 ]] \
    || fail "UPGAL_ALLOWED_MODELS must be at most 4096 characters"
  validate_disaster_recovery_plan
  for configured_value in \
    "$AUTH_COOKIE_DOMAIN" \
    "$UPSTAND_INSTANCE_OWNER_USER_ID" \
    "$UPSTAND_INSTANCE_OWNER_EMAIL" \
    "$UPSTAND_CONTROL_PLANE_SSH_HOST_KEY_FINGERPRINT" \
    "$UPSTAND_DOCKER_VERSION" \
    "$UPSTAND_OUTBOUND_ALLOWED_HOSTS" \
    "$UPSTAND_SECRET_PROVIDER_ALLOWED_HOSTS" \
    "$UPSTAND_GIT_PROVIDER_ALLOWED_HOSTS"; do
    [[ "$configured_value" != *$'\r'* && "$configured_value" != *$'\n'* ]] \
      || fail "production environment values must not contain newlines"
  done
  UPSTAND_DOCKER_GID="${requested_docker_gid:-${UPSTAND_DOCKER_GID:-}}"
  if [[ -z "$UPSTAND_DOCKER_GID" ]]; then
    UPSTAND_DOCKER_GID="$(stat -c '%g' /var/run/docker.sock 2>/dev/null || true)"
  fi
  [[ "$UPSTAND_DOCKER_GID" =~ ^[0-9]+$ ]] \
    || fail "could not determine a numeric group id for /var/run/docker.sock; set UPSTAND_DOCKER_GID explicitly"
  local configured_origin_count=0
  [[ -n "${BETTER_AUTH_URL:-}" ]] && ((configured_origin_count += 1))
  [[ -n "${CORS_ORIGIN:-}" ]] && ((configured_origin_count += 1))
  [[ -n "${NEXT_PUBLIC_SERVER_URL:-}" ]] && ((configured_origin_count += 1))
  if ((configured_origin_count > 0 && configured_origin_count < 3)); then
    fail "provide BETTER_AUTH_URL, CORS_ORIGIN, and NEXT_PUBLIC_SERVER_URL together, or omit all three for direct host-IP access"
  fi
  if [[ -n "$requested_better_auth_url$requested_cors_origin$requested_server_url" ]]; then
    direct_origins=false
  fi
  if [[ -n "$MODE_OVERRIDE" ]]; then
    IS_CLOUD="$MODE_OVERRIDE"
  fi

  # Production installs must establish an explicit HTTPS origin before the
  # control plane is exposed. The insecure direct-IP bootstrap remains
  # available only as an explicit operator opt-in for isolated development
  # hosts.
  if [[ -z "${BETTER_AUTH_URL:-}" || -z "${CORS_ORIGIN:-}" || -z "${NEXT_PUBLIC_SERVER_URL:-}" ]]; then
    [[ "${UPSTAND_ALLOW_INSECURE_BOOTSTRAP:-false}" == true ]] \
      || fail "set BETTER_AUTH_URL, CORS_ORIGIN, and NEXT_PUBLIC_SERVER_URL to HTTPS origins; use UPSTAND_ALLOW_INSECURE_BOOTSTRAP=true only on an isolated development host"
    direct_origins=true
    BETTER_AUTH_URL="${BETTER_AUTH_URL:-http://${advertise_address}:3000}"
    CORS_ORIGIN="${CORS_ORIGIN:-http://${advertise_address}:3001}"
    NEXT_PUBLIC_SERVER_URL="${NEXT_PUBLIC_SERVER_URL:-$BETTER_AUTH_URL}"
    echo "Using direct HTTP origins for the detected host: API=$BETTER_AUTH_URL dashboard=$CORS_ORIGIN" >&2
  fi

  [[ -r "$INSTALL_DIR/secrets/postgres_password" ]] && POSTGRES_PASSWORD="$(cat "$INSTALL_DIR/secrets/postgres_password")"
  [[ -r "$INSTALL_DIR/secrets/redis_password" ]] && REDIS_PASSWORD="$(cat "$INSTALL_DIR/secrets/redis_password")"
  [[ -r "$INSTALL_DIR/secrets/better_auth_secret" ]] && BETTER_AUTH_SECRET="$(cat "$INSTALL_DIR/secrets/better_auth_secret")"
  [[ -r "$INSTALL_DIR/secrets/upgal_tool_approval_secret" ]] && UPGAL_TOOL_APPROVAL_SECRET="$(cat "$INSTALL_DIR/secrets/upgal_tool_approval_secret")"
  [[ -r "$INSTALL_DIR/secrets/encryption_key" ]] && ENCRYPTION_KEY_V1="$(cat "$INSTALL_DIR/secrets/encryption_key")"
  [[ -z "${ENCRYPTION_KEY_V1:-}" && -r "$INSTALL_DIR/secrets/ssh_key_encryption_key" ]] && ENCRYPTION_KEY_V1="$(cat "$INSTALL_DIR/secrets/ssh_key_encryption_key")"
  [[ -r "$INSTALL_DIR/secrets/database_url" ]] && DATABASE_URL="$(cat "$INSTALL_DIR/secrets/database_url")"
  [[ -r "$INSTALL_DIR/secrets/redis_url" ]] && REDIS_URL="$(cat "$INSTALL_DIR/secrets/redis_url")"
  [[ -r "$INSTALL_DIR/secrets/docker_broker_server_token" ]] && DOCKER_BROKER_SERVER_TOKEN="$(cat "$INSTALL_DIR/secrets/docker_broker_server_token")"
  [[ -r "$INSTALL_DIR/secrets/docker_broker_schedules_token" ]] && DOCKER_BROKER_SCHEDULES_TOKEN="$(cat "$INSTALL_DIR/secrets/docker_broker_schedules_token")"
  [[ -r "$INSTALL_DIR/secrets/docker_broker_deployment_worker_token" ]] && DOCKER_BROKER_DEPLOYMENT_WORKER_TOKEN="$(cat "$INSTALL_DIR/secrets/docker_broker_deployment_worker_token")"
  [[ -r "$INSTALL_DIR/secrets/docker_broker_scope_secret" ]] && DOCKER_BROKER_SCOPE_SECRET="$(cat "$INSTALL_DIR/secrets/docker_broker_scope_secret")"
  DATABASE_URL="${requested_database_url:-${DATABASE_URL:-}}"
  REDIS_URL="${requested_redis_url:-${REDIS_URL:-}}"
  if [[ -n "$DATABASE_URL" || -n "$REDIS_URL" ]]; then
    [[ -n "$DATABASE_URL" && -n "$REDIS_URL" ]] \
      || fail "DATABASE_URL and REDIS_URL must be configured together for external HA data services"
    [[ "$DATABASE_URL" == postgresql://* || "$DATABASE_URL" == postgres://* ]] \
      || fail "DATABASE_URL must use postgresql:// or postgres://"
    [[ "$REDIS_URL" == redis://* || "$REDIS_URL" == rediss://* ]] \
      || fail "REDIS_URL must use redis:// or rediss://"
    [[ "$DATABASE_URL" != *$'\r'* && "$DATABASE_URL" != *$'\n'* ]] \
      || fail "DATABASE_URL must be a single-line URL"
    [[ "$REDIS_URL" != *$'\r'* && "$REDIS_URL" != *$'\n'* ]] \
      || fail "REDIS_URL must be a single-line URL"
    UPSTAND_BUNDLED_POSTGRES_REPLICAS=0
    UPSTAND_BUNDLED_REDIS_REPLICAS=0
  else
    UPSTAND_BUNDLED_POSTGRES_REPLICAS="${requested_bundled_postgres_replicas:-${UPSTAND_BUNDLED_POSTGRES_REPLICAS:-1}}"
    UPSTAND_BUNDLED_REDIS_REPLICAS="${requested_bundled_redis_replicas:-${UPSTAND_BUNDLED_REDIS_REPLICAS:-1}}"
  fi
  UPSTAND_SERVER_REPLICAS="${requested_server_replicas:-${UPSTAND_SERVER_REPLICAS:-1}}"
  UPSTAND_SCHEDULES_REPLICAS="${requested_schedules_replicas:-${UPSTAND_SCHEDULES_REPLICAS:-1}}"
  UPSTAND_DEPLOYMENT_WORKER_REPLICAS="${requested_deployment_worker_replicas:-${UPSTAND_DEPLOYMENT_WORKER_REPLICAS:-1}}"
  UPSTAND_WEB_REPLICAS="${requested_web_replicas:-${UPSTAND_WEB_REPLICAS:-1}}"
  UPSTAND_FUMADOCS_REPLICAS="${requested_fumadocs_replicas:-${UPSTAND_FUMADOCS_REPLICAS:-1}}"
  UPSTAND_AUDIT_LOG_RETENTION_DAYS="${requested_audit_log_retention_days:-${UPSTAND_AUDIT_LOG_RETENTION_DAYS:-365}}"
  [[ "$UPSTAND_AUDIT_LOG_RETENTION_DAYS" =~ ^[1-9][0-9]*$ ]] \
    && ((UPSTAND_AUDIT_LOG_RETENTION_DAYS <= 3650)) \
    || fail "UPSTAND_AUDIT_LOG_RETENTION_DAYS must be an integer from 1 to 3650"
  local external_data=false
  [[ -n "$DATABASE_URL" ]] && external_data=true
  validate_replica_configuration \
    "$external_data" \
    "$UPSTAND_SERVER_REPLICAS" \
    "$UPSTAND_SCHEDULES_REPLICAS" \
    "$UPSTAND_DEPLOYMENT_WORKER_REPLICAS" \
    "$UPSTAND_WEB_REPLICAS" \
    "$UPSTAND_FUMADOCS_REPLICAS" \
    "$UPSTAND_BUNDLED_POSTGRES_REPLICAS" \
    "$UPSTAND_BUNDLED_REDIS_REPLICAS"
  POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-$(openssl rand -hex 32)}"
  REDIS_PASSWORD="${REDIS_PASSWORD:-$(openssl rand -hex 32)}"
  BETTER_AUTH_SECRET="${BETTER_AUTH_SECRET:-$(openssl rand -hex 32)}"
  UPGAL_TOOL_APPROVAL_SECRET="${UPGAL_TOOL_APPROVAL_SECRET:-$(openssl rand -hex 32)}"
  DOCKER_BROKER_SERVER_TOKEN="${DOCKER_BROKER_SERVER_TOKEN:-$(openssl rand -hex 32)}"
  DOCKER_BROKER_SCHEDULES_TOKEN="${DOCKER_BROKER_SCHEDULES_TOKEN:-$(openssl rand -hex 32)}"
  DOCKER_BROKER_DEPLOYMENT_WORKER_TOKEN="${DOCKER_BROKER_DEPLOYMENT_WORKER_TOKEN:-$(openssl rand -hex 32)}"
  DOCKER_BROKER_SCOPE_SECRET="${DOCKER_BROKER_SCOPE_SECRET:-$(openssl rand -hex 32)}"
  METRICS_TOKEN="${METRICS_TOKEN:-$(openssl rand -hex 32)}"
  ENCRYPTION_KEY_V1="${ENCRYPTION_KEY_V1:-${SSH_KEY_ENCRYPTION_KEY_V1:-$(openssl rand -base64 32 | tr -d '\n')}}"
  ensure_docker_broker_mtls
  printf '%s' "$POSTGRES_PASSWORD" >"$INSTALL_DIR/secrets/postgres_password"
  printf '%s' "$REDIS_PASSWORD" >"$INSTALL_DIR/secrets/redis_password"
  printf '%s' "$BETTER_AUTH_SECRET" >"$INSTALL_DIR/secrets/better_auth_secret"
  printf '%s' "$UPGAL_TOOL_APPROVAL_SECRET" >"$INSTALL_DIR/secrets/upgal_tool_approval_secret"
  printf '%s' "$DOCKER_BROKER_SERVER_TOKEN" >"$INSTALL_DIR/secrets/docker_broker_server_token"
  printf '%s' "$DOCKER_BROKER_SCHEDULES_TOKEN" >"$INSTALL_DIR/secrets/docker_broker_schedules_token"
  printf '%s' "$DOCKER_BROKER_DEPLOYMENT_WORKER_TOKEN" >"$INSTALL_DIR/secrets/docker_broker_deployment_worker_token"
  printf '%s' "$DOCKER_BROKER_SCOPE_SECRET" >"$INSTALL_DIR/secrets/docker_broker_scope_secret"
  printf '%s' "$METRICS_TOKEN" >"$INSTALL_DIR/secrets/metrics_token"
  printf '%s' "$ENCRYPTION_KEY_V1" >"$INSTALL_DIR/secrets/encryption_key"
  printf '%s' "$DATABASE_URL" >"$INSTALL_DIR/secrets/database_url"
  printf '%s' "$REDIS_URL" >"$INSTALL_DIR/secrets/redis_url"
  cp -f "$INSTALL_DIR/secrets/encryption_key" "$INSTALL_DIR/secrets/ssh_key_encryption_key" 2>/dev/null || true
  chmod 0600 "$INSTALL_DIR/secrets"/*
  DOCKER_NETWORK="$NETWORK_NAME"
  DOCKER_CONTROL_NETWORK="$CONTROL_NETWORK_NAME"

  BETTER_AUTH_URL="${requested_better_auth_url:-${BETTER_AUTH_URL:-}}"
  CORS_ORIGIN="${requested_cors_origin:-${CORS_ORIGIN:-}}"
  NEXT_PUBLIC_SERVER_URL="${requested_server_url:-${NEXT_PUBLIC_SERVER_URL:-}}"
  TRUSTED_PROXY_CIDRS="${requested_trusted_proxy_cidrs:-${TRUSTED_PROXY_CIDRS:-}}"
  if [[ -z "$TRUSTED_PROXY_CIDRS" ]]; then
    TRUSTED_PROXY_CIDRS="$(docker network inspect --format '{{range .IPAM.Config}}{{.Subnet}}{{"\n"}}{{end}}' "$NETWORK_NAME" | awk 'NF { printf "%s%s", sep, $0; sep="," }')"
  fi
  [[ -n "$TRUSTED_PROXY_CIDRS" ]] || fail "could not determine the trusted proxy CIDR for '$NETWORK_NAME'"
  UPSTAND_SERVER_IMAGE="${requested_server_image:-${UPSTAND_SERVER_IMAGE:-}}"
  UPSTAND_SCHEDULES_IMAGE="${requested_schedules_image:-${UPSTAND_SCHEDULES_IMAGE:-}}"
  UPSTAND_DEPLOYMENT_WORKER_IMAGE="${requested_deployment_worker_image:-${UPSTAND_DEPLOYMENT_WORKER_IMAGE:-}}"
  UPSTAND_WEB_IMAGE="${requested_web_image:-${UPSTAND_WEB_IMAGE:-}}"
  UPSTAND_DOCS_IMAGE="${requested_docs_image:-${UPSTAND_DOCS_IMAGE:-}}"
  UPSTAND_MONITORING_IMAGE="${requested_monitoring_image:-${UPSTAND_MONITORING_IMAGE:-}}"
  UPSTAND_DOCKER_BROKER_IMAGE="${requested_docker_broker_image:-${UPSTAND_DOCKER_BROKER_IMAGE:-}}"
  UPSTAND_AUTO_UPDATE="${requested_auto_update:-${UPSTAND_AUTO_UPDATE:-false}}"
  OTLP_ENDPOINT="${requested_otlp_endpoint:-${OTLP_ENDPOINT:-}}"
  if [[ -n "$OTLP_ENDPOINT" ]]; then
    [[ "$OTLP_ENDPOINT" == http://* || "$OTLP_ENDPOINT" == https://* ]] \
      || fail "OTLP_ENDPOINT must use HTTP or HTTPS"
    [[ "$OTLP_ENDPOINT" != *$'\r'* && "$OTLP_ENDPOINT" != *$'\n'* ]] \
      || fail "OTLP_ENDPOINT must be a single-line URL"
  fi
  # Each deployment gets a fresh barrier key. Reusing the previous key would
  # let a new server race past a failed or still-running migration.
  UPSTAND_MIGRATION_ID="${requested_migration_id:-upstand-$(date +%s)-$$}"

  local advertise_ip
  advertise_ip="$(detect_advertise_address)"

  if [[ -z "$BETTER_AUTH_URL" ]]; then
    BETTER_AUTH_URL="http://${advertise_ip}:3000"
  fi
  if [[ -z "$CORS_ORIGIN" ]]; then
    CORS_ORIGIN="http://${advertise_ip}:3001"
  fi
  if [[ -z "$NEXT_PUBLIC_SERVER_URL" ]]; then
    NEXT_PUBLIC_SERVER_URL="http://${advertise_ip}:3000"
  fi

  [[ "$BETTER_AUTH_URL" == http://* || "$BETTER_AUTH_URL" == https://* ]] || fail "BETTER_AUTH_URL must use HTTP or HTTPS"
  [[ "$CORS_ORIGIN" == http://* || "$CORS_ORIGIN" == https://* ]] || fail "CORS_ORIGIN must use HTTP or HTTPS"
  [[ "$NEXT_PUBLIC_SERVER_URL" == http://* || "$NEXT_PUBLIC_SERVER_URL" == https://* ]] || fail "NEXT_PUBLIC_SERVER_URL must use HTTP or HTTPS"
  if [[ "${UPSTAND_ALLOW_INSECURE_BOOTSTRAP:-false}" != true ]]; then
    [[ "$BETTER_AUTH_URL" == https://* && "$CORS_ORIGIN" == https://* && "$NEXT_PUBLIC_SERVER_URL" == https://* ]] \
      || fail "production origins must all use HTTPS"
  fi

  if [[ "$direct_origins" == true ]]; then
    UPSTAND_DASHBOARD_HOST=""
    UPSTAND_API_HOST=""
    UPSTAND_DOCS_HOST=""
  else
    UPSTAND_DASHBOARD_HOST="${CORS_ORIGIN#https://}"
    UPSTAND_DASHBOARD_HOST="${UPSTAND_DASHBOARD_HOST#http://}"
    UPSTAND_DASHBOARD_HOST="${UPSTAND_DASHBOARD_HOST%%:*}"

    UPSTAND_API_HOST="${BETTER_AUTH_URL#https://}"
    UPSTAND_API_HOST="${UPSTAND_API_HOST#http://}"
    UPSTAND_API_HOST="${UPSTAND_API_HOST%%:*}"
  fi

  [[ "$UPSTAND_DASHBOARD_HOST" != */* && "$UPSTAND_API_HOST" != */* ]] || fail "dashboard and API origins must not include a path"

  if [[ -z "${UPSTAND_DOCS_HOST:-}" && "$direct_origins" != true ]]; then
    UPSTAND_DOCS_HOST="docs.$UPSTAND_API_HOST"
  fi

  POSTGRES_IMAGE="${POSTGRES_IMAGE:-postgres:18-alpine@sha256:9a8afca54e7861fd90fab5fdf4c42477a6b1cb7d293595148e674e0a3181de15}"
  REDIS_IMAGE="${REDIS_IMAGE:-redis:8.8-alpine@sha256:8096655e437712b07503796fb64d81359256cfcff0ab29d95a7da72863786efb}"

  if [[ "${UPSTAND_BUILD_FROM_SOURCE:-false}" == true ]]; then
    build_source_images
  else
    # Stable installations consume the selected release manifest and verify
    # every published image before writing the environment file.
    UPSTAND_SERVER_IMAGE="${UPSTAND_SERVER_IMAGE:-$(resolve_stable_image server)}"
    UPSTAND_SCHEDULES_IMAGE="${UPSTAND_SCHEDULES_IMAGE:-$(resolve_stable_image schedules)}"
    UPSTAND_DEPLOYMENT_WORKER_IMAGE="${UPSTAND_DEPLOYMENT_WORKER_IMAGE:-$(resolve_stable_image deployment-worker)}"
    UPSTAND_WEB_IMAGE="${UPSTAND_WEB_IMAGE:-$(resolve_stable_image web)}"
    UPSTAND_DOCS_IMAGE="${UPSTAND_DOCS_IMAGE:-$(resolve_stable_image fumadocs)}"
    UPSTAND_MONITORING_IMAGE="${UPSTAND_MONITORING_IMAGE:-$(resolve_stable_image monitoring)}"
    UPSTAND_DOCKER_BROKER_IMAGE="${UPSTAND_DOCKER_BROKER_IMAGE:-$(resolve_stable_image docker-broker)}"
  fi
  if [[ "${SOURCE_BUILD:-false}" != true ]]; then
    require_digest_image UPSTAND_SERVER_IMAGE
    require_digest_image UPSTAND_SCHEDULES_IMAGE
    require_digest_image UPSTAND_DEPLOYMENT_WORKER_IMAGE
    require_digest_image UPSTAND_WEB_IMAGE
    require_digest_image UPSTAND_DOCS_IMAGE
    require_digest_image UPSTAND_MONITORING_IMAGE
    require_digest_image UPSTAND_DOCKER_BROKER_IMAGE
    require_digest_image POSTGRES_IMAGE
    require_digest_image REDIS_IMAGE
  fi

  {
    write_env_assignment DOCKER_NETWORK "$DOCKER_NETWORK"
    write_env_assignment DOCKER_CONTROL_NETWORK "$DOCKER_CONTROL_NETWORK"
    write_env_assignment BETTER_AUTH_URL "$BETTER_AUTH_URL"
    write_env_assignment CORS_ORIGIN "$CORS_ORIGIN"
    write_env_assignment AUTH_COOKIE_DOMAIN "$AUTH_COOKIE_DOMAIN"
    write_env_assignment TRUSTED_PROXY_HEADERS "$TRUSTED_PROXY_HEADERS"
    write_env_assignment TRUSTED_PROXY_CIDRS "$TRUSTED_PROXY_CIDRS"
    write_env_assignment NEXT_PUBLIC_SERVER_URL "$NEXT_PUBLIC_SERVER_URL"
    write_env_assignment UPSTAND_INSTANCE_OWNER_USER_ID "$UPSTAND_INSTANCE_OWNER_USER_ID"
    write_env_assignment UPSTAND_INSTANCE_OWNER_EMAIL "$UPSTAND_INSTANCE_OWNER_EMAIL"
    write_env_assignment UPSTAND_CONTROL_PLANE_SSH_HOST_KEY_FINGERPRINT "$UPSTAND_CONTROL_PLANE_SSH_HOST_KEY_FINGERPRINT"
    write_env_assignment UPSTAND_DOCKER_VERSION "$UPSTAND_DOCKER_VERSION"
    write_env_assignment UPSTAND_DASHBOARD_HOST "$UPSTAND_DASHBOARD_HOST"
    write_env_assignment UPSTAND_API_HOST "$UPSTAND_API_HOST"
    write_env_assignment UPSTAND_DOCS_HOST "$UPSTAND_DOCS_HOST"
    write_env_assignment UPSTAND_SERVER_IMAGE "$UPSTAND_SERVER_IMAGE"
    write_env_assignment UPSTAND_SCHEDULES_IMAGE "$UPSTAND_SCHEDULES_IMAGE"
    write_env_assignment UPSTAND_DEPLOYMENT_WORKER_IMAGE "$UPSTAND_DEPLOYMENT_WORKER_IMAGE"
    write_env_assignment UPSTAND_WEB_IMAGE "$UPSTAND_WEB_IMAGE"
    write_env_assignment UPSTAND_DOCS_IMAGE "$UPSTAND_DOCS_IMAGE"
    write_env_assignment UPSTAND_MONITORING_IMAGE "$UPSTAND_MONITORING_IMAGE"
    write_env_assignment UPSTAND_DOCKER_BROKER_IMAGE "$UPSTAND_DOCKER_BROKER_IMAGE"
    write_env_assignment UPSTAND_AUTO_UPDATE "$UPSTAND_AUTO_UPDATE"
    write_env_assignment UPSTAND_ALLOW_INSECURE_BOOTSTRAP "$UPSTAND_ALLOW_INSECURE_BOOTSTRAP"
    write_env_assignment UPSTAND_ALLOW_UNOBSERVED_PRODUCTION "$UPSTAND_ALLOW_UNOBSERVED_PRODUCTION"
    write_env_assignment UPSTAND_OUTBOUND_ALLOWED_HOSTS "$UPSTAND_OUTBOUND_ALLOWED_HOSTS"
    write_env_assignment UPSTAND_SECRET_PROVIDER_ALLOWED_HOSTS "$UPSTAND_SECRET_PROVIDER_ALLOWED_HOSTS"
    write_env_assignment UPSTAND_GIT_PROVIDER_ALLOWED_HOSTS "$UPSTAND_GIT_PROVIDER_ALLOWED_HOSTS"
    write_env_assignment UPSTAND_BACKUP_COMMAND_TIMEOUT_MS "$UPSTAND_BACKUP_COMMAND_TIMEOUT_MS"
    write_env_assignment UPSTAND_DR_READINESS_GATE "$UPSTAND_DR_READINESS_GATE"
    write_env_assignment UPSTAND_DR_OFFSITE_CONFIRMED "$UPSTAND_DR_OFFSITE_CONFIRMED"
    write_env_assignment UPSTAND_DR_KEY_ESCROW_CONFIRMED "$UPSTAND_DR_KEY_ESCROW_CONFIRMED"
    write_env_assignment UPSTAND_DR_IMMUTABLE_RETENTION_CONFIRMED "$UPSTAND_DR_IMMUTABLE_RETENTION_CONFIRMED"
    write_env_assignment UPSTAND_DR_RPO_SECONDS "$UPSTAND_DR_RPO_SECONDS"
    write_env_assignment UPSTAND_DR_RTO_SECONDS "$UPSTAND_DR_RTO_SECONDS"
    write_env_assignment UPSTAND_DR_EVIDENCE_REFERENCE "$UPSTAND_DR_EVIDENCE_REFERENCE"
    write_env_assignment UPGAL_DAILY_COST_LIMIT_USD "$UPGAL_DAILY_COST_LIMIT_USD"
    write_env_assignment UPGAL_MAX_COST_PER_MILLION_TOKENS_USD "$UPGAL_MAX_COST_PER_MILLION_TOKENS_USD"
    write_env_assignment UPGAL_ALLOWED_MODELS "$UPGAL_ALLOWED_MODELS"
    write_env_assignment OTLP_ENDPOINT "$OTLP_ENDPOINT"
    write_env_assignment UPSTAND_MIGRATION_ID "$UPSTAND_MIGRATION_ID"
    write_env_assignment UPSTAND_BUNDLED_POSTGRES_REPLICAS "$UPSTAND_BUNDLED_POSTGRES_REPLICAS"
    write_env_assignment UPSTAND_BUNDLED_REDIS_REPLICAS "$UPSTAND_BUNDLED_REDIS_REPLICAS"
    write_env_assignment UPSTAND_DATABASE_POOL_MAX "$UPSTAND_DATABASE_POOL_MAX"
    write_env_assignment UPSTAND_DATABASE_POOL_IDLE_TIMEOUT_MS "$UPSTAND_DATABASE_POOL_IDLE_TIMEOUT_MS"
    write_env_assignment UPSTAND_DATABASE_POOL_CONNECTION_TIMEOUT_MS "$UPSTAND_DATABASE_POOL_CONNECTION_TIMEOUT_MS"
    write_env_assignment UPSTAND_SERVER_REPLICAS "$UPSTAND_SERVER_REPLICAS"
    write_env_assignment UPSTAND_SCHEDULES_REPLICAS "$UPSTAND_SCHEDULES_REPLICAS"
    write_env_assignment UPSTAND_DEPLOYMENT_WORKER_REPLICAS "$UPSTAND_DEPLOYMENT_WORKER_REPLICAS"
    write_env_assignment UPSTAND_WEB_REPLICAS "$UPSTAND_WEB_REPLICAS"
    write_env_assignment UPSTAND_FUMADOCS_REPLICAS "$UPSTAND_FUMADOCS_REPLICAS"
    write_env_assignment UPSTAND_AUDIT_LOG_RETENTION_DAYS "$UPSTAND_AUDIT_LOG_RETENTION_DAYS"
    write_env_assignment UPSTAND_DOCKER_GID "$UPSTAND_DOCKER_GID"
    write_env_assignment UPSTAND_VERSION "$UPSTAND_VERSION"
    write_env_assignment IS_CLOUD "${IS_CLOUD:-false}"
    write_env_assignment UPSTAND_DIRECT_ORIGINS "$direct_origins"
    write_env_assignment POSTGRES_IMAGE "$POSTGRES_IMAGE"
    write_env_assignment REDIS_IMAGE "$REDIS_IMAGE"
  } >"$ENV_FILE"
  chmod 0600 "$ENV_FILE"
}

deploy_stack() {
  local stack_file="$STACK_FILE"
  if [[ "${SOURCE_BUILD:-false}" == true ]]; then
    stack_file="$SOURCE_DIR/docker-compose.prod.yml"
  fi
  [[ -f "$stack_file" ]] || fail "docker-compose.prod.yml is unavailable"
  install -m 0600 "$stack_file" "$INSTALL_DIR/docker-compose.yml"

  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a

  if [[ "${SOURCE_BUILD:-false}" == true ]]; then
    docker stack deploy \
      --compose-file "$INSTALL_DIR/docker-compose.yml" \
      --prune \
      --resolve-image never \
      upstand
  else
    docker stack deploy \
      --compose-file "$INSTALL_DIR/docker-compose.yml" \
      --with-registry-auth \
      --prune \
      --resolve-image always \
      upstand
  fi
  wait_for_migration
}

wait_for_migration() {
  local deadline=$((SECONDS + 600))
  while ((SECONDS < deadline)); do
    local state
    state="$(docker service ps upstand_migrate --no-trunc --format '{{.CurrentState}}' 2>/dev/null | head -n1 || true)"
    if [[ "$state" == Complete* ]]; then
      return 0
    fi
    if [[ "$state" == Failed* || "$state" == Rejected* || "$state" == "Shutdown"* ]]; then
      fail "database migration service failed: $state"
    fi
    sleep 2
  done
  fail "timed out waiting for database migration service"
}

configure_registry_auth() {
  [[ "${SOURCE_BUILD:-false}" == true ]] && return
  local registry="${UPSTAND_REGISTRY:-}"
  [[ -z "$registry" ]] && return
  [[ "$registry" != */* && "$registry" != *:*/* ]] || fail "UPSTAND_REGISTRY must be a registry hostname, not an image path"
  [[ -n "${UPSTAND_REGISTRY_USERNAME:-}" ]] || fail "UPSTAND_REGISTRY_USERNAME is required when UPSTAND_REGISTRY is set"
  [[ -n "${UPSTAND_REGISTRY_PASSWORD:-}" ]] || fail "UPSTAND_REGISTRY_PASSWORD is required when UPSTAND_REGISTRY is set"
  printf '%s' "$UPSTAND_REGISTRY_PASSWORD" | docker login "$registry" \
    --username "$UPSTAND_REGISTRY_USERNAME" \
    --password-stdin >/dev/null
  REGISTRY_LOGIN_PERFORMED=true
}

cleanup_registry_auth() {
  if [[ "$REGISTRY_LOGIN_PERFORMED" == true ]]; then
    docker logout "${UPSTAND_REGISTRY}" >/dev/null 2>&1 || true
  fi
}

wait_for_stack() {
  local deadline=$((SECONDS + 600))
  local services=()
  mapfile -t services < <(required_stack_services)

  while ((SECONDS < deadline)); do
    local converged=true
    for service in "${services[@]}"; do
      local service_name="upstand_${service}"
      if ! docker service inspect "$service_name" >/dev/null 2>&1; then
        converged=false
        break
      fi

      local desired running
      desired="$(docker service inspect --format '{{if .Spec.Mode.Replicated}}{{.Spec.Mode.Replicated.Replicas}}{{else}}0{{end}}' "$service_name")"
      running="$(docker service ps --filter desired-state=running --format '{{.CurrentState}}' "$service_name" | grep -c '^Running ' || true)"
      if [[ "$desired" -lt 1 || "$running" -ne "$desired" ]]; then
        converged=false
        break
      fi
    done

    local server_container web_container
    server_container="$(docker ps -q --filter label=com.docker.swarm.service.name=upstand_server | head -n1)"
    web_container="$(docker ps -q --filter label=com.docker.swarm.service.name=upstand_web | head -n1)"

    if [[ "$converged" == true ]] \
      && [[ -n "$server_container" && -n "$web_container" ]] \
      && docker exec "$server_container" curl --fail --silent http://127.0.0.1:3000/health/ready >/dev/null \
      && docker exec "$web_container" node -e "fetch('http://127.0.0.1:3001/').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"; then
      return
    fi
    sleep 5
  done

  docker stack services upstand >&2 || true
  docker stack ps --no-trunc upstand >&2 || true
  fail "Upstand services did not become ready within 10 minutes"
}

validate_external_origins() {
  local api_probe dashboard_probe

  # These probes intentionally run from the deployment host. curl validates
  # DNS resolution and, for HTTPS origins, the complete TLS certificate chain.
  api_probe="${BETTER_AUTH_URL%/}/health/ready"
  dashboard_probe="${CORS_ORIGIN%/}/"

  curl --fail --silent --show-error --location --max-time 30 "$api_probe" >/dev/null \
    || fail "API origin failed DNS/TLS/readiness validation: $BETTER_AUTH_URL"
  curl --fail --silent --show-error --location --max-time 30 "$dashboard_probe" >/dev/null \
    || fail "dashboard origin failed DNS/TLS/HTTP validation: $CORS_ORIGIN"
}

main() {
  parse_args "$@"
  require_root
  ensure_host_dependencies
  ensure_docker
  check_host_resources
  local advertise_address
  advertise_address="$(detect_advertise_address)"
  ensure_stack_file
  ensure_swarm "$advertise_address"
  write_environment "$advertise_address"
  validate_production_operating_model
  trap cleanup_registry_auth EXIT
  configure_registry_auth
  validate_swarm_network_runtime
  deploy_stack
  wait_for_stack
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  validate_external_origins

  echo "Upstand has been deployed and all services report ready."
  echo "Dashboard: $CORS_ORIGIN"
  echo "API: $BETTER_AUTH_URL"
  echo "Generated secrets are stored in $INSTALL_DIR/secrets/; back up that directory securely."
  echo "Run $INSTALL_DIR/production-acceptance.sh (add --require-ha for HA validation)."
  echo "For multi-node runtime evidence, run $INSTALL_DIR/production-acceptance.sh --node-local on every task-bearing node."
  echo "For manager-driven multi-node evidence, run $INSTALL_DIR/production-acceptance-cluster.sh --output /var/tmp/upstand-acceptance --ssh-user USER."
  echo "Collect manager evidence with $INSTALL_DIR/production-evidence-collect.sh --output /var/tmp/upstand-acceptance-evidence."
  echo "Control-plane state is pinned to node label upstand.control-plane=true."
  echo "Use 'docker stack services upstand' to watch rollout status."
}

# BASH_SOURCE[0] is unset when this script is executed through `curl | bash`.
# The empty-source branch is therefore intentional and keeps both direct-file
# execution and the documented stdin installer path working with `set -u`.
if [[ "${BASH_SOURCE[0]:-}" == "$0" || -z "${BASH_SOURCE[0]:-}" ]]; then
  main "$@"
fi
