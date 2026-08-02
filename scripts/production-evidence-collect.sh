#!/usr/bin/env bash
set -euo pipefail

STACK_NAME="upstand"
NETWORK_NAME="${DOCKER_NETWORK:-upstand-network}"
OUTPUT_DIR=""
DOCKER_BIN="${DOCKER_BIN:-docker}"

usage() {
  cat >&2 <<'EOF'
Usage: production-evidence-collect.sh --output DIR [--stack NAME] [--network NAME]

Collects a secret-safe, read-only evidence bundle from a Docker Swarm manager.
The bundle contains host/runtime identity, node and service state, immutable
image references, task state, and network properties. It never inspects service
environment variables, secrets, or application logs.
EOF
}

fail() {
  echo "production-evidence-collect: $*" >&2
  exit 1
}

while (($# > 0)); do
  case "$1" in
    --output)
      (($# >= 2)) || { usage; exit 2; }
      OUTPUT_DIR="$2"
      shift 2
      ;;
    --stack)
      (($# >= 2)) || { usage; exit 2; }
      STACK_NAME="$2"
      shift 2
      ;;
    --network)
      (($# >= 2)) || { usage; exit 2; }
      NETWORK_NAME="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      usage
      exit 2
      ;;
  esac
done

[[ -n "$OUTPUT_DIR" ]] || { usage; exit 2; }

docker_cmd() {
  "$DOCKER_BIN" "$@"
}

safe_name() {
  printf '%s' "$1" | tr -c 'A-Za-z0-9_.-' '_'
}

umask 077
mkdir -p "$OUTPUT_DIR"
chmod 700 "$OUTPUT_DIR"

metadata_file="$OUTPUT_DIR/metadata.txt"
printf 'collected_at=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$metadata_file"
printf 'stack=%s\n' "$STACK_NAME" >> "$metadata_file"
printf 'network=%s\n' "$NETWORK_NAME" >> "$metadata_file"
printf 'release_ref=%s\n' "${RELEASE_REF:-unknown}" >> "$metadata_file"

docker_cmd version --format 'client={{.Client.Version}} server={{.Server.Version}} api={{.Server.APIVersion}}' \
  > "$OUTPUT_DIR/docker-version.txt"
docker_cmd info --format 'name={{.Name}} swarm={{.Swarm.LocalNodeState}} node_id={{.Swarm.NodeID}} kernel={{.KernelVersion}} os={{.OSType}} arch={{.Architecture}}' \
  > "$OUTPUT_DIR/docker-host.txt"
uname -a > "$OUTPUT_DIR/host-kernel.txt"

docker_cmd node ls --format '{{.ID}}\t{{.Hostname}}\t{{.Status}}\t{{.Availability}}\t{{.ManagerStatus}}' \
  > "$OUTPUT_DIR/swarm-nodes.txt"
docker_cmd service ls --format '{{.Name}}\t{{.Image}}\t{{.Replicas}}\t{{.Mode}}' \
  > "$OUTPUT_DIR/swarm-services.txt"

docker_cmd network inspect "$NETWORK_NAME" \
  --format 'id={{.Id}} driver={{.Driver}} scope={{.Scope}} attachable={{.Attachable}} internal={{.Internal}} encrypted={{index .Options "encrypted"}}' \
  > "$OUTPUT_DIR/network.txt"

mapfile -t services < <(
  docker_cmd service ls --format '{{.Name}}' \
    | awk -v prefix="${STACK_NAME}_" 'index($0, prefix) == 1' \
    | sort
)
for service in "${services[@]}"; do
  [[ -n "$service" ]] || continue
  file_name="$OUTPUT_DIR/service-$(safe_name "$service").txt"
  {
    printf 'name=%s\n' "$service"
    printf 'image='
    docker_cmd service inspect --format '{{.Spec.TaskTemplate.ContainerSpec.Image}}' "$service"
    printf 'replicas='
    docker_cmd service inspect --format '{{if .Spec.Mode.Replicated}}{{.Spec.Mode.Replicated.Replicas}}{{else}}global{{end}}' "$service"
    printf 'user='
    docker_cmd service inspect --format '{{.Spec.TaskTemplate.ContainerSpec.User}}' "$service"
    printf 'read_only_rootfs='
    docker_cmd service inspect --format '{{.Spec.TaskTemplate.ContainerSpec.ReadOnly}}' "$service"
    printf 'capability_drop='
    docker_cmd service inspect --format '{{json .Spec.TaskTemplate.ContainerSpec.CapabilityDrop}}' "$service"
    printf 'networks='
    docker_cmd service inspect --format '{{json .Spec.TaskTemplate.Networks}}' "$service"
    printf '\n[tasks]\n'
    docker_cmd service ps "$service" --no-trunc \
      --format '{{.Name}}\t{{.Node}}\t{{.DesiredState}}\t{{.CurrentState}}\t{{.Error}}'
  } > "$file_name"
done

docker_cmd ps --filter label=com.docker.swarm.service.name \
  --format '{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}' \
  > "$OUTPUT_DIR/local-task-containers.txt"

printf 'completed_at=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$metadata_file"
echo "production-evidence-collect: wrote secret-safe evidence to $OUTPUT_DIR"
