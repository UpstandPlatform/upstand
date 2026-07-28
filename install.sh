#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

# Production Docker Swarm installer. It deliberately does not guess a public
# address or pull mutable application tags: both are unsafe cluster defaults.

readonly INSTALL_DIR="/etc/upstand"
readonly ENV_FILE="$INSTALL_DIR/.env"
readonly SOURCE_DIR="$INSTALL_DIR/source"
readonly NETWORK_NAME="${DOCKER_NETWORK:-upstand-network}"
readonly RECOMMENDED_CPU_CORES=2
readonly RECOMMENDED_MEMORY_BYTES=$((4 * 1024 * 1024 * 1024))
readonly RECOMMENDED_DISK_BYTES=$((30 * 1024 * 1024 * 1024))
# BASH_SOURCE is an array only when Bash executes a file. A curl | bash install
# has no array element, so use the scalar expansion with a safe $0 fallback.
readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE:-$0}")" && pwd)"
STACK_FILE="$INSTALL_DIR/docker-compose.prod.yml"
INTERACTIVE=false
IS_CLOUD="${IS_CLOUD:-false}"
MODE_OVERRIDE=""
REGISTRY_LOGIN_PERFORMED=false

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

Options:
  --interactive         prompt for the Swarm advertise address
  --cloud               install in multi-tenant Cloud mode (open sign-ups enabled)
  --self-hosted         install in single-tenant Self-Hosted mode (default, single owner account)
  --help                show this help
EOF
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
  [[ "$image" == *@sha256:* ]] || fail "$name must be set to an immutable image digest (for example ghcr.io/acme/image@sha256:...)"
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
  UPSTAND_WEB_IMAGE="upstand-web:source-${revision}"
  UPSTAND_MONITORING_IMAGE="upstand-monitoring:source-${revision}"

  docker build --file "$SOURCE_DIR/apps/server/Dockerfile" --tag "$UPSTAND_SERVER_IMAGE" "$SOURCE_DIR"
  docker build --file "$SOURCE_DIR/apps/schedules/Dockerfile" --tag "$UPSTAND_SCHEDULES_IMAGE" "$SOURCE_DIR"
  docker build --file "$SOURCE_DIR/apps/web/Dockerfile" --build-arg "NEXT_PUBLIC_SERVER_URL=$NEXT_PUBLIC_SERVER_URL" --tag "$UPSTAND_WEB_IMAGE" "$SOURCE_DIR"
  docker build --file "$SOURCE_DIR/apps/monitoring/Dockerfile" \
    --build-arg "GOPROXY=${GOPROXY:-https://proxy.golang.org|direct}" \
    --tag "$UPSTAND_MONITORING_IMAGE" "$SOURCE_DIR/apps/monitoring"
  SOURCE_BUILD=true
}

ensure_stack_file() {
  install -d -m 0700 "$INSTALL_DIR"
  local repository="${UPSTAND_REPOSITORY:-https://github.com/upstandplatform/upstand.git}"
  local ref="${UPSTAND_REF:-${UPSTAND_VERSION:-master}}"
  local raw_repository="${repository%.git}"
  raw_repository="${raw_repository#https://github.com/}"
  curl --fail --show-error --silent --location \
    "https://raw.githubusercontent.com/${raw_repository}/${ref}/docker-compose.prod.yml" \
    --output "$STACK_FILE"
  chmod 0600 "$STACK_FILE"
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
  if ! command -v docker >/dev/null 2>&1; then
    require_command curl
    curl --fail --show-error --silent --location https://get.docker.com | sh
  fi

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
    docker network create --driver overlay --attachable --label com.upstand.managed=true "$NETWORK_NAME" >/dev/null
  fi

  local driver scope attachable
  driver="$(docker network inspect --format '{{.Driver}}' "$NETWORK_NAME")"
  scope="$(docker network inspect --format '{{.Scope}}' "$NETWORK_NAME")"
  attachable="$(docker network inspect --format '{{.Attachable}}' "$NETWORK_NAME")"
  [[ "$driver" == "overlay" && "$scope" == "swarm" && "$attachable" == "true" ]] || fail "existing network '$NETWORK_NAME' must be an attachable Swarm overlay network"
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
  local requested_web_image="${UPSTAND_WEB_IMAGE:-}"
  local requested_docs_image="${UPSTAND_DOCS_IMAGE:-}"
  local requested_monitoring_image="${UPSTAND_MONITORING_IMAGE:-}"
  local requested_auto_update="${UPSTAND_AUTO_UPDATE:-}"
  local requested_version="${UPSTAND_VERSION:-}"
  local direct_origins="${UPSTAND_DIRECT_ORIGINS:-false}"

  if [[ -f "$ENV_FILE" ]]; then
    # shellcheck disable=SC1090
    source "$ENV_FILE"
  fi
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

  # A first-run install should be usable without requiring DNS setup up front.
  # When origins are not supplied, keep the control plane reachable directly by
  # the detected host IP and its published service ports. Caddy/domain setup
  # can be enabled later from the Web Server page.
  if [[ -z "${BETTER_AUTH_URL:-}" || -z "${CORS_ORIGIN:-}" || -z "${NEXT_PUBLIC_SERVER_URL:-}" ]]; then
    direct_origins=true
    BETTER_AUTH_URL="${BETTER_AUTH_URL:-http://${advertise_address}:3000}"
    CORS_ORIGIN="${CORS_ORIGIN:-http://${advertise_address}:3001}"
    NEXT_PUBLIC_SERVER_URL="${NEXT_PUBLIC_SERVER_URL:-$BETTER_AUTH_URL}"
    echo "Using direct HTTP origins for the detected host: API=$BETTER_AUTH_URL dashboard=$CORS_ORIGIN" >&2
  fi

  [[ -r "$INSTALL_DIR/secrets/postgres_password" ]] && POSTGRES_PASSWORD="$(cat "$INSTALL_DIR/secrets/postgres_password")"
  [[ -r "$INSTALL_DIR/secrets/redis_password" ]] && REDIS_PASSWORD="$(cat "$INSTALL_DIR/secrets/redis_password")"
  [[ -r "$INSTALL_DIR/secrets/better_auth_secret" ]] && BETTER_AUTH_SECRET="$(cat "$INSTALL_DIR/secrets/better_auth_secret")"
  [[ -r "$INSTALL_DIR/secrets/encryption_key" ]] && ENCRYPTION_KEY_V1="$(cat "$INSTALL_DIR/secrets/encryption_key")"
  [[ -z "${ENCRYPTION_KEY_V1:-}" && -r "$INSTALL_DIR/secrets/ssh_key_encryption_key" ]] && ENCRYPTION_KEY_V1="$(cat "$INSTALL_DIR/secrets/ssh_key_encryption_key")"
  POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-$(openssl rand -hex 32)}"
  REDIS_PASSWORD="${REDIS_PASSWORD:-$(openssl rand -hex 32)}"
  BETTER_AUTH_SECRET="${BETTER_AUTH_SECRET:-$(openssl rand -hex 32)}"
  ENCRYPTION_KEY_V1="${ENCRYPTION_KEY_V1:-${SSH_KEY_ENCRYPTION_KEY_V1:-$(openssl rand -base64 32 | tr -d '\n')}}"
  printf '%s' "$POSTGRES_PASSWORD" >"$INSTALL_DIR/secrets/postgres_password"
  printf '%s' "$REDIS_PASSWORD" >"$INSTALL_DIR/secrets/redis_password"
  printf '%s' "$BETTER_AUTH_SECRET" >"$INSTALL_DIR/secrets/better_auth_secret"
  printf '%s' "$ENCRYPTION_KEY_V1" >"$INSTALL_DIR/secrets/encryption_key"
  cp -f "$INSTALL_DIR/secrets/encryption_key" "$INSTALL_DIR/secrets/ssh_key_encryption_key" 2>/dev/null || true
  chmod 0600 "$INSTALL_DIR/secrets"/*
  DOCKER_NETWORK="$NETWORK_NAME"

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
  UPSTAND_WEB_IMAGE="${requested_web_image:-${UPSTAND_WEB_IMAGE:-}}"
  UPSTAND_DOCS_IMAGE="${requested_docs_image:-${UPSTAND_DOCS_IMAGE:-}}"
  UPSTAND_MONITORING_IMAGE="${requested_monitoring_image:-${UPSTAND_MONITORING_IMAGE:-}}"
  UPSTAND_AUTO_UPDATE="${requested_auto_update:-${UPSTAND_AUTO_UPDATE:-false}}"

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

  POSTGRES_IMAGE="${POSTGRES_IMAGE:-postgres:16.4-alpine@sha256:5660c2cbfea50c7a9127d17dc4e48543eedd3d7a41a595a2dfa572471e37e64c}"
  REDIS_IMAGE="${REDIS_IMAGE:-redis:7.4-alpine@sha256:e7723ff73d963f5cc6d9c4643ea3d989527a402a319239054e9472a7fb9219a2}"

  if [[ "${UPSTAND_BUILD_FROM_SOURCE:-false}" == true || -z "$UPSTAND_SERVER_IMAGE$UPSTAND_SCHEDULES_IMAGE$UPSTAND_WEB_IMAGE$UPSTAND_MONITORING_IMAGE" ]]; then
    build_source_images
  fi
  if [[ "${SOURCE_BUILD:-false}" != true ]]; then
    require_digest_image UPSTAND_SERVER_IMAGE
    require_digest_image UPSTAND_SCHEDULES_IMAGE
    require_digest_image UPSTAND_WEB_IMAGE
    require_digest_image UPSTAND_MONITORING_IMAGE
    require_digest_image POSTGRES_IMAGE
    require_digest_image REDIS_IMAGE
  fi

  cat >"$ENV_FILE" <<EOF
DOCKER_NETWORK=$DOCKER_NETWORK
BETTER_AUTH_URL=$BETTER_AUTH_URL
CORS_ORIGIN=$CORS_ORIGIN
TRUSTED_PROXY_CIDRS=$TRUSTED_PROXY_CIDRS
NEXT_PUBLIC_SERVER_URL=$NEXT_PUBLIC_SERVER_URL
UPSTAND_DASHBOARD_HOST=$UPSTAND_DASHBOARD_HOST
UPSTAND_API_HOST=$UPSTAND_API_HOST
UPSTAND_DOCS_HOST=$UPSTAND_DOCS_HOST
UPSTAND_SERVER_IMAGE=$UPSTAND_SERVER_IMAGE
UPSTAND_SCHEDULES_IMAGE=$UPSTAND_SCHEDULES_IMAGE
UPSTAND_WEB_IMAGE=$UPSTAND_WEB_IMAGE
UPSTAND_DOCS_IMAGE=$UPSTAND_DOCS_IMAGE
UPSTAND_MONITORING_IMAGE=$UPSTAND_MONITORING_IMAGE
UPSTAND_AUTO_UPDATE=$UPSTAND_AUTO_UPDATE
UPSTAND_VERSION=$requested_version
IS_CLOUD=${IS_CLOUD:-false}
UPSTAND_DIRECT_ORIGINS=$direct_origins
POSTGRES_IMAGE=${POSTGRES_IMAGE:-postgres:16.4-alpine@sha256:5660c2cbfea50c7a9127d17dc4e48543eedd3d7a41a595a2dfa572471e37e64c}
REDIS_IMAGE=${REDIS_IMAGE:-redis:7.4-alpine@sha256:e7723ff73d963f5cc6d9c4643ea3d989527a402a319239054e9472a7fb9219a2}
UPSTAND_SERVER_PORT=${UPSTAND_SERVER_PORT:-3000}
UPSTAND_WEB_PORT=${UPSTAND_WEB_PORT:-3001}
UPSTAND_DOCS_PORT=${UPSTAND_DOCS_PORT:-4000}
EOF
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
  local services=(postgres redis server web)

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
  trap cleanup_registry_auth EXIT
  configure_registry_auth
  deploy_stack
  wait_for_stack
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  validate_external_origins

  echo "Upstand has been deployed and all services report ready."
  echo "Dashboard: $CORS_ORIGIN"
  echo "API: $BETTER_AUTH_URL"
  echo "Generated secrets are stored in $INSTALL_DIR/secrets/; back up that directory securely."
  echo "Control-plane state is pinned to node label upstand.control-plane=true."
  echo "Use 'docker stack services upstand' to watch rollout status."
}

# BASH_SOURCE[0] is unset when this script is executed through `curl | bash`.
# The empty-source branch is therefore intentional and keeps both direct-file
# execution and the documented stdin installer path working with `set -u`.
if [[ "${BASH_SOURCE[0]:-}" == "$0" || -z "${BASH_SOURCE[0]:-}" ]]; then
  main "$@"
fi
