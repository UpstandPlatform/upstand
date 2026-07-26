#!/bin/sh
set -eu

network_name="${DOCKER_NETWORK:-upstand-network}"

if [ "$(docker info --format '{{.Swarm.LocalNodeState}}' 2>/dev/null || true)" != "active" ]; then
  echo "Initializing a single-node Docker Swarm for local Upstand development..."
  docker swarm init
fi

docker swarm update --task-history-limit 1

if ! docker network inspect "$network_name" >/dev/null 2>&1; then
  docker network create --driver overlay --attachable "$network_name"
fi
