#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STACK_NAME="upstand"
REQUIRE_HA="false"
ALLOW_REMOTE_TASKS="false"
REQUIRE_OBSERVABILITY="true"
NODE_LOCAL_ONLY="false"
NETWORK_NAME="${DOCKER_NETWORK:-upstand-network}"
CONTROL_NETWORK_NAME="${DOCKER_CONTROL_NETWORK:-upstand-docker-control}"
DOCKER_BIN="${DOCKER_BIN:-docker}"
REQUIRE_ENCRYPTED_NETWORK="${UPSTAND_ACCEPTANCE_REQUIRE_ENCRYPTED_NETWORK:-true}"
EXTERNAL_POSTGRES_SERVICE=""
EXTERNAL_REDIS_SERVICE=""
DR_EVIDENCE_FILE="${UPSTAND_DR_EVIDENCE_FILE:-}"
DR_EVIDENCE_SIGNATURE_FILE="${UPSTAND_DR_EVIDENCE_SIGNATURE_FILE:-}"
DR_EVIDENCE_PUBLIC_KEY_FILE="${UPSTAND_DR_EVIDENCE_PUBLIC_KEY_FILE:-}"
DR_EVIDENCE_MAX_AGE_SECONDS="${UPSTAND_DR_EVIDENCE_MAX_AGE_SECONDS:-2592000}"

docker_cmd() {
  "$DOCKER_BIN" "$@"
}

usage() {
  cat >&2 <<'EOF'
Usage: production-acceptance.sh [--stack NAME] [--network NAME] [--require-ha] [--allow-remote-tasks] [--allow-unobserved] [--node-local] \
  [--external-postgres-service NAME] [--external-redis-service NAME] \
  [--dr-evidence-file PATH] [--dr-evidence-signature-file PATH] [--dr-evidence-public-key-file PATH]

Read-only production acceptance checks for a deployed Upstand Swarm stack.
Use --node-local on each Swarm node to inspect task containers hosted by that
Docker daemon; it does not replace the manager-level service convergence gate.
EOF
}

fail() {
  echo "production-acceptance: $*" >&2
  exit 1
}

assert_no_root_runtime_process() {
  local container_id="$1"
  local subject="$2"
  local process_inspection_user="${3:-65534:65534}"
  local process_users process_rows root_process

  if process_users="$(docker_cmd top "$container_id" -eo user 2>/dev/null)"; then
    process_rows="$(printf '%s\n' "$process_users" | tail -n +2 | sed '/^[[:space:]]*$/d')"
  else
    # Official stateful images may not include a portable `ps` format, which
    # makes `docker top -eo user` unavailable. Read process UIDs through a
    # non-root exec instead so the inspection shell itself cannot create a
    # false root-process result. Stateful callers pass their already-validated
    # numeric runtime identity because minimal images can reject arbitrary
    # supplemental users during docker exec.
    process_rows="$(docker_cmd exec --user "$process_inspection_user" "$container_id" /bin/sh -ec '
      found=0
      for status in /proc/[0-9]*/status; do
        [ -r "$status" ] || continue
        uid="$(awk '\''$1 == "Uid:" { print $2; exit }'\'' "$status")"
        [ -n "$uid" ] || continue
        printf "%s %s\\n" "$uid" "${status##*/}"
        found=1
      done
      [ "$found" -eq 1 ]
    ' 2>/dev/null)" \
      || fail "$subject process users could not be inspected with docker top or the container /proc fallback"
  fi

  [[ -n "$process_rows" ]] \
    || fail "$subject has no inspectable runtime process"
  root_process="$(printf '%s\n' "$process_rows" | awk '$1 == "0" || $1 == "root" { print; exit }')"
  [[ -z "$root_process" ]] \
    || fail "$subject has a root runtime process: $root_process"
}

while (($# > 0)); do
  case "$1" in
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
    --require-ha)
      REQUIRE_HA="true"
      shift
      ;;
    --allow-remote-tasks)
      ALLOW_REMOTE_TASKS="true"
      shift
      ;;
    --allow-unobserved)
      REQUIRE_OBSERVABILITY="false"
      shift
      ;;
    --node-local)
      NODE_LOCAL_ONLY="true"
      shift
      ;;
    --external-postgres-service)
      (($# >= 2)) || { usage; exit 2; }
      EXTERNAL_POSTGRES_SERVICE="$2"
      shift 2
      ;;
    --external-redis-service)
      (($# >= 2)) || { usage; exit 2; }
      EXTERNAL_REDIS_SERVICE="$2"
      shift 2
      ;;
    --dr-evidence-file)
      (($# >= 2)) || { usage; exit 2; }
      DR_EVIDENCE_FILE="$2"
      shift 2
      ;;
    --dr-evidence-signature-file)
      (($# >= 2)) || { usage; exit 2; }
      DR_EVIDENCE_SIGNATURE_FILE="$2"
      shift 2
      ;;
    --dr-evidence-public-key-file)
      (($# >= 2)) || { usage; exit 2; }
      DR_EVIDENCE_PUBLIC_KEY_FILE="$2"
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

assert_node_local_container() {
  local container_id="$1"
  local service_name image health runtime_user capabilities readonly_rootfs

  service_name="$(docker_cmd inspect --format '{{index .Config.Labels "com.docker.swarm.service.name"}}' "$container_id")" \
    || fail "node-local container '$container_id' service label could not be inspected"
  [[ "$service_name" == "${STACK_NAME}_"* ]] || return 0

  image="$(docker_cmd inspect --format '{{.Config.Image}}' "$container_id")" \
    || fail "node-local container '$container_id' image could not be inspected"
  [[ "$image" =~ @sha256:[0-9a-fA-F]{64}$ ]] \
    || fail "node-local service '$service_name' is not pinned to an immutable image: $image"

  health="$(docker_cmd inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}no-healthcheck{{end}}' "$container_id")" \
    || fail "node-local container '$container_id' health could not be inspected"
  [[ "$health" == "healthy" ]] \
    || fail "node-local service '$service_name' container '$container_id' is $health"

  runtime_user="$(docker_cmd inspect --format '{{.Config.User}}' "$container_id")" \
    || fail "node-local container '$container_id' runtime user could not be inspected"
  if [[ -z "$runtime_user" || "$runtime_user" == "0" || "$runtime_user" == "root" ]]; then
    assert_no_root_runtime_process \
      "$container_id" \
      "node-local service '$service_name' container '$container_id'"
  fi

  capabilities="$(docker_cmd inspect --format '{{json .HostConfig.CapDrop}}' "$container_id")" \
    || fail "node-local service '$service_name' container '$container_id' capabilities could not be inspected"
  [[ "$capabilities" == *'"ALL"'* ]] \
    || fail "node-local service '$service_name' container '$container_id' does not drop all Linux capabilities: $capabilities"

  case "$service_name" in
    "${STACK_NAME}_migrate"|"${STACK_NAME}_docker-broker"|"${STACK_NAME}_server"|"${STACK_NAME}_schedules"|"${STACK_NAME}_deployment-worker"|"${STACK_NAME}_web"|"${STACK_NAME}_fumadocs")
      readonly_rootfs="$(docker_cmd inspect --format '{{.HostConfig.ReadonlyRootfs}}' "$container_id")" \
        || fail "node-local service '$service_name' container '$container_id' filesystem mode could not be inspected"
      [[ "$readonly_rootfs" == "true" ]] \
        || fail "node-local service '$service_name' container '$container_id' does not use a read-only root filesystem"
      ;;
  esac

  echo "acceptance: node-local $service_name container=$container_id healthy, image=$image"
}

run_node_local_acceptance() {
  local swarm_state node_id node_name container_id service_name local_task_count=0
  local server_task_count=0 monitoring_count=0 expected_monitoring_image monitoring_image

  swarm_state="$(docker_cmd info --format '{{.Swarm.LocalNodeState}}')" \
    || fail "unable to inspect Docker Swarm on the local node"
  [[ "$swarm_state" == "active" ]] \
    || fail "Docker Swarm is not active on the local node: $swarm_state"
  node_id="$(docker_cmd info --format '{{.Swarm.NodeID}}')" \
    || fail "unable to inspect the local Swarm node ID"
  node_name="$(docker_cmd info --format '{{.Name}}')" \
    || fail "unable to inspect the local Docker node name"
  [[ -n "$node_id" && "$node_id" != "<no value>" ]] \
    || fail "local Docker daemon did not report a Swarm node ID"

  while IFS= read -r container_id; do
    [[ -n "$container_id" ]] || continue
    service_name="$(docker_cmd inspect --format '{{index .Config.Labels "com.docker.swarm.service.name"}}' "$container_id")" \
      || fail "node-local container '$container_id' service label could not be inspected"
    [[ "$service_name" == "${STACK_NAME}_"* ]] || continue
    ((local_task_count += 1))
    [[ "$service_name" == "${STACK_NAME}_server" ]] && ((server_task_count += 1))
    assert_node_local_container "$container_id"
  done < <(docker_cmd ps -q --filter label=com.docker.swarm.service.name)

  expected_monitoring_image="$(docker_cmd service inspect --format '{{range .Spec.TaskTemplate.ContainerSpec.Env}}{{println .}}{{end}}' "${STACK_NAME}_server" 2>/dev/null \
    | sed -n 's/^UPSTAND_MONITORING_IMAGE=//p' | head -n 1)"
  [[ "$server_task_count" -eq 0 || "$expected_monitoring_image" =~ @sha256:[0-9a-fA-F]{64}$ ]] \
    || fail "server monitoring image is not pinned to an immutable image digest: $expected_monitoring_image"

  while IFS= read -r container_id; do
    [[ -n "$container_id" ]] || continue
    ((monitoring_count += 1))
    monitoring_image="$(docker_cmd inspect --format '{{.Config.Image}}' "$container_id")" \
      || fail "node-local monitoring agent '$container_id' image could not be inspected"
    [[ "$monitoring_image" == "$expected_monitoring_image" ]] \
      || fail "node-local monitoring agent '$container_id' image does not match the server configuration: $monitoring_image"
    local health runtime_user capabilities readonly_rootfs
    health="$(docker_cmd inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}no-healthcheck{{end}}' "$container_id")" \
      || fail "node-local monitoring agent '$container_id' health could not be inspected"
    [[ "$health" == "healthy" ]] \
      || fail "node-local monitoring agent '$container_id' is $health"
    runtime_user="$(docker_cmd inspect --format '{{.Config.User}}' "$container_id")" \
      || fail "node-local monitoring agent '$container_id' runtime user could not be inspected"
    [[ -n "$runtime_user" && "$runtime_user" != "0" && "$runtime_user" != "root" ]] \
      || fail "node-local monitoring agent '$container_id' is configured to run as root"
    capabilities="$(docker_cmd inspect --format '{{json .HostConfig.CapDrop}}' "$container_id")" \
      || fail "node-local monitoring agent '$container_id' capabilities could not be inspected"
    [[ "$capabilities" == *'"ALL"'* ]] \
      || fail "node-local monitoring agent '$container_id' does not drop all Linux capabilities: $capabilities"
    readonly_rootfs="$(docker_cmd inspect --format '{{.HostConfig.ReadonlyRootfs}}' "$container_id")" \
      || fail "node-local monitoring agent '$container_id' filesystem mode could not be inspected"
    [[ "$readonly_rootfs" == "true" ]] \
      || fail "node-local monitoring agent '$container_id' does not use a read-only root filesystem"
  done < <(docker_cmd ps -q --filter label=com.upstand.component=monitoring-agent)

  if [[ "$server_task_count" -gt 0 && "$monitoring_count" -eq 0 ]]; then
    fail "node-local server task(s) have no inspectable monitoring agent on node '$node_name'"
  fi
  echo "acceptance: node-local inspection passed (node=$node_name id=$node_id stack_tasks=$local_task_count monitoring_agents=$monitoring_count)"
}

if [[ "$NODE_LOCAL_ONLY" == "true" ]]; then
  run_node_local_acceptance
  echo "production-acceptance: node-local passed"
  exit 0
fi

docker_swarm_state="$(docker_cmd info --format '{{.Swarm.LocalNodeState}}')" \
  || fail "unable to inspect Docker Swarm"
[[ "$docker_swarm_state" == "active" ]] \
  || fail "Docker Swarm is not active: $docker_swarm_state"

network_driver="$(docker_cmd network inspect -f '{{.Driver}}' "$NETWORK_NAME")" \
  || fail "network '$NETWORK_NAME' does not exist"
network_scope="$(docker_cmd network inspect -f '{{.Scope}}' "$NETWORK_NAME")"
network_attachable="$(docker_cmd network inspect -f '{{.Attachable}}' "$NETWORK_NAME")"
network_id="$(docker_cmd network inspect -f '{{.Id}}' "$NETWORK_NAME")"
network_options="$(docker_cmd network inspect -f '{{json .Options}}' "$NETWORK_NAME")"
[[ "$network_driver" == "overlay" ]] || fail "network '$NETWORK_NAME' is not an overlay"
[[ "$network_scope" == "swarm" ]] || fail "network '$NETWORK_NAME' is not Swarm-scoped"
[[ "$network_attachable" == "true" ]] || fail "network '$NETWORK_NAME' is not attachable"
[[ -n "$network_id" && "$network_id" != "<no value>" ]] \
  || fail "network '$NETWORK_NAME' has no inspectable network ID"
if [[ "$REQUIRE_ENCRYPTED_NETWORK" == true ]]; then
  [[ "$network_options" == *'"encrypted"'* \
    && "$network_options" != *'"encrypted":false'* \
    && "$network_options" != *'"encrypted":"false"'* ]] \
    || fail "network '$NETWORK_NAME' is not encrypted"
  echo "acceptance: encrypted attachable Swarm network verified"
else
  echo "acceptance: encrypted network requirement skipped by explicit CI capability override"
fi

[[ "$CONTROL_NETWORK_NAME" != "$NETWORK_NAME" ]] \
  || fail "Docker control network must be distinct from the application network"
control_network_driver="$(docker_cmd network inspect -f '{{.Driver}}' "$CONTROL_NETWORK_NAME")" \
  || fail "Docker control network '$CONTROL_NETWORK_NAME' does not exist"
control_network_scope="$(docker_cmd network inspect -f '{{.Scope}}' "$CONTROL_NETWORK_NAME")"
control_network_attachable="$(docker_cmd network inspect -f '{{.Attachable}}' "$CONTROL_NETWORK_NAME")"
control_network_internal="$(docker_cmd network inspect -f '{{.Internal}}' "$CONTROL_NETWORK_NAME")"
control_network_id="$(docker_cmd network inspect -f '{{.Id}}' "$CONTROL_NETWORK_NAME")"
control_network_options="$(docker_cmd network inspect -f '{{json .Options}}' "$CONTROL_NETWORK_NAME")"
[[ "$control_network_driver" == "overlay" && "$control_network_scope" == "swarm" && "$control_network_attachable" == "true" && "$control_network_internal" == "true" ]] \
  || fail "Docker control network '$CONTROL_NETWORK_NAME' is not an attachable Swarm overlay"
[[ -n "$control_network_id" && "$control_network_id" != "<no value>" ]] \
  || fail "Docker control network '$CONTROL_NETWORK_NAME' has no inspectable network ID"
if [[ "$REQUIRE_ENCRYPTED_NETWORK" == true ]]; then
  [[ "$control_network_options" == *'"encrypted"'* \
    && "$control_network_options" != *'"encrypted":false'* \
    && "$control_network_options" != *'"encrypted":"false"'* ]] \
    || fail "Docker control network '$CONTROL_NETWORK_NAME' is not encrypted"
fi
echo "acceptance: encrypted Docker control network verified"

migration_name="${STACK_NAME}_migrate"
migration_state="$(docker_cmd service ps "$migration_name" --no-trunc --format '{{.CurrentState}}' | head -n 1)" \
  || fail "migration service '$migration_name' does not exist"
migration_image="$(docker_cmd service inspect --format '{{.Spec.TaskTemplate.ContainerSpec.Image}}' "$migration_name")" \
  || fail "migration service '$migration_name' does not exist"
[[ "$migration_state" == Complete\ * ]] \
  || fail "current database migration task has not completed: ${migration_state:-unknown}"
[[ "$migration_image" =~ @sha256:[0-9a-fA-F]{64}$ ]] \
  || fail "migration service is not pinned to an immutable image digest: $migration_image"
migration_capabilities="$(docker_cmd service inspect --format '{{json .Spec.TaskTemplate.ContainerSpec.CapabilityDrop}}' "$migration_name")" \
  || fail "migration service '$migration_name' capabilities could not be inspected"
[[ "$migration_capabilities" == *'"ALL"'* ]] \
  || fail "migration service does not drop all Linux capabilities: $migration_capabilities"
migration_readonly_rootfs="$(docker_cmd service inspect --format '{{.Spec.TaskTemplate.ContainerSpec.ReadOnly}}' "$migration_name")" \
  || fail "migration service '$migration_name' read-only root filesystem could not be inspected"
[[ "$migration_readonly_rootfs" == "true" ]] \
  || fail "migration service does not use a read-only root filesystem"
migration_user="$(docker_cmd service inspect --format '{{.Spec.TaskTemplate.ContainerSpec.User}}' "$migration_name")" \
  || fail "migration service '$migration_name' runtime user could not be inspected"
[[ "$migration_user" =~ ^10001:[0-9]+$ ]] \
  || fail "migration service is not configured with the non-root runtime identity: $migration_user"
migration_networks="$(docker_cmd service inspect --format '{{json .Spec.TaskTemplate.Networks}}' "$migration_name")" \
  || fail "migration service '$migration_name' networks could not be inspected"
[[ "$migration_networks" == *"$network_id"* ]] \
  || fail "migration service is not attached to network '$NETWORK_NAME': $migration_networks"
server_image="$(docker_cmd service inspect --format '{{.Spec.TaskTemplate.ContainerSpec.Image}}' "${STACK_NAME}_server")" \
  || fail "service '${STACK_NAME}_server' does not exist"
[[ "$migration_image" == "$server_image" ]] \
  || fail "migration image does not match the running server image: migration=$migration_image server=$server_image"
echo "acceptance: current database migration completed, image=$migration_image"

assert_service() {
  local service_name="$1"
  local expected_network_id="${2:-$network_id}"
  local expected_network_name="${3:-$NETWORK_NAME}"
  local desired running image healthcheck container_id health service_networks container_count
  local readonly_rootfs container_readonly runtime_user

  desired="$(docker_cmd service inspect --format '{{if .Spec.Mode.Replicated}}{{.Spec.Mode.Replicated.Replicas}}{{else}}0{{end}}' "$service_name")" \
    || fail "service '$service_name' does not exist"
  [[ "$desired" =~ ^[0-9]+$ && "$desired" -ge 1 ]] \
    || fail "service '$service_name' has no desired replicas"

  service_networks="$(docker_cmd service inspect --format '{{json .Spec.TaskTemplate.Networks}}' "$service_name")" \
    || fail "service '$service_name' networks could not be inspected"
  [[ "$service_networks" == *"$expected_network_id"* ]] \
    || fail "service '$service_name' is not attached to network '$expected_network_name': $service_networks"

  running="$(docker_cmd service ps "$service_name" --filter desired-state=running --format '{{.CurrentState}}' | grep -c '^Running ' || true)"
  [[ "$running" -eq "$desired" ]] \
    || fail "service '$service_name' converged at $running/$desired running tasks"

  image="$(docker_cmd service inspect --format '{{.Spec.TaskTemplate.ContainerSpec.Image}}' "$service_name")"
  [[ "$image" =~ @sha256:[0-9a-fA-F]{64}$ ]] \
    || fail "service '$service_name' is not pinned to an immutable image digest: $image"

  healthcheck="$(docker_cmd service inspect --format '{{json .Spec.TaskTemplate.ContainerSpec.Healthcheck}}' "$service_name")"
  [[ "$healthcheck" != "null" && "$healthcheck" != "{}" ]] \
    || fail "service '$service_name' has no configured container health check"
if [[ "$service_name" == *_migrate || "$service_name" == *_server || "$service_name" == *_schedules || "$service_name" == *_deployment-worker ]]; then
    readonly_rootfs="$(docker_cmd service inspect --format '{{.Spec.TaskTemplate.ContainerSpec.ReadOnly}}' "$service_name")" \
      || fail "service '$service_name' read-only root filesystem could not be inspected"
    [[ "$readonly_rootfs" == "true" ]] \
      || fail "service '$service_name' does not use a read-only root filesystem"
  fi
  capabilities="$(docker_cmd service inspect --format '{{json .Spec.TaskTemplate.ContainerSpec.CapabilityDrop}}' "$service_name")"
  [[ "$capabilities" == *'"ALL"'* ]] \
    || fail "service '$service_name' does not drop all Linux capabilities: $capabilities"

  if [[ "$service_name" == *_postgres || "$service_name" == *_redis ]]; then
    capabilities_add="$(docker_cmd service inspect --format '{{json .Spec.TaskTemplate.ContainerSpec.CapabilityAdd}}' "$service_name")"
    for capability in CHOWN DAC_OVERRIDE SETGID SETUID; do
      [[ "$capabilities_add" == *"\"CAP_$capability\""* || "$capabilities_add" == *"\"$capability\""* ]] \
        || fail "stateful service '$service_name' does not grant required $capability capability for its official entrypoint: $capabilities_add"
    done
  fi

  if [[ "$service_name" == "${STACK_NAME}_redis" ]]; then
    runtime_user="$(docker_cmd service inspect --format '{{.Spec.TaskTemplate.ContainerSpec.User}}' "$service_name")" \
      || fail "bundled Redis service '$service_name' runtime user could not be inspected"
    [[ "$runtime_user" == "999:1000" ]] \
      || fail "bundled Redis service '$service_name' is not pinned to Redis's non-root identity: $runtime_user"
  elif [[ "$service_name" == "${STACK_NAME}_postgres" ]]; then
    runtime_user="$(docker_cmd service inspect --format '{{.Spec.TaskTemplate.ContainerSpec.User}}' "$service_name")" \
      || fail "bundled PostgreSQL service '$service_name' runtime user could not be inspected"
    [[ "$runtime_user" == "70:70" ]] \
      || fail "bundled PostgreSQL service '$service_name' is not pinned to PostgreSQL's non-root identity: $runtime_user"
  fi

  container_count=0
  while IFS= read -r container_id; do
    [[ -n "$container_id" ]] || continue
    ((container_count += 1))
    health="$(docker_cmd inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}no-healthcheck{{end}}' "$container_id")"
    [[ "$health" == "healthy" ]] \
      || fail "service '$service_name' container '$container_id' is $health"
    runtime_user="$(docker_cmd inspect --format '{{.Config.User}}' "$container_id")"
    if [[ "$service_name" == "${STACK_NAME}_redis" ]]; then
      assert_no_root_runtime_process \
        "$container_id" \
        "service '$service_name' container '$container_id'" \
        "$runtime_user"
    elif [[ -z "$runtime_user" || "$runtime_user" == "0" || "$runtime_user" == "root" ]]; then
      # PostgreSQL's official entrypoint may leave Config.User empty while
      # dropping its effective server process to the postgres account. Inspect
      # the process table when the image does not declare a static user.
      assert_no_root_runtime_process \
        "$container_id" \
        "service '$service_name' container '$container_id'"
    fi
    if [[ "$service_name" == *_migrate || "$service_name" == *_server || "$service_name" == *_schedules || "$service_name" == *_deployment-worker ]]; then
      container_readonly="$(docker_cmd inspect --format '{{.HostConfig.ReadonlyRootfs}}' "$container_id")" \
        || fail "service '$service_name' container '$container_id' filesystem mode could not be inspected"
      [[ "$container_readonly" == "true" ]] \
        || fail "service '$service_name' container '$container_id' does not use a read-only root filesystem"
    fi
  done < <(docker_cmd ps -q --filter "label=com.docker.swarm.service.name=$service_name")
  if [[ "$container_count" -ne "$desired" ]]; then
    if [[ "$container_count" -lt "$desired" && "$ALLOW_REMOTE_TASKS" == "true" ]]; then
      echo "acceptance: $service_name has $((desired - container_count)) remote task(s); local process and health inspection was skipped for those tasks" >&2
    else
      fail "service '$service_name' has $container_count inspectable containers for $desired running tasks; run on a Docker daemon that can inspect every task or use --allow-remote-tasks for service-level validation"
    fi
  fi

  echo "acceptance: $service_name ready ($running/$desired tasks), image=$image"
}

assert_observability() {
  local service_name="$1"
  local service_environment otlp_endpoint

  service_environment="$(docker_cmd service inspect --format '{{range .Spec.TaskTemplate.ContainerSpec.Env}}{{println .}}{{end}}' "$service_name")" \
    || fail "service '$service_name' environment could not be inspected"
  otlp_endpoint="$(printf '%s\n' "$service_environment" | sed -n 's/^OTLP_ENDPOINT=//p' | head -n 1)"
  [[ "$otlp_endpoint" == http://* || "$otlp_endpoint" == https://* ]] \
    || fail "service '$service_name' has no valid OTLP_ENDPOINT; use --allow-unobserved only for an explicitly unobserved environment"
}

for service in postgres redis; do
  service_name="${STACK_NAME}_${service}"
  if docker_cmd service inspect "$service_name" >/dev/null 2>&1; then
    desired="$(docker_cmd service inspect --format '{{if .Spec.Mode.Replicated}}{{.Spec.Mode.Replicated.Replicas}}{{else}}0{{end}}' "$service_name")"
    if [[ "$desired" -gt 0 ]]; then
      assert_service "$service_name"
    else
      echo "acceptance: bundled $service is disabled (external service expected)"
    fi
  fi
done

assert_service "${STACK_NAME}_docker-broker" "$control_network_id" "$CONTROL_NETWORK_NAME"
for service in server schedules deployment-worker web fumadocs; do
  assert_service "${STACK_NAME}_${service}"
done

schedules_image="$(docker_cmd service inspect --format '{{.Spec.TaskTemplate.ContainerSpec.Image}}' "${STACK_NAME}_schedules")" \
  || fail "schedules image could not be inspected"
deployment_worker_image="$(docker_cmd service inspect --format '{{.Spec.TaskTemplate.ContainerSpec.Image}}' "${STACK_NAME}_deployment-worker")" \
  || fail "deployment-worker image could not be inspected"
[[ "$schedules_image" =~ @sha256:[0-9a-fA-F]{64}$ ]] \
  || fail "schedules image is not pinned to an immutable digest: $schedules_image"
[[ "$deployment_worker_image" =~ @sha256:[0-9a-fA-F]{64}$ ]] \
  || fail "deployment-worker image is not pinned to an immutable digest: $deployment_worker_image"
[[ "$schedules_image" != "$deployment_worker_image" ]] \
  || fail "schedules and deployment-worker must use distinct images"
echo "acceptance: schedules and deployment-worker use distinct immutable images"

broker_auth_environment="$(docker_cmd service inspect --format '{{range .Spec.TaskTemplate.ContainerSpec.Env}}{{println .}}{{end}}' "${STACK_NAME}_docker-broker")" \
  || fail "service '${STACK_NAME}_docker-broker' environment could not be inspected for Docker broker authentication"
printf '%s\n' "$broker_auth_environment" | grep -Fxq 'UPSTAND_DOCKER_BROKER_SERVER_TOKEN_FILE=/run/secrets/docker_broker_server_token' \
  || fail "Docker broker must load the server-specific Swarm secret"
printf '%s\n' "$broker_auth_environment" | grep -Fxq 'UPSTAND_DOCKER_BROKER_SCHEDULES_TOKEN_FILE=/run/secrets/docker_broker_schedules_token' \
  || fail "Docker broker must load the schedules-specific Swarm secret"
printf '%s\n' "$broker_auth_environment" | grep -Fxq 'UPSTAND_DOCKER_BROKER_DEPLOYMENT_WORKER_TOKEN_FILE=/run/secrets/docker_broker_deployment_worker_token' \
  || fail "Docker broker must load the deployment-worker-specific Swarm secret"
printf '%s\n' "$broker_auth_environment" | grep -Fxq 'UPSTAND_DOCKER_BROKER_TLS_REQUIRED=true' \
  || fail "Docker broker must require mutually authenticated TLS"
printf '%s\n' "$broker_auth_environment" | grep -Fxq 'UPSTAND_DOCKER_BROKER_CA_FILE=/run/secrets/docker_broker_ca' \
  || fail "Docker broker must load its private CA"
printf '%s\n' "$broker_auth_environment" | grep -Fxq 'UPSTAND_DOCKER_BROKER_CERT_FILE=/run/secrets/docker_broker_server_cert' \
  || fail "Docker broker must load its server certificate"
printf '%s\n' "$broker_auth_environment" | grep -Fxq 'UPSTAND_DOCKER_BROKER_KEY_FILE=/run/secrets/docker_broker_server_key' \
  || fail "Docker broker must load its server key"
server_auth_environment="$(docker_cmd service inspect --format '{{range .Spec.TaskTemplate.ContainerSpec.Env}}{{println .}}{{end}}' "${STACK_NAME}_server")" \
  || fail "server environment could not be inspected for Docker broker authentication"
printf '%s\n' "$server_auth_environment" | grep -Fxq 'UPSTAND_DOCKER_BROKER_TOKEN_FILE=/run/secrets/docker_broker_server_token' \
  || fail "server must use its caller-specific Docker broker Swarm secret"
printf '%s\n' "$server_auth_environment" | grep -Fxq 'DOCKER_HOST=https://docker-broker:2375' \
  || fail "server must use the HTTPS Docker broker transport"
printf '%s\n' "$server_auth_environment" | grep -Fxq 'DOCKER_TLS_VERIFY=1' \
  || fail "server Docker CLI must verify the broker TLS certificate"
printf '%s\n' "$server_auth_environment" | grep -Fxq 'DOCKER_CERT_PATH=/run/secrets' \
  || fail "server Docker CLI must use the mounted broker client certificate directory"
printf '%s\n' "$server_auth_environment" | grep -Fxq 'UPSTAND_DOCKER_BROKER_CA_FILE=/run/secrets/ca.pem' \
  || fail "server must use the mounted broker CA"
printf '%s\n' "$server_auth_environment" | grep -Fxq 'UPSTAND_DOCKER_BROKER_CLIENT_CERT_FILE=/run/secrets/cert.pem' \
  || fail "server must use its mTLS client certificate"
printf '%s\n' "$server_auth_environment" | grep -Fxq 'UPSTAND_DOCKER_BROKER_CLIENT_KEY_FILE=/run/secrets/key.pem' \
  || fail "server must use its mTLS client key"
schedules_auth_environment="$(docker_cmd service inspect --format '{{range .Spec.TaskTemplate.ContainerSpec.Env}}{{println .}}{{end}}' "${STACK_NAME}_schedules")" \
  || fail "schedules environment could not be inspected for Docker broker authentication"
printf '%s\n' "$schedules_auth_environment" | grep -Fxq 'UPSTAND_DOCKER_BROKER_TOKEN_FILE=/run/secrets/docker_broker_schedules_token' \
  || fail "schedules must use its caller-specific Docker broker Swarm secret"
printf '%s\n' "$schedules_auth_environment" | grep -Fxq 'DOCKER_HOST=https://docker-broker:2375' \
  || fail "schedules must use the HTTPS Docker broker transport"
printf '%s\n' "$schedules_auth_environment" | grep -Fxq 'DOCKER_TLS_VERIFY=1' \
  || fail "schedules Docker CLI must verify the broker TLS certificate"
printf '%s\n' "$schedules_auth_environment" | grep -Fxq 'DOCKER_CERT_PATH=/run/secrets' \
  || fail "schedules Docker CLI must use the mounted broker client certificate directory"
printf '%s\n' "$schedules_auth_environment" | grep -Fxq 'UPSTAND_DOCKER_BROKER_CA_FILE=/run/secrets/ca.pem' \
  || fail "schedules must use the mounted broker CA"
printf '%s\n' "$schedules_auth_environment" | grep -Fxq 'UPSTAND_DOCKER_BROKER_CLIENT_CERT_FILE=/run/secrets/cert.pem' \
  || fail "schedules must use its mTLS client certificate"
printf '%s\n' "$schedules_auth_environment" | grep -Fxq 'UPSTAND_DOCKER_BROKER_CLIENT_KEY_FILE=/run/secrets/key.pem' \
  || fail "schedules must use its mTLS client key"
worker_auth_environment="$(docker_cmd service inspect --format '{{range .Spec.TaskTemplate.ContainerSpec.Env}}{{println .}}{{end}}' "${STACK_NAME}_deployment-worker")" \
  || fail "deployment-worker environment could not be inspected for Docker broker authentication"
printf '%s\n' "$worker_auth_environment" | grep -Fxq 'UPSTAND_DOCKER_BROKER_TOKEN_FILE=/run/secrets/docker_broker_deployment_worker_token' \
  || fail "deployment-worker must use its caller-specific Docker broker Swarm secret"
printf '%s\n' "$worker_auth_environment" | grep -Fxq 'DOCKER_HOST=https://docker-broker:2375' \
  || fail "deployment-worker must use the HTTPS Docker broker transport"
printf '%s\n' "$worker_auth_environment" | grep -Fxq 'DOCKER_TLS_VERIFY=1' \
  || fail "deployment-worker Docker CLI must verify the broker TLS certificate"
printf '%s\n' "$worker_auth_environment" | grep -Fxq 'DOCKER_CERT_PATH=/run/secrets' \
  || fail "deployment-worker Docker CLI must use the mounted broker client certificate directory"
printf '%s\n' "$worker_auth_environment" | grep -Fxq 'UPSTAND_DOCKER_BROKER_CA_FILE=/run/secrets/ca.pem' \
  || fail "deployment-worker must use the mounted broker CA"
printf '%s\n' "$worker_auth_environment" | grep -Fxq 'UPSTAND_DOCKER_BROKER_CLIENT_CERT_FILE=/run/secrets/cert.pem' \
  || fail "deployment-worker must use its mTLS client certificate"
printf '%s\n' "$worker_auth_environment" | grep -Fxq 'UPSTAND_DOCKER_BROKER_CLIENT_KEY_FILE=/run/secrets/key.pem' \
  || fail "deployment-worker must use its mTLS client key"
broker_environment="$(docker_cmd service inspect --format '{{range .Spec.TaskTemplate.ContainerSpec.Env}}{{println .}}{{end}}' "${STACK_NAME}_docker-broker")" \
  || fail "service '${STACK_NAME}_docker-broker' environment could not be inspected for caller policy"
printf '%s\n' "$broker_environment" | grep -Fxq 'UPSTAND_DOCKER_BROKER_ALLOWED_CALLERS=server,schedules,deployment-worker' \
  || fail "Docker broker must use an explicit caller allowlist"
printf '%s\n' "$broker_environment" | grep -Eq '^UPSTAND_DOCKER_BROKER_MAX_INFLIGHT=[1-9][0-9]*$' \
  || fail "Docker broker must expose a bounded in-flight concurrency limit"
server_broker_caller="$(docker_cmd service inspect --format '{{range .Spec.TaskTemplate.ContainerSpec.Env}}{{println .}}{{end}}' "${STACK_NAME}_server" | sed -n 's/^UPSTAND_DOCKER_BROKER_CALLER=//p' | head -n 1)"
[[ "$server_broker_caller" == server ]] || fail "server must identify itself to the Docker broker"
schedules_broker_caller="$(docker_cmd service inspect --format '{{range .Spec.TaskTemplate.ContainerSpec.Env}}{{println .}}{{end}}' "${STACK_NAME}_schedules" | sed -n 's/^UPSTAND_DOCKER_BROKER_CALLER=//p' | head -n 1)"
[[ "$schedules_broker_caller" == schedules ]] || fail "schedules must identify itself to the Docker broker"
deployment_worker_broker_caller="$(docker_cmd service inspect --format '{{range .Spec.TaskTemplate.ContainerSpec.Env}}{{println .}}{{end}}' "${STACK_NAME}_deployment-worker" | sed -n 's/^UPSTAND_DOCKER_BROKER_CALLER=//p' | head -n 1)"
[[ "$deployment_worker_broker_caller" == deployment-worker ]] || fail "deployment-worker must identify itself to the Docker broker"
echo "acceptance: Docker broker service authentication is configured"

server_metrics_environment="$(docker_cmd service inspect --format '{{range .Spec.TaskTemplate.ContainerSpec.Env}}{{println .}}{{end}}' "${STACK_NAME}_server")" \
  || fail "service '${STACK_NAME}_server' environment could not be inspected for API metrics authentication"
printf '%s\n' "$server_metrics_environment" | grep -Fxq 'UPSTAND_METRICS_TOKEN_FILE=/run/secrets/metrics_token' \
  || fail "service '${STACK_NAME}_server' must protect API metrics with a Swarm secret"
echo "acceptance: API metrics authentication is configured"

schedules_environment="$(docker_cmd service inspect --format '{{range .Spec.TaskTemplate.ContainerSpec.Env}}{{println .}}{{end}}' "${STACK_NAME}_schedules")" \
  || fail "service '${STACK_NAME}_schedules' environment could not be inspected for backup policy"
backup_require_success="$(printf '%s\n' "$schedules_environment" | sed -n 's/^UPSTAND_BACKUP_ALERT_REQUIRE_SUCCESS=//p' | head -n 1)"
[[ "$backup_require_success" == "true" || "$backup_require_success" == "1" ]] \
  || fail "schedules backup freshness policy must require a successful backup"
backup_require_restore_verification="$(printf '%s\n' "$schedules_environment" | sed -n 's/^UPSTAND_BACKUP_ALERT_REQUIRE_RESTORE_VERIFICATION=//p' | head -n 1)"
[[ "$backup_require_restore_verification" == "true" || "$backup_require_restore_verification" == "1" ]] \
  || fail "schedules backup freshness policy must require restore verification"
backup_max_age_ms="$(printf '%s\n' "$schedules_environment" | sed -n 's/^UPSTAND_BACKUP_ALERT_MAX_AGE_MS=//p' | head -n 1)"
[[ "$backup_max_age_ms" =~ ^[1-9][0-9]*$ ]] \
  || fail "schedules backup freshness policy must have a positive maximum age"
echo "acceptance: mandatory control-plane backup freshness and restore-verification policy verified"

dr_readiness_gate="$(printf '%s\n' "$schedules_environment" | sed -n 's/^UPSTAND_DR_READINESS_GATE=//p' | head -n 1)"
if [[ "$dr_readiness_gate" == "true" || "$dr_readiness_gate" == "1" ]]; then
  for confirmation in \
    UPSTAND_DR_OFFSITE_CONFIRMED \
    UPSTAND_DR_KEY_ESCROW_CONFIRMED \
    UPSTAND_DR_IMMUTABLE_RETENTION_CONFIRMED; do
    value="$(printf '%s\n' "$schedules_environment" | sed -n "s/^${confirmation}=//p" | head -n 1)"
    [[ "$value" == "true" || "$value" == "1" ]] \
      || fail "installed recovery plan must confirm ${confirmation#UPSTAND_DR_}"
  done
  dr_rpo_seconds="$(printf '%s\n' "$schedules_environment" | sed -n 's/^UPSTAND_DR_RPO_SECONDS=//p' | head -n 1)"
  dr_rto_seconds="$(printf '%s\n' "$schedules_environment" | sed -n 's/^UPSTAND_DR_RTO_SECONDS=//p' | head -n 1)"
  [[ "$dr_rpo_seconds" =~ ^[1-9][0-9]*$ && "$dr_rto_seconds" =~ ^[1-9][0-9]*$ ]] \
    || fail "installed recovery plan must publish positive RPO and RTO seconds"
  dr_evidence_reference="$(printf '%s\n' "$schedules_environment" | sed -n 's/^UPSTAND_DR_EVIDENCE_REFERENCE=//p' | head -n 1)"
  [[ -n "$dr_evidence_reference" ]] \
    || fail "installed recovery plan must publish a non-secret evidence reference"
  [[ -n "$DR_EVIDENCE_FILE" && -n "$DR_EVIDENCE_SIGNATURE_FILE" && -n "$DR_EVIDENCE_PUBLIC_KEY_FILE" ]] \
    || fail "installation-specific recovery evidence files must be supplied when the DR readiness gate is enabled"
  [[ "$DR_EVIDENCE_MAX_AGE_SECONDS" =~ ^[1-9][0-9]*$ ]] \
    || fail "UPSTAND_DR_EVIDENCE_MAX_AGE_SECONDS must be a positive integer"
  verifier="$SCRIPT_DIR/verify-installation-recovery-evidence.sh"
  [[ -x "$verifier" ]] || fail "installation-specific recovery evidence verifier is unavailable"
  "$verifier" "$DR_EVIDENCE_FILE" "$DR_EVIDENCE_SIGNATURE_FILE" "$DR_EVIDENCE_PUBLIC_KEY_FILE" \
    "$dr_evidence_reference" "$dr_rpo_seconds" "$dr_rto_seconds" "$DR_EVIDENCE_MAX_AGE_SECONDS" \
    || fail "installation-specific disaster-recovery evidence could not be verified"
  echo "acceptance: installation-specific disaster-recovery evidence verified (rpo=${dr_rpo_seconds}s rto=${dr_rto_seconds}s reference=${dr_evidence_reference})"
else
  echo "acceptance: installation-specific disaster-recovery attestation not enabled (disposable/release environment)"
fi

server_environment="$(docker_cmd service inspect --format '{{json .Spec.TaskTemplate.ContainerSpec.Env}}' "${STACK_NAME}_server")" \
  || fail "service '${STACK_NAME}_server' environment could not be inspected"
monitoring_image="${server_environment#*UPSTAND_MONITORING_IMAGE=}"
monitoring_image="${monitoring_image%%\"*}"
[[ "$monitoring_image" =~ @sha256:[0-9a-fA-F]{64}$ ]] \
  || fail "server monitoring image is not pinned to an immutable image digest: $monitoring_image"
echo "acceptance: server monitoring image is pinned to an immutable digest"

assert_monitoring_agent() {
  local expected_image="$1"
  local container_id image health runtime_user capabilities readonly_rootfs
  local container_count=0

  while IFS= read -r container_id; do
    [[ -n "$container_id" ]] || continue
    ((container_count += 1))
    image="$(docker_cmd inspect --format '{{.Config.Image}}' "$container_id")" \
      || fail "monitoring agent '$container_id' image could not be inspected"
    [[ "$image" == "$expected_image" ]] \
      || fail "monitoring agent '$container_id' image does not match the pinned server configuration: $image"
    health="$(docker_cmd inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}no-healthcheck{{end}}' "$container_id")" \
      || fail "monitoring agent '$container_id' health could not be inspected"
    [[ "$health" == "healthy" ]] \
      || fail "monitoring agent '$container_id' is $health"
    runtime_user="$(docker_cmd inspect --format '{{.Config.User}}' "$container_id")" \
      || fail "monitoring agent '$container_id' runtime user could not be inspected"
    [[ -n "$runtime_user" && "$runtime_user" != "0" && "$runtime_user" != "root" ]] \
      || fail "monitoring agent '$container_id' is configured to run as root"
    capabilities="$(docker_cmd inspect --format '{{json .HostConfig.CapDrop}}' "$container_id")" \
      || fail "monitoring agent '$container_id' capabilities could not be inspected"
    [[ "$capabilities" == *'"ALL"'* ]] \
      || fail "monitoring agent '$container_id' does not drop all Linux capabilities: $capabilities"
    readonly_rootfs="$(docker_cmd inspect --format '{{.HostConfig.ReadonlyRootfs}}' "$container_id")" \
      || fail "monitoring agent '$container_id' filesystem mode could not be inspected"
    [[ "$readonly_rootfs" == "true" ]] \
      || fail "monitoring agent '$container_id' does not use a read-only root filesystem"
  done < <(docker_cmd ps -q --filter "label=com.upstand.component=monitoring-agent")

  if [[ "$container_count" -eq 0 ]]; then
    if [[ "$ALLOW_REMOTE_TASKS" == "true" ]]; then
      echo "acceptance: monitoring agent was not inspectable on this Docker node; remote-task mode did not claim its runtime health" >&2
    else
      fail "no inspectable monitoring agent container was found"
    fi
  else
    echo "acceptance: monitoring agent ready ($container_count local container(s)), image=$expected_image"
  fi
}

assert_monitoring_agent "$monitoring_image"

if [[ "$REQUIRE_OBSERVABILITY" == "true" ]]; then
  for service in server schedules deployment-worker web fumadocs; do
    assert_observability "${STACK_NAME}_${service}"
  done
fi

if [[ "$REQUIRE_HA" == "true" ]]; then
  [[ -n "$EXTERNAL_POSTGRES_SERVICE" || -z "$EXTERNAL_REDIS_SERVICE" ]] \
    || fail "an external PostgreSQL service must be provided with the external Redis service"
  [[ -n "$EXTERNAL_REDIS_SERVICE" || -z "$EXTERNAL_POSTGRES_SERVICE" ]] \
    || fail "an external Redis service must be provided with the external PostgreSQL service"

  for service in server schedules deployment-worker web fumadocs; do
    desired="$(docker_cmd service inspect --format '{{if .Spec.Mode.Replicated}}{{.Spec.Mode.Replicated.Replicas}}{{else}}0{{end}}' "${STACK_NAME}_${service}")"
    [[ "$desired" -ge 2 ]] || fail "HA mode requires at least two '$service' replicas"
  done

  for service in postgres redis; do
    service_name="${STACK_NAME}_${service}"
    if docker_cmd service inspect "$service_name" >/dev/null 2>&1; then
      desired="$(docker_cmd service inspect --format '{{if .Spec.Mode.Replicated}}{{.Spec.Mode.Replicated.Replicas}}{{else}}0{{end}}' "$service_name")"
      [[ "$desired" -eq 0 ]] \
        || fail "HA mode requires external data services; bundled '$service' has $desired replicas"
    fi
  done

  if [[ -n "$EXTERNAL_POSTGRES_SERVICE" ]]; then
    assert_service "$EXTERNAL_POSTGRES_SERVICE"
    assert_service "$EXTERNAL_REDIS_SERVICE"
    echo "acceptance: external PostgreSQL and Redis services verified"
  fi
  echo "acceptance: HA replica and external data-service requirements verified"
fi

echo "production-acceptance: passed"
