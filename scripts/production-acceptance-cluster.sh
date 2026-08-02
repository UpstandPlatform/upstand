#!/usr/bin/env bash
set -euo pipefail

STACK_NAME="upstand"
NETWORK_NAME="${DOCKER_NETWORK:-upstand-network}"
OUTPUT_DIR=""
SSH_USER=""
SSH_PORT="22"
SSH_IDENTITY=""
REMOTE_SCRIPT="/etc/upstand/production-acceptance.sh"
DOCKER_BIN="${DOCKER_BIN:-docker}"

usage() {
  cat >&2 <<'EOF'
Usage: production-acceptance-cluster.sh --output DIR --ssh-user USER [--stack NAME] [--network NAME] [--ssh-port PORT] [--ssh-identity FILE] [--remote-script PATH]

Run the existing node-local production acceptance gate on every active Swarm
node and write a secret-safe per-node evidence bundle. The SSH account must
have access to Docker and the installed acceptance script on every node.
Strict host-key checking is always enabled; this command never accepts a new
host key automatically and never inspects service environments or secrets.
EOF
}

fail() {
  echo "production-acceptance-cluster: $*" >&2
  exit 1
}

while (($# > 0)); do
  case "$1" in
    --output)
      (($# >= 2)) || { usage; exit 2; }
      OUTPUT_DIR="$2"
      shift 2
      ;;
    --ssh-user)
      (($# >= 2)) || { usage; exit 2; }
      SSH_USER="$2"
      shift 2
      ;;
    --ssh-port)
      (($# >= 2)) || { usage; exit 2; }
      SSH_PORT="$2"
      shift 2
      ;;
    --ssh-identity)
      (($# >= 2)) || { usage; exit 2; }
      SSH_IDENTITY="$2"
      shift 2
      ;;
    --remote-script)
      (($# >= 2)) || { usage; exit 2; }
      REMOTE_SCRIPT="$2"
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
[[ -n "$SSH_USER" ]] || { usage; exit 2; }
[[ "$OUTPUT_DIR" == /* && "$OUTPUT_DIR" != "/" && "$OUTPUT_DIR" != "$HOME" ]] \
  || fail "output directory must be an absolute non-root path"
[[ "$SSH_USER" =~ ^[A-Za-z0-9_.-]+$ ]] \
  || fail "SSH user must contain only letters, digits, dot, underscore, or hyphen"
[[ "$SSH_PORT" =~ ^[0-9]+$ && "$SSH_PORT" -ge 1 && "$SSH_PORT" -le 65535 ]] \
  || fail "SSH port must be between 1 and 65535"
[[ "$REMOTE_SCRIPT" =~ ^/[A-Za-z0-9._/-]+$ ]] \
  || fail "remote script must be a safe absolute path"
if [[ -n "$SSH_IDENTITY" && ! -f "$SSH_IDENTITY" ]]; then
  fail "SSH identity file does not exist: $SSH_IDENTITY"
fi
known_hosts_file="${UPSTAND_SSH_KNOWN_HOSTS:-$HOME/.ssh/known_hosts}"
[[ -f "$known_hosts_file" ]] \
  || fail "strict SSH known_hosts file does not exist: $known_hosts_file"

docker_cmd() {
  "$DOCKER_BIN" "$@"
}

safe_name() {
  printf '%s' "$1" | tr -c 'A-Za-z0-9_.-' '_'
}

umask 077
mkdir -p "$OUTPUT_DIR"
chmod 700 "$OUTPUT_DIR"

docker_cmd info --format '{{.Swarm.LocalNodeState}}' | grep -Fxq active \
  || fail "manager Docker daemon is not an active Swarm node"

mapfile -t nodes < <(
  docker_cmd node ls --format '{{.ID}}\t{{.Description.Hostname}}\t{{.Status.Addr}}\t{{.Status.State}}\t{{.Spec.Availability}}' \
    | awk -F '\t' '$4 == "Ready" && $5 == "Active"'
)
[[ "${#nodes[@]}" -gt 0 ]] || fail "no Ready/Active Swarm nodes were discovered"

metadata_file="$OUTPUT_DIR/cluster-metadata.txt"
{
  printf 'collected_at=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf 'stack=%s\n' "$STACK_NAME"
  printf 'network=%s\n' "$NETWORK_NAME"
  printf 'node_count=%s\n' "${#nodes[@]}"
  printf 'remote_script=%s\n' "$REMOTE_SCRIPT"
} > "$metadata_file"

ssh_args=(
  -o BatchMode=yes
  -o ConnectTimeout=10
  -o StrictHostKeyChecking=yes
  -o UserKnownHostsFile="$known_hosts_file"
  -p "$SSH_PORT"
)
if [[ -n "$SSH_IDENTITY" ]]; then
  ssh_args+=( -i "$SSH_IDENTITY" )
fi

failed_nodes=0
for node in "${nodes[@]}"; do
  IFS=$'\t' read -r node_id node_name node_address node_state node_availability <<< "$node"
  [[ "$node_id" =~ ^[[:alnum:]]+$ && -n "$node_name" && -n "$node_address" ]] \
    || fail "Swarm node record is incomplete or malformed"

  output_name="$(safe_name "$node_name")"
  result_file="$OUTPUT_DIR/node-$output_name.txt"
  printf -v remote_command 'bash %q --node-local --stack %q --network %q' \
    "$REMOTE_SCRIPT" "$STACK_NAME" "$NETWORK_NAME"
  ssh_target="$SSH_USER@$node_address"
  if [[ "$node_address" == *:* && "$node_address" != \[*\] ]]; then
    ssh_target="$SSH_USER@[$node_address]"
  fi
  {
    printf 'node_id=%s\n' "$node_id"
    printf 'node_name=%s\n' "$node_name"
    printf 'node_address=%s\n' "$node_address"
    printf 'node_state=%s\n' "$node_state"
    printf 'node_availability=%s\n' "$node_availability"
    printf 'ssh_user=%s\n' "$SSH_USER"
    printf '\n[node-local-acceptance]\n'
  } > "$result_file"

  set +e
  ssh "${ssh_args[@]}" "$ssh_target" "$remote_command" \
    >> "$result_file" 2>&1
  node_exit=$?
  set -e
  printf '\nexit_code=%s\n' "$node_exit" >> "$result_file"
  if [[ "$node_exit" -ne 0 ]]; then
    failed_nodes=$((failed_nodes + 1))
    echo "production-acceptance-cluster: node '$node_name' failed; see $result_file" >&2
  else
    echo "production-acceptance-cluster: node '$node_name' passed"
  fi
done

printf 'completed_at=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$metadata_file"
printf 'failed_nodes=%s\n' "$failed_nodes" >> "$metadata_file"

if [[ "$failed_nodes" -ne 0 ]]; then
  fail "$failed_nodes of ${#nodes[@]} Swarm nodes failed node-local acceptance"
fi

echo "production-acceptance-cluster: passed (${#nodes[@]} nodes); evidence=$OUTPUT_DIR"
