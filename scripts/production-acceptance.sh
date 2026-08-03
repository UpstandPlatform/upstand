#!/usr/bin/env bash
set -euo pipefail

STACK_NAME="upstand"
REQUIRE_HA="false"
ALLOW_REMOTE_TASKS="false"
REQUIRE_OBSERVABILITY="true"
NODE_LOCAL_ONLY="false"
NETWORK_NAME="${DOCKER_NETWORK:-upstand-network}"
DOCKER_BIN="${DOCKER_BIN:-docker}"
REQUIRE_ENCRYPTED_NETWORK="${UPSTAND_ACCEPTANCE_REQUIRE_ENCRYPTED_NETWORK:-true}"
EXTERNAL_POSTGRES_SERVICE=""
EXTERNAL_REDIS_SERVICE=""

docker_cmd() {
  "$DOCKER_BIN" "$@"
}

usage() {
  cat >&2 <<'EOF'
Usage: production-acceptance.sh [--stack NAME] [--network NAME] [--require-ha] [--allow-remote-tasks] [--allow-unobserved] [--node-local] \
  [--external-postgres-service NAME] [--external-redis-service NAME]

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
  local process_users process_rows root_process

  if process_users="$(docker_cmd top "$container_id" -eo user 2>/dev/null)"; then
    process_rows="$(printf '%s\n' "$process_users" | tail -n +2 | sed '/^[[:space:]]*$/d')"
  else
    # Official stateful images may not include `ps`, which makes `docker top`
    # unavailable. Read process UIDs through a non-root exec instead so the
    # inspection shell itself cannot create a false root-process result.
    process_rows="$(docker_cmd exec --user 65534:65534 "$container_id" /bin/sh -ec '
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
    "${STACK_NAME}_migrate"|"${STACK_NAME}_server"|"${STACK_NAME}_schedules"|"${STACK_NAME}_web"|"${STACK_NAME}_fumadocs")
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
  local desired running image healthcheck container_id health service_networks container_count
  local readonly_rootfs container_readonly

  desired="$(docker_cmd service inspect --format '{{if .Spec.Mode.Replicated}}{{.Spec.Mode.Replicated.Replicas}}{{else}}0{{end}}' "$service_name")" \
    || fail "service '$service_name' does not exist"
  [[ "$desired" =~ ^[0-9]+$ && "$desired" -ge 1 ]] \
    || fail "service '$service_name' has no desired replicas"

  service_networks="$(docker_cmd service inspect --format '{{json .Spec.TaskTemplate.Networks}}' "$service_name")" \
    || fail "service '$service_name' networks could not be inspected"
  [[ "$service_networks" == *"$network_id"* ]] \
    || fail "service '$service_name' is not attached to network '$NETWORK_NAME': $service_networks"

  running="$(docker_cmd service ps "$service_name" --filter desired-state=running --format '{{.CurrentState}}' | grep -c '^Running ' || true)"
  [[ "$running" -eq "$desired" ]] \
    || fail "service '$service_name' converged at $running/$desired running tasks"

  image="$(docker_cmd service inspect --format '{{.Spec.TaskTemplate.ContainerSpec.Image}}' "$service_name")"
  [[ "$image" =~ @sha256:[0-9a-fA-F]{64}$ ]] \
    || fail "service '$service_name' is not pinned to an immutable image digest: $image"

  healthcheck="$(docker_cmd service inspect --format '{{json .Spec.TaskTemplate.ContainerSpec.Healthcheck}}' "$service_name")"
  [[ "$healthcheck" != "null" && "$healthcheck" != "{}" ]] \
    || fail "service '$service_name' has no configured container health check"
  if [[ "$service_name" == *_migrate || "$service_name" == *_server || "$service_name" == *_schedules ]]; then
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

  container_count=0
  while IFS= read -r container_id; do
    [[ -n "$container_id" ]] || continue
    ((container_count += 1))
    health="$(docker_cmd inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}no-healthcheck{{end}}' "$container_id")"
    [[ "$health" == "healthy" ]] \
      || fail "service '$service_name' container '$container_id' is $health"
    runtime_user="$(docker_cmd inspect --format '{{.Config.User}}' "$container_id")"
    [[ -n "$runtime_user" && "$runtime_user" != "0" && "$runtime_user" != "root" ]] \
      || {
        # Official stateful images such as PostgreSQL and Redis intentionally
        # leave Config.User empty because their entrypoints start as root and
        # then drop to the service account. Inspect the effective process table
        # when the image does not declare a static user; checking Config.User
        # alone would reject a healthy bundled deployment.
        assert_no_root_runtime_process \
          "$container_id" \
          "service '$service_name' container '$container_id'"
      }
    if [[ "$service_name" == *_migrate || "$service_name" == *_server || "$service_name" == *_schedules ]]; then
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

for service in server schedules web fumadocs; do
  assert_service "${STACK_NAME}_${service}"
done

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
  for service in server schedules web fumadocs; do
    assert_observability "${STACK_NAME}_${service}"
  done
fi

if [[ "$REQUIRE_HA" == "true" ]]; then
  [[ -n "$EXTERNAL_POSTGRES_SERVICE" || -z "$EXTERNAL_REDIS_SERVICE" ]] \
    || fail "an external PostgreSQL service must be provided with the external Redis service"
  [[ -n "$EXTERNAL_REDIS_SERVICE" || -z "$EXTERNAL_POSTGRES_SERVICE" ]] \
    || fail "an external Redis service must be provided with the external PostgreSQL service"

  for service in server schedules web fumadocs; do
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
