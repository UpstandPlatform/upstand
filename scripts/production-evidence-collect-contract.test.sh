#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$ROOT_DIR/scripts/production-evidence-collect.sh"

grep -Fq -- 'docker_cmd node ls --format' "$SCRIPT"
grep -Fq -- 'docker_cmd service ls --format' "$SCRIPT"
grep -Fq -- 'docker_cmd service ps "$service" --no-trunc' "$SCRIPT"
grep -Fq -- 'awk -v prefix="${STACK_NAME}_"' "$SCRIPT"
grep -Fq -- 'docker_cmd network inspect "$NETWORK_NAME"' "$SCRIPT"
grep -Fq -- 'docker_cmd info --format' "$SCRIPT"
grep -Fq -- 'docker_cmd ps --filter label=com.docker.swarm.service.name' "$SCRIPT"
grep -Fq -- 'capability_drop=' "$SCRIPT"
grep -Fq -- 'read_only_rootfs=' "$SCRIPT"
grep -Fq -- 'umask 077' "$SCRIPT"
grep -Fq -- 'chmod 700 "$OUTPUT_DIR"' "$SCRIPT"

if grep -Eq -- 'ContainerSpec\.Env|service logs|docker secret inspect' "$SCRIPT"; then
  echo "production evidence collector must not collect environment variables, secrets, or logs" >&2
  exit 1
fi

echo "production-evidence-collect-contract: passed"
