#!/usr/bin/env bash
set -euo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/production-acceptance-cluster.sh"

grep -Fq -- '--node-local' "$SCRIPT"
grep -Fq -- 'StrictHostKeyChecking=yes' "$SCRIPT"
grep -Fq -- 'UserKnownHostsFile=' "$SCRIPT"
grep -Fq -- 'known_hosts file does not exist' "$SCRIPT"
grep -Fq -- 'node ls --format' "$SCRIPT"
grep -Fq -- 'failed_nodes' "$SCRIPT"
grep -Fq -- 'chmod 700' "$SCRIPT"
grep -Fq -- '"$remote_command"' "$SCRIPT"
if grep -Fq -- '"bash $remote_command"' "$SCRIPT"; then
  echo "cluster acceptance must not double-wrap the remote bash command" >&2
  exit 1
fi
if grep -Fq -- 'service inspect --format.*ContainerSpec.Env' "$SCRIPT"; then
  echo "cluster acceptance must not inspect service environments" >&2
  exit 1
fi
if grep -Fq -- 'docker_cmd service logs' "$SCRIPT"; then
  echo "cluster acceptance must not collect application logs" >&2
  exit 1
fi

echo "production-acceptance-cluster-contract: passed"
